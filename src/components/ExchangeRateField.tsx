import { useState } from 'react'
import { formatMoney } from '../lib/types'

/**
 * The exchange-rate control: a rate you can read, flip, type over, or work out
 * from what you actually got at the counter.
 *
 * Shared by the expense form and the settle-up payment form, which need the
 * same three ways of arriving at a rate:
 *
 *  - **automatic** — the trip's last-used rate, else today's live rate
 *  - **typed in** — when you already know the number
 *  - **worked out** — "I handed over $200 and got back ¥30,000", which is the
 *    only rate that actually happened if you changed money at a counter. The
 *    published mid-market rate is not the rate you got.
 *
 * `rate` is always stored as the foreign → settlement multiplier, whichever
 * direction the user is looking at it from.
 */

export type RateSource = 'live' | 'trip' | 'custom' | ''

/** Rates are stored to 4dp — enough for JPY-scale numbers without noise. */
const round4 = (n: number) => Math.round(n * 10000) / 10000

export function ExchangeRateField({
  currency,
  settlementCurrency: sc,
  rate,
  onRateChange,
  source,
  onResetToAuto,
  amount,
}: {
  /** The foreign currency being converted from. */
  currency: string
  settlementCurrency: string
  /** Multiplier: amount × rate = amount in the settlement currency. */
  rate: number
  /** A user-supplied rate. The caller marks it custom. */
  onRateChange: (rate: number) => void
  source: RateSource
  /** Re-derive from the trip/live rates. Omit when there's nothing to go back to. */
  onResetToAuto?: () => void
  /** Amount in `currency`, for the running conversion line. */
  amount?: number
}) {
  // Purely presentational state — which way round the rate is shown, and
  // whether the calculator is open. Nothing here belongs in the caller's form.
  const [inverted, setInverted] = useState(false)
  const [showCalc, setShowCalc] = useState(false)
  const [gave, setGave] = useState('')
  const [got, setGot] = useState('')

  const converted = amount !== undefined && amount > 0 && rate > 0 ? amount * rate : 0

  /** Both calculator fields drive the same division, so share it. */
  function applyCalc(gaveStr: string, gotStr: string) {
    const g = parseFloat(gaveStr) || 0
    const r = parseFloat(gotStr) || 0
    if (g > 0 && r > 0) onRateChange(round4(g / r))
  }

  return (
    <div className="bg-muted/50 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setInverted((v) => !v)}
          className="text-sm font-medium text-text-secondary flex items-center gap-1"
        >
          {inverted ? `1 ${sc} = ? ${currency}` : `1 ${currency} = ? ${sc}`}
          <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          {onResetToAuto && (source === 'custom' || source === 'trip') && (
            <button
              type="button"
              onClick={onResetToAuto}
              className="text-xs font-medium text-accent-text border border-line rounded-md px-2 py-1 hover:bg-accent-soft transition-colors"
            >
              {source === 'custom' ? 'Reset to auto' : 'Use live rate'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCalc((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent-text border border-line rounded-md px-2 py-1 hover:bg-accent-soft transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <rect x="5" y="3" width="14" height="18" rx="2" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 7h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 15h.01M12 15h.01M15.5 15h.01" />
            </svg>
            {showCalc ? 'Hide' : 'Calculator'}
          </button>
        </div>
      </div>

      <input
        type="number"
        step="0.0001"
        min="0"
        className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-input text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        value={inverted ? (rate > 0 ? round4(1 / rate) : '') : rate || ''}
        onChange={(e) => {
          const val = parseFloat(e.target.value) || 0
          // Shown inverted, but always stored foreign → settlement
          onRateChange(inverted ? (val > 0 ? round4(1 / val) : 0) : val)
        }}
      />

      {showCalc && (
        <div className="bg-card rounded-lg p-2.5 border border-line space-y-2">
          <p className="text-xs font-medium text-text-secondary">Exchange calculator</p>
          {/* Underscores, not commas: Tailwind passes arbitrary values through
              verbatim, and `1fr,auto,1fr` is invalid CSS for this property —
              the browser drops it and the fields collapse into one column. */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
            <div>
              <label className="text-[10px] text-text-muted uppercase">Gave ({sc})</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="200"
                className="w-full border border-line rounded px-2 py-1 text-sm bg-input text-text"
                value={gave}
                onChange={(e) => {
                  setGave(e.target.value)
                  applyCalc(e.target.value, got)
                }}
              />
            </div>
            <span className="text-text-muted text-sm mt-4">=</span>
            <div>
              <label className="text-[10px] text-text-muted uppercase">Got ({currency})</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="350"
                className="w-full border border-line rounded px-2 py-1 text-sm bg-input text-text"
                value={got}
                onChange={(e) => {
                  setGot(e.target.value)
                  applyCalc(gave, e.target.value)
                }}
              />
            </div>
          </div>
          <p className="text-[10px] text-text-muted">
            What you actually got at the counter, fees and all — not the headline rate.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        {converted > 0 && (
          <p className="text-xs text-text-secondary">
            {amount} {currency} = {formatMoney(converted, sc)}
          </p>
        )}
        <p className="text-xs text-text-muted ml-auto">
          {source === 'live' && 'Auto (live)'}
          {source === 'trip' && 'Last used on trip'}
          {source === 'custom' && 'Custom'}
        </p>
      </div>
    </div>
  )
}
