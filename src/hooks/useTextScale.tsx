import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

const STORAGE_KEY = 'fairshare-text-scale'
const LEVELS = [87.5, 93.75, 100, 106.25, 112.5] // 14px, 15px, 16px, 17px, 18px
const DEFAULT_LEVEL = 2 // index into LEVELS → 100%

interface TextScaleState {
  level: number
  increase: () => void
  decrease: () => void
}

const TextScaleContext = createContext<TextScaleState>({
  level: DEFAULT_LEVEL,
  increase: () => {},
  decrease: () => {},
})

export function TextScaleProvider({ children }: { children: ReactNode }) {
  const [level, setLevel] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved !== null) {
        const n = parseInt(saved, 10)
        if (n >= 0 && n < LEVELS.length) return n
      }
    } catch { /* ignore */ }
    return DEFAULT_LEVEL
  })

  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', `${LEVELS[level]}%`)
    try {
      localStorage.setItem(STORAGE_KEY, String(level))
    } catch { /* ignore */ }
  }, [level])

  function increase() {
    setLevel((l) => Math.min(l + 1, LEVELS.length - 1))
  }

  function decrease() {
    setLevel((l) => Math.max(l - 1, 0))
  }

  return (
    <TextScaleContext.Provider value={{ level, increase, decrease }}>
      {children}
    </TextScaleContext.Provider>
  )
}

export function useTextScale() {
  return useContext(TextScaleContext)
}

export const TEXT_SCALE_LEVELS = LEVELS
