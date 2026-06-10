const CACHE_KEY = 'fairshare_exchange_rates'
const CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours

interface CachedRates {
  rates: Record<string, number>
  fetchedAt: number
}

let memoryCache: CachedRates | null = null

function loadFromStorage(): CachedRates | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedRates
    if (Date.now() - parsed.fetchedAt > CACHE_TTL) return null
    return parsed
  } catch {
    return null
  }
}

function saveToStorage(data: CachedRates) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {
    // localStorage full or unavailable
  }
}

export async function fetchRates(): Promise<Record<string, number>> {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < CACHE_TTL) {
    return memoryCache.rates
  }

  const stored = loadFromStorage()
  if (stored) {
    memoryCache = stored
    return stored.rates
  }

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD')
    const data = await res.json()
    if (data.result !== 'success' || !data.rates) {
      return memoryCache?.rates ?? {}
    }

    // API gives "1 USD = X foreign". We want "1 foreign = Y USD", so invert.
    const inverted: Record<string, number> = {}
    for (const [code, rate] of Object.entries(data.rates as Record<string, number>)) {
      if (rate > 0) {
        inverted[code] = Math.round((1 / rate) * 1_000_000) / 1_000_000
      }
    }
    inverted['USD'] = 1

    const cached: CachedRates = { rates: inverted, fetchedAt: Date.now() }
    memoryCache = cached
    saveToStorage(cached)
    return inverted
  } catch {
    return memoryCache?.rates ?? {}
  }
}

/**
 * Rate that converts `from` into `to` using the USD-based table:
 * amount × rate = amount in `to`. Cross rates go through USD, e.g.
 * GBP→EUR = (GBP→USD) / (EUR→USD).
 */
export function getCrossRate(
  rates: Record<string, number>,
  from: string,
  to: string
): number | null {
  if (from === to) return 1
  const fromUsd = from === 'USD' ? 1 : rates[from]
  const toUsd = to === 'USD' ? 1 : rates[to]
  if (!fromUsd || !toUsd) return null
  return fromUsd / toUsd
}
