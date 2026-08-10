import { notifyError } from '../lib/errorToast'
import { useEffect, useState } from 'react'
import { searchGifs, trendingGifs, type GifResult } from '../lib/gif'

/**
 * KLIPY-backed GIF search (lazy-loaded — only people who tap 🎬 pay for it).
 * Trending fills the grid until a query lands; searches debounce 300ms.
 */
export default function GifPicker({
  onPick,
  onClose,
}: {
  onPick: (gif: GifResult) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  // Keyed by query so stale results render dimmed instead of setState-in-effect.
  const [result, setResult] = useState<{
    q: string
    gifs: GifResult[] | null
    error: boolean
  }>({ q: '', gifs: null, error: false })

  useEffect(() => {
    let live = true
    const term = q.trim()
    const t = setTimeout(
      () => {
        ;(term ? searchGifs(term) : trendingGifs())
          .then((gifs) => {
            if (live) setResult({ q, gifs, error: false })
          })
          .catch((err) => {
            console.error('GIF fetch failed:', err)
            notifyError()
            if (live) setResult({ q, gifs: [], error: true })
          })
      },
      term ? 300 : 0
    )
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q])

  const stale = result.q !== q
  const gifs = result.gifs ?? []

  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search GIFs…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-input px-3 py-1.5 text-sm text-text outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close GIF picker"
          className="rounded-lg px-2 py-1.5 text-sm text-text-muted hover:bg-card-hover hover:text-text transition-colors"
        >
          ✕
        </button>
      </div>

      {result.error ? (
        <p className="py-6 text-center text-sm text-text-muted">
          GIF search is down. Blame the internet.
        </p>
      ) : result.gifs === null ? (
        <p className="py-6 text-center text-sm text-text-muted">Loading GIFs…</p>
      ) : gifs.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">No GIFs for that.</p>
      ) : (
        <div
          className={`grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto ${stale ? 'opacity-60' : ''}`}
        >
          {gifs.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onPick(g)}
              className="overflow-hidden rounded-lg bg-muted ring-1 ring-line hover:ring-accent transition-shadow"
            >
              <img
                src={g.previewUrl}
                alt=""
                loading="lazy"
                className="h-20 w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 text-right text-[10px] uppercase tracking-wide text-text-muted">
        Powered by KLIPY
      </p>
    </div>
  )
}
