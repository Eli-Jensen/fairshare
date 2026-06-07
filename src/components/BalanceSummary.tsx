import { formatMoney } from '../lib/types'

export function BalanceSummary({
  netBalance,
  tripCount,
  settlementCurrency,
}: {
  netBalance: number
  tripCount: number
  settlementCurrency: string
}) {
  if (tripCount === 0) return null

  const rounded = Math.round(netBalance * 100) / 100

  if (Math.abs(rounded) < 0.01) {
    return (
      <div className="bg-success-bg rounded-lg px-4 py-3 mb-6">
        <p className="text-sm font-medium text-success-text">
          All settled up across all trips!
        </p>
      </div>
    )
  }

  const isOwed = rounded > 0
  return (
    <div className={`rounded-lg px-4 py-3 mb-6 ${isOwed ? 'bg-success-bg' : 'bg-warn-bg'}`}>
      <p className={`text-sm font-medium ${isOwed ? 'text-success-text' : 'text-warn-text'}`}>
        {isOwed
          ? `You are owed ${formatMoney(rounded, settlementCurrency)} across ${tripCount} trip${tripCount !== 1 ? 's' : ''}`
          : `You owe ${formatMoney(-rounded, settlementCurrency)} across ${tripCount} trip${tripCount !== 1 ? 's' : ''}`}
      </p>
    </div>
  )
}
