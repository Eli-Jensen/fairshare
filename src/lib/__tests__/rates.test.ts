import { describe, it, expect } from 'vitest'
import { getCrossRate } from '../rates'

// Rates are units of each currency per 1 USD, as open.er-api.com returns them.
const rates = { EUR: 0.8, GBP: 0.5, JPY: 150 }

describe('getCrossRate', () => {
  it('is 1 for the same currency, even one with no rate', () => {
    expect(getCrossRate(rates, 'EUR', 'EUR')).toBe(1)
    expect(getCrossRate({}, 'XYZ', 'XYZ')).toBe(1)
  })

  it('treats USD as the base without needing a USD entry', () => {
    expect(getCrossRate(rates, 'USD', 'EUR')).toBeCloseTo(1 / 0.8)
    expect(getCrossRate(rates, 'EUR', 'USD')).toBeCloseTo(0.8)
  })

  it('crosses two non-USD currencies through USD', () => {
    expect(getCrossRate(rates, 'GBP', 'EUR')).toBeCloseTo(0.5 / 0.8)
    expect(getCrossRate(rates, 'JPY', 'GBP')).toBeCloseTo(150 / 0.5)
  })

  it('is the inverse in the other direction', () => {
    const there = getCrossRate(rates, 'GBP', 'JPY')!
    const back = getCrossRate(rates, 'JPY', 'GBP')!
    expect(there * back).toBeCloseTo(1)
  })

  it('returns null when either side has no rate, rather than guessing', () => {
    expect(getCrossRate(rates, 'CHF', 'EUR')).toBeNull()
    expect(getCrossRate(rates, 'EUR', 'CHF')).toBeNull()
    expect(getCrossRate({ EUR: 0 }, 'EUR', 'USD')).toBeNull()
  })
})
