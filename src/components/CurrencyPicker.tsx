import { useState, useRef, useEffect } from 'react'
import { COMMON_CURRENCIES, ALL_CURRENCIES, getCurrency, type Currency } from '../lib/currencies'

export function CurrencyPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = getCurrency(value)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const query = search.toLowerCase().trim()
  const filtered = query
    ? ALL_CURRENCIES.filter(
        (c) =>
          c.code.toLowerCase().includes(query) ||
          c.name.toLowerCase().includes(query)
      )
    : null

  function handleSelect(c: Currency) {
    onChange(c.code)
    setSearch('')
    setOpen(false)
  }

  function handleInputFocus() {
    setOpen(true)
    setSearch('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  const displayList = filtered ?? []
  const showCommon = !query

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        placeholder="Search currencies..."
        value={open ? search : selected ? `${selected.code} - ${selected.name}` : value}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={handleInputFocus}
        onKeyDown={handleKeyDown}
      />

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-card border border-line rounded-lg shadow-lg max-h-64 overflow-y-auto">
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

          {!showCommon && displayList.length > 0 &&
            displayList.map((c) => (
              <CurrencyOption
                key={c.code}
                currency={c}
                isSelected={c.code === value}
                onSelect={handleSelect}
              />
            ))}

          {!showCommon && displayList.length === 0 && (
            <div className="px-3 py-3 text-sm text-text-muted text-center">
              No currencies match "{search}"
            </div>
          )}
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
      className={`w-full text-left px-3 py-2 text-sm hover:bg-primary-50 flex items-center justify-between ${
        isSelected ? 'bg-primary-50 text-primary-700' : 'text-slate-700'
      }`}
    >
      <span>
        <span className="font-medium">{currency.code}</span>
        <span className="text-text-muted ml-2">{currency.name}</span>
      </span>
      <span className="text-text-muted text-xs">{currency.symbol}</span>
    </button>
  )
}
