import { describe, it, expect } from 'vitest'
import {
  formatMoney,
  getMemberName,
  getExpenseCategories,
  getCategoryInfo,
  getAllCategories,
  categoryExists,
  tripLabel,
  mapExpense,
  EXPENSE_CATEGORIES,
} from '../types'
import type { UserProfile, Expense, CustomCategory } from '../types'
import { Timestamp } from 'firebase/firestore'

describe('formatMoney', () => {
  it('formats USD amounts', () => {
    expect(formatMoney(100, 'USD')).toBe('$100.00')
    expect(formatMoney(0, 'USD')).toBe('$0.00')
    expect(formatMoney(1234.56, 'USD')).toBe('$1,234.56')
  })

  it('keeps the minus sign on negative amounts', () => {
    expect(formatMoney(-25.5, 'USD')).toBe('-$25.50')
  })

  it('defaults to USD when no currency specified', () => {
    expect(formatMoney(100)).toBe('$100.00')
  })

  // 'XY', not a well-formed-but-unknown code like 'XYZ': Intl formats those
  // happily ("XYZ 100.00"), so they never reach the fallback.
  it('falls back to "CODE 0.00" when Intl rejects the currency code', () => {
    expect(formatMoney(100, 'XY')).toBe('XY 100.00')
  })
})

describe('getMemberName', () => {
  const members: Record<string, UserProfile> = {
    uid1: { uid: 'uid1', displayName: 'Alice', email: 'alice@test.com', photoURL: null },
    uid2: { uid: 'uid2', displayName: 'Bob', email: 'bob@test.com', photoURL: null },
    uid3: { uid: 'uid3', displayName: 'Alice', email: 'alice2@test.com', photoURL: null },
  }

  it('returns display name for unique names', () => {
    expect(getMemberName('uid2', members)).toBe('Bob')
  })

  it('appends email for duplicate names', () => {
    expect(getMemberName('uid1', members)).toBe('Alice (alice@test.com)')
    expect(getMemberName('uid3', members)).toBe('Alice (alice2@test.com)')
  })

  it('returns uid when member not found', () => {
    expect(getMemberName('unknown', members)).toBe('unknown')
  })

  it('handles empty members object', () => {
    expect(getMemberName('uid1', {})).toBe('uid1')
  })

  it('uses email as fallback when displayName is empty', () => {
    const m: Record<string, UserProfile> = {
      uid1: { uid: 'uid1', displayName: '', email: 'test@test.com', photoURL: null },
    }
    expect(getMemberName('uid1', m)).toBe('test@test.com')
  })
})

describe('tripLabel', () => {
  it.each([
    ['trip', 'trip'],
    ['group', 'group'],
    [undefined, 'trip'],
  ] as const)('%s → %s', (type, label) => {
    expect(tripLabel(type)).toBe(label)
  })
})

describe('mapExpense', () => {
  it('maps amountUSD to amountSettled', () => {
    const result = mapExpense({
      id: 'e1',
      description: 'Lunch',
      amount: 100,
      currency: 'USD',
      exchangeRate: 1,
      amountUSD: 100,
      paidBy: 'alice',
      splitType: 'equal',
      splits: { alice: 50, bob: 50 },
      createdBy: 'alice',
      createdAt: Timestamp.now(),
      date: Timestamp.now(),
    })
    expect(result.amountSettled).toBe(100)
    expect(result).not.toHaveProperty('amountUSD')
  })

  it('defaults amountSettled to 0 when amountUSD is missing', () => {
    const result = mapExpense({
      id: 'e1',
      description: 'Test',
      amount: 50,
      currency: 'EUR',
      exchangeRate: 1.1,
      paidBy: 'alice',
      splitType: 'equal',
      splits: {},
      createdBy: 'alice',
      createdAt: Timestamp.now(),
      date: Timestamp.now(),
    })
    expect(result.amountSettled).toBe(0)
  })
})

describe('getExpenseCategories', () => {
  const base = {
    id: 'e1',
    description: 'Test',
    amount: 10,
    currency: 'USD',
    exchangeRate: 1,
    amountSettled: 10,
    paidBy: 'alice',
    splitType: 'equal' as const,
    splits: {},
    createdBy: 'alice',
    createdAt: Timestamp.now(),
    date: Timestamp.now(),
  }

  it('returns categories array when present', () => {
    const exp: Expense = { ...base, categories: ['food', 'entertainment'] }
    expect(getExpenseCategories(exp)).toEqual(['food', 'entertainment'])
  })

  it('falls back to legacy category field', () => {
    const exp: Expense = { ...base, category: 'food' }
    expect(getExpenseCategories(exp)).toEqual(['food'])
  })

  it('prefers categories over legacy category', () => {
    const exp: Expense = { ...base, categories: ['transport'], category: 'food' }
    expect(getExpenseCategories(exp)).toEqual(['transport'])
  })

  it('returns empty array when no category', () => {
    const exp: Expense = { ...base }
    expect(getExpenseCategories(exp)).toEqual([])
  })

  it('falls back to the legacy category when categories is empty', () => {
    const exp: Expense = { ...base, categories: [], category: 'food' }
    // Empty categories array → falls back to legacy
    expect(getExpenseCategories(exp)).toEqual(['food'])
  })
})

describe('getCategoryInfo', () => {
  it('finds default categories', () => {
    const info = getCategoryInfo('food')
    expect(info).toEqual({ value: 'food', label: 'Food', emoji: '🍽️' })
  })

  it('finds legacy categories', () => {
    const info = getCategoryInfo('groceries')
    expect(info).toEqual({ label: 'Groceries', emoji: '🛒' })
  })

  it('finds custom categories', () => {
    const custom: CustomCategory[] = [
      { id: 'drinks', label: 'Drinks', emoji: '🍺' },
    ]
    const info = getCategoryInfo('drinks', custom)
    expect(info).toEqual({ label: 'Drinks', emoji: '🍺' })
  })

  it('returns undefined for unknown category', () => {
    expect(getCategoryInfo('nonexistent')).toBeUndefined()
  })
})

describe('getAllCategories', () => {
  it('returns defaults when no custom categories', () => {
    const cats = getAllCategories()
    expect(cats).toHaveLength(EXPENSE_CATEGORIES.length)
    expect(cats[0].value).toBe('food')
  })

  it('appends custom categories', () => {
    const custom: CustomCategory[] = [
      { id: 'drinks', label: 'Drinks', emoji: '🍺' },
    ]
    const cats = getAllCategories(custom)
    expect(cats).toHaveLength(EXPENSE_CATEGORIES.length + 1)
    expect(cats[cats.length - 1].value).toBe('drinks')
  })
})

describe('categoryExists', () => {
  it('detects existing default category', () => {
    expect(categoryExists('🍽️', 'Food')).toBe(true)
  })

  it('returns false for non-matching', () => {
    expect(categoryExists('🍺', 'Drinks')).toBe(false)
  })

  it('detects existing custom category', () => {
    const custom: CustomCategory[] = [
      { id: 'drinks', label: 'Drinks', emoji: '🍺' },
    ]
    expect(categoryExists('🍺', 'Drinks', custom)).toBe(true)
  })

  it('is case-insensitive on label', () => {
    expect(categoryExists('🍽️', 'food')).toBe(true)
  })
})
