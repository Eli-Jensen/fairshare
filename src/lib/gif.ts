/**
 * GIF search via KLIPY (the post-Tenor-shutdown replacement; free tier).
 * The API key is a public, rate-limited content key — one key serves dev
 * and prod (it isn't project-bound), injected via the VITE_KLIPY_API_KEY
 * GitHub secret in CI and pasted into the gitignored local env files. No
 * key → the GIF UI simply doesn't render. (Client shared with
 * good-boy-points, including parseKlipyResponse's captured-live-shape test.)
 */

export interface GifResult {
  id: string
  previewUrl: string // small rendition for the picker grid
  url: string // md rendition stored on the comment
  width: number
  height: number
}

const API_BASE = 'https://api.klipy.com/api/v1'
const RATING = 'pg-13' // adults, meme tone — but keep it off the deep end

function apiKey(): string {
  return (import.meta.env.VITE_KLIPY_API_KEY as string | undefined) ?? ''
}

export function gifConfigured(): boolean {
  return apiKey().length > 0
}

interface SizeEntry {
  url?: string
  width?: number
  height?: number
  gif?: { url?: string; width?: number; height?: number }
}

function pick(e: SizeEntry | undefined): { url: string; width: number; height: number } | null {
  if (!e) return null
  const url = e.url ?? e.gif?.url
  if (!url) return null
  return {
    url,
    width: e.width ?? e.gif?.width ?? 0,
    height: e.height ?? e.gif?.height ?? 0,
  }
}

/** Normalize a KLIPY list response into GifResults. Pure — unit-tested.
 *  Tolerates missing renditions and skips unusable items. */
export function parseKlipyResponse(json: unknown): GifResult[] {
  const items = (json as { data?: { data?: unknown[] } })?.data?.data
  if (!Array.isArray(items)) return []
  const out: GifResult[] = []
  for (const [i, raw] of items.entries()) {
    const item = raw as {
      id?: string | number
      slug?: string
      file?: Record<string, SizeEntry>
      files?: Record<string, SizeEntry>
    }
    const files = item.files ?? item.file ?? {}
    const main = pick(files.md) ?? pick(files.hd) ?? pick(files.sm) ?? pick(files.xs)
    if (!main) continue
    const preview = pick(files.sm) ?? pick(files.xs) ?? main
    out.push({
      id: String(item.id ?? item.slug ?? i),
      previewUrl: preview.url,
      url: main.url,
      width: main.width,
      height: main.height,
    })
  }
  return out
}

async function fetchGifs(path: string, params: Record<string, string>): Promise<GifResult[]> {
  const qs = new URLSearchParams({ per_page: '24', rating: RATING, ...params })
  const res = await fetch(`${API_BASE}/${apiKey()}/gifs/${path}?${qs}`)
  if (!res.ok) throw new Error(`KLIPY ${path} failed: ${res.status}`)
  return parseKlipyResponse(await res.json())
}

export function searchGifs(q: string, page = 1): Promise<GifResult[]> {
  return fetchGifs('search', { q, page: String(page) })
}

export function trendingGifs(page = 1): Promise<GifResult[]> {
  return fetchGifs('trending', { page: String(page) })
}
