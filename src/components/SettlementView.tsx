import { useState, useEffect } from 'react'
import type { Expense, UserProfile, CustomCategory } from '../lib/types'
import { formatMoney, getMemberName, getCategoryInfo, DEFAULT_CURRENCY } from '../lib/types'
import { computeBalances, simplifyDebts } from '../lib/settlement'
import { MemberAvatar } from './MemberAvatar'
import { CurrencyPicker } from './CurrencyPicker'
import { fetchRates } from '../lib/rates'

/** Compute all individual debtor→creditor pairs without simplification */
export function SettlementView({
  expenses,
  members,
  memberUids,
  settlementCurrency,
  onRecordSettlement,
  customCategories,
  tripRates,
  tripLastCurrency,
  currentUserUid,
}: {
  expenses: Expense[]
  members: Record<string, UserProfile>
  memberUids: string[]
  settlementCurrency?: string
  onRecordSettlement?: (from: string, to: string, amount: number, method?: string, currency?: string, exchangeRate?: number) => Promise<void>
  customCategories?: CustomCategory[]
  tripRates?: Record<string, number>
  tripLastCurrency?: string
  currentUserUid?: string
}) {
  const sc = settlementCurrency ?? DEFAULT_CURRENCY
  const [recordingIdx, setRecordingIdx] = useState<number | null>(null)
  const [payMethod, setPayMethod] = useState('')
  const [showSettleAll, setShowSettleAll] = useState(false)
  const [settlingAll, setSettlingAll] = useState(false)
  const balances = computeBalances(expenses, memberUids)
  const settlements = simplifyDebts(balances)

  // Custom payment form state
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [cpFrom, setCpFrom] = useState('')
  const [cpTo, setCpTo] = useState('')
  const [cpAmount, setCpAmount] = useState('')
  const [cpCurrency, setCpCurrency] = useState(sc)
  const [cpMethod, setCpMethod] = useState('')
  const [cpSubmitting, setCpSubmitting] = useState(false)
  const [rates, setRates] = useState<Record<string, number>>(tripRates ?? {})

  // Fetch exchange rates when form opens with non-settlement currency
  useEffect(() => {
    if (!showPaymentForm) return
    if (cpCurrency === sc && rates[cpCurrency]) return
    fetchRates().then((r) => setRates((prev) => ({ ...prev, ...r })))
  }, [showPaymentForm, cpCurrency, sc])

  const cpRate = cpCurrency === sc ? 1 : (rates[cpCurrency] ?? tripRates?.[cpCurrency] ?? null)
  const cpAmountNum = parseFloat(cpAmount) || 0
  const cpAmountInSC = cpRate ? cpAmountNum * cpRate : 0

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
      spending[exp.paidBy] = (spending[exp.paidBy] ?? 0) + exp.amountSettled
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
    <div className="space-y-6 min-w-0 max-w-lg mx-auto">
      {/* Settle Up — most important, shown first */}
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
                {onRecordSettlement && recordingIdx !== i && (
                  <button
                    onClick={() => { setRecordingIdx(i); setPayMethod('') }}
                    className="ml-auto text-sm font-medium text-accent-text bg-accent/20 hover:bg-accent/30 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Pay in full
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
                      await Promise.all(
                        settlements.map((s) => onRecordSettlement!(s.from, s.to, s.amount))
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

      {/* Record a payment (custom/partial) */}
      {onRecordSettlement && expenses.length > 0 && (
        <div>
          {!showPaymentForm ? (
            <button
              onClick={() => {
                setCpFrom(currentUserUid ?? memberUids[0])
                setCpTo(memberUids.find((u) => u !== (currentUserUid ?? memberUids[0])) ?? '')
                setCpAmount('')
                setCpCurrency(tripLastCurrency ?? sc)
                setCpMethod('')
                setShowPaymentForm(true)
              }}
              className="w-full py-2.5 text-sm font-medium text-text-secondary border border-line rounded-lg hover:bg-card-hover transition-colors flex items-center justify-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Record a payment
            </button>
          ) : (
            <div className="bg-card border border-line rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-text">Record a payment</h3>
                <button
                  onClick={() => setShowPaymentForm(false)}
                  className="text-text-muted hover:text-text-secondary transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Payer → Payee */}
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-xs text-text-muted mb-1 block">From</label>
                  <select
                    value={cpFrom}
                    onChange={(e) => {
                      setCpFrom(e.target.value)
                      if (e.target.value === cpTo) {
                        setCpTo(memberUids.find((u) => u !== e.target.value) ?? '')
                      }
                    }}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-input text-text"
                  >
                    {memberUids.map((uid) => (
                      <option key={uid} value={uid}>{getMemberName(uid, members)}</option>
                    ))}
                  </select>
                </div>
                <div className="pt-5 text-text-muted">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-text-muted mb-1 block">To</label>
                  <select
                    value={cpTo}
                    onChange={(e) => setCpTo(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-input text-text"
                  >
                    {memberUids.filter((u) => u !== cpFrom).map((uid) => (
                      <option key={uid} value={uid}>{getMemberName(uid, members)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Amount + Currency */}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs text-text-muted mb-1 block">Amount</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={cpAmount}
                    onChange={(e) => setCpAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-input text-text"
                    autoFocus
                  />
                </div>
                <div className="shrink-0">
                  <CurrencyPicker value={cpCurrency} onChange={setCpCurrency} />
                </div>
              </div>

              {/* Exchange rate hint when in foreign currency */}
              {cpCurrency !== sc && cpAmountNum > 0 && (
                <div className="text-xs text-text-muted px-1">
                  {cpRate
                    ? `≈ ${formatMoney(cpAmountInSC, sc)} at 1 ${cpCurrency} = ${cpRate.toFixed(4)} ${sc}`
                    : 'Loading exchange rate...'}
                </div>
              )}

              {/* Payment method pills */}
              <div>
                <label className="text-xs text-text-muted mb-1 block">Method (optional)</label>
                <div className="flex flex-wrap gap-1.5">
                  {['Cash', 'Venmo', 'Zelle', 'Bank', 'PayPal', 'Other'].map((m) => (
                    <button
                      key={m}
                      onClick={() => setCpMethod(cpMethod === m ? '' : m)}
                      className={`text-[11px] px-2 py-1 rounded-full border transition-all ${
                        cpMethod === m
                          ? 'bg-accent-soft border-accent text-accent-text'
                          : 'bg-card border-line text-text-secondary'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Confirm / Cancel */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={async () => {
                    if (!cpFrom || !cpTo || cpAmountNum <= 0) return
                    if (cpCurrency !== sc && !cpRate) return
                    setCpSubmitting(true)
                    try {
                      await onRecordSettlement(
                        cpFrom,
                        cpTo,
                        cpAmountNum,
                        cpMethod || undefined,
                        cpCurrency !== sc ? cpCurrency : undefined,
                        cpCurrency !== sc ? cpRate! : undefined,
                      )
                      setShowPaymentForm(false)
                    } catch {
                      // handled by parent
                    }
                    setCpSubmitting(false)
                  }}
                  disabled={cpSubmitting || cpAmountNum <= 0 || !cpFrom || !cpTo || (cpCurrency !== sc && !cpRate)}
                  className="flex-1 text-sm font-medium text-white bg-accent hover:bg-accent-hover px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {cpSubmitting ? 'Recording...' : 'Record payment'}
                </button>
                <button
                  onClick={() => setShowPaymentForm(false)}
                  className="text-sm text-text-muted hover:text-text-secondary px-4 py-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Per-person spending */}
      <div>
        <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-2">
          Total Spent
        </h3>
        <div>
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
          catTotals[cat] = (catTotals[cat] ?? 0) + exp.amountSettled
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
