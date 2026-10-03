import { describe, it, expect } from 'vitest'
import {
  splitEqually,
  splitProportionally,
  splitByShares,
  splitByPercentages,
  derivePercentages,
  deriveShares,
  deriveOriginalAmounts,
} from '../splits'

const sum = (splits: Record<string, number>) =>
  Math.round(Object.values(splits).reduce((s, v) => s + v, 0) * 100) / 100

describe('splitEqually', () => {
  it('splits evenly when amounts divide cleanly', () => {
    expect(splitEqually(90, ['a', 'b', 'c'])).toEqual({ a: 30, b: 30, c: 30 })
  })

  it('sums exactly to the total when cents are uneven', () => {
    const splits = splitEqually(100, ['a', 'b', 'c'])
    expect(sum(splits)).toBe(100)
    expect(splits.a).toBe(33.34)
    expect(splits.b).toBe(33.33)
    expect(splits.c).toBe(33.33)
  })

  it('handles a single member', () => {
    expect(splitEqually(12.34, ['a'])).toEqual({ a: 12.34 })
  })

  it('handles tiny amounts smaller than one cent per person', () => {
    const splits = splitEqually(0.02, ['a', 'b', 'c'])
    expect(sum(splits)).toBe(0.02)
  })

  it('returns empty for no members', () => {
    expect(splitEqually(100, [])).toEqual({})
  })
})

describe('splitProportionally / splitByShares', () => {
  it('respects 2:1:1 share ratios and sums exactly', () => {
    const splits = splitByShares(100, { a: 2, b: 1, c: 1 })
    expect(splits.a).toBe(50)
    expect(splits.b).toBe(25)
    expect(splits.c).toBe(25)
  })

  it('gives zero-weight members zero without leftover cents', () => {
    const splits = splitProportionally(100, { a: 1, b: 0, c: 2 })
    expect(splits.b).toBe(0)
    expect(sum(splits)).toBe(100)
  })

  it('returns empty when all weights are zero', () => {
    expect(splitProportionally(100, { a: 0, b: 0 })).toEqual({})
  })
})

describe('splitByPercentages', () => {
  it('splits exactly when percentages sum to 100', () => {
    const splits = splitByPercentages(100, { a: 50, b: 30, c: 20 })
    expect(splits).toEqual({ a: 50, b: 30, c: 20 })
  })

  it('absorbs rounding so one-third percentages sum exactly', () => {
    const splits = splitByPercentages(100, { a: 33.33, b: 33.33, c: 33.34 })
    expect(sum(splits)).toBe(100)
  })

  it('treats near-100 sums (derived inputs) as exact', () => {
    const splits = splitByPercentages(99.99, { a: 33.33, b: 33.33, c: 33.33 })
    expect(sum(splits)).toBe(99.99)
  })

  it('computes literally when percentages are clearly off 100', () => {
    const splits = splitByPercentages(100, { a: 50, b: 30 })
    expect(splits).toEqual({ a: 50, b: 30 })
  })
})

describe('derivePercentages', () => {
  it('round-trips an exact percentage split', () => {
    const derived = derivePercentages({ a: 50, b: 30, c: 20 }, 100)
    expect(derived).toEqual({ a: '50', b: '30', c: '20' })
  })

  it('derived values re-split to the original amounts', () => {
    const original = splitByPercentages(123.45, { a: 60, b: 25, c: 15 })
    const derived = derivePercentages(original, 123.45)
    const reSplit = splitByPercentages(
      123.45,
      Object.fromEntries(Object.entries(derived).map(([u, p]) => [u, parseFloat(p)]))
    )
    expect(sum(reSplit)).toBe(123.45)
  })
})

describe('deriveShares', () => {
  it('recovers small integer ratios', () => {
    expect(deriveShares({ a: 50, b: 25, c: 25 })).toEqual({ a: '2', b: '1', c: '1' })
  })

  it('recovers 2:3 style ratios via scaling', () => {
    expect(deriveShares({ a: 40, b: 60 })).toEqual({ a: '2', b: '3' })
  })

  it('recovers ratios from cent-rounded splits', () => {
    const splits = splitByShares(100, { a: 2, b: 1, c: 1 })
    expect(deriveShares(splits)).toEqual({ a: '2', b: '1', c: '1' })
  })

  it('falls back to amounts as weights for irregular splits', () => {
    const derived = deriveShares({ a: 17.31, b: 82.69 })
    const reSplit = splitByShares(
      100,
      Object.fromEntries(Object.entries(derived).map(([u, s]) => [u, parseFloat(s)]))
    )
    expect(reSplit.a).toBe(17.31)
    expect(reSplit.b).toBe(82.69)
  })

  it('marks zero-amount members with zero shares', () => {
    expect(deriveShares({ a: 50, b: 50, c: 0 })).toEqual({ a: '1', b: '1', c: '0' })
  })
})

describe('deriveOriginalAmounts', () => {
  it('recovers the amounts that produced the splits', () => {
    // 87.40 EUR at 1.0842 split three ways
    const splits = splitEqually(87.4 * 1.0842, ['a', 'b', 'c'])
    expect(sum(deriveOriginalAmounts(splits, 87.4))).toBe(87.4)
  })

  it('adds up to the total for a low-value currency', () => {
    // The reported bug: 10000 JPY in a USD trip, exact three-way split.
    // Per-person `split / rate` sums to 10001.49 — over the total by enough to
    // block an edit that changed nothing about the money.
    const rate = 0.006723
    const typed = { a: 3400, b: 3300, c: 3300 }
    const stored = splitProportionally(10000 * rate, typed)
    expect(sum(deriveOriginalAmounts(stored, 10000))).toBe(10000)
  })

  it('keeps the proportions, not just the total', () => {
    const stored = splitProportionally(100, { a: 2, b: 1, c: 1 })
    expect(deriveOriginalAmounts(stored, 12500)).toEqual({ a: 6250, b: 3125, c: 3125 })
  })

  it('leaves people out of the split at zero', () => {
    const derived = deriveOriginalAmounts({ a: 33.33, b: 33.34, c: 0 }, 9000)
    expect(derived.c).toBe(0)
    expect(sum(derived)).toBe(9000)
  })

  it('answers zero for every member when nothing was split', () => {
    expect(deriveOriginalAmounts({ a: 0, b: 0 }, 500)).toEqual({ a: 0, b: 0 })
  })

  it('answers zero rather than dividing by a zero total', () => {
    expect(deriveOriginalAmounts({ a: 10, b: 10 }, 0)).toEqual({ a: 0, b: 0 })
  })
})
