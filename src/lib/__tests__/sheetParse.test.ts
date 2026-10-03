import { describe, it, expect } from 'vitest'
import { parseGrids, payerFields } from '../sheetParse'
import type { RawGrids } from '../sheetParse'
import type { CellValue } from '../sheetSnapshot'
import { ymdToSerial } from '../sheetSnapshot'
import { MAX_RESTORE_EXPENSES } from '../limits'
import { todayString } from '../dates'

/**
 * Targeted parser cases. The end-to-end guarantee lives in
 * sheetRoundTrip.test.ts; these pin down the individual recovery and rejection
 * rules, most of which a well-formed sheet never reaches.
 */

// A minimal two-person sheet. Column order matches what snapshotToGrids writes.
const MACHINE_ROW = [
  'date',
  'type',
  'categories',
  'description',
  'notes',
  'currency',
  'amountOriginal',
  'exchangeRate',
  'amountSettled',
  'paid:alice',
  'share:alice',
  'paid:bob',
  'share:bob',
  'expenseId',
  'splitType',
  'categoryIds',
]
const HUMAN_ROW = [
  'Date',
  'Type',
  'Categories',
  'Description',
  'Notes',
  'Currency',
  'Original amount',
  'Rate',
  'Amount (USD)',
  'Alice paid',
  'Alice share',
  'Bob paid',
  'Bob share',
  'Expense ID',
  'Split type',
  'Category IDs',
]
const C = Object.fromEntries(MACHINE_ROW.map((k, i) => [k, i])) as Record<string, number>

interface RowSpec {
  id?: string
  date?: CellValue
  type?: string
  description?: string
  notes?: string
  currency?: string
  amountOriginal?: CellValue
  rate?: CellValue
  amount?: CellValue
  paidAlice?: CellValue
  shareAlice?: CellValue
  paidBob?: CellValue
  shareBob?: CellValue
  splitType?: string
  categories?: string
  categoryIds?: string
}

function row(spec: RowSpec = {}): CellValue[] {
  const r: CellValue[] = Array(MACHINE_ROW.length).fill('')
  r[C.date] = spec.date ?? ymdToSerial('2026-06-10')
  r[C.type] = spec.type ?? 'Expense'
  r[C.categories] = spec.categories ?? ''
  r[C.description] = spec.description ?? 'Lunch'
  r[C.notes] = spec.notes ?? ''
  r[C.currency] = spec.currency ?? 'USD'
  r[C.amountOriginal] = spec.amountOriginal ?? spec.amount ?? 100
  r[C.exchangeRate] = spec.rate ?? 1
  r[C.amountSettled] = spec.amount ?? 100
  r[C['paid:alice']] = spec.paidAlice ?? 100
  r[C['share:alice']] = spec.shareAlice ?? 50
  r[C['paid:bob']] = spec.paidBob ?? ''
  r[C['share:bob']] = spec.shareBob ?? 50
  r[C.expenseId] = spec.id ?? 'e1'
  r[C.splitType] = spec.splitType ?? 'exact'
  r[C.categoryIds] = spec.categoryIds ?? ''
  return r
}

function grids(rows: CellValue[][], overrides: Partial<RawGrids> = {}): RawGrids {
  return {
    meta: [
      ['key', 'value'],
      ['Key', 'Value'],
      ['schemaVersion', '1'],
      ['tripName', 'Trip'],
      ['tripType', 'trip'],
      ['settlementCurrency', 'USD'],
      ['sourceTripId', 'trip1'],
    ],
    people: [
      ['participantId', 'name', 'email', 'status', 'self'],
      ['Participant ID', 'Name', 'Email', 'Status', 'You'],
      ['alice', 'Alice', 'alice@test.com', 'member', 'TRUE'],
      ['bob', 'Bob', 'bob@test.com', 'member', ''],
    ],
    expenses: [MACHINE_ROW, HUMAN_ROW, ...rows],
    ...overrides,
  }
}

function ok(g: RawGrids) {
  const result = parseGrids(g)
  if (!result.ok) throw new Error(`expected a successful parse, got: ${result.error}`)
  return result
}

describe('rejections', () => {
  it('rejects a sheet with no Meta tab', () => {
    const result = parseGrids(grids([row()], { meta: [] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("doesn't look like a FairShare backup")
  })

  it('rejects a backup from a newer schema version', () => {
    const g = grids([row()])
    g.meta = [...g.meta, ['schemaVersion', '99']]
    const result = parseGrids(g)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('newer version of FairShare')
  })

  it('rejects an empty People tab', () => {
    const result = parseGrids(grids([row()], { people: [] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('People tab is empty')
  })

  it('rejects a sheet with no recognizable header', () => {
    const result = parseGrids(grids([], { expenses: [['nonsense', 'junk']] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("Couldn't find the header row")
  })

  it('rejects a sheet with no amount column', () => {
    const noAmount = MACHINE_ROW.filter((k) => k !== 'amountSettled')
    const result = parseGrids(
      grids([], { expenses: [noAmount, HUMAN_ROW.filter((h) => !h.startsWith('Amount'))] })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('no amounts to restore')
  })

  it('rejects a sheet where nobody has paid/share columns', () => {
    const orphaned = MACHINE_ROW.map((k) =>
      k.startsWith('paid:') || k.startsWith('share:') ? `${k}_gone` : k
    )
    const result = parseGrids(grids([], { expenses: [orphaned, HUMAN_ROW, row()] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('have paid/share columns')
  })

  it('rejects a sheet with no readable expenses', () => {
    const result = parseGrids(grids([]))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('No expenses could be read')
  })

  it('rejects more expenses than a restore can write', () => {
    const many = Array.from({ length: MAX_RESTORE_EXPENSES + 1 }, (_, i) =>
      row({ id: `e${i}` })
    )
    const result = parseGrids(grids(many))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(`more than the ${MAX_RESTORE_EXPENSES}`)
  })
})

describe('row selection', () => {
  it('skips the TOTAL row and blank rows', () => {
    const total: CellValue[] = Array(MACHINE_ROW.length).fill('')
    total[C.description] = 'TOTAL (expenses)'
    total[C.amountSettled] = 100
    const result = ok(grids([row(), total, [], Array(MACHINE_ROW.length).fill('')]))
    expect(result.snapshot.expenses.map((e) => e.expenseId)).toEqual(['e1'])
  })

  it('skips a duplicated expense id and warns', () => {
    const result = ok(grids([row(), row({ description: 'Copy' })]))
    expect(result.snapshot.expenses).toHaveLength(1)
    expect(result.snapshot.expenses[0].description).toBe('Lunch')
    expect(result.warnings.join(' ')).toContain('repeats an expense')
  })

  it('skips a row with nobody paying and warns', () => {
    const result = ok(
      grids([row(), row({ id: 'e2', description: 'Ghost', paidAlice: '', paidBob: '' })])
    )
    expect(result.snapshot.expenses).toHaveLength(1)
    expect(result.warnings.join(' ')).toContain('nobody marked as paying')
  })

  it('skips a row with no shares and warns', () => {
    const result = ok(
      grids([row(), row({ id: 'e2', description: 'Ghost', shareAlice: '', shareBob: '' })])
    )
    expect(result.snapshot.expenses).toHaveLength(1)
    expect(result.warnings.join(' ')).toContain('no shares')
  })
})

describe('amounts', () => {
  it('nudges shares that are off by a cent back onto the total', () => {
    const result = ok(grids([row({ shareAlice: 50.01, shareBob: 49.98 })]))
    const shares = result.snapshot.expenses[0].shares
    expect(Math.round((shares.alice + shares.bob) * 100)).toBe(10000)
    // A sub-tolerance correction is rounding, not a disagreement — no warning
    expect(result.warnings).toEqual([])
  })

  // AMOUNT_TOLERANCE is 0.02: at or under it the drift is rounding we can
  // absorb, past it the sheet and the total genuinely disagree and the user has
  // to decide which is right
  it('absorbs a drift at the tolerance boundary', () => {
    const result = ok(grids([row({ shareAlice: 50, shareBob: 49.98 })]))
    const shares = result.snapshot.expenses[0].shares
    expect(Math.round((shares.alice + shares.bob) * 100)).toBe(10000)
    expect(result.warnings).toEqual([])
  })

  it('reports a drift past the tolerance instead of silently fixing it', () => {
    const result = parseGrids(grids([row({ shareAlice: 50, shareBob: 49.97 })]))
    expect(result.ok).toBe(false)
    expect(result.warnings.join(' ')).toContain('shares add up to 99.97')
  })

  it('reports a large drift and blocks the restore, saying by how much', () => {
    const result = parseGrids(grids([row({ shareAlice: 50, shareBob: 45 })]))
    expect(result.ok).toBe(false)
    expect(result.warnings.join(' ')).toContain('shares add up to 95')
    if (!result.ok) {
      expect(result.error).toContain("don't balance")
      expect(result.error).toContain('off by 5 ')
    }
  })

  it('keeps the settled amount authoritative when the rate disagrees', () => {
    // 40 x 1.5 = 60, not the 100 recorded — the recorded amount wins, because
    // recomputing it would move everyone's balance
    const result = ok(grids([row({ amountOriginal: 40, rate: 1.5, amount: 100 })]))
    expect(result.snapshot.expenses[0].amountSettled).toBe(100)
    expect(result.snapshot.expenses[0].amountOriginal).toBe(40)
    expect(result.snapshot.expenses[0].exchangeRate).toBe(1.5)
    expect(result.warnings.join(' ')).toContain("don't match the USD amount")
  })

  it('parses an amount a user retyped with a currency symbol', () => {
    const result = ok(grids([row({ amount: '$100.00', paidAlice: '1,00.00' })]))
    expect(result.snapshot.expenses[0].amountSettled).toBe(100)
  })

  it('does not read a number out of a description', () => {
    const result = ok(grids([row({ description: '-15 refund' })]))
    expect(result.snapshot.expenses[0].description).toBe('-15 refund')
    expect(result.snapshot.expenses[0].amountSettled).toBe(100)
  })
})

describe('payers', () => {
  it('names a single payer with no paidByAmounts map', () => {
    const result = ok(grids([row()]))
    expect(payerFields(result.snapshot.expenses[0].paid)).toEqual({ paidBy: 'alice' })
  })

  it('keeps both payers and picks the largest as paidBy', () => {
    const result = ok(grids([row({ paidAlice: 40, paidBob: 60 })]))
    expect(payerFields(result.snapshot.expenses[0].paid)).toEqual({
      paidBy: 'bob',
      paidByAmounts: { alice: 40, bob: 60 },
    })
  })
})

describe('split types', () => {
  it('keeps an even split marked as equal', () => {
    const result = ok(grids([row({ splitType: 'equal' })]))
    expect(result.snapshot.expenses[0].splitType).toBe('equal')
  })

  it('coerces an uneven "equal" split to exact so the shares survive an edit', () => {
    // ExpenseForm re-derives equal shares from the participant list, so leaving
    // this as 'equal' would silently re-equalize 70/30 the next time it's opened
    const result = ok(grids([row({ splitType: 'equal', shareAlice: 70, shareBob: 30 })]))
    expect(result.snapshot.expenses[0].splitType).toBe('exact')
    expect(result.snapshot.expenses[0].shares).toEqual({ alice: 70, bob: 30 })
    expect(result.warnings.join(' ')).toContain('saved as an exact split')
  })

  it('tolerates the odd cent in an equal split', () => {
    const result = ok(
      grids([row({ amount: 100, splitType: 'equal', shareAlice: 50.01, shareBob: 49.99 })])
    )
    expect(result.snapshot.expenses[0].splitType).toBe('equal')
  })

  it('falls back to exact for an unrecognized split type', () => {
    const result = ok(grids([row({ splitType: 'sideways' })]))
    expect(result.snapshot.expenses[0].splitType).toBe('exact')
  })

  it('forces a settlement to exact whatever the sheet says', () => {
    const result = ok(
      grids([row({ type: 'Settlement', splitType: 'equal', shareAlice: 100, shareBob: '' })])
    )
    expect(result.snapshot.expenses[0].isSettlement).toBe(true)
    expect(result.snapshot.expenses[0].splitType).toBe('exact')
    expect(result.snapshot.expenses[0].shares).toEqual({ alice: 100 })
  })
})

describe('dates', () => {
  it('reads a date serial', () => {
    const result = ok(grids([row({ date: ymdToSerial('2026-03-08') })]))
    expect(result.snapshot.expenses[0].date).toBe('2026-03-08')
  })

  it('accepts a hand-typed ISO date', () => {
    const result = ok(grids([row({ date: '2026-12-25' })]))
    expect(result.snapshot.expenses[0].date).toBe('2026-12-25')
  })

  it("falls back to today's date and warns for an unreadable date", () => {
    const result = ok(grids([row({ date: 'next tuesday' })]))
    expect(result.snapshot.expenses[0].date).toBe(todayString())
    expect(result.warnings.join(' ')).toContain('unreadable date')
  })
})

describe('categories', () => {
  it('prefers the hidden category ids', () => {
    const result = ok(grids([row({ categoryIds: 'food,transport', categories: 'Ignored' })]))
    expect(result.snapshot.expenses[0].categoryIds).toEqual(['food', 'transport'])
  })

  it('passes an unknown category id through untouched', () => {
    const result = ok(grids([row({ categoryIds: 'health' })]))
    expect(result.snapshot.expenses[0].categoryIds).toEqual(['health'])
  })

  it('matches labels back to ids when the id column is gone', () => {
    const result = ok(grids([row({ categories: 'Food, Transport' })]))
    expect(result.snapshot.expenses[0].categoryIds).toEqual(['food', 'transport'])
  })

  it('resolves a custom category label from the Meta tab', () => {
    const g = grids([row({ categories: 'Gelato' })])
    g.meta = [
      ...g.meta,
      ['customCategoriesJson', JSON.stringify([{ id: 'gelato', label: 'Gelato', emoji: '🍨' }])],
    ]
    const result = ok(g)
    expect(result.snapshot.expenses[0].categoryIds).toEqual(['gelato'])
  })

  it('drops an unmatchable label rather than inventing a category', () => {
    const result = ok(grids([row({ categories: 'Interpretive Dance' })]))
    expect(result.snapshot.expenses[0].categoryIds).toEqual([])
  })

  it('warns and continues when custom categories are unreadable', () => {
    const g = grids([row()])
    g.meta = [...g.meta, ['customCategoriesJson', '{not json']]
    const result = ok(g)
    expect(result.warnings.join(' ')).toContain('Custom categories')
  })
})

describe('people', () => {
  it('lowercases emails so the claim-on-join match works', () => {
    const g = grids([row()])
    g.people[2] = ['alice', 'Alice', 'Alice@TEST.com', 'member', 'TRUE']
    expect(ok(g).snapshot.people[0].email).toBe('alice@test.com')
  })

  it('keeps a participant with no email', () => {
    const g = grids([row()])
    g.people[3] = ['bob', 'Dana', '', 'invited', '']
    const dana = ok(g).snapshot.people[1]
    expect(dana.name).toBe('Dana')
    expect(dana.email).toBe('')
  })

  it('falls back to invited for an unrecognized status', () => {
    const g = grids([row()])
    g.people[3] = ['bob', 'Bob', 'bob@test.com', 'honoured guest', '']
    expect(ok(g).snapshot.people[1].status).toBe('invited')
  })

  it('warns about a person with no columns in the Expenses tab', () => {
    const g = grids([row()])
    g.people.push(['carol', 'Carol', 'carol@test.com', 'member', ''])
    expect(ok(g).warnings.join(' ')).toContain('"Carol" has no columns')
  })

  it('skips a duplicated participant row and warns', () => {
    const g = grids([row()])
    g.people.push(['alice', 'Alice Again', 'alice@test.com', 'member', ''])
    const result = ok(g)
    expect(result.snapshot.people).toHaveLength(2)
    expect(result.warnings.join(' ')).toContain('more than once')
  })
})

describe('metadata fallbacks', () => {
  it('assumes USD and warns when the currency is missing', () => {
    const g = grids([row()])
    g.meta = g.meta.filter((r) => r[0] !== 'settlementCurrency')
    const result = ok(g)
    expect(result.snapshot.settlementCurrency).toBe('USD')
    expect(result.warnings.join(' ')).toContain('no settlement currency')
  })

  it('names the trip and warns when the name is missing', () => {
    const g = grids([row()])
    g.meta = g.meta.filter((r) => r[0] !== 'tripName')
    const result = ok(g)
    expect(result.snapshot.tripName).toBe('Restored trip')
    expect(result.warnings.join(' ')).toContain('no trip name')
  })

  it('reads the group type', () => {
    const g = grids([row()])
    g.meta = [...g.meta, ['tripType', 'group']]
    expect(ok(g).snapshot.tripType).toBe('group')
  })
})

describe('a sheet whose hidden columns were deleted', () => {
  it('identifies rows by position and warns', () => {
    const withoutIds = MACHINE_ROW.filter(
      (k) => k !== 'expenseId' && k !== 'splitType' && k !== 'categoryIds'
    )
    const human = HUMAN_ROW.slice(0, 13)
    const dataRow = row().slice(0, 13)
    const result = ok(grids([], { expenses: [withoutIds, human, dataRow] }))
    expect(result.snapshot.expenses).toHaveLength(1)
    expect(result.snapshot.expenses[0].expenseId).toBe('row-3')
    expect(result.warnings.join(' ')).toContain('Expense ID column is gone')
  })
})
