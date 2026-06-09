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

describe('tripToCsv', () => {
  it('generates CSV with trip name header', () => {
    const csv = tripToCsv('Beach Trip', [], members, ['alice', 'bob'])
    expect(csv).toContain('Trip: Beach Trip')
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

  it('labels settlements correctly', () => {
    const csv = tripToCsv('Trip', [
      expense({ isSettlement: true, description: 'Payment' }),
    ], members, ['alice', 'bob'])
    expect(csv).toContain('Settlement')
  })

  it('handles multi-payer expenses', () => {
    const csv = tripToCsv('Trip', [
      expense({ paidByAmounts: { alice: 60, bob: 40 } }),
    ], members, ['alice', 'bob'])
    expect(csv).toContain('Alice')
    expect(csv).toContain('Bob')
  })

  it('includes per-person spending section', () => {
    const csv = tripToCsv('Trip', [expense()], members, ['alice', 'bob'])
    expect(csv).toContain('Per-Person Spending')
    expect(csv).toContain('Total Paid')
  })

  it('includes balances section', () => {
    const csv = tripToCsv('Trip', [expense()], members, ['alice', 'bob'])
    expect(csv).toContain('Balances')
  })

  it('includes remaining settlements section', () => {
    const csv = tripToCsv('Trip', [expense()], members, ['alice', 'bob'])
    expect(csv).toContain('Remaining Settlements')
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
