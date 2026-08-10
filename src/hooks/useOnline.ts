import { useEffect, useState } from 'react'

/**
 * navigator.onLine, live. `false` is trustworthy (definitely offline);
 * `true` only means "not provably offline" — so gate UX affordances on it,
 * never correctness. Lazy initial read keeps render pure.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
