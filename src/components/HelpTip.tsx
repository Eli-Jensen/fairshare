import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'

/**
 * A small tappable "?" that opens a short explanatory popover. Tap to open;
 * outside-click, Esc, or scroll closes it. Built as a tap target (not a native
 * `title=` tooltip) because those never appear on touch devices — exactly where
 * new users need the help. The popover is fixed-positioned and clamped to the
 * viewport so it never runs off the edge of a phone screen.
 */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const margin = 8
    const rect = btnRef.current.getBoundingClientRect()
    const width = Math.min(288, window.innerWidth - margin * 2)
    // Anchor under the button, then pull left so the right edge stays on-screen
    let left = rect.left
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width
    if (left < margin) left = margin
    setPos({ top: rect.bottom + 6, left, width })
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
    function onScroll() {
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <span className="inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Help: ${label}`}
        aria-expanded={open}
        className="w-4 h-4 inline-flex items-center justify-center rounded-full border border-line text-text-muted hover:text-text-secondary hover:border-text-muted text-[10px] font-bold leading-none transition-colors"
      >
        ?
      </button>
      {open && pos && (
        <div
          ref={popRef}
          role="tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
          className="z-50 bg-card border border-line rounded-lg shadow-lg p-3 text-xs font-normal normal-case text-left text-text-secondary leading-relaxed space-y-1.5"
        >
          {children}
        </div>
      )}
    </span>
  )
}
