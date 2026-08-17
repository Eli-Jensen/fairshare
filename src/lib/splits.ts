/**
 * Split math that guarantees per-person amounts sum exactly to the total.
 * Works in integer cents and distributes leftover cents by largest
 * remainder, so no money is silently created or destroyed by rounding.
 */

/** Proportional split by positive weights; residual cents go to the largest remainders. */
export function splitProportionally(
  total: number,
  weights: Record<string, number>
): Record<string, number> {
  const splits: Record<string, number> = {}
  const totalWeight = Object.values(weights).reduce(
    (s, w) => s + (w > 0 ? w : 0),
    0
  )
  if (totalWeight <= 0) return splits

  const totalCents = Math.round(total * 100)
  let assigned = 0
  const remainders: { uid: string; frac: number }[] = []

  for (const [uid, w] of Object.entries(weights)) {
    if (w <= 0) {
      splits[uid] = 0
      continue
    }
    const exact = (totalCents * w) / totalWeight
    const cents = Math.floor(exact)
    splits[uid] = cents
    assigned += cents
    remainders.push({ uid, frac: exact - cents })
  }

  remainders.sort((a, b) => b.frac - a.frac)
  let leftover = totalCents - assigned
  for (const { uid } of remainders) {
    if (leftover <= 0) break
    splits[uid] += 1
    leftover--
  }

  for (const uid of Object.keys(splits)) {
    splits[uid] = splits[uid] / 100
  }
  return splits
}

/** Equal split across uids; the first members absorb any extra cents. */
export function splitEqually(total: number, uids: string[]): Record<string, number> {
  return splitProportionally(total, Object.fromEntries(uids.map((u) => [u, 1])))
}

/** Shares are pure weights (2:1:1 etc.). */
export function splitByShares(
  total: number,
  shares: Record<string, number>
): Record<string, number> {
  return splitProportionally(total, shares)
}

/**
 * Percentages that sum to ~100 split proportionally (exact total).
 * Off-100 totals are computed literally so form validation can flag the gap.
 */
export function splitByPercentages(
  total: number,
  percentages: Record<string, number>
): Record<string, number> {
  const sum = Object.values(percentages).reduce((s, p) => s + (p > 0 ? p : 0), 0)
  if (Math.abs(sum - 100) <= 0.1) {
    return splitProportionally(total, percentages)
  }
  const splits: Record<string, number> = {}
  for (const [uid, pct] of Object.entries(percentages)) {
    splits[uid] = Math.round(total * (pct / 100) * 100) / 100
  }
  return splits
}

/**
 * Recover per-person form inputs in the ORIGINAL currency from splits that
 * were stored in the settlement currency.
 *
 * Not `split / rate` per person, which is the obvious version and is wrong.
 * Stored splits are settlement-currency cents, so dividing back multiplies any
 * rounding by 1/rate — at a JPY rate of ~0.0067 one settlement cent becomes
 * ~1.5 yen, and a three-way split reopened in the edit form no longer added up
 * to its own total. The form then refused to save an edit that changed nothing
 * about the money ("Split total doesn't match expense").
 *
 * Distributing the original amount by the stored splits as weights keeps the
 * proportions and makes the parts sum EXACTLY to `amount` at any scale, so a
 * reopened expense always adds up.
 */
export function deriveOriginalAmounts(
  splits: Record<string, number>,
  amount: number
): Record<string, number> {
  const out = splitProportionally(amount, splits)
  // Every split is zero (or the amount is): weights carry no information, so
  // there is nothing to distribute — answer 0 rather than an empty map.
  if (Object.keys(out).length === 0) {
    return Object.fromEntries(Object.keys(splits).map((uid) => [uid, 0]))
  }
  return out
}

/** Recover percentage form inputs from stored splits (2 decimal places). */
export function derivePercentages(
  splits: Record<string, number>,
  total: number
): Record<string, string> {
  const out: Record<string, string> = {}
  if (total <= 0) return out
  for (const [uid, amt] of Object.entries(splits)) {
    out[uid] = String(Math.round((amt / total) * 10000) / 100)
  }
  return out
}

/**
 * Recover share form inputs from stored splits. Prefers small integer
 * ratios (2:1:1, 2:3) and falls back to the amounts themselves as weights.
 */
export function deriveShares(splits: Record<string, number>): Record<string, string> {
  const positive = Object.entries(splits).filter(([, v]) => v > 0)
  if (positive.length === 0) return {}

  const min = Math.min(...positive.map(([, v]) => v))
  const out: Record<string, string> = {}

  for (let k = 1; k <= 4; k++) {
    const scaled = positive.map(([uid, v]) => [uid, (v / min) * k] as const)
    if (scaled.every(([, r]) => Math.abs(r - Math.round(r)) < 0.02)) {
      for (const [uid, r] of scaled) out[uid] = String(Math.round(r))
      for (const [uid, v] of Object.entries(splits)) {
        if (v <= 0) out[uid] = '0'
      }
      return out
    }
  }

  for (const [uid, v] of Object.entries(splits)) out[uid] = String(v)
  return out
}
