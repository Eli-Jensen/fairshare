import type { Expense, UserProfile } from '../lib/types'
import { formatMoney, getMemberName } from '../lib/types'
import { computeBalances, simplifyDebts } from '../lib/settlement'
import { MemberAvatar } from './MemberAvatar'

export function SettlementView({
  expenses,
  members,
  memberUids,
  settlementCurrency,
  onRecordSettlement,
}: {
  expenses: Expense[]
  members: Record<string, UserProfile>
  memberUids: string[]
  settlementCurrency?: string
  onRecordSettlement?: (from: string, to: string, amount: number) => Promise<void>
}) {
  const sc = settlementCurrency ?? 'USD'
  const balances = computeBalances(expenses, memberUids)
  const settlements = simplifyDebts(balances)

  // Per-person spending (exclude settlements)
  const spending: Record<string, number> = {}
  for (const uid of memberUids) spending[uid] = 0
  for (const exp of expenses) {
    if (exp.isSettlement) continue
    if (exp.paidByAmounts && Object.keys(exp.paidByAmounts).length > 0) {
      for (const [uid, amt] of Object.entries(exp.paidByAmounts)) {
        spending[uid] = (spending[uid] ?? 0) + amt
      }
    } else {
      spending[exp.paidBy] = (spending[exp.paidBy] ?? 0) + exp.amountUSD
    }
  }
  const sortedSpending = memberUids
    .map((uid) => ({ uid, amount: spending[uid] ?? 0 }))
    .sort((a, b) => b.amount - a.amount)
  const totalSpent = sortedSpending.reduce((s, e) => s + e.amount, 0)

  if (expenses.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted">
        No expenses yet — add one to get started.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Per-person spending */}
      <div>
        <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-2">
          Total Spent
        </h3>
        <div className="space-y-1">
          {sortedSpending.map(({ uid, amount }) => (
            <div key={uid} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <MemberAvatar member={members[uid]} size="sm" />
                <span className="text-sm text-text-secondary">
                  {getMemberName(uid, members)}
                </span>
              </div>
              <span className="text-sm font-medium text-text">
                {formatMoney(amount, sc)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-line-light">
          <span className="text-xs text-text-muted">Trip total</span>
          <span className="text-sm font-semibold text-text">{formatMoney(totalSpent, sc)}</span>
        </div>
      </div>

      {/* Balances */}
      <div>
        <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-2">
          Balances
        </h3>
        <div className="space-y-1">
          {memberUids.map((uid) => {
            const balance = balances[uid] ?? 0
            const rounded = Math.round(balance * 100) / 100
            return (
              <div key={uid} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <MemberAvatar member={members[uid]} size="sm" />
                  <span className="text-sm text-text-secondary">
                    {getMemberName(uid, members)}
                  </span>
                </div>
                <span
                  className={`text-sm font-medium ${
                    rounded > 0
                      ? 'text-success-text'
                      : rounded < 0
                        ? 'text-danger-text'
                        : 'text-text-muted'
                  }`}
                >
                  {rounded > 0 ? '+' : ''}
                  {formatMoney(rounded, sc)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Settle Up */}
      {settlements.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-2">
            Settle Up
          </h3>
          <div className="space-y-2">
            {settlements.map((s, i) => (
              <div
                key={i}
                className="bg-accent-soft rounded-lg p-3 flex items-center gap-2 flex-wrap"
              >
                <MemberAvatar member={members[s.from]} size="sm" />
                <span className="text-sm font-medium text-text-secondary">
                  {getMemberName(s.from, members)}
                </span>
                <span className="text-text-muted text-sm">pays</span>
                <MemberAvatar member={members[s.to]} size="sm" />
                <span className="text-sm font-medium text-text-secondary">
                  {getMemberName(s.to, members)}
                </span>
                <span className="font-bold text-accent-text">
                  {formatMoney(s.amount, sc)}
                </span>
                {onRecordSettlement && (
                  <button
                    onClick={() => onRecordSettlement(s.from, s.to, s.amount)}
                    className="ml-auto text-xs font-medium text-accent-text bg-accent/20 hover:bg-accent/30 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Record payment
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {settlements.length === 0 && expenses.length > 0 && (
        <div className="text-center py-4 text-success-text font-medium">
          All settled up!
        </div>
      )}
    </div>
  )
}
