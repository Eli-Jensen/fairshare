import { describe, it, expect } from 'vitest'
import { getCurrency, COMMON_CURRENCIES, ALL_CURRENCIES } from '../currencies'

describe('getCurrency', () => {
  it('finds common currencies', () => {
    const usd = getCurrency('USD')
    expect(usd).toBeDefined()
    expect(usd!.name).toBe('US Dollar')
    expect(usd!.symbol).toBe('$')
  })

  it('finds non-common currencies', () => {
    const pln = getCurrency('PLN')
    expect(pln).toBeDefined()
    expect(pln!.name).toBe('Polish Zloty')
  })

  it('returns undefined for unknown code', () => {
    expect(getCurrency('XYZ')).toBeUndefined()
  })

  it('is case-sensitive (codes must be uppercase)', () => {
    expect(getCurrency('usd')).toBeUndefined()
  })
})

describe('currency lists', () => {
  it('COMMON_CURRENCIES has expected entries', () => {
    expect(COMMON_CURRENCIES.length).toBeGreaterThanOrEqual(15)
    const codes = COMMON_CURRENCIES.map((c) => c.code)
    expect(codes).toContain('USD')
    expect(codes).toContain('EUR')
    expect(codes).toContain('GBP')
    expect(codes).toContain('ILS')
  })

  it('ALL_CURRENCIES contains all common currencies', () => {
    const allCodes = new Set(ALL_CURRENCIES.map((c) => c.code))
    for (const c of COMMON_CURRENCIES) {
      expect(allCodes.has(c.code)).toBe(true)
    }
  })

  it('ALL_CURRENCIES has no duplicate codes', () => {
    const codes = ALL_CURRENCIES.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
