import { formatMoney } from '../lib/types'

export function BalanceSummary({
  tripBalances,
  settlementCurrency,
}: {
  tripBalances: Record<string, number>
  settlementCurrency: string
}) {
  const entries = Object.values(tripBalances)
  if (entries.length === 0) return null

  let totalOwed = 0   // positive balances (others owe you)
  let totalOwe = 0    // negative balances (you owe others)
  let tripsOwed = 0
  let tripsOwe = 0

  for (const bal of entries) {
    const rounded = Math.round(bal * 100) / 100
    if (rounded > 0.01) {
      totalOwed += rounded
      tripsOwed++
    } else if (rounded < -0.01) {
      totalOwe += -rounded
      tripsOwe++
    }
  }

  if (totalOwed < 0.01 && totalOwe < 0.01) {
    return (
      <div className="bg-success-bg rounded-lg px-4 py-3 mb-6">
        <p className="text-sm font-medium text-success-text">
          All settled up across all trips!
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3 mb-6 space-y-1">
      {totalOwe > 0.01 && (
        <p className="text-sm font-medium text-warn-text">
          You owe {formatMoney(totalOwe, settlementCurrency)} across {tripsOwe} trip{tripsOwe !== 1 ? 's' : ''}
        </p>
      )}
      {totalOwed > 0.01 && (
        <p className="text-sm font-medium text-success-text">
          You are owed {formatMoney(totalOwed, settlementCurrency)} across {tripsOwed} trip{tripsOwed !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
