import { describe, it, expect } from 'vitest'
import { formatMoney, getMemberName } from '../types'
import type { UserProfile } from '../types'

describe('formatMoney', () => {
  it('formats USD amounts', () => {
    expect(formatMoney(100, 'USD')).toBe('$100.00')
    expect(formatMoney(0, 'USD')).toBe('$0.00')
    expect(formatMoney(1234.56, 'USD')).toBe('$1,234.56')
  })

  it('formats EUR amounts', () => {
    const result = formatMoney(100, 'EUR')
    // Intl formatting varies by environment, but should contain the amount
    expect(result).toContain('100')
  })

  it('formats GBP amounts', () => {
    const result = formatMoney(50.5, 'GBP')
    expect(result).toContain('50.50')
  })

  it('handles negative amounts', () => {
    const result = formatMoney(-25.5, 'USD')
    expect(result).toContain('25.50')
  })

  it('defaults to USD when no currency specified', () => {
    expect(formatMoney(100)).toBe('$100.00')
  })

  it('falls back gracefully for unknown currency codes', () => {
    const result = formatMoney(100, 'XYZ')
    // Should not throw, should contain the amount
    expect(result).toContain('100')
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
