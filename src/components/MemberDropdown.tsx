import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import type { UserProfile } from '../lib/types'
import { getMemberName } from '../lib/types'

interface Pos {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

/**
 * Custom member picker that replaces a native <select>. Native <select> popups
 * mis-render (jump to the top-left corner) when the page isn't at 100% zoom in
 * Chrome — this one is a plain element, fixed-positioned and clamped to the
 * viewport (flips above when low on screen), so it looks right on web, phone,
 * and any zoom. Matches the CurrencyPicker / HelpTip positioning.
 */
export function MemberDropdown({
  value,
  options,
  members,
  onChange,
}: {
  value: string
  options: string[]
  members: Record<string, UserProfile>
  onChange: (uid: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  function reposition() {
    if (!btnRef.current) return
    const margin = 8
    const r = btnRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = r.width
    let left = r.left
    if (left + width > vw - margin) left = vw - margin - width
    if (left < margin) left = margin
    const below = vh - r.bottom - margin
    const above = r.top - margin
    if (below >= above) setPos({ top: r.bottom + 4, left, width, maxHeight: below - 4 })
    else setPos({ bottom: vh - r.top + 4, left, width, maxHeight: above - 4 })
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
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-left border border-line rounded-lg px-3 py-2 text-sm bg-card text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
      >
        <span className="truncate">{getMemberName(value, members)}</span>
        <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && pos && (
        <div
          ref={popRef}
          role="listbox"
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }),
          }}
          className="z-50 overflow-y-auto bg-card border border-line rounded-lg shadow-lg py-1"
        >
          {options.map((uid) => (
            <button
              key={uid}
              type="button"
              role="option"
              aria-selected={uid === value}
              onClick={() => { onChange(uid); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-sm truncate transition-colors hover:bg-accent-soft ${
                uid === value ? 'bg-accent-soft text-accent-text font-medium' : 'text-text-secondary'
              }`}
            >
              {getMemberName(uid, members)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
