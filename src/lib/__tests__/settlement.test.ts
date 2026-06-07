import { describe, it, expect } from 'vitest'
import { computeBalances, simplifyDebts } from '../settlement'
import type { Expense } from '../types'
import { Timestamp } from 'firebase/firestore'

// Helper to create a minimal expense for testing
function expense(overrides: Partial<Expense> & Pick<Expense, 'amountUSD' | 'paidBy' | 'splits'>): Expense {
  return {
    id: 'e1',
    description: 'Test',
    amount: overrides.amountUSD,
    currency: 'USD',
    exchangeRate: 1,
    splitType: 'equal',
    date: Timestamp.now(),
    createdBy: overrides.paidBy,
    createdAt: Timestamp.now(),
    ...overrides,
  }
}

describe('computeBalances', () => {
  it('handles a simple equal split between 2 people', () => {
    const members = ['alice', 'bob']
    const expenses = [
      expense({
        amountUSD: 100,
        paidBy: 'alice',
        splits: { alice: 50, bob: 50 },
      }),
    ]
    const balances = computeBalances(expenses, members)
    expect(balances.alice).toBeCloseTo(50)  // paid 100, owes 50 → +50
    expect(balances.bob).toBeCloseTo(-50)   // paid 0, owes 50 → -50
  })

  it('handles multiple expenses', () => {
    const members = ['alice', 'bob']
    const expenses = [
      expense({
        id: 'e1',
        amountUSD: 100,
        paidBy: 'alice',
        splits: { alice: 50, bob: 50 },
      }),
      expense({
        id: 'e2',
        amountUSD: 60,
        paidBy: 'bob',
        splits: { alice: 30, bob: 30 },
      }),
    ]
    const balances = computeBalances(expenses, members)
    // Alice: paid 100, owes 50+30=80 → +20
    // Bob: paid 60, owes 50+30=80 → -20
    expect(balances.alice).toBeCloseTo(20)
    expect(balances.bob).toBeCloseTo(-20)
  })

  it('handles 3-way split', () => {
    const members = ['alice', 'bob', 'carol']
    const expenses = [
      expense({
        amountUSD: 90,
        paidBy: 'alice',
        splits: { alice: 30, bob: 30, carol: 30 },
      }),
    ]
    const balances = computeBalances(expenses, members)
    expect(balances.alice).toBeCloseTo(60)   // paid 90, owes 30
    expect(balances.bob).toBeCloseTo(-30)
    expect(balances.carol).toBeCloseTo(-30)
  })

  it('handles uneven splits', () => {
    const members = ['alice', 'bob']
    const expenses = [
      expense({
        amountUSD: 100,
        paidBy: 'alice',
        splitType: 'exact',
        splits: { alice: 70, bob: 30 },
      }),
    ]
    const balances = computeBalances(expenses, members)
    expect(balances.alice).toBeCloseTo(30)  // paid 100, owes 70
    expect(balances.bob).toBeCloseTo(-30)   // paid 0, owes 30
  })

  it('handles multi-payer expenses', () => {
    const members = ['alice', 'bob', 'carol']
    const expenses = [
      expense({
        amountUSD: 100,
        paidBy: 'alice',
        paidByAmounts: { alice: 60, bob: 40 },
        splits: { alice: 34, bob: 33, carol: 33 },
      }),
    ]
    const balances = computeBalances(expenses, members)
    // Alice: paid 60, owes 34 → +26
    // Bob: paid 40, owes 33 → +7
    // Carol: paid 0, owes 33 → -33
    expect(balances.alice).toBeCloseTo(26)
    expect(balances.bob).toBeCloseTo(7)
    expect(balances.carol).toBeCloseTo(-33)
  })

  it('handles settlement expenses (isSettlement)', () => {
    const members = ['alice', 'bob']
    const expenses = [
      // Original expense: alice paid, split equally
      expense({
        id: 'e1',
        amountUSD: 100,
        paidBy: 'alice',
        splits: { alice: 50, bob: 50 },
      }),
      // Settlement: bob pays alice 50
      expense({
        id: 'e2',
        amountUSD: 50,
        paidBy: 'bob',
        isSettlement: true,
        splits: { alice: 50 },
      }),
    ]
    const balances = computeBalances(expenses, members)
    // After settlement, both should be ~0
    expect(balances.alice).toBeCloseTo(0)
    expect(balances.bob).toBeCloseTo(0)
  })

  it('handles removed members (UIDs not in memberUids)', () => {
    const members = ['alice'] // bob was removed
    const expenses = [
      expense({
        amountUSD: 100,
        paidBy: 'alice',
        splits: { alice: 50, bob: 50 },
      }),
    ]
    const balances = computeBalances(expenses, members)
    expect(balances.alice).toBeCloseTo(50)
    // bob still gets a balance even though not in memberUids
    expect(balances.bob).toBeCloseTo(-50)
  })

  it('returns zero balances for an empty expense list', () => {
    const balances = computeBalances([], ['alice', 'bob'])
    expect(balances.alice).toBe(0)
    expect(balances.bob).toBe(0)
  })

  it('handles single member trip', () => {
    const expenses = [
      expense({
        amountUSD: 50,
        paidBy: 'alice',
        splits: { alice: 50 },
      }),
    ]
    const balances = computeBalances(expenses, ['alice'])
    expect(balances.alice).toBeCloseTo(0) // paid 50, owes 50
  })
})

describe('simplifyDebts', () => {
  it('produces no settlements when all balanced', () => {
    const settlements = simplifyDebts({ alice: 0, bob: 0 })
    expect(settlements).toHaveLength(0)
  })

  it('produces a single settlement for 2 people', () => {
    const settlements = simplifyDebts({ alice: 50, bob: -50 })
    expect(settlements).toHaveLength(1)
    expect(settlements[0]).toEqual({ from: 'bob', to: 'alice', amount: 50 })
  })

  it('minimizes settlements for 3 people', () => {
    // Alice is owed 60, Bob owes 30, Carol owes 30
    const settlements = simplifyDebts({ alice: 60, bob: -30, carol: -30 })
    expect(settlements).toHaveLength(2)
    const total = settlements.reduce((s, d) => s + d.amount, 0)
    expect(total).toBeCloseTo(60)
    // All payments go to alice
    expect(settlements.every((s) => s.to === 'alice')).toBe(true)
  })

  it('handles chain of debts', () => {
    // Alice +40, Bob +10, Carol -50
    const settlements = simplifyDebts({ alice: 40, bob: 10, carol: -50 })
    // Carol pays Alice 40, Carol pays Bob 10 (or similar — 2 settlements)
    expect(settlements.length).toBeLessThanOrEqual(2)
    const totalPaid = settlements.reduce((s, d) => s + d.amount, 0)
    expect(totalPaid).toBeCloseTo(50)
  })

  it('ignores tiny balances (rounding errors)', () => {
    const settlements = simplifyDebts({ alice: 0.005, bob: -0.005 })
    expect(settlements).toHaveLength(0)
  })

  it('handles complex 4-person scenario', () => {
    // Alice +100, Bob -60, Carol -30, Dave -10
    const settlements = simplifyDebts({
      alice: 100,
      bob: -60,
      carol: -30,
      dave: -10,
    })
    // Should produce at most 3 settlements
    expect(settlements.length).toBeLessThanOrEqual(3)
    // Total debtor amount = 100
    const totalPaid = settlements.reduce((s, d) => s + d.amount, 0)
    expect(totalPaid).toBeCloseTo(100)
    // All go to alice (she's the only creditor)
    expect(settlements.every((s) => s.to === 'alice')).toBe(true)
  })
})
