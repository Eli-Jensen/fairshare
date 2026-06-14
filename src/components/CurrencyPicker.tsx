import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { COMMON_CURRENCIES, ALL_CURRENCIES, getCurrency, type Currency } from '../lib/currencies'

/**
 * Compact currency selector: a "USD ▾" button (sits inline next to an amount)
 * that opens a searchable list. The dropdown is fixed-positioned and clamped to
 * the viewport so the full code + name are readable and it never clips off a
 * phone screen, at any text size.
 */
export function CurrencyPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const selected = getCurrency(value)

  function reposition() {
    if (!btnRef.current) return
    const margin = 8
    const rect = btnRef.current.getBoundingClientRect()
    const width = Math.min(320, window.innerWidth - margin * 2)
    let left = rect.left
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width
    if (left < margin) left = margin
    setPos({ top: rect.bottom + 4, left, width })
  }

  useLayoutEffect(() => {
    if (open) reposition()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onReflow() {
      reposition()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    const focusId = setTimeout(() => searchRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
      clearTimeout(focusId)
    }
  }, [open])

  const query = search.toLowerCase().trim()
  const filtered = query
    ? ALL_CURRENCIES.filter(
        (c) =>
          c.code.toLowerCase().includes(query) ||
          c.name.toLowerCase().includes(query)
      )
    : null
  const showCommon = !query

  function handleSelect(c: Currency) {
    onChange(c.code)
    setSearch('')
    setOpen(false)
  }

  return (
    <div className="inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={() => { setSearch(''); setOpen((o) => !o) }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 border border-line rounded-lg pl-3 pr-2 py-2 text-sm bg-card text-text hover:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
      >
        <span className="font-medium">{selected?.code ?? value}</span>
        <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && pos && (
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
          className="z-50 bg-card border border-line rounded-lg shadow-lg"
        >
          <div className="p-2 border-b border-line">
            <input
              ref={searchRef}
              type="text"
              className="w-full border border-line rounded-md px-2.5 py-1.5 text-sm bg-input text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Search currencies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {showCommon && (
              <>
                <div className="px-3 py-1.5 text-xs font-medium text-text-muted uppercase tracking-wide bg-muted sticky top-0">
                  Common
                </div>
                {COMMON_CURRENCIES.map((c) => (
                  <CurrencyOption
                    key={c.code}
                    currency={c}
                    isSelected={c.code === value}
                    onSelect={handleSelect}
                  />
                ))}
                <div className="px-3 py-1.5 text-xs font-medium text-text-muted uppercase tracking-wide bg-muted sticky top-0">
                  All currencies
                </div>
                {ALL_CURRENCIES.filter(
                  (c) => !COMMON_CURRENCIES.some((cc) => cc.code === c.code)
                ).map((c) => (
                  <CurrencyOption
                    key={c.code}
                    currency={c}
                    isSelected={c.code === value}
                    onSelect={handleSelect}
                  />
                ))}
              </>
            )}

            {!showCommon && filtered && filtered.length > 0 &&
              filtered.map((c) => (
                <CurrencyOption
                  key={c.code}
                  currency={c}
                  isSelected={c.code === value}
                  onSelect={handleSelect}
                />
              ))}

            {!showCommon && filtered && filtered.length === 0 && (
              <div className="px-3 py-3 text-sm text-text-muted text-center">
                No currencies match "{search}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CurrencyOption({
  currency,
  isSelected,
  onSelect,
}: {
  currency: Currency
  isSelected: boolean
  onSelect: (c: Currency) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(currency)}
      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-soft flex items-center justify-between gap-3 ${
        isSelected ? 'bg-accent-soft text-primary-700' : 'text-text-secondary'
      }`}
    >
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="font-medium shrink-0">{currency.code}</span>
        <span className="text-text-muted truncate">{currency.name}</span>
      </span>
      <span className="text-text-muted text-xs shrink-0">{currency.symbol}</span>
    </button>
  )
}
