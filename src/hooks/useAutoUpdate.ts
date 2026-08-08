import { useEffect } from 'react'

const CHECK_MS = 15 * 60 * 1000
// Remembers the sha we last reloaded for, so a mismatch that survives a reload
// can't turn into a refresh loop. See below.
const ATTEMPT_KEY = 'fairshare-reloaded-for'

/**
 * Watch /version.json (emitted at build) for a sha different from the one this
 * bundle was built with — i.e. a deploy landed while this tab was open — and
 * reload straight away. Shipping is continuous here: a push to dev reaches prod
 * on its own, so an open tab drifts behind silently and keeps writing to
 * Firestore with old code.
 *
 * This interrupts whatever the person was doing, unsaved form input included.
 * That's the accepted trade: deploys are small and frequent, and a prompt they
 * can ignore is a prompt that gets ignored.
 *
 * No-op in dev: the file is emitted by a build-only plugin, so `vite dev` would
 * 404 (or, with the SPA fallback, hand back index.html) forever.
 *
 * Three things keep this from reloading when it shouldn't:
 *  - The SPA rewrite serves index.html for unknown paths, so a parse failure or
 *    a missing `sha` is treated as "no answer", never as a new version.
 *  - We reload at most once per sha per tab session. If a reload somehow comes
 *    back on the same old bundle, the app is merely stale — survivable — rather
 *    than refreshing forever, which would make it unusable. A later deploy
 *    (a different sha) is still picked up.
 *  - The service worker deliberately does NOT cache /version.json, so an
 *    offline tab can't be told about a version it has no way to fetch.
 */
export function useAutoUpdate(): void {
  useEffect(() => {
    if (import.meta.env.DEV) return

    let live = true
    async function check() {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { sha?: string }
        if (!live || typeof data.sha !== 'string' || data.sha === __GIT_SHA__) return

        try {
          if (sessionStorage.getItem(ATTEMPT_KEY) === data.sha) return // already tried
          sessionStorage.setItem(ATTEMPT_KEY, data.sha)
        } catch {
          // No sessionStorage — reload anyway; the loop guard is a nicety, and
          // going stale forever is the worse failure.
        }
        window.location.reload()
      } catch {
        // Offline, or the fetch was cut off mid-navigation — try again next tick.
      }
    }

    check()
    const interval = setInterval(check, CHECK_MS)
    // Coming back to a backgrounded tab is the moment a stale bundle is most
    // likely, and timers are throttled while hidden — so check on the way in.
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}
