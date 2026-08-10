import { useEffect, type ReactNode } from 'react'

/**
 * Full-screen image viewer — tap anywhere or Escape to close. (Ported from
 * good-boy-points; fairshare has no scrim token, so bg-black/80 — photos
 * want the same dark surround in both themes anyway.)
 */
export function Lightbox({
  src,
  alt = '',
  caption,
  onClose,
}: {
  src: string
  alt?: string
  /** Optional bar under the image (Photos tab shows expense + amount). */
  caption?: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // Freeze the page behind the viewer.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Photo'}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/80 p-4"
    >
      {/* The scrim is a REAL button (keyboardable); the image passes taps
          through to it, so "tap anywhere closes" works — Enter/Space too. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default"
      />
      <img
        src={src}
        alt={alt}
        className="pointer-events-none relative max-h-full max-w-full rounded-lg object-contain"
      />
      {caption && (
        <div className="pointer-events-none relative mt-3 max-w-full rounded-lg bg-black/60 px-3 py-1.5 text-center text-sm text-white">
          {caption}
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-xl text-white"
      >
        ✕
      </button>
    </div>
  )
}
