import { useEffect, useState } from 'react'
import { imageUrl } from '../lib/image'

/**
 * Resolve a Storage path to a display URL via the shared cached fetch.
 * Keyed by path so a path change falls back to null without a synchronous
 * state reset in the effect. (Pattern shared with good-boy-points.)
 */
export function useImageUrl(path: string | undefined): string | null {
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    if (!path) return
    let live = true
    imageUrl(path)
      .then((url) => {
        if (live) setLoaded({ path, url })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [path])

  return path && loaded?.path === path ? loaded.url : null
}
