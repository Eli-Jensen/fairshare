import { describe, it, expect } from 'vitest'
import { buildSnapshot, snapshotToGrids, toBalanceInput } from '../sheetSnapshot'
import type { SheetExpense, SheetSnapshot, Grid } from '../sheetSnapshot'
import { parseGrids } from '../sheetParse'
import type { RawGrids } from '../sheetParse'
import { tripFixture, expensesFixture, membersFixture, PARTICIPANTS } from './sheetFixture'

/**
 * The test the whole sheet format exists to pass: a trip written out and read
 * back must be the same trip. If this drifts, a restore silently invents or
 * destroys money, and nothing else in the feature can be trusted.
 */

function snapshot(): SheetSnapshot {
  return buildSnapshot({
    trip: tripFixture(),
    expenses: expensesFixture(),
    members: membersFixture(),
    participants: PARTICIPANTS,
    currentUid: 'alice',
    exportedAt: '2026-07-29T00:00:00.000Z',
  })
}

function toRawGrids(grids: Grid[]): RawGrids {
  const byTitle = Object.fromEntries(grids.map((g) => [g.title, g.values]))
  return {
    expenses: byTitle.Expenses,
    people: byTitle.People,
    meta: byTitle.Meta,
  }
}

/** What the Sheets API actually returns: trailing empty cells are dropped. */
function raggedy(grids: RawGrids): RawGrids {
  const trim = (rows: (string | number | boolean)[][]) =>
    rows.map((row) => {
      const out = [...row]
      while (out.length > 0 && out[out.length - 1] === '') out.pop()
      return out
    })
  return {
    expenses: trim(grids.expenses),
    people: trim(grids.people),
    meta: trim(grids.meta),
  }
}

function roundTrip(mutate?: (g: RawGrids) => void) {
  const original = snapshot()
  const grids = raggedy(toRawGrids(snapshotToGrids(original).grids))
  mutate?.(grids)
  const result = parseGrids(grids)
  return { original, result, grids }
}

/** Compare only what a restore can carry: no doc ids, no authorship, no comments. */
function normalize(e: SheetExpense) {
  const round = (m: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(m).map(([k, v]) => [k, Math.round(v * 100) / 100])
    )
  return {
    date: e.date,
    isSettlement: e.isSettlement,
    categoryIds: [...e.categoryIds].sort(),
    description: e.description,
    notes: e.notes,
    currency: e.currency,
    amountOriginal: Math.round(e.amountOriginal * 100) / 100,
    exchangeRate: e.exchangeRate,
    amountSettled: Math.round(e.amountSettled * 100) / 100,
    splitType: e.splitType,
    paid: round(e.paid),
    shares: round(e.shares),
  }
}

describe('sheet round trip', () => {
  const { original, result } = roundTrip()

  it('parses without error', () => {
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
  })

  it('recovers the trip metadata', () => {
    if (!result.ok) throw new Error('parse failed')
    expect(result.snapshot.tripName).toBe(original.tripName)
    expect(result.snapshot.tripType).toBe(original.tripType)
    expect(result.snapshot.settlementCurrency).toBe(original.settlementCurrency)
    expect(result.snapshot.sourceTripId).toBe(original.sourceTripId)
    expect(result.snapshot.customCategories).toEqual(original.customCategories)
  })

  it('recovers every participant with their id, name, email and status', () => {
    if (!result.ok) throw new Error('parse failed')
    expect(result.snapshot.people).toEqual(original.people)
  })

  it('recovers every expense exactly', () => {
    if (!result.ok) throw new Error('parse failed')
    expect(result.snapshot.expenses.length).toBe(original.expenses.length)
    expect(result.snapshot.expenses.map(normalize)).toEqual(
      original.expenses.map(normalize)
    )
  })

  it('keeps every split summing exactly to its total', () => {
    if (!result.ok) throw new Error('parse failed')
    for (const e of result.snapshot.expenses) {
      const shares = Object.values(e.shares).reduce((s, v) => s + v, 0)
      const paid = Object.values(e.paid).reduce((s, v) => s + v, 0)
      expect(Math.round(shares * 100)).toBe(Math.round(e.amountSettled * 100))
      expect(Math.round(paid * 100)).toBe(Math.round(e.amountSettled * 100))
    }
  })


  it('survives a description that looks like a formula', () => {
    if (!result.ok) throw new Error('parse failed')
    const descriptions = result.snapshot.expenses.map((e) => e.description)
    expect(descriptions).toContain('=SUM(A1:A9) souvenir shop')
    expect(descriptions).toContain('-15 refund adjustment')
  })

  it('survives notes with quotes, commas, newlines and emoji', () => {
    if (!result.ok) throw new Error('parse failed')
    const hotel = result.snapshot.expenses.find((e) => e.description === 'Hotel')!
    expect(hotel.notes).toBe('Two rooms, "sea view", 3 nights\nbreakfast included')
    const souvenir = result.snapshot.expenses.find((e) =>
      e.description.startsWith('=SUM')
    )!
    expect(souvenir.notes).toBe('Receipt #12, 3/4 off — see photo 🧾')
  })

  it('preserves a multi-payer expense', () => {
    if (!result.ok) throw new Error('parse failed')
    const hotel = result.snapshot.expenses.find((e) => e.description === 'Hotel')!
    expect(hotel.paid).toEqual({ alice: 300, bob: 200 })
    expect(toBalanceInput(hotel).paidBy).toBe('alice')
  })

  it('preserves a single payer without inventing a paidByAmounts map', () => {
    if (!result.ok) throw new Error('parse failed')
    const lunch = result.snapshot.expenses.find((e) => e.description === 'Lunch')!
    expect(Object.keys(lunch.paid)).toEqual(['alice'])
    expect(toBalanceInput(lunch).paidByAmounts).toBeUndefined()
  })

  it('preserves the foreign currency, rate and original amount', () => {
    if (!result.ok) throw new Error('parse failed')
    const wine = result.snapshot.expenses.find((e) => e.description === 'Wine')!
    expect(wine.currency).toBe('EUR')
    expect(wine.amountOriginal).toBe(40)
    expect(wine.exchangeRate).toBe(1.1)
    expect(wine.amountSettled).toBe(44)
  })

  it('distinguishes a zero share from no share at all', () => {
    if (!result.ok) throw new Error('parse failed')
    const wine = result.snapshot.expenses.find((e) => e.description === 'Wine')!
    expect(wine.shares.ph_noemail).toBe(0)
    expect('ph_guest' in wine.shares).toBe(false)
  })

  it('preserves the settlement as a settlement', () => {
    if (!result.ok) throw new Error('parse failed')
    const settlement = result.snapshot.expenses.find((e) => e.isSettlement)!
    expect(settlement.splitType).toBe('exact')
    expect(settlement.shares).toEqual({ alice: 50 })
    expect(settlement.paid).toEqual({ bob: 50 })
  })

  it('keeps a removed member who still owes money', () => {
    if (!result.ok) throw new Error('parse failed')
    expect(result.snapshot.people.find((p) => p.id === 'carol')?.status).toBe('removed')
    const train = result.snapshot.expenses.find((e) => e.description === 'Train tickets')!
    expect(train.shares.carol).toBe(30)
  })

  it('preserves each split type, including odd-cent equal splits', () => {
    if (!result.ok) throw new Error('parse failed')
    const byDescription = Object.fromEntries(
      result.snapshot.expenses.map((e) => [e.description, e])
    )
    expect(byDescription.Lunch.splitType).toBe('equal')
    expect(byDescription['Boat tour'].splitType).toBe('percentage')
    expect(byDescription['Villa deposit'].splitType).toBe('shares')
    expect(byDescription.Wine.splitType).toBe('exact')
    // 100/3 — the largest-remainder cents must come back unchanged
    expect(byDescription.Taxi.shares).toEqual({ alice: 33.34, bob: 33.33, ph_guest: 33.33 })
    expect(byDescription.Taxi.splitType).toBe('equal')
  })

  it('preserves multiple categories and an unknown legacy id', () => {
    if (!result.ok) throw new Error('parse failed')
    const dinner = result.snapshot.expenses.find(
      (e) => e.description === 'Dinner and show'
    )!
    expect(dinner.categoryIds.sort()).toEqual(['entertainment', 'food'])
    const pharmacy = result.snapshot.expenses.find((e) => e.description === 'Pharmacy')!
    expect(pharmacy.categoryIds).toEqual(['health'])
    const gelato = result.snapshot.expenses.find((e) => e.description === 'Wine')!
    expect(gelato.categoryIds).toEqual(['gelato'])
  })
})

describe('sheet round trip, after the user edits the sheet', () => {
  it('recovers when the hidden machine header row is deleted', () => {
    const { original, result } = roundTrip((g) => {
      g.expenses.shift()
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.join(' ')).toContain('hidden header row is missing')
    // Every row still present, and the books still balance
    expect(result.snapshot.expenses.length).toBe(original.expenses.length)
    expect(result.snapshot.expenses.map(normalize)).toEqual(
      original.expenses.map(normalize)
    )
  })

  it('ignores notes a user typed below the table', () => {
    const { original, result } = roundTrip((g) => {
      g.expenses.push(['', '', '', 'my own running total', '', '', '', '', 999])
      g.expenses.push([])
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.expenses.length).toBe(original.expenses.length)
  })
})
