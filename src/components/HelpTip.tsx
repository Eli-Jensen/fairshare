import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'

interface Pos {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

/**
 * A small tappable "?" that opens a short explanatory popover. Tap to open;
 * outside-click, Esc, or scroll closes it. Built as a tap target (not a native
 * `title=` tooltip) because those never appear on touch devices — exactly where
 * new users need the help. The popover is fixed-positioned and clamped to the
 * viewport on both axes (and flips above the button when there's more room
 * there) so it never runs off the edge of a phone screen.
 */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Pos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const margin = 8
    const rect = btnRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(288, vw - margin * 2)
    // Horizontal: anchor under the button, pull in so it stays on-screen
    let left = rect.left
    if (left + width > vw - margin) left = vw - margin - width
    if (left < margin) left = margin
    // Vertical: use whichever side has more room; cap height to that space
    const spaceBelow = vh - rect.bottom - margin
    const spaceAbove = rect.top - margin
    if (spaceBelow >= spaceAbove) {
      setPos({ left, width, top: rect.bottom + 6, maxHeight: spaceBelow - 6 })
    } else {
      setPos({ left, width, bottom: vh - rect.top + 6, maxHeight: spaceAbove - 6 })
    }
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
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
            ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }),
          }}
          className="z-50 overflow-y-auto bg-card border border-line rounded-lg shadow-lg p-3 text-xs font-normal normal-case text-left text-text-secondary leading-relaxed space-y-1.5"
        >
          {children}
        </div>
      )}
    </span>
  )
}
