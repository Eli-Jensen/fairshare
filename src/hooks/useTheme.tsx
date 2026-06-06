import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeState {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeState>({
  theme: 'system',
  resolved: 'light',
  setTheme: () => {},
})

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('fairshare-theme')
    return (saved as Theme) || 'system'
  })

  const resolved = theme === 'system' ? getSystemTheme() : theme

  function setTheme(t: Theme) {
    setThemeState(t)
    localStorage.setItem('fairshare-theme', t)
  }

  // Apply dark class to <html>
  useEffect(() => {
    const root = document.documentElement
    if (resolved === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [resolved])

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onChange() {
      if (theme === 'system') {
        // Force re-render by toggling state
        setThemeState('system')
      }
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
