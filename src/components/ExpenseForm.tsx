import { useState, useEffect } from 'react'
import { Timestamp } from 'firebase/firestore'
import type { Expense, UserProfile } from '../lib/types'
import { CURRENCIES } from '../lib/types'

interface ExpenseFormData {
  description: string
  amount: number
  currency: string
  exchangeRate: number
  paidBy: string
  splitType: 'equal' | 'exact' | 'percentage' | 'shares'
  splitAmong: string[]
  exactAmounts: Record<string, string>
  percentages: Record<string, string>
  shares: Record<string, string>
  date: string
}

function toDateString(ts?: Timestamp): string {
  if (!ts?.toDate) return new Date().toISOString().slice(0, 10)
  return ts.toDate().toISOString().slice(0, 10)
}

export function ExpenseForm({
  members,
  memberUids,
  currentUserUid,
  onSubmit,
  onDelete,
  existing,
}: {
  members: Record<string, UserProfile>
  memberUids: string[]
  currentUserUid: string
  onSubmit: (data: {
    description: string
    amount: number
    currency: string
    exchangeRate: number
    amountUSD: number
    paidBy: string
    splitType: 'equal' | 'exact' | 'percentage' | 'shares'
    splits: Record<string, number>
    date: Timestamp
  }) => Promise<void>
  onDelete?: () => Promise<void>
  existing?: Expense
}) {
  const [form, setForm] = useState<ExpenseFormData>(() => {
    if (existing) {
      const exactAmounts: Record<string, string> = {}
      const percentages: Record<string, string> = {}
      const shares: Record<string, string> = {}
      for (const uid of memberUids) {
        exactAmounts[uid] = (existing.splits[uid] ?? 0).toString()
        percentages[uid] = ''
        shares[uid] = '1'
      }
      return {
        description: existing.description,
        amount: existing.amount,
        currency: existing.currency,
        exchangeRate: existing.exchangeRate,
        paidBy: existing.paidBy,
        splitType: existing.splitType,
        splitAmong: Object.keys(existing.splits),
        exactAmounts,
        percentages,
        shares,
        date: toDateString(existing.date),
      }
    }
    const init: Record<string, string> = {}
    for (const uid of memberUids) {
      init[uid] = ''
    }
    return {
      description: '',
      amount: 0,
      currency: 'USD',
      exchangeRate: 1,
      paidBy: currentUserUid,
      splitType: 'equal',
      splitAmong: [...memberUids],
      exactAmounts: { ...init },
      percentages: { ...init },
      shares: Object.fromEntries(memberUids.map((uid) => [uid, '1'])),
      date: new Date().toISOString().slice(0, 10),
    }
  })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (form.currency === 'USD') {
      setForm((f) => ({ ...f, exchangeRate: 1 }))
    }
  }, [form.currency])

  const amountUSD = form.amount * form.exchangeRate

  function computeSplits(): Record<string, number> {
    const splits: Record<string, number> = {}

    if (form.splitType === 'equal') {
      const perPerson = amountUSD / form.splitAmong.length
      for (const uid of form.splitAmong) {
        splits[uid] = Math.round(perPerson * 100) / 100
      }
    } else if (form.splitType === 'exact') {
      for (const uid of form.splitAmong) {
        splits[uid] = parseFloat(form.exactAmounts[uid] || '0') || 0
      }
    } else if (form.splitType === 'percentage') {
      for (const uid of form.splitAmong) {
        const pct = parseFloat(form.percentages[uid] || '0') || 0
        splits[uid] = Math.round(amountUSD * (pct / 100) * 100) / 100
      }
    } else if (form.splitType === 'shares') {
      const totalShares = form.splitAmong.reduce(
        (sum, uid) => sum + (parseFloat(form.shares[uid] || '0') || 0),
        0
      )
      if (totalShares > 0) {
        for (const uid of form.splitAmong) {
          const s = parseFloat(form.shares[uid] || '0') || 0
          splits[uid] = Math.round(amountUSD * (s / totalShares) * 100) / 100
        }
      }
    }

    return splits
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!form.description.trim()) {
      setError('Description is required')
      return
    }
    if (form.amount <= 0) {
      setError('Amount must be greater than 0')
      return
    }
    if (form.exchangeRate <= 0) {
      setError('Exchange rate must be greater than 0')
      return
    }
    if (form.splitAmong.length === 0) {
      setError('Select at least one person to split with')
      return
    }

    const splits = computeSplits()
    const splitTotal = Object.values(splits).reduce((a, b) => a + b, 0)
    if (
      form.splitType !== 'equal' &&
      Math.abs(splitTotal - amountUSD) > 0.02
    ) {
      setError(
        `Split total ($${splitTotal.toFixed(2)}) doesn't match expense ($${amountUSD.toFixed(2)})`
      )
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        description: form.description.trim(),
        amount: form.amount,
        currency: form.currency,
        exchangeRate: form.exchangeRate,
        amountUSD,
        paidBy: form.paidBy,
        splitType: form.splitType,
        splits,
        date: Timestamp.fromDate(new Date(form.date)),
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      setSubmitting(false)
    }
  }

  function toggleMember(uid: string) {
    setForm((f) => ({
      ...f,
      splitAmong: f.splitAmong.includes(uid)
        ? f.splitAmong.filter((u) => u !== uid)
        : [...f.splitAmong, uid],
    }))
  }

  const label = 'block text-sm font-medium text-slate-700 mb-1'
  const input =
    'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={label}>Description</label>
        <input
          type="text"
          className={input}
          placeholder="Dinner, taxi, groceries..."
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Amount</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className={input}
            value={form.amount || ''}
            onChange={(e) =>
              setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))
            }
          />
        </div>
        <div>
          <label className={label}>Currency</label>
          <select
            className={input}
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} ({c.symbol})
              </option>
            ))}
          </select>
        </div>
      </div>

      {form.currency !== 'USD' && (
        <div>
          <label className={label}>
            Exchange Rate (1 {form.currency} = ? USD)
          </label>
          <input
            type="number"
            step="0.0001"
            min="0"
            className={input}
            value={form.exchangeRate || ''}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                exchangeRate: parseFloat(e.target.value) || 0,
              }))
            }
          />
          {amountUSD > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              = ${amountUSD.toFixed(2)} USD
            </p>
          )}
        </div>
      )}

      <div>
        <label className={label}>Paid by</label>
        <select
          className={input}
          value={form.paidBy}
          onChange={(e) => setForm((f) => ({ ...f, paidBy: e.target.value }))}
        >
          {memberUids.map((uid) => (
            <option key={uid} value={uid}>
              {members[uid]?.displayName ?? uid}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={label}>Date</label>
        <input
          type="date"
          className={input}
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
        />
      </div>

      <div>
        <label className={label}>Split type</label>
        <div className="grid grid-cols-4 gap-1 bg-slate-100 rounded-lg p-1">
          {(['equal', 'exact', 'percentage', 'shares'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setForm((f) => ({ ...f, splitType: t }))}
              className={`text-sm py-1.5 rounded-md capitalize transition-all ${
                form.splitType === t
                  ? 'bg-white text-primary-700 font-medium shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'percentage' ? '%' : t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={label}>Split among</label>
        <div className="space-y-2">
          {memberUids.map((uid) => (
            <div key={uid} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={form.splitAmong.includes(uid)}
                onChange={() => toggleMember(uid)}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm flex-1">
                {members[uid]?.displayName ?? uid}
              </span>

              {form.splitType === 'exact' && form.splitAmong.includes(uid) && (
                <div className="flex items-center gap-1">
                  <span className="text-sm text-slate-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-24 border border-slate-300 rounded px-2 py-1 text-sm"
                    value={form.exactAmounts[uid] ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        exactAmounts: { ...f.exactAmounts, [uid]: e.target.value },
                      }))
                    }
                  />
                </div>
              )}

              {form.splitType === 'percentage' && form.splitAmong.includes(uid) && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    className="w-20 border border-slate-300 rounded px-2 py-1 text-sm"
                    value={form.percentages[uid] ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        percentages: { ...f.percentages, [uid]: e.target.value },
                      }))
                    }
                  />
                  <span className="text-sm text-slate-400">%</span>
                </div>
              )}

              {form.splitType === 'shares' && form.splitAmong.includes(uid) && (
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="w-20 border border-slate-300 rounded px-2 py-1 text-sm"
                  value={form.shares[uid] ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      shares: { ...f.shares, [uid]: e.target.value },
                    }))
                  }
                />
              )}

              {form.splitType === 'equal' && form.splitAmong.includes(uid) && (
                <span className="text-sm text-slate-400">
                  ${(amountUSD / form.splitAmong.length).toFixed(2)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 bg-primary-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Saving...' : existing ? 'Update Expense' : 'Add Expense'}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  )
}
