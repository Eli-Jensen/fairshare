import { useState } from 'react'
import { formatMoney, BALANCE_THRESHOLD } from '../lib/types'
import type { Trip } from '../lib/types'

export function BalanceSummary({
  tripBalances,
  trips,
  settlementCurrency,
}: {
  tripBalances: Record<string, number>
  trips: Trip[]
  settlementCurrency: string
}) {
  const entries = Object.entries(tripBalances)
  if (entries.length === 0) return null

  const oweTrips: { name: string; amount: number }[] = []
  const owedTrips: { name: string; amount: number }[] = []

  for (const [tripId, bal] of entries) {
    const rounded = Math.round(bal * 100) / 100
    const trip = trips.find((t) => t.id === tripId)
    const name = trip?.name ?? 'Unknown trip'
    if (rounded > BALANCE_THRESHOLD) {
      owedTrips.push({ name, amount: rounded })
    } else if (rounded < -BALANCE_THRESHOLD) {
      oweTrips.push({ name, amount: -rounded })
    }
  }

  const totalOwe = oweTrips.reduce((s, t) => s + t.amount, 0)
  const totalOwed = owedTrips.reduce((s, t) => s + t.amount, 0)

  if (totalOwed < BALANCE_THRESHOLD && totalOwe < BALANCE_THRESHOLD) {
    return (
      <div className="bg-success-bg rounded-lg px-4 py-3 mb-6">
        <p className="text-sm font-medium text-success-text">
          All settled up! ✓
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3 mb-6 space-y-1">
      {totalOwe > BALANCE_THRESHOLD && (
        <BalanceLine
          text={`You owe ${formatMoney(totalOwe, settlementCurrency)} across `}
          tripDetails={oweTrips}
          settlementCurrency={settlementCurrency}
          color="warn"
        />
      )}
      {totalOwed > BALANCE_THRESHOLD && (
        <BalanceLine
          text={`You are owed ${formatMoney(totalOwed, settlementCurrency)} across `}
          tripDetails={owedTrips}
          settlementCurrency={settlementCurrency}
          color="success"
        />
      )}
    </div>
  )
}

function BalanceLine({
  text,
  tripDetails,
  settlementCurrency,
  color,
}: {
  text: string
  tripDetails: { name: string; amount: number }[]
  settlementCurrency: string
  color: 'warn' | 'success'
}) {
  const [showTooltip, setShowTooltip] = useState(false)
  const count = tripDetails.length
  const textColor = color === 'warn' ? 'text-warn-text' : 'text-success-text'

  return (
    <p className={`text-sm font-medium ${textColor}`}>
      {text}
      <span
        className="relative inline-block"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={() => setShowTooltip(!showTooltip)}
      >
        <span className="underline decoration-dotted cursor-help">
          {count} trip{count !== 1 ? 's' : ''}
        </span>
        {showTooltip && (
          <span className="absolute right-0 sm:left-0 sm:right-auto top-full mt-1 bg-card border border-line rounded-lg shadow-lg p-2 z-50 w-48 max-w-[calc(100vw-2rem)] animate-slide-up">
            {tripDetails.map((t, i) => (
              <span key={i} className="flex items-center justify-between text-xs py-0.5">
                <span className="text-text-secondary truncate mr-2">{t.name}</span>
                <span className={`font-medium shrink-0 ${textColor}`}>
                  {formatMoney(t.amount, settlementCurrency)}
                </span>
              </span>
            ))}
          </span>
        )}
      </span>
    </p>
  )
}
