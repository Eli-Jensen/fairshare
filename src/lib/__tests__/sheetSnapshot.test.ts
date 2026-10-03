import { describe, it, expect } from 'vitest'
import {
  buildSnapshot,
  currencyNumberPattern,
  hashSnapshot,
  largestPayer,
  serialToYmd,
  snapshotToGrids,
  toBalanceInput,
  ymdToSerial,
  FIXED_COLUMN_COUNT,
  TRAILING_COLUMN_COUNT,
  TABS,
} from '../sheetSnapshot'
import type { SheetExpense, SheetSnapshot } from '../sheetSnapshot'
import { computeBalances } from '../settlement'
import { tripFixture, expensesFixture, membersFixture, PARTICIPANTS } from './sheetFixture'

describe('ymdToSerial / serialToYmd', () => {
  it('maps the Sheets epoch anchor', () => {
    // 1970-01-01 is serial 25569 in Sheets' 1899-12-30 day count
    expect(ymdToSerial('1970-01-01')).toBe(25569)
    expect(serialToYmd(25569)).toBe('1970-01-01')
  })

  it('round-trips a leap day', () => {
    expect(serialToYmd(ymdToSerial('2024-02-29'))).toBe('2024-02-29')
  })

  it('round-trips dates across a DST boundary', () => {
    // The hazard the dates.ts module exists to avoid: these are date-only
    // values, so they must not shift when the local clock jumps
    for (const d of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-11-01']) {
      expect(serialToYmd(ymdToSerial(d))).toBe(d)
    }
  })

  it('round-trips a year of consecutive dates', () => {
    let serial = ymdToSerial('2026-01-01')
    for (let i = 0; i < 400; i++, serial++) {
      expect(ymdToSerial(serialToYmd(serial))).toBe(serial)
    }
  })

  it('floors a fractional serial to its day', () => {
    expect(serialToYmd(ymdToSerial('2026-07-29') + 0.75)).toBe('2026-07-29')
  })
})

describe('currencyNumberPattern', () => {
  it('puts a leading symbol before the number', () => {
    expect(currencyNumberPattern('USD')).toBe('"$"#,##0.00')
    expect(currencyNumberPattern('EUR')).toBe('"€"#,##0.00')
    expect(currencyNumberPattern('JPY')).toBe('"¥"#,##0.00')
  })

  it('uses the code itself when there is no symbol', () => {
    expect(currencyNumberPattern('XYZ')).toBe('"XYZ"#,##0.00')
  })

  it('falls back for a malformed code rather than throwing', () => {
    expect(currencyNumberPattern('BAD!')).toBe('#,##0.00" BAD!"')
  })
})

describe('largestPayer', () => {
  it('picks the biggest contributor', () => {
    expect(largestPayer({ a: 10, b: 40, c: 30 })).toBe('b')
  })

  it('returns an empty string for no payers', () => {
    expect(largestPayer({})).toBe('')
  })
})

describe('buildSnapshot', () => {
  const snapshot = buildSnapshot({
    trip: tripFixture(),
    expenses: expensesFixture(),
    members: membersFixture(),
    participants: PARTICIPANTS,
    currentUid: 'alice',
    exportedAt: '2026-07-29T00:00:00.000Z',
  })

  it('carries the trip metadata through', () => {
    expect(snapshot.tripName).toBe('Italy 2026')
    expect(snapshot.settlementCurrency).toBe('USD')
    expect(snapshot.schemaVersion).toBe(1)
    expect(snapshot.sourceTripId).toBe('trip1')
  })

  it('orders people as members, then guests, then removed', () => {
    expect(snapshot.people.map((p) => p.id)).toEqual([
      'alice',
      'bob',
      'ph_guest',
      'ph_noemail',
      'carol',
    ])
    expect(snapshot.people.map((p) => p.status)).toEqual([
      'member',
      'member',
      'invited',
      'invited',
      'removed',
    ])
  })

  it('marks the exporting user', () => {
    expect(snapshot.people.filter((p) => p.isSelf).map((p) => p.id)).toEqual(['alice'])
  })

  it('records the plain name for a guest with no email', () => {
    const guest = snapshot.people.find((p) => p.id === 'ph_noemail')
    expect(guest?.name).toBe('Dana')
    expect(guest?.email).toBe('')
  })

  it('sorts expenses chronologically', () => {
    const dates = snapshot.expenses.map((e) => e.date)
    expect([...dates]).toEqual([...dates].sort())
  })

  it('expands a single payer into the paid map', () => {
    const lunch = snapshot.expenses.find((e) => e.description === 'Lunch')!
    expect(lunch.paid).toEqual({ alice: 60 })
  })

  it('keeps a multi-payer map as written', () => {
    const hotel = snapshot.expenses.find((e) => e.description === 'Hotel')!
    expect(hotel.paid).toEqual({ alice: 300, bob: 200 })
  })

  it('preserves a zero share as a real value', () => {
    const excluded = snapshot.expenses.find((e) => e.description === 'Wine')!
    expect(excluded.shares.ph_noemail).toBe(0)
  })
})

describe('snapshotToGrids', () => {
  const snapshot = buildSnapshot({
    trip: tripFixture(),
    expenses: expensesFixture(),
    members: membersFixture(),
    participants: PARTICIPANTS,
    currentUid: 'alice',
    exportedAt: '2026-07-29T00:00:00.000Z',
  })
  const { grids, layout } = snapshotToGrids(snapshot)
  const byTitle = Object.fromEntries(grids.map((g) => [g.title, g]))

  it('emits the four tabs with stable sheet ids', () => {
    expect(grids.map((g) => g.title)).toEqual(['Expenses', 'People', 'Summary', 'Meta'])
    expect(grids.map((g) => g.sheetId)).toEqual([1, 2, 3, 4])
    expect(TABS.expenses.sheetId).toBe(1)
  })

  it('writes the documented machine keys in row 1', () => {
    const machine = byTitle.Expenses.values[0]
    expect(machine.slice(0, FIXED_COLUMN_COUNT)).toEqual([
      'date',
      'type',
      'categories',
      'description',
      'notes',
      'currency',
      'amountOriginal',
      'exchangeRate',
      'amountSettled',
    ])
    expect(machine.slice(-TRAILING_COLUMN_COUNT)).toEqual([
      'expenseId',
      'splitType',
      'categoryIds',
    ])
  })

  it('keys participant columns by id, not by name', () => {
    const machine = byTitle.Expenses.values[0]
    expect(machine).toContain('paid:ph_noemail')
    expect(machine).toContain('share:ph_noemail')
  })

  it('annotates participant headers the way the CSV export does', () => {
    const human = byTitle.Expenses.values[1] as string[]
    expect(human).toContain('guest@test.com (invited) paid')
    expect(human).toContain('Carol (removed) share')
    expect(human).toContain('Amount (USD)')
  })

  it('writes amounts as numbers and dates as serials', () => {
    const row = byTitle.Expenses.values[2]
    expect(typeof row[0]).toBe('number')
    expect(typeof row[8]).toBe('number')
  })

  it('distinguishes an uninvolved participant from one with a zero share', () => {
    // Wine excludes ph_guest entirely but gives ph_noemail an explicit 0. Both
    // must survive: a blank means "not in this split", a 0 means "in it, owes
    // nothing" — and collapsing the two would change the split type on restore.
    const machine = byTitle.Expenses.values[0] as string[]
    const wine = byTitle.Expenses.values.find((r) => r[3] === 'Wine')!
    expect(wine[machine.indexOf('share:ph_guest')]).toBe('')
    expect(wine[machine.indexOf('share:ph_noemail')]).toBe(0)
    // …and only the payer has a paid cell
    expect(wine[machine.indexOf('paid:bob')]).toBe(44)
    expect(wine[machine.indexOf('paid:alice')]).toBe('')
  })

  it('totals expenses only, excluding settlements', () => {
    const total = byTitle.Expenses.values.at(-1)!
    expect(total[3]).toBe('TOTAL (expenses)')
    const expected = snapshot.expenses
      .filter((e) => !e.isSettlement)
      .reduce((s, e) => s + e.amountSettled, 0)
    expect(total[8]).toBeCloseTo(expected, 2)
  })

  it('sizes the grid to the documented formulas', () => {
    const n = snapshot.people.length
    expect(layout.participantCount).toBe(n)
    expect(layout.expensesColumnCount).toBe(
      FIXED_COLUMN_COUNT + 2 * n + TRAILING_COLUMN_COUNT
    )
    expect(layout.machineColumnStart).toBe(FIXED_COLUMN_COUNT + 2 * n)
    // 2 header rows + the expenses + a blank + the total
    expect(layout.expensesRowCount).toBe(2 + snapshot.expenses.length + 2)
  })

  it('gives every Expenses row the same width', () => {
    const widths = new Set(byTitle.Expenses.values.map((r) => r.length))
    expect(widths.size).toBe(1)
    expect([...widths][0]).toBe(layout.expensesColumnCount)
  })

  it('lists every participant on the People tab with their id and status', () => {
    const rows = byTitle.People.values.slice(2)
    expect(rows.map((r) => r[0])).toEqual(snapshot.people.map((p) => p.id))
    expect(rows.find((r) => r[0] === 'carol')?.[3]).toBe('removed')
  })

  it("reports balances on Summary that match the settlement algorithm", () => {
    const balances = computeBalances(
      snapshot.expenses.map(toBalanceInput),
      snapshot.people.map((p) => p.id)
    )
    const aliceRow = byTitle.Summary.values.find((r) => r[0] === 'Alice')!
    expect(aliceRow[3]).toBeCloseTo(balances.alice, 2)
  })

  it('records the schema version and the overwrite warning in Meta', () => {
    const meta = Object.fromEntries(byTitle.Meta.values.map((r) => [r[0], r[1]]))
    expect(meta.schemaVersion).toBe('1')
    expect(meta.settlementCurrency).toBe('USD')
    expect(meta.sourceTripId).toBe('trip1')
    expect(String(meta.note)).toContain('do not sync back')
    expect(String(meta.notBackedUp)).toContain('comments')
  })
})

describe('hashSnapshot', () => {
  const base = (): SheetSnapshot =>
    buildSnapshot({
      trip: tripFixture(),
      expenses: expensesFixture(),
      members: membersFixture(),
      participants: PARTICIPANTS,
      currentUid: 'alice',
      exportedAt: '2026-07-29T00:00:00.000Z',
    })

  it('is stable across runs', () => {
    expect(hashSnapshot(base())).toBe(hashSnapshot(base()))
  })

  it('ignores the export timestamp, which changes every sync', () => {
    const a = base()
    const b = { ...base(), exportedAt: '2030-01-01T00:00:00.000Z' }
    expect(hashSnapshot(a)).toBe(hashSnapshot(b))
  })

  it('ignores object key ordering', () => {
    const a = base()
    const b = base()
    // Same data, keys inserted in the opposite order — JSON.stringify would
    // give a different string, the canonical rendering must not
    b.expenses[0] = Object.fromEntries(
      Object.entries(b.expenses[0]).reverse()
    ) as SheetExpense
    expect(hashSnapshot(a)).toBe(hashSnapshot(b))
  })

  it('changes when an amount changes', () => {
    const b = base()
    b.expenses[0].amountSettled += 0.01
    expect(hashSnapshot(b)).not.toBe(hashSnapshot(base()))
  })

  it('changes when a split changes', () => {
    const b = base()
    const key = Object.keys(b.expenses[0].shares)[0]
    b.expenses[0].shares[key] += 0.01
    expect(hashSnapshot(b)).not.toBe(hashSnapshot(base()))
  })

  it('changes when a participant is added', () => {
    const b = base()
    b.people.push({
      id: 'new',
      name: 'New',
      email: 'new@test.com',
      status: 'invited',
      isSelf: false,
    })
    expect(hashSnapshot(b)).not.toBe(hashSnapshot(base()))
  })

  it('changes when the trip is renamed', () => {
    expect(hashSnapshot({ ...base(), tripName: 'Elsewhere' })).not.toBe(
      hashSnapshot(base())
    )
  })
})

describe('toBalanceInput', () => {
  it('omits paidByAmounts for a single payer', () => {
    const input = toBalanceInput({
      expenseId: 'e',
      date: '2026-01-01',
      isSettlement: false,
      categoryIds: [],
      description: '',
      notes: '',
      currency: 'USD',
      amountOriginal: 10,
      exchangeRate: 1,
      amountSettled: 10,
      splitType: 'exact',
      paid: { alice: 10 },
      shares: { alice: 10 },
    })
    expect(input.paidBy).toBe('alice')
    expect(input.paidByAmounts).toBeUndefined()
  })

  it('keeps paidByAmounts and the largest payer for multiple payers', () => {
    const input = toBalanceInput({
      expenseId: 'e',
      date: '2026-01-01',
      isSettlement: false,
      categoryIds: [],
      description: '',
      notes: '',
      currency: 'USD',
      amountOriginal: 10,
      exchangeRate: 1,
      amountSettled: 10,
      splitType: 'exact',
      paid: { alice: 4, bob: 6 },
      shares: { alice: 5, bob: 5 },
    })
    expect(input.paidBy).toBe('bob')
    expect(input.paidByAmounts).toEqual({ alice: 4, bob: 6 })
  })
})
