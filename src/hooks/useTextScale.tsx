import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

const STORAGE_KEY = 'fairshare-text-scale'
const VERSION_KEY = 'fairshare-text-scale-v'
const LEVELS = [81.25, 87.5, 93.75, 100, 106.25, 112.5, 118.75] // ~13px → ~19px
const DEFAULT_LEVEL = 3 // index into LEVELS → 100%
const CURRENT_VERSION = 2

interface TextScaleState {
  level: number
  increase: () => void
  decrease: () => void
  setLevel: (n: number) => void
}

const TextScaleContext = createContext<TextScaleState>({
  level: DEFAULT_LEVEL,
  increase: () => {},
  decrease: () => {},
  setLevel: () => {},
})

export function TextScaleProvider({ children }: { children: ReactNode }) {
  const [level, setLevel] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved !== null) {
        const n = parseInt(saved, 10)
        const ver = parseInt(localStorage.getItem(VERSION_KEY) ?? '1', 10)
        if (ver < CURRENT_VERSION) {
          // Migrate: old 5-level [87.5..112.5] → new 7-level (shift index +1)
          const migrated = Math.min(n + 1, LEVELS.length - 1)
          localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
          return migrated
        }
        if (n >= 0 && n < LEVELS.length) return n
      }
    } catch { /* ignore */ }
    return DEFAULT_LEVEL
  })

  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', `${LEVELS[level]}%`)
    try {
      localStorage.setItem(STORAGE_KEY, String(level))
      localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION))
    } catch { /* ignore */ }
  }, [level])

  function increase() {
    setLevel((l) => Math.min(l + 1, LEVELS.length - 1))
  }

  function decrease() {
    setLevel((l) => Math.max(l - 1, 0))
  }

  function jumpTo(n: number) {
    setLevel(Math.max(0, Math.min(n, LEVELS.length - 1)))
  }

  return (
    <TextScaleContext.Provider value={{ level, increase, decrease, setLevel: jumpTo }}>
      {children}
    </TextScaleContext.Provider>
  )
}

export function useTextScale() {
  return useContext(TextScaleContext)
}

export const TEXT_SCALE_LEVELS = LEVELS
