import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMoney, BALANCE_THRESHOLD, DEFAULT_CURRENCY } from '../lib/types'
import type { Trip } from '../lib/types'

interface TripBalance {
  id: string
  name: string
  amount: number
}

export function BalanceSummary({
  tripBalances,
  trips,
}: {
  tripBalances: Record<string, number>
  trips: Trip[]
}) {
  const entries = Object.entries(tripBalances)
  if (entries.length === 0) return null

  // Trips can settle in different currencies — totals only make sense
  // grouped per currency, never summed across them
  const oweByCurrency: Record<string, TripBalance[]> = {}
  const owedByCurrency: Record<string, TripBalance[]> = {}

  for (const [tripId, bal] of entries) {
    const rounded = Math.round(bal * 100) / 100
    const trip = trips.find((t) => t.id === tripId)
    const name = trip?.name ?? 'Unknown trip'
    const sc = trip?.settlementCurrency ?? DEFAULT_CURRENCY
    if (rounded > BALANCE_THRESHOLD) {
      ;(owedByCurrency[sc] ??= []).push({ id: tripId, name, amount: rounded })
    } else if (rounded < -BALANCE_THRESHOLD) {
      ;(oweByCurrency[sc] ??= []).push({ id: tripId, name, amount: -rounded })
    }
  }

  const oweGroups = Object.entries(oweByCurrency)
  const owedGroups = Object.entries(owedByCurrency)

  if (oweGroups.length === 0 && owedGroups.length === 0) {
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
      {oweGroups.map(([sc, tripDetails]) => (
        <BalanceLine
          key={`owe-${sc}`}
          text={`You owe ${formatMoney(tripDetails.reduce((s, t) => s + t.amount, 0), sc)} across `}
          tripDetails={tripDetails}
          settlementCurrency={sc}
          color="warn"
        />
      ))}
      {owedGroups.map(([sc, tripDetails]) => (
        <BalanceLine
          key={`owed-${sc}`}
          text={`You are owed ${formatMoney(tripDetails.reduce((s, t) => s + t.amount, 0), sc)} across `}
          tripDetails={tripDetails}
          settlementCurrency={sc}
          color="success"
        />
      ))}
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
  tripDetails: TripBalance[]
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
        onClick={() => setShowTooltip(!showTooltip)}
      >
        <span className="underline decoration-dotted cursor-help">
          {count} trip{count !== 1 ? 's' : ''}
        </span>
        {showTooltip && (
          <>
            <span
              className="fixed inset-0 z-40"
              onClick={(e) => { e.stopPropagation(); setShowTooltip(false); }}
            />
            <span className="absolute right-0 sm:left-0 sm:right-auto top-full mt-1 bg-card border border-line rounded-lg shadow-lg p-2 z-50 w-48 max-w-[calc(100vw-2rem)] animate-slide-up">
              {tripDetails.map((t, i) => (
                <Link
                  key={i}
                  to={`/trip/${t.id}?tab=settle`}
                  className="flex items-center justify-between text-xs py-1 px-1 -mx-1 rounded hover:bg-card-hover transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-text-secondary truncate mr-2">{t.name}</span>
                  <span className={`font-medium shrink-0 ${textColor}`}>
                    {formatMoney(t.amount, settlementCurrency)}
                  </span>
                </Link>
              ))}
            </span>
          </>
        )}
      </span>
    </p>
  )
}
