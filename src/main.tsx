import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AuthProvider } from './hooks/useAuth'
import { ThemeProvider } from './hooks/useTheme'
import { TextScaleProvider } from './hooks/useTextScale'
import { ProfileCacheProvider } from './hooks/useProfileCache'

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TextScaleProvider>
        <AuthProvider>
          <ProfileCacheProvider>
            <App />
          </ProfileCacheProvider>
        </AuthProvider>
      </TextScaleProvider>
    </ThemeProvider>
  </StrictMode>
)
