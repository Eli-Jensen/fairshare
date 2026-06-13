import { useState, useRef, useEffect, type ReactNode } from 'react'

/**
 * A small tappable "?" that opens a short explanatory popover. Tap to open;
 * outside-click or Esc closes it. Built as a tap target (not a native `title=`
 * tooltip) because those never appear on touch devices — which is exactly where
 * new users need the help. Anchored left and capped to the viewport so it never
 * overflows on a phone.
 */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Help: ${label}`}
        aria-expanded={open}
        className="w-4 h-4 inline-flex items-center justify-center rounded-full border border-line text-text-muted hover:text-text-secondary hover:border-text-muted text-[10px] font-bold leading-none transition-colors"
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-0 top-full mt-1.5 z-30 w-64 max-w-[calc(100vw-2rem)] bg-card border border-line rounded-lg shadow-lg p-3 text-xs font-normal normal-case text-left text-text-secondary leading-relaxed space-y-1.5"
        >
          {children}
        </div>
      )}
    </div>
  )
}
