import { useState, useEffect, useRef } from 'react'
import { Timestamp } from 'firebase/firestore'
import type { Expense, UserProfile } from '../lib/types'
import { getMemberName } from '../lib/types'
import { getCurrency } from '../lib/currencies'
import { CurrencyPicker } from './CurrencyPicker'
import { fetchRates, getRate } from '../lib/rates'

interface ExpenseFormData {
  description: string
  amount: number
  currency: string
  exchangeRate: number
  rateIsCustom: boolean
  paidBy: string
  multiPayer: boolean
  paidByAmounts: Record<string, string>
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
  tripRates,
  onSubmit,
  onDelete,
  existing,
}: {
  members: Record<string, UserProfile>
  memberUids: string[]
  currentUserUid: string
  tripRates?: Record<string, number>
  onSubmit: (data: {
    description: string
    amount: number
    currency: string
    exchangeRate: number
    amountUSD: number
    paidBy: string
    paidByAmounts?: Record<string, number>
    splitType: 'equal' | 'exact' | 'percentage' | 'shares'
    splits: Record<string, number>
    date: Timestamp
  }) => Promise<void>
  onDelete?: () => Promise<void>
  existing?: Expense
}) {
  const [form, setForm] = useState<ExpenseFormData>(() => {
    const initAmounts: Record<string, string> = {}
    const initPaidBy: Record<string, string> = {}
    for (const uid of memberUids) {
      initAmounts[uid] = ''
      initPaidBy[uid] = ''
    }

    if (existing) {
      const exactAmounts: Record<string, string> = {}
      const percentages: Record<string, string> = {}
      const shares: Record<string, string> = {}
      const paidByAmounts: Record<string, string> = {}
      for (const uid of memberUids) {
        exactAmounts[uid] = (existing.splits[uid] ?? 0).toString()
        percentages[uid] = ''
        shares[uid] = '1'
        paidByAmounts[uid] = ''
      }

      const hasMultiPayer = existing.paidByAmounts && Object.keys(existing.paidByAmounts).length > 0
      if (hasMultiPayer) {
        for (const [uid, amt] of Object.entries(existing.paidByAmounts!)) {
          paidByAmounts[uid] = amt.toString()
        }
      }

      return {
        description: existing.description,
        amount: existing.amount,
        currency: existing.currency,
        exchangeRate: existing.exchangeRate,
        rateIsCustom: true,
        paidBy: existing.paidBy,
        multiPayer: !!hasMultiPayer,
        paidByAmounts,
        splitType: existing.splitType,
        splitAmong: Object.keys(existing.splits),
        exactAmounts,
        percentages,
        shares,
        date: toDateString(existing.date),
      }
    }

    return {
      description: '',
      amount: 0,
      currency: 'USD',
      exchangeRate: 1,
      rateIsCustom: false,
      paidBy: currentUserUid,
      multiPayer: false,
      paidByAmounts: initPaidBy,
      splitType: 'equal',
      splitAmong: [...memberUids],
      exactAmounts: { ...initAmounts },
      percentages: { ...initAmounts },
      shares: Object.fromEntries(memberUids.map((uid) => [uid, '1'])),
      date: new Date().toISOString().slice(0, 10),
    }
  })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [liveRates, setLiveRates] = useState<Record<string, number>>({})
  const [rateSource, setRateSource] = useState<'live' | 'trip' | 'custom' | ''>('')
  const initializedCurrency = useRef(existing?.currency ?? 'USD')

  useEffect(() => {
    fetchRates().then(setLiveRates)
  }, [])

  useEffect(() => {
    if (form.currency === 'USD') {
      setForm((f) => ({ ...f, exchangeRate: 1, rateIsCustom: false }))
      setRateSource('')
      return
    }
    if (existing && form.currency === initializedCurrency.current) return
    if (form.rateIsCustom) return
    autoFillRate(form.currency)
  }, [form.currency, liveRates, tripRates])

  function autoFillRate(currency: string) {
    if (tripRates?.[currency]) {
      setForm((f) => ({ ...f, exchangeRate: tripRates[currency], rateIsCustom: false }))
      setRateSource('trip')
      return
    }
    const live = getRate(liveRates, currency)
    if (live) {
      setForm((f) => ({ ...f, exchangeRate: Math.round(live * 10000) / 10000, rateIsCustom: false }))
      setRateSource('live')
      return
    }
  }

  function handleCurrencyChange(currency: string) {
    initializedCurrency.current = ''
    setForm((f) => ({ ...f, currency, rateIsCustom: false }))
  }

  function handleRateChange(value: string) {
    setForm((f) => ({
      ...f,
      exchangeRate: parseFloat(value) || 0,
      rateIsCustom: true,
    }))
    setRateSource('custom')
  }

  function resetToAutoRate() {
    setForm((f) => ({ ...f, rateIsCustom: false }))
    autoFillRate(form.currency)
  }

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

  function computePaidByAmounts(): Record<string, number> | undefined {
    if (!form.multiPayer) return undefined
    const amounts: Record<string, number> = {}
    for (const uid of memberUids) {
      const val = parseFloat(form.paidByAmounts[uid] || '0') || 0
      if (val > 0) amounts[uid] = val
    }
    return Object.keys(amounts).length > 0 ? amounts : undefined
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

    // Validate multi-payer amounts
    if (form.multiPayer) {
      const paidAmounts = computePaidByAmounts()
      if (!paidAmounts || Object.keys(paidAmounts).length === 0) {
        setError('Enter how much each person paid')
        return
      }
      const paidTotal = Object.values(paidAmounts).reduce((a, b) => a + b, 0)
      if (Math.abs(paidTotal - amountUSD) > 0.02) {
        setError(
          `Paid amounts total ($${paidTotal.toFixed(2)}) doesn't match expense ($${amountUSD.toFixed(2)})`
        )
        return
      }
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
      const paidByAmounts = computePaidByAmounts()
      const submitData: Parameters<typeof onSubmit>[0] = {
        description: form.description.trim(),
        amount: form.amount,
        currency: form.currency,
        exchangeRate: form.exchangeRate,
        amountUSD,
        paidBy: form.multiPayer
          ? Object.entries(paidByAmounts ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? currentUserUid
          : form.paidBy,
        splitType: form.splitType,
        splits,
        date: Timestamp.fromDate(new Date(form.date)),
      }
      // Only include paidByAmounts when using multi-payer (Firestore rejects undefined)
      if (paidByAmounts) {
        submitData.paidByAmounts = paidByAmounts
      }
      await onSubmit(submitData)
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

  function toggleMultiPayer() {
    setForm((f) => ({ ...f, multiPayer: !f.multiPayer }))
  }

  const label = 'block text-sm font-medium text-text-secondary mb-1'
  const input =
    'w-full border border-line rounded-lg px-3 py-2 text-sm bg-card text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500'

  const currencyInfo = getCurrency(form.currency)

  // Compute paid total for multi-payer display
  const paidTotal = form.multiPayer
    ? memberUids.reduce((sum, uid) => sum + (parseFloat(form.paidByAmounts[uid] || '0') || 0), 0)
    : 0
  const paidRemaining = form.multiPayer ? amountUSD - paidTotal : 0

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
          <CurrencyPicker
            value={form.currency}
            onChange={handleCurrencyChange}
          />
        </div>
      </div>

      {form.currency !== 'USD' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-text-secondary">
              Exchange Rate (1 {currencyInfo?.symbol ?? form.currency} = ? USD)
            </label>
            {rateSource === 'custom' && (
              <button
                type="button"
                onClick={resetToAutoRate}
                className="text-xs text-accent-text hover:text-accent-hover"
              >
                Reset to auto
              </button>
            )}
          </div>
          <div className="relative">
            <input
              type="number"
              step="0.0001"
              min="0"
              className={input}
              value={form.exchangeRate || ''}
              onChange={(e) => handleRateChange(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            {amountUSD > 0 && (
              <p className="text-xs text-text-secondary">
                {form.amount} {form.currency} = ${amountUSD.toFixed(2)} USD
              </p>
            )}
            <p className="text-xs text-text-muted">
              {rateSource === 'live' && 'Auto (live rate)'}
              {rateSource === 'trip' && 'Auto (last used on this trip)'}
              {rateSource === 'custom' && 'Custom rate'}
            </p>
          </div>
        </div>
      )}

      {/* Paid by section */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-text-secondary">Paid by</label>
          <button
            type="button"
            onClick={toggleMultiPayer}
            className="text-xs text-accent-text hover:text-accent-hover"
          >
            {form.multiPayer ? 'Single payer' : 'Multiple payers'}
          </button>
        </div>

        {form.multiPayer ? (
          <div className="space-y-2">
            {memberUids.map((uid) => (
              <div key={uid} className="flex items-center gap-3">
                <span className="text-sm flex-1 text-text-secondary">
                  {getMemberName(uid, members)}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-text-muted">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-28 border border-line rounded px-2 py-1 text-sm bg-card text-text"
                    placeholder="0.00"
                    value={form.paidByAmounts[uid] ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        paidByAmounts: { ...f.paidByAmounts, [uid]: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>
            ))}
            {amountUSD > 0 && (
              <p className={`text-xs ${Math.abs(paidRemaining) < 0.02 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {Math.abs(paidRemaining) < 0.02
                  ? 'Paid amounts match total'
                  : paidRemaining > 0
                    ? `$${paidRemaining.toFixed(2)} remaining to assign`
                    : `$${Math.abs(paidRemaining).toFixed(2)} over the total`}
              </p>
            )}
          </div>
        ) : (
          <select
            className={input}
            value={form.paidBy}
            onChange={(e) => setForm((f) => ({ ...f, paidBy: e.target.value }))}
          >
            {memberUids.map((uid) => (
              <option key={uid} value={uid}>
                {getMemberName(uid, members)}
              </option>
            ))}
          </select>
        )}
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
        <div className="grid grid-cols-4 gap-1 bg-muted rounded-lg p-1">
          {(['equal', 'exact', 'percentage', 'shares'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setForm((f) => ({ ...f, splitType: t }))}
              className={`text-sm py-1.5 rounded-md capitalize transition-all ${
                form.splitType === t
                  ? 'bg-active text-accent-text font-medium shadow-sm'
                  : 'text-text-secondary hover:text-text-secondary'
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
                className="rounded border-line text-accent-text focus:ring-primary-500"
              />
              <span className="text-sm flex-1 text-text-secondary">
                {getMemberName(uid, members)}
              </span>

              {form.splitType === 'exact' && form.splitAmong.includes(uid) && (
                <div className="flex items-center gap-1">
                  <span className="text-sm text-text-muted">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-24 border border-line rounded px-2 py-1 text-sm bg-card text-text"
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
                    className="w-20 border border-line rounded px-2 py-1 text-sm bg-card text-text"
                    value={form.percentages[uid] ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        percentages: { ...f.percentages, [uid]: e.target.value },
                      }))
                    }
                  />
                  <span className="text-sm text-text-muted">%</span>
                </div>
              )}

              {form.splitType === 'shares' && form.splitAmong.includes(uid) && (
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="w-20 border border-line rounded px-2 py-1 text-sm bg-card text-text"
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
                <span className="text-sm text-text-muted">
                  ${(amountUSD / form.splitAmong.length).toFixed(2)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-danger-bg rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 bg-accent text-white rounded-lg py-2.5 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Saving...' : existing ? 'Update Expense' : 'Add Expense'}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="px-4 py-2.5 text-sm text-red-600 hover:bg-danger-bg rounded-lg transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  )
}
