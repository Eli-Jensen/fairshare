import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export type Accent = 'indigo' | 'teal' | 'orange'

export interface AccentOption {
  value: Accent
  label: string
  /** Swatch shown in the picker (the light-mode accent color). */
  swatch: string
}

export const ACCENTS: AccentOption[] = [
  { value: 'indigo', label: 'Indigo', swatch: '#4f46e5' },
  { value: 'teal', label: 'Teal', swatch: '#0d9488' },
  { value: 'orange', label: 'Orange', swatch: '#ea580c' },
]

const STORAGE_KEY = 'fairshare-accent'
const DEFAULT_ACCENT: Accent = 'indigo'

interface AccentState {
  accent: Accent
  setAccent: (a: Accent) => void
}

const AccentContext = createContext<AccentState>({
  accent: DEFAULT_ACCENT,
  setAccent: () => {},
})

function isAccent(v: string | null): v is Accent {
  return v === 'indigo' || v === 'teal' || v === 'orange'
}

export function AccentProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState<Accent>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (isAccent(saved)) return saved
    } catch { /* ignore */ }
    return DEFAULT_ACCENT
  })

  function setAccent(a: Accent) {
    setAccentState(a)
    try {
      localStorage.setItem(STORAGE_KEY, a)
    } catch { /* ignore */ }
  }

  // Apply the data-accent attribute; the CSS theme blocks key off it.
  // Indigo is the default (no overrides), so the attribute is cleared.
  useEffect(() => {
    const root = document.documentElement
    if (accent === DEFAULT_ACCENT) {
      root.removeAttribute('data-accent')
    } else {
      root.setAttribute('data-accent', accent)
    }
    // Keep the mobile browser chrome (theme-color) in sync with the accent
    const meta = document.querySelector('meta[name="theme-color"]')
    const color = ACCENTS.find((o) => o.value === accent)?.swatch
    if (meta && color) meta.setAttribute('content', color)
  }, [accent])

  return (
    <AccentContext.Provider value={{ accent, setAccent }}>
      {children}
    </AccentContext.Provider>
  )
}

export function useAccent() {
  return useContext(AccentContext)
}
