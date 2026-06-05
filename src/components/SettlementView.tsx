import type { Expense, UserProfile } from '../lib/types'
import { formatUSD } from '../lib/types'
import { computeBalances, simplifyDebts } from '../lib/settlement'
import { MemberAvatar } from './MemberAvatar'

export function SettlementView({
  expenses,
  members,
  memberUids,
}: {
  expenses: Expense[]
  members: Record<string, UserProfile>
  memberUids: string[]
}) {
  const balances = computeBalances(expenses, memberUids)
  const settlements = simplifyDebts(balances)

  if (expenses.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        No expenses yet — add one to get started.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-2">
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
                  <span className="text-sm text-slate-700">
                    {members[uid]?.displayName ?? uid}
                  </span>
                </div>
                <span
                  className={`text-sm font-medium ${
                    rounded > 0
                      ? 'text-emerald-600'
                      : rounded < 0
                        ? 'text-red-500'
                        : 'text-slate-400'
                  }`}
                >
                  {rounded > 0 ? '+' : ''}
                  {formatUSD(rounded)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {settlements.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-2">
            Settle Up
          </h3>
          <div className="space-y-2">
            {settlements.map((s, i) => (
              <div
                key={i}
                className="bg-primary-50 rounded-lg p-3 flex items-center gap-2"
              >
                <MemberAvatar member={members[s.from]} size="sm" />
                <span className="text-sm font-medium text-slate-700">
                  {members[s.from]?.displayName ?? s.from}
                </span>
                <span className="text-slate-400 text-sm">pays</span>
                <MemberAvatar member={members[s.to]} size="sm" />
                <span className="text-sm font-medium text-slate-700">
                  {members[s.to]?.displayName ?? s.to}
                </span>
                <span className="ml-auto font-bold text-primary-700">
                  {formatUSD(s.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {settlements.length === 0 && expenses.length > 0 && (
        <div className="text-center py-4 text-emerald-600 font-medium">
          All settled up!
        </div>
      )}
    </div>
  )
}
