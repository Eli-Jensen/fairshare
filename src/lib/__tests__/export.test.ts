import { describe, it, expect } from 'vitest'
import { tripToCsv } from '../export'
import type { Expense, UserProfile } from '../types'
import { Timestamp } from 'firebase/firestore'

const now = Timestamp.now()

const members: Record<string, UserProfile> = {
  alice: { uid: 'alice', displayName: 'Alice', email: 'alice@test.com', photoURL: null },
  bob: { uid: 'bob', displayName: 'Bob', email: 'bob@test.com', photoURL: null },
}

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    description: 'Lunch',
    amount: 100,
    currency: 'USD',
    exchangeRate: 1,
    amountSettled: 100,
    paidBy: 'alice',
    splitType: 'equal',
    splits: { alice: 50, bob: 50 },
    createdBy: 'alice',
    createdAt: now,
    date: now,
    ...overrides,
  }
}

// The expense row for `description`, as cells. Test descriptions and payer
// labels contain no commas, so a plain split is safe here.
function rowFor(csv: string, description: string): string[] {
  const row = csv.split('\n').map((l) => l.split(',')).find((cells) => cells[3] === description)
  if (!row) throw new Error(`no row for ${description}`)
  return row
}

describe('tripToCsv', () => {
  it('writes the trip header and every section', () => {
    const csv = tripToCsv('Beach Trip', [expense()], members, ['alice', 'bob'])
    for (const heading of [
      'Trip: Beach Trip',
      'Per-Person Spending',
      'Total Paid',
      'Balances',
      'Remaining Settlements',
    ]) {
      expect(csv).toContain(heading)
    }
  })

  it('includes expense rows', () => {
    const csv = tripToCsv('Trip', [expense()], members, ['alice', 'bob'])
    expect(csv).toContain('Lunch')
    expect(csv).toContain('Alice')
  })

  it('includes total row for expenses', () => {
    const csv = tripToCsv('Trip', [expense({ amountSettled: 100 })], members, ['alice', 'bob'])
    expect(csv).toContain('TOTAL (expenses)')
    expect(csv).toContain('$100.00')
  })

  it('excludes settlements from total', () => {
    const expenses = [
      expense({ id: 'e1', amountSettled: 100 }),
      expense({ id: 'e2', description: 'Payment', amountSettled: 50, isSettlement: true, splits: { alice: 50 } }),
    ]
    const csv = tripToCsv('Trip', expenses, members, ['alice', 'bob'])
    // Total should be 100 (only expense), not 150
    const lines = csv.split('\n')
    const totalLine = lines.find((l) => l.includes('TOTAL (expenses)'))
    expect(totalLine).toContain('$100.00')
  })

  // Asserts on the row's Type cell: the word "Settlement" is always somewhere
  // in the file (the "Remaining Settlements" heading), so a whole-file
  // toContain could never fail.
  it('labels settlement rows as settlements and expense rows as expenses', () => {
    const csv = tripToCsv('Trip', [
      expense({ id: 'e1', description: 'Lunch' }),
      expense({ id: 'e2', isSettlement: true, description: 'Payment' }),
    ], members, ['alice', 'bob'])
    expect(rowFor(csv, 'Lunch')[1]).toBe('Expense')
    expect(rowFor(csv, 'Payment')[1]).toBe('Settlement')
  })

  // Asserts on the Paid By cell: both names are always in the column headers.
  it('lists every payer and their amount for multi-payer expenses', () => {
    const csv = tripToCsv('Trip', [
      expense({ paidByAmounts: { alice: 60, bob: 40 } }),
    ], members, ['alice', 'bob'])
    expect(rowFor(csv, 'Lunch')[8]).toBe('Alice $60.00 + Bob $40.00')
  })

  it('names the single payer when there is no paidByAmounts', () => {
    const csv = tripToCsv('Trip', [expense({ paidBy: 'bob' })], members, ['alice', 'bob'])
    expect(rowFor(csv, 'Lunch')[8]).toBe('Bob')
  })

  it('escapes CSV values with commas', () => {
    const csv = tripToCsv('Trip', [
      expense({ description: 'Dinner, drinks' }),
    ], members, ['alice', 'bob'])
    expect(csv).toContain('"Dinner, drinks"')
  })

  it('escapes CSV values with quotes', () => {
    const csv = tripToCsv('Trip', [
      expense({ description: 'The "best" restaurant' }),
    ], members, ['alice', 'bob'])
    expect(csv).toContain('"The ""best"" restaurant"')
  })

  it('handles multi-tag categories', () => {
    const csv = tripToCsv('Trip', [
      expense({ categories: ['food', 'entertainment'] }),
    ], members, ['alice', 'bob'])
    expect(csv).toContain('Food')
    expect(csv).toContain('Fun')
  })

  it('handles empty expense list', () => {
    const csv = tripToCsv('Trip', [], members, ['alice', 'bob'])
    expect(csv).toContain('TOTAL (expenses)')
    expect(csv).toContain('$0.00')
  })
})
