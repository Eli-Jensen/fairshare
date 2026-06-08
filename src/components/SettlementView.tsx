import { useState } from 'react'
import type { Expense, UserProfile, CustomCategory } from '../lib/types'
import { formatMoney, getMemberName, getCategoryInfo } from '../lib/types'
import { computeBalances, simplifyDebts } from '../lib/settlement'
import { MemberAvatar } from './MemberAvatar'

/** Compute all individual debtor→creditor pairs without simplification */
function computeRawDebts(balances: Record<string, number>) {
  const debts: { from: string; to: string; amount: number }[] = []
  const creditors = Object.entries(balances).filter(([, b]) => b > 0.01)
  const debtors = Object.entries(balances).filter(([, b]) => b < -0.01)
  for (const [fromUid, fromBal] of debtors) {
    for (const [toUid, toBal] of creditors) {
      // Each debtor owes each creditor proportionally
      const totalDebt = -fromBal
      const totalCredit = creditors.reduce((s, [, b]) => s + b, 0)
      const amount = Math.round(totalDebt * (toBal / totalCredit) * 100) / 100
      if (amount > 0.01) {
        debts.push({ from: fromUid, to: toUid, amount })
      }
    }
  }
  return debts
}

export function SettlementView({
  expenses,
  members,
  memberUids,
  settlementCurrency,
  simplifyDebtsDefault = true,
  onRecordSettlement,
  onToggleSimplify,
  customCategories,
}: {
  expenses: Expense[]
  members: Record<string, UserProfile>
  memberUids: string[]
  settlementCurrency?: string
  simplifyDebtsDefault?: boolean
  onRecordSettlement?: (from: string, to: string, amount: number, method?: string) => Promise<void>
  onToggleSimplify?: (value: boolean) => void
  customCategories?: CustomCategory[]
}) {
  const sc = settlementCurrency ?? 'USD'
  const [simplify, setSimplify] = useState(simplifyDebtsDefault)
  const [recordingIdx, setRecordingIdx] = useState<number | null>(null)
  const [payMethod, setPayMethod] = useState('')
  const [showSettleAll, setShowSettleAll] = useState(false)
  const [settlingAll, setSettlingAll] = useState(false)
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
        No expenses yet
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Settle Up — most important, shown first */}
      {settlements.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide">
              Settle Up
            </h3>
            <button
              onClick={() => {
                const next = !simplify
                setSimplify(next)
                onToggleSimplify?.(next)
              }}
              className="text-sm text-accent-text hover:text-accent-hover transition-colors"
            >
              {simplify ? 'Show all debts' : 'Simplify debts'}
            </button>
          </div>
          <div className="space-y-2">
            {(simplify ? settlements : computeRawDebts(balances)).map((s, i) => (
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
                {onRecordSettlement && recordingIdx !== i && (
                  <button
                    onClick={() => { setRecordingIdx(i); setPayMethod('') }}
                    className="ml-auto text-sm font-medium text-accent-text bg-accent/20 hover:bg-accent/30 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Record payment
                  </button>
                )}
                {onRecordSettlement && recordingIdx === i && (
                  <div className="w-full mt-2 flex flex-wrap gap-1.5 items-center">
                    {['Cash', 'Venmo', 'Zelle', 'Bank', 'PayPal', 'Other'].map((m) => (
                      <button
                        key={m}
                        onClick={() => setPayMethod(m)}
                        className={`text-[11px] px-2 py-1 rounded-full border transition-all ${
                          payMethod === m
                            ? 'bg-accent-soft border-accent text-accent-text'
                            : 'bg-card border-line text-text-secondary'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                    <button
                      onClick={async () => {
                        await onRecordSettlement(s.from, s.to, s.amount, payMethod || undefined)
                        setRecordingIdx(null)
                      }}
                      className="ml-auto text-sm font-medium text-white bg-accent hover:bg-accent-hover px-3 py-1 rounded-lg transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setRecordingIdx(null)}
                      className="text-sm text-text-muted hover:text-text-secondary px-2 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Settle All button */}
          {onRecordSettlement && settlements.length > 1 && !showSettleAll && (
            <button
              onClick={() => setShowSettleAll(true)}
              className="w-full mt-3 py-2.5 text-sm font-medium text-accent-text border border-accent/30 rounded-lg hover:bg-accent-soft transition-colors"
            >
              Settle all ({settlements.length} payments)
            </button>
          )}

          {/* Settle All confirmation */}
          {showSettleAll && (
            <div className="mt-3 bg-warn-bg border border-warn-border rounded-lg p-4">
              <p className="text-sm font-medium text-text mb-2">
                Record all {settlements.length} payments?
              </p>
              <p className="text-sm text-text-secondary mb-3">
                This will mark all outstanding balances as settled. Make sure everyone has actually paid outside the app first.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setSettlingAll(true)
                    try {
                      const debts = simplify ? settlements : computeRawDebts(balances)
                      await Promise.all(
                        debts.map((s) => onRecordSettlement!(s.from, s.to, s.amount))
                      )
                    } catch {
                      // Individual failures are handled by the parent
                    }
                    setSettlingAll(false)
                    setShowSettleAll(false)
                  }}
                  disabled={settlingAll}
                  className="text-sm font-medium text-white bg-accent hover:bg-accent-hover px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {settlingAll ? 'Recording...' : 'Yes, settle all'}
                </button>
                <button
                  onClick={() => setShowSettleAll(false)}
                  className="text-sm text-text-muted hover:text-text-secondary px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {settlements.length === 0 && expenses.length > 0 && (
        <div className="text-center py-4 text-success-text font-medium">
          All settled up!
        </div>
      )}

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
          <span className="text-sm text-text-muted">Trip total</span>
          <span className="text-sm font-semibold text-text">{formatMoney(totalSpent, sc)}</span>
        </div>
      </div>

      {/* Balances */}
      <div>
        <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-2">
          Balances
        </h3>
        <div className="space-y-1">
          {/* Show all UIDs with balances, including removed members */}
          {Object.entries(balances)
            .sort(([, a], [, b]) => b - a)
            .map(([uid, balance]) => {
            const rounded = Math.round(balance * 100) / 100
            const isRemoved = !memberUids.includes(uid)
            return (
              <div key={uid} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <MemberAvatar member={members[uid]} size="sm" />
                  <span className="text-sm text-text-secondary">
                    {getMemberName(uid, members)}
                    {isRemoved && <span className="text-text-muted ml-1">(removed)</span>}
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

      {/* Spending by category */}
      {(() => {
        const catTotals: Record<string, number> = {}
        for (const exp of expenses) {
          if (exp.isSettlement) continue
          const cat = exp.category || 'uncategorized'
          catTotals[cat] = (catTotals[cat] ?? 0) + exp.amountUSD
        }
        const entries = Object.entries(catTotals).sort(([, a], [, b]) => b - a)
        if (entries.length <= 1 && entries[0]?.[0] === 'uncategorized') return null
        const max = Math.max(...entries.map(([, v]) => v), 1)
        return (
          <div>
            <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-2">
              By Category
            </h3>
            <div className="space-y-2">
              {entries.map(([cat, amount]) => {
                const info = getCategoryInfo(cat, customCategories)
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-sm mb-0.5">
                      <span className="text-text-secondary">
                        {info ? `${info.emoji} ${info.label}` : 'Uncategorized'}
                      </span>
                      <span className="text-text font-medium">{formatMoney(amount, sc)}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${(amount / max) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
