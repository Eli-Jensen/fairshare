/**
 * The app's spinner. Inherits `currentColor`, so it takes the color of
 * whatever it sits in — on an accent button, in muted body text, anywhere.
 *
 * `aria-hidden` because a spinner on its own says nothing useful to a screen
 * reader; give the surrounding element the live region or the label instead
 * (see the join states in JoinTrip.tsx).
 */
export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
