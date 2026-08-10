import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { Timestamp } from 'firebase/firestore'
import type { Expense, UserProfile, ExpenseCategory, CustomCategory } from '../lib/types'
import { getMemberName, formatMoney, getAllCategories, categoryExists, getExpenseCategories, AMOUNT_TOLERANCE, DEFAULT_CURRENCY } from '../lib/types'
import { CurrencyPicker } from './CurrencyPicker'
import { HelpTip } from './HelpTip'
import { MemberDropdown } from './MemberDropdown'
import { ExchangeRateField } from './ExchangeRateField'
import { getCurrency } from '../lib/currencies'
import { fetchRates, getCrossRate } from '../lib/rates'
import { splitEqually, splitByPercentages, splitByShares, derivePercentages, deriveShares } from '../lib/splits'
import { todayString, parseDateString, timestampToDateString } from '../lib/dates'

import type { Theme as EmojiTheme } from 'emoji-picker-react'
const EmojiPicker = lazy(() => import('emoji-picker-react'))

interface ExpenseFormData {
  description: string
  amount: number
  currency: string
  exchangeRate: number
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
  categories: string[]
}


export function ExpenseForm({
  members,
  memberUids,
  currentUserUid,
  tripRates,
  tripLastCurrency,
  settlementCurrency: sc = DEFAULT_CURRENCY,
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
    categories?: ExpenseCategory[]
    // void return = the caller fired the write and navigated without
    // awaiting the server ack (the offline-friendly pattern).
  }) => Promise<void> | void
  onDelete?: () => Promise<void> | void
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
      const paidByAmounts: Record<string, string> = {}
      const rate = existing.exchangeRate || 1
      for (const uid of memberUids) {
        // Convert splits from settlement currency back to original for display
        const splitVal = existing.splits[uid] ?? 0
        exactAmounts[uid] = (rate !== 1 ? Math.round((splitVal / rate) * 100) / 100 : splitVal).toString()
        paidByAmounts[uid] = ''
      }

      // Recover percentage/share inputs from the stored splits so an
      // unrelated edit doesn't silently re-split the expense
      const percentages: Record<string, string> = {
        ...Object.fromEntries(memberUids.map((uid) => [uid, ''])),
        ...derivePercentages(existing.splits, existing.amountSettled),
      }
      const shares: Record<string, string> = {
        ...Object.fromEntries(memberUids.map((uid) => [uid, '1'])),
        ...deriveShares(existing.splits),
      }

      const hasMultiPayer = existing.paidByAmounts && Object.keys(existing.paidByAmounts).length > 0
      if (hasMultiPayer) {
        const rate = existing.exchangeRate || 1
        for (const [uid, amt] of Object.entries(existing.paidByAmounts!)) {
          // Convert from settlement currency back to original currency for display
          const inOriginal = rate !== 1 ? Math.round((amt / rate) * 100) / 100 : amt
          paidByAmounts[uid] = inOriginal.toString()
        }
      }

      return {
        description: existing.description,
        amount: existing.amount,
        currency: existing.currency,
        exchangeRate: existing.exchangeRate,
        paidBy: existing.paidBy,
        multiPayer: !!hasMultiPayer,
        paidByAmounts,
        splitType: existing.splitType,
        splitAmong: Object.keys(existing.splits),
        exactAmounts,
        percentages,
        shares,
        date: timestampToDateString(existing.date),
        notes: existing.notes ?? '',
        categories: getExpenseCategories(existing),
      }
    }

    return {
      description: '',
      amount: 0,
      currency: tripLastCurrency || sc,
      exchangeRate: 1,
      paidBy: currentUserUid,
      multiPayer: false,
      paidByAmounts: initPaidBy,
      splitType: 'equal',
      splitAmong: [...memberUids],
      exactAmounts: { ...initAmounts },
      percentages: { ...initAmounts },
      shares: Object.fromEntries(memberUids.map((uid) => [uid, '1'])),
      date: todayString(),
      notes: '',
      categories: [],
    }
  })

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [liveRates, setLiveRates] = useState<Record<string, number>>({})
  const [rateSource, setRateSource] = useState<'live' | 'trip' | 'custom' | ''>('')
  const initializedCurrency = useRef(existing?.currency ?? DEFAULT_CURRENCY)
  /**
   * Has the user taken control of the rate?
   *
   * A REF, not state, and that's load-bearing. The auto-fill effect below
   * re-runs whenever `liveRates` resolves (an async fetch — a real network
   * call to the rates API whenever the 6h cache is cold) or `tripRates`
   * changes identity (it's `trip.lastRates`, a fresh object on every trip-doc
   * snapshot, and useTrip writes cached* fields to that doc). Both land after
   * mount, on their own schedule.
   *
   * Guarding that with state loses a race: state isn't true until React
   * commits, so a fetch resolving between the user's keystroke and that
   * commit would silently overwrite the rate they just entered — which is
   * exactly what happened, and it cost a real expense the wrong amount. A ref
   * mutates synchronously, so there is no window.
   */
  const rateTouched = useRef(Boolean(existing))

  useEffect(() => {
    fetchRates().then(setLiveRates)
  }, [])

  useEffect(() => {
    if (form.currency === sc) {
      setForm((f) => ({ ...f, exchangeRate: 1 }))
      setRateSource('')
      rateTouched.current = false
      return
    }
    if (existing && form.currency === initializedCurrency.current) return
    if (rateTouched.current) return
    autoFillRate(form.currency)
  }, [form.currency, liveRates, tripRates])

  function autoFillRate(currency: string) {
    // Trip rates are already relative to the settlement currency; live API
    // rates are USD-based and need the cross-rate through USD
    if (tripRates?.[currency]) {
      setForm((f) => ({ ...f, exchangeRate: tripRates[currency] }))
      setRateSource('trip')
      return
    }
    const live = getCrossRate(liveRates, currency, sc)
    if (live) {
      setForm((f) => ({ ...f, exchangeRate: Math.round(live * 10000) / 10000 }))
      setRateSource('live')
      return
    }
  }

  function handleCurrencyChange(currency: string) {
    initializedCurrency.current = ''
    // A new currency means the old rate is meaningless — auto-fill again.
    rateTouched.current = false
    setForm((f) => ({ ...f, currency }))
  }

  function handleRateChange(value: string) {
    rateTouched.current = true
    setForm((f) => ({ ...f, exchangeRate: parseFloat(value) || 0 }))
    setRateSource('custom')
  }

  // resetToAutoRate kept for reference — inline version used in JSX

  const amountSettled = form.amount * form.exchangeRate

  function computeSplits(): Record<string, number> {
    if (form.splitType === 'equal') {
      return splitEqually(amountSettled, form.splitAmong)
    }
    if (form.splitType === 'exact') {
      const splits: Record<string, number> = {}
      for (const uid of form.splitAmong) {
        const val = parseFloat(form.exactAmounts[uid] || '0') || 0
        // Convert from original currency to settlement currency
        splits[uid] = Math.round(val * form.exchangeRate * 100) / 100
      }
      return splits
    }
    if (form.splitType === 'percentage') {
      return splitByPercentages(
        amountSettled,
        Object.fromEntries(
          form.splitAmong.map((uid) => [uid, parseFloat(form.percentages[uid] || '0') || 0])
        )
      )
    }
    return splitByShares(
      amountSettled,
      Object.fromEntries(
        form.splitAmong.map((uid) => [uid, parseFloat(form.shares[uid] || '0') || 0])
      )
    )
  }

  function computePaidByAmounts(): Record<string, number> | undefined {
    if (!form.multiPayer) return undefined
    const amounts: Record<string, number> = {}
    for (const uid of memberUids) {
      const val = parseFloat(form.paidByAmounts[uid] || '0') || 0
      // Convert from original currency to settlement currency
      if (val > 0) amounts[uid] = Math.round(val * form.exchangeRate * 100) / 100
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

    // Validate multi-payer amounts (in original currency, before conversion)
    if (form.multiPayer) {
      const rawPaidTotal = memberUids.reduce(
        (sum, uid) => sum + (parseFloat(form.paidByAmounts[uid] || '0') || 0), 0
      )
      if (rawPaidTotal <= 0) {
        setError('Enter how much each person paid')
        return
      }
      if (Math.abs(rawPaidTotal - form.amount) > AMOUNT_TOLERANCE) {
        setError(
          `Paid amounts total (${rawPaidTotal.toFixed(2)}) doesn't match expense (${form.amount.toFixed(2)})`
        )
        return
      }
    }

    const splits = computeSplits()
    if (form.splitType === 'exact') {
      // Validate in original currency (before conversion)
      const rawSplitTotal = form.splitAmong.reduce(
        (sum, uid) => sum + (parseFloat(form.exactAmounts[uid] || '0') || 0), 0
      )
      if (Math.abs(rawSplitTotal - form.amount) > AMOUNT_TOLERANCE) {
        setError(
          `Split total (${rawSplitTotal.toFixed(2)}) doesn't match expense (${form.amount.toFixed(2)})`
        )
        return
      }
    } else if (form.splitType !== 'equal') {
      const splitTotal = Object.values(splits).reduce((a, b) => a + b, 0)
      if (Math.abs(splitTotal - amountSettled) > AMOUNT_TOLERANCE) {
        setError(
          `Split total (${splitTotal.toFixed(2)}) doesn't match expense (${amountSettled.toFixed(2)})`
        )
        return
      }
    }

    setSubmitting(true)
    try {
      const paidByAmounts = computePaidByAmounts()
      const submitData: Parameters<typeof onSubmit>[0] = {
        description: form.description.trim(),
        amount: form.amount,
        currency: form.currency,
        exchangeRate: form.exchangeRate,
        amountUSD: amountSettled,
        paidBy: form.multiPayer
          ? Object.entries(paidByAmounts ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? currentUserUid
          : form.paidBy,
        splitType: form.splitType,
        splits,
        date: Timestamp.fromDate(parseDateString(form.date)),
      }
      // Only include optional fields when set (Firestore rejects undefined)
      if (paidByAmounts) submitData.paidByAmounts = paidByAmounts
      if (form.notes.trim()) submitData.notes = form.notes.trim()
      if (form.categories.length > 0) submitData.categories = form.categories
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
    // Cap at 3 so the full picker always stays available
    return Array.from(codes).slice(0, 3)
  })()

  // Compute paid total for multi-payer display (in original currency)
  const paidTotal = form.multiPayer
    ? memberUids.reduce((sum, uid) => sum + (parseFloat(form.paidByAmounts[uid] || '0') || 0), 0)
    : 0
  const paidRemaining = form.multiPayer ? form.amount - paidTotal : 0
  const currencySymbol = getCurrency(form.currency)?.symbol ?? form.currency
  const equalPreview = form.splitType === 'equal'
    ? splitEqually(amountSettled, form.splitAmong)
    : null
  // Live feedback for the split-among section (mirrors the multi-payer total)
  const exactRemaining = form.amount -
    form.splitAmong.reduce((s, uid) => s + (parseFloat(form.exactAmounts[uid] || '0') || 0), 0)
  const pctRemaining = 100 -
    form.splitAmong.reduce((s, uid) => s + (parseFloat(form.percentages[uid] || '0') || 0), 0)
  const sharesPreview = form.splitType === 'shares'
    ? splitByShares(
        amountSettled,
        Object.fromEntries(form.splitAmong.map((uid) => [uid, parseFloat(form.shares[uid] || '0') || 0])),
      )
    : null

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={label} htmlFor="ef-description">Description</label>
        <input
          id="ef-description"
          type="text"
          className={input}
          placeholder="Dinner, taxi, drinks..."
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div>
        <label className={label} htmlFor="ef-amount">
          Amount <span className="font-normal text-text-muted">· “total spent”</span>
        </label>
        {/* Amount number with the currency selector right beside it */}
        <div className="flex items-center gap-2">
          <input
            id="ef-amount"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            className="w-28 border border-line rounded-lg px-3 py-2 text-sm bg-card text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            value={form.amount || ''}
            placeholder="0.00"
            onChange={(e) =>
              setForm((f) => ({ ...f, amount: parseFloat(e.target.value) || 0 }))
            }
          />
          <CurrencyPicker
            value={form.currency}
            onChange={handleCurrencyChange}
          />
        </div>
        {/* Quick switch — only when the trip actually uses more than one currency */}
        {quickCurrencies.length > 1 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {quickCurrencies.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => handleCurrencyChange(code)}
                className={`text-xs px-3 py-1 rounded-lg border transition-all font-medium ${
                  form.currency === code
                    ? 'bg-accent-soft border-accent text-accent-text'
                    : 'bg-card border-line text-text-secondary hover:border-accent'
                }`}
              >
                {code}
              </button>
            ))}
          </div>
        )}
        {form.currency !== sc && form.amount > 0 && form.exchangeRate > 0 && (
          <p className="text-xs text-accent-text mt-1 font-medium">
            = {formatMoney(amountSettled, sc)}
          </p>
        )}
      </div>

      {form.currency !== sc && (
        <ExchangeRateField
          currency={form.currency}
          settlementCurrency={sc}
          rate={form.exchangeRate}
          onRateChange={(rate) => handleRateChange(String(rate))}
          source={rateSource}
          amount={form.amount}
          onResetToAuto={() => {
            // Handing control back: let the auto-fill effect win again.
            rateTouched.current = false
            // Force fetch from live API, bypassing trip saved rate
            const live = getCrossRate(liveRates, form.currency, sc)
            if (live) {
              setForm((f) => ({ ...f, exchangeRate: Math.round(live * 10000) / 10000 }))
              setRateSource('live')
            } else {
              autoFillRate(form.currency)
            }
          }}
        />
      )}

      <div className="border-t border-line-light" />

      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-sm font-medium text-text-secondary">How to split</span>
          <HelpTip label="How to split">
            <p>Each person's amount in this section is <strong className="text-text">the share of the bill they received — and are therefore responsible for</strong>.</p>
            <p><strong className="text-text">Don't think about who actually paid yet</strong> when entering these — that's the “Paid by” section below.</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li><strong className="text-text">Equal</strong> — same for everyone.</li>
              <li><strong className="text-text">Exact</strong> — type each person's amount; must add up to the total. Good when one person had only an appetizer ($) and another a full meal with drinks ($$$).</li>
              <li><strong className="text-text">%</strong> — split by percentage.</li>
              <li><strong className="text-text">Shares</strong> — by weight, e.g. 2 vs 1.</li>
            </ul>
          </HelpTip>
        </div>
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
        <span className={label}>
          Split among <span className="font-normal text-text-muted">· “what each person owes”</span>
        </span>
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
                  <span className="text-sm text-text-muted">{currencySymbol}</span>
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
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    className="w-16 border border-line rounded px-2 py-1 text-sm bg-card text-text"
                    value={form.shares[uid] ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        shares: { ...f.shares, [uid]: e.target.value },
                      }))
                    }
                  />
                  <span className="text-sm text-text-muted whitespace-nowrap">
                    = {formatMoney(sharesPreview?.[uid] ?? 0, sc)}
                  </span>
                </div>
              )}

              {form.splitType === 'equal' && form.splitAmong.includes(uid) && (
                <span className="text-sm text-text-muted">
                  {formatMoney(equalPreview?.[uid] ?? 0, sc)}
                </span>
              )}
            </div>
          ))}
          {form.splitType === 'exact' && form.splitAmong.length > 0 && form.amount > 0 && (
            <p className={`text-xs ${Math.abs(exactRemaining) < AMOUNT_TOLERANCE ? 'text-success-text' : 'text-warn-text'}`}>
              {Math.abs(exactRemaining) < AMOUNT_TOLERANCE
                ? 'Amounts add up to the total'
                : exactRemaining > 0
                  ? `${currencySymbol}${exactRemaining.toFixed(2)} left to assign`
                  : `${currencySymbol}${Math.abs(exactRemaining).toFixed(2)} over the total`}
            </p>
          )}
          {form.splitType === 'percentage' && form.splitAmong.length > 0 && (
            <p className={`text-xs ${Math.abs(pctRemaining) < 0.05 ? 'text-success-text' : 'text-warn-text'}`}>
              {Math.abs(pctRemaining) < 0.05
                ? 'Adds up to 100%'
                : pctRemaining > 0
                  ? `${+pctRemaining.toFixed(1)}% left to assign`
                  : `${+Math.abs(pctRemaining).toFixed(1)}% over 100%`}
            </p>
          )}
        </div>
      </div>

      {/* Paid by section */}
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-sm font-medium text-text-secondary">
            Paid by
          </span>
          <HelpTip label="Paid by">
            <p><strong className="text-text">Who actually paid</strong> the bill — usually you. They get paid back by everyone else.</p>
            <p>Two people split the check? Tap <strong className="text-text">+ Multiple payers</strong> to enter how much each paid.</p>
          </HelpTip>
        </div>

        {form.multiPayer ? (
          <div className="space-y-2">
            {memberUids.map((uid) => (
              <div key={uid} className="flex items-center gap-3">
                <span className="text-sm flex-1 text-text-secondary">
                  {getMemberName(uid, members)}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-text-muted">{currencySymbol}</span>
                  <input
                    type="number"
                    inputMode="decimal"
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
            {form.amount > 0 && (
              <p className={`text-xs ${Math.abs(paidRemaining) < AMOUNT_TOLERANCE ? 'text-success-text' : 'text-warn-text'}`}>
                {Math.abs(paidRemaining) < AMOUNT_TOLERANCE
                  ? 'Paid amounts match total'
                  : paidRemaining > 0
                    ? `${currencySymbol}${paidRemaining.toFixed(2)} remaining to assign`
                    : `${currencySymbol}${Math.abs(paidRemaining).toFixed(2)} over the total`}
              </p>
            )}
            <button
              type="button"
              onClick={toggleMultiPayer}
              className="text-xs text-accent-text hover:text-accent-hover"
            >
              Use a single payer
            </button>
          </div>
        ) : (
          <>
          <MemberDropdown
            value={form.paidBy}
            options={memberUids}
            members={members}
            onChange={(uid) => setForm((f) => ({ ...f, paidBy: uid }))}
          />
          <button
            type="button"
            onClick={toggleMultiPayer}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:text-accent-hover"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Multiple payers
          </button>
          </>
        )}
      </div>

      <div className="border-t border-line-light" />

      <div>
        <label className={label} htmlFor="ef-date">Date</label>
        <input
          id="ef-date"
          type="date"
          className={input}
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          onClick={(e) => { try { e.currentTarget.showPicker?.() } catch { /* picker already open */ } }}
        />
      </div>

      <CategoryPicker
        categories={form.categories}
        customCategories={customCategories}
        onToggle={(value) => setForm((f) => ({
          ...f,
          categories: f.categories.includes(value)
            ? f.categories.filter((v) => v !== value)
            : [...f.categories, value],
        }))}
        onAddCategory={onAddCategory}
        onUpdateCategories={onUpdateCategories}
      />

      <div>
        <label className={label} htmlFor="ef-notes">Notes <span className="font-normal text-text-muted">(optional)</span></label>
        <textarea
          id="ef-notes"
          className={input}
          rows={2}
          placeholder="Add a note..."
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </div>

      {error && (
        <p className="text-sm text-danger-text bg-danger-bg rounded-lg px-3 py-2">
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
            className="px-4 py-2.5 text-sm text-danger-text hover:bg-danger-bg rounded-lg transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  )
}

const MAX_LABEL_LENGTH = 20

const RANDOM_EMOJIS = ['🏷️','📌','🔖','🎲','💫','⭐','🌟','✨']
// Module-level so the impure Math.random() call is clearly outside render —
// it runs in click handlers only (react-hooks/purity).
const randomEmoji = () => RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)]

// Module-level so re-renders of the picker don't remount it (losing
// search text and re-triggering the lazy emoji load)
function EmojiGrid({ onPick }: { selected: string; onPick: (e: string) => void }) {
  const isDark = document.documentElement.classList.contains('dark')
  return (
    <div className="mt-1 rounded-lg overflow-hidden [&_.epr-main]:!border-line [&_.epr-search-container_input]:!bg-input [&_.epr-search-container_input]:!border-line">
      <Suspense fallback={<div className="h-[350px] flex items-center justify-center text-text-muted text-sm">Loading...</div>}>
        <EmojiPicker
          onEmojiClick={(emojiData) => onPick(emojiData.emoji)}
          width="100%"
          height={350}
          theme={(isDark ? 'dark' : 'light') as EmojiTheme}
          searchPlaceholder="Search emojis..."
          previewConfig={{ showPreview: false }}
          skinTonesDisabled
          lazyLoadEmojis
        />
      </Suspense>
    </div>
  )
}

function CategoryPicker({
  categories,
  customCategories,
  onToggle,
  onAddCategory,
  onUpdateCategories,
}: {
  categories: string[]
  customCategories?: CustomCategory[]
  onToggle: (value: string) => void
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
    const emoji = newEmoji.trim() || randomEmoji()

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
      onToggle(id)
      handleCancel()
    } catch {
      setError('Failed to save')
    }
    setSaving(false)
  }

  async function handleEditSave(oldId: string) {
    if (!customCategories || !onUpdateCategories) return
    const label = editLabel.trim()
    const emoji = editEmoji.trim() || randomEmoji()
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

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-text-secondary">
          Tags <span className="font-normal text-text-muted">(optional)</span>
        </span>
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
              onClick={() => onToggle(cat.value)}
              className={`text-xs px-2.5 py-1.5 rounded-full border transition-all ${
                categories.includes(cat.value)
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
