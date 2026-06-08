import { useState, useEffect, useRef } from 'react'
import { Timestamp } from 'firebase/firestore'
import type { Expense, UserProfile, ExpenseCategory, CustomCategory } from '../lib/types'
import { getMemberName, formatMoney, getAllCategories, categoryExists } from '../lib/types'
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
  notes: string
  category: string
  rateDirection: 'foreign-to-usd' | 'usd-to-foreign'
  calcGave: string
  calcGotForeign: string
  showCalc: boolean
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
  tripLastCurrency,
  settlementCurrency: sc = 'USD',
  customCategories,
  onAddCategory,
  onUpdateCategories,
  onSubmit,
  onDelete,
  existing,
}: {
  members: Record<string, UserProfile>
  memberUids: string[]
  currentUserUid: string
  tripRates?: Record<string, number>
  tripLastCurrency?: string
  settlementCurrency?: string
  customCategories?: CustomCategory[]
  onAddCategory?: (category: CustomCategory) => Promise<void>
  onUpdateCategories?: (categories: CustomCategory[]) => Promise<void>
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
    notes?: string
    category?: ExpenseCategory
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
        notes: existing.notes ?? '',
        category: existing.category ?? '',
        rateDirection: 'foreign-to-usd',
        calcGave: '',
        calcGotForeign: '',
        showCalc: false,
      }
    }

    return {
      description: '',
      amount: 0,
      currency: tripLastCurrency || sc,
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
      notes: '',
      category: '',
      rateDirection: 'foreign-to-usd',
      calcGave: '',
      calcGotForeign: '',
      showCalc: false,
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
    if (form.currency === sc) {
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

  // resetToAutoRate kept for reference — inline version used in JSX

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
          `Paid amounts total (${paidTotal.toFixed(2)}) doesn't match expense (${amountUSD.toFixed(2)})`
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
        `Split total (${splitTotal.toFixed(2)}) doesn't match expense (${amountUSD.toFixed(2)})`
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
      // Only include optional fields when set (Firestore rejects undefined)
      if (paidByAmounts) submitData.paidByAmounts = paidByAmounts
      if (form.notes.trim()) submitData.notes = form.notes.trim()
      if (form.category) submitData.category = form.category
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

  // Quick currency switcher: USD + currencies that have been used on this trip
  const quickCurrencies = (() => {
    const codes = new Set<string>([sc])
    if (tripLastCurrency && tripLastCurrency !== sc) codes.add(tripLastCurrency)
    if (tripRates) {
      for (const code of Object.keys(tripRates)) {
        if (code !== sc) codes.add(code)
      }
    }
    // If current currency isn't in the set, add it
    if (form.currency !== sc) codes.add(form.currency)
    return Array.from(codes).slice(0, 4)
  })()

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
          placeholder="Dinner, taxi, drinks..."
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div>
        <label className={label}>Amount</label>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="number"
            step="0.01"
            min="0"
            className={input}
            value={form.amount || ''}
            placeholder="0.00"
            onChange={(e) =>
              setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))
            }
          />
          {/* Quick currency switcher */}
          <div className="flex gap-1">
            {quickCurrencies.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => handleCurrencyChange(code)}
                className={`flex-1 text-xs py-2 rounded-lg border transition-all font-medium ${
                  form.currency === code
                    ? 'bg-accent-soft border-accent text-accent-text'
                    : 'bg-card border-line text-text-secondary hover:border-accent'
                }`}
              >
                {code}
              </button>
            ))}
            {quickCurrencies.length < 4 && (
              <div className="flex-1">
                <CurrencyPicker
                  value={form.currency}
                  onChange={handleCurrencyChange}
                />
              </div>
            )}
          </div>
        </div>
        {form.currency !== sc && form.amount > 0 && form.exchangeRate > 0 && (
          <p className="text-xs text-accent-text mt-1 font-medium">
            = {formatMoney(amountUSD, sc)}
          </p>
        )}
      </div>

      {form.currency !== sc && (
        <div className="bg-muted/50 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setForm((f) => ({
                ...f,
                rateDirection: f.rateDirection === 'foreign-to-usd' ? 'usd-to-foreign' : 'foreign-to-usd',
              }))}
              className="text-sm font-medium text-text-secondary flex items-center gap-1"
            >
              {form.rateDirection === 'foreign-to-usd'
                ? `1 ${form.currency} = ? USD`
                : `1 ${sc} = ? ${form.currency}`}
              <svg className="w-3.5 h-3.5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              {(rateSource === 'custom' || rateSource === 'trip') && (
                <button type="button" onClick={() => {
                  setForm((f) => ({ ...f, rateIsCustom: false }))
                  // Force fetch from live API, bypassing trip saved rate
                  const live = getRate(liveRates, form.currency)
                  if (live) {
                    setForm((f) => ({ ...f, exchangeRate: Math.round(live * 10000) / 10000 }))
                    setRateSource('live')
                  } else {
                    autoFillRate(form.currency)
                  }
                }} className="text-xs text-accent-text hover:text-accent-hover">
                  {rateSource === 'custom' ? 'Reset to auto' : 'Use live rate'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, showCalc: !f.showCalc }))}
                className="text-xs text-accent-text hover:text-accent-hover"
              >
                {form.showCalc ? 'Hide calculator' : 'Calculator'}
              </button>
            </div>
          </div>

          <input
            type="number"
            step="0.0001"
            min="0"
            className={input}
            value={form.rateDirection === 'foreign-to-usd'
              ? (form.exchangeRate || '')
              : (form.exchangeRate > 0 ? Math.round((1 / form.exchangeRate) * 10000) / 10000 : '')}
            onChange={(e) => {
              const val = parseFloat(e.target.value) || 0
              if (form.rateDirection === 'foreign-to-usd') {
                handleRateChange(e.target.value)
              } else {
                // Convert "1 USD = X foreign" to "1 foreign = Y USD"
                const rate = val > 0 ? Math.round((1 / val) * 10000) / 10000 : 0
                handleRateChange(rate.toString())
              }
            }}
          />

          {/* Exchange calculator */}
          {form.showCalc && (
            <div className="bg-card rounded-lg p-2.5 border border-line space-y-2">
              <p className="text-xs font-medium text-text-secondary">Exchange calculator</p>
              <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-center">
                <div>
                  <label className="text-[10px] text-text-muted uppercase">Gave ({sc})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="200"
                    className="w-full border border-line rounded px-2 py-1 text-sm bg-input text-text"
                    value={form.calcGave}
                    onChange={(e) => {
                      const gave = parseFloat(e.target.value) || 0
                      const got = parseFloat(form.calcGotForeign) || 0
                      setForm((f) => ({ ...f, calcGave: e.target.value }))
                      if (gave > 0 && got > 0) {
                        const rate = Math.round((gave / got) * 10000) / 10000
                        handleRateChange(rate.toString())
                      }
                    }}
                  />
                </div>
                <span className="text-text-muted text-sm mt-4">=</span>
                <div>
                  <label className="text-[10px] text-text-muted uppercase">Got ({form.currency})</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="350"
                    className="w-full border border-line rounded px-2 py-1 text-sm bg-input text-text"
                    value={form.calcGotForeign}
                    onChange={(e) => {
                      const got = parseFloat(e.target.value) || 0
                      const gave = parseFloat(form.calcGave) || 0
                      setForm((f) => ({ ...f, calcGotForeign: e.target.value }))
                      if (gave > 0 && got > 0) {
                        const rate = Math.round((gave / got) * 10000) / 10000
                        handleRateChange(rate.toString())
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            {amountUSD > 0 && (
              <p className="text-xs text-text-secondary">
                {form.amount} {form.currency} = {formatMoney(amountUSD, sc)}
              </p>
            )}
            <p className="text-xs text-text-muted">
              {rateSource === 'live' && 'Auto (live)'}
              {rateSource === 'trip' && 'Last used on trip'}
              {rateSource === 'custom' && 'Custom'}
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

      <CategoryPicker
        category={form.category}
        customCategories={customCategories}
        onSelect={(value) => setForm((f) => ({ ...f, category: f.category === value ? '' : value }))}
        onAddCategory={onAddCategory}
        onUpdateCategories={onUpdateCategories}
      />

      <div>
        <label className={label}>Notes <span className="font-normal text-text-muted">(optional)</span></label>
        <textarea
          className={input}
          rows={2}
          placeholder="Add a note..."
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
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
                  {formatMoney(amountUSD / form.splitAmong.length, sc)}
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
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving
            </span>
          ) : existing ? 'Update Expense' : 'Add Expense'}
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

const MAX_LABEL_LENGTH = 20

const EMOJI_GRID = [
  '🍽️','🍕','🍺','☕','🛒','🚗','✈️','🚌','🏨','🏠',
  '🎭','🎬','🎯','🎵','⛷️','🏖️','🎟️','💊','🛍️','💇',
  '📱','💡','🔧','🎁','📦','💰','🧾','🎓','👶','🐾',
]

const RANDOM_EMOJIS = ['🏷️','📌','🔖','🎲','💫','⭐','🌟','✨']

function CategoryPicker({
  category,
  customCategories,
  onSelect,
  onAddCategory,
  onUpdateCategories,
}: {
  category: string
  customCategories?: CustomCategory[]
  onSelect: (value: string) => void
  onAddCategory?: (category: CustomCategory) => Promise<void>
  onUpdateCategories?: (categories: CustomCategory[]) => Promise<void>
}) {
  const [mode, setMode] = useState<'pick' | 'create' | 'manage'>('pick')
  const [newEmoji, setNewEmoji] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [showEmojiGrid, setShowEmojiGrid] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editEmoji, setEditEmoji] = useState('')
  const [editLabel, setEditLabel] = useState('')
  const [editEmojiGrid, setEditEmojiGrid] = useState(false)
  const labelRef = useRef<HTMLInputElement>(null)

  const allCategories = getAllCategories(customCategories)

  function handleStartCreate() {
    setMode('create')
    setNewEmoji('')
    setNewLabel('')
    setShowEmojiGrid(false)
    setError('')
    setTimeout(() => labelRef.current?.focus(), 50)
  }

  function handleCancel() {
    setMode('pick')
    setNewEmoji('')
    setNewLabel('')
    setShowEmojiGrid(false)
    setError('')
    setEditingId(null)
  }

  async function handleSave() {
    const label = newLabel.trim()
    // If no emoji picked, assign a random one
    const emoji = newEmoji.trim() || RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)]

    if (!label) {
      setError('Enter a name')
      return
    }
    if (label.length > MAX_LABEL_LENGTH) {
      setError(`Max ${MAX_LABEL_LENGTH} characters`)
      return
    }
    if (categoryExists(emoji, label, customCategories)) {
      setError('This category already exists')
      return
    }

    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (!id || allCategories.some((c) => c.value === id)) {
      setError('This category already exists')
      return
    }

    setSaving(true)
    try {
      await onAddCategory?.({ id, label, emoji })
      onSelect(id)
      handleCancel()
    } catch {
      setError('Failed to save')
    }
    setSaving(false)
  }

  async function handleEditSave(oldId: string) {
    if (!customCategories || !onUpdateCategories) return
    const label = editLabel.trim()
    const emoji = editEmoji.trim() || RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)]
    if (!label) return

    const updated = customCategories.map((c) =>
      c.id === oldId ? { ...c, label, emoji } : c
    )
    setSaving(true)
    try {
      await onUpdateCategories(updated)
      setEditingId(null)
      setEditEmojiGrid(false)
    } catch {
      setError('Failed to save')
    }
    setSaving(false)
  }

  async function handleMove(idx: number, dir: -1 | 1) {
    if (!customCategories || !onUpdateCategories) return
    const arr = [...customCategories]
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= arr.length) return
    ;[arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]
    await onUpdateCategories(arr)
  }

  async function handleDelete(id: string) {
    if (!customCategories || !onUpdateCategories) return
    await onUpdateCategories(customCategories.filter((c) => c.id !== id))
  }

  function EmojiGrid({ selected, onPick }: { selected: string; onPick: (e: string) => void }) {
    return (
      <div className="grid grid-cols-10 gap-1 mt-1 p-2 bg-muted rounded-lg">
        {EMOJI_GRID.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            className={`w-8 h-8 flex items-center justify-center rounded text-base hover:bg-card-hover transition-colors ${
              selected === e ? 'bg-accent-soft ring-1 ring-accent' : ''
            }`}
          >
            {e}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium text-text-secondary">
          Category <span className="font-normal text-text-muted">(optional)</span>
        </label>
        {onUpdateCategories && customCategories && customCategories.length > 0 && mode !== 'manage' && (
          <button type="button" onClick={() => setMode('manage')} className="text-xs text-accent-text hover:text-accent-hover">
            Edit
          </button>
        )}
        {mode === 'manage' && (
          <button type="button" onClick={handleCancel} className="text-xs text-accent-text hover:text-accent-hover">
            Done
          </button>
        )}
      </div>

      {/* Category pills (pick mode) */}
      {mode !== 'manage' && (
        <div className="flex flex-wrap gap-1.5">
          {allCategories.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => onSelect(cat.value)}
              className={`text-xs px-2.5 py-1.5 rounded-full border transition-all ${
                category === cat.value
                  ? 'bg-accent-soft border-accent text-accent-text font-medium'
                  : 'bg-card border-line text-text-secondary hover:border-accent'
              }`}
            >
              {cat.emoji} {cat.label}
            </button>
          ))}
          {onAddCategory && mode !== 'create' && (
            <button
              type="button"
              onClick={handleStartCreate}
              className="text-xs px-2.5 py-1.5 rounded-full border border-dashed border-line text-text-muted hover:border-accent hover:text-accent-text transition-all"
            >
              +
            </button>
          )}
        </div>
      )}

      {/* Create mode */}
      {mode === 'create' && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowEmojiGrid(!showEmojiGrid)}
              className="w-10 h-10 border border-line rounded-lg flex items-center justify-center text-lg bg-card hover:bg-card-hover transition-colors shrink-0"
            >
              {newEmoji || '😀'}
            </button>
            <input
              ref={labelRef}
              type="text"
              className="flex-1 border border-line rounded-lg px-2.5 py-2 text-sm bg-card text-text focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Category name"
              maxLength={MAX_LABEL_LENGTH}
              value={newLabel}
              onChange={(e) => { setNewLabel(e.target.value); setError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave() } }}
            />
            <button type="button" onClick={handleSave} disabled={saving} className="text-sm font-medium text-accent-text hover:text-accent-hover px-2 py-1.5 disabled:opacity-50">
              {saving ? '...' : 'Add'}
            </button>
            <button type="button" onClick={handleCancel} className="text-sm text-text-muted hover:text-text-secondary px-1 py-1.5">
              ✕
            </button>
          </div>
          {showEmojiGrid && (
            <EmojiGrid selected={newEmoji} onPick={(e) => { setNewEmoji(e); setShowEmojiGrid(false); labelRef.current?.focus() }} />
          )}
          {!newEmoji && !showEmojiGrid && (
            <p className="text-xs text-text-muted">Tap the emoji to pick one, or leave blank for a random one</p>
          )}
          {error && <p className="text-xs text-danger-text">{error}</p>}
        </div>
      )}

      {/* Manage mode — edit/reorder custom categories */}
      {mode === 'manage' && customCategories && (
        <div className="space-y-1 mt-1">
          {customCategories.length === 0 && (
            <p className="text-sm text-text-muted py-2">No custom categories</p>
          )}
          {customCategories.map((cat, idx) => (
            <div key={cat.id} className="flex items-center gap-1.5 bg-card border border-line rounded-lg px-2 py-1.5">
              {editingId === cat.id ? (
                <>
                  <button
                    type="button"
                    onClick={() => setEditEmojiGrid(!editEmojiGrid)}
                    className="w-8 h-8 border border-line rounded flex items-center justify-center text-sm bg-card hover:bg-card-hover shrink-0"
                  >
                    {editEmoji || cat.emoji}
                  </button>
                  <input
                    type="text"
                    className="flex-1 border border-line rounded px-2 py-1 text-sm bg-card text-text focus:outline-none focus:ring-1 focus:ring-primary-500"
                    value={editLabel}
                    maxLength={MAX_LABEL_LENGTH}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleEditSave(cat.id) } }}
                  />
                  <button type="button" onClick={() => handleEditSave(cat.id)} disabled={saving} className="text-xs text-accent-text font-medium px-1">
                    {saving ? '...' : 'Save'}
                  </button>
                  <button type="button" onClick={() => { setEditingId(null); setEditEmojiGrid(false) }} className="text-xs text-text-muted px-1">✕</button>
                </>
              ) : (
                <>
                  <span className="text-sm">{cat.emoji} {cat.label}</span>
                  <div className="ml-auto flex items-center gap-0.5">
                    <button type="button" onClick={() => handleMove(idx, -1)} disabled={idx === 0}
                      className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-secondary disabled:opacity-20 rounded hover:bg-card-hover">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                    </button>
                    <button type="button" onClick={() => handleMove(idx, 1)} disabled={idx === customCategories.length - 1}
                      className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-secondary disabled:opacity-20 rounded hover:bg-card-hover">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    <button type="button" onClick={() => { setEditingId(cat.id); setEditEmoji(cat.emoji); setEditLabel(cat.label); setEditEmojiGrid(false) }}
                      className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-accent-text rounded hover:bg-card-hover">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    <button type="button" onClick={() => handleDelete(cat.id)}
                      className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-danger-text rounded hover:bg-danger-bg">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </>
              )}
              {editingId === cat.id && editEmojiGrid && (
                <div className="w-full">
                  <EmojiGrid selected={editEmoji} onPick={(e) => { setEditEmoji(e); setEditEmojiGrid(false) }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
