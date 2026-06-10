import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTrips } from '../hooks/useTrips'
import { useTheme } from '../hooks/useTheme'
import { useTextScale, TEXT_SCALE_LEVELS } from '../hooks/useTextScale'
import { hasUnseenActivity } from '../lib/activityNotification'

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()
  // Shares the same query (and billing) as the Home page's listener; the
  // lastActivityAt stamps on trip docs drive the unseen dot
  const { trips } = useTrips()
  const { theme, setTheme } = useTheme()
  const { level: textLevel, increase: textIncrease, decrease: textDecrease, setLevel: textSetLevel } = useTextScale()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [hasUnseen, setHasUnseen] = useState(false)

  // Close menu on navigation, re-check unseen activity
  useEffect(() => {
    setMenuOpen(false)
    if (user?.uid) {
      setHasUnseen(hasUnseenActivity(user.uid, trips))
    }
  }, [location.pathname, user?.uid, trips])

  return (
    <div className="min-h-screen flex flex-col bg-page text-text transition-colors">
      <header className="bg-card border-b border-line sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {location.pathname !== '/' && (
              <button
                onClick={() => navigate(-1)}
                className="p-1.5 -ml-1.5 rounded-lg text-text-muted hover:text-text hover:bg-card-hover transition-colors"
                aria-label="Go back"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <Link to="/" className="flex items-center gap-1.5 text-xl font-bold text-accent-text">
              <svg className="w-6 h-6" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="7" fill="currentColor"/>
                <circle cx="13" cy="16" r="7.5" fill="none" stroke="white" strokeWidth="2" opacity="0.9"/>
                <circle cx="19" cy="16" r="7.5" fill="none" stroke="white" strokeWidth="2" opacity="0.9"/>
              </svg>
              fairshare
            </Link>
          </div>
          {user && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="relative w-8 h-8 rounded-full overflow-visible ring-2 ring-transparent hover:ring-primary-200 transition-all"
              >
                <div className="w-8 h-8 rounded-full overflow-hidden">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt=""
                      className="w-full h-full"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full bg-primary-100 text-accent-text flex items-center justify-center text-sm font-medium">
                      {user.displayName?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                  )}
                </div>
                {hasUnseen && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-accent rounded-full ring-2 ring-card" />
                )}
              </button>

              {menuOpen && (
                <>
                {/* Invisible backdrop — catches outside clicks so they don't pass through to trip cards, etc. */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  className="absolute right-0 mt-2 bg-card border border-line rounded-lg shadow-lg py-1 w-52 z-50 animate-slide-up"
                >
                  <div className="px-3 py-2 border-b border-line-light">
                    <p className="text-sm font-medium text-text truncate">
                      {user.displayName}
                    </p>
                    <p className="text-sm text-text-muted truncate">{user.email}</p>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-sm text-text-muted mb-1.5">Theme</p>
                    <div className="flex gap-1 bg-muted rounded-lg p-0.5">
                      {([
                        { value: 'light' as const, icon: (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                        ), label: 'Light' },
                        { value: 'dark' as const, icon: (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                          </svg>
                        ), label: 'Dark' },
                        { value: 'system' as const, icon: (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                        ), label: 'Auto' },
                      ]).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setTheme(opt.value)}
                          className={`flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-md transition-all ${
                            theme === opt.value
                              ? 'bg-active text-text font-medium shadow-sm'
                              : 'text-text-muted hover:text-text-secondary'
                          }`}
                        >
                          {opt.icon}
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="px-3 py-2 border-b border-line-light" style={{ fontSize: '16px' }}>
                    <p className="text-text-muted mb-1.5" style={{ fontSize: '14px' }}>Text Size</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={textDecrease}
                        disabled={textLevel <= 0}
                        className="rounded-md bg-muted text-text-secondary hover:bg-card-hover flex items-center justify-center font-bold disabled:opacity-30 transition-colors"
                        style={{ width: '32px', height: '32px', fontSize: '14px' }}
                      >
                        −
                      </button>
                      <div className="flex-1 flex items-end justify-center" style={{ gap: '3px', height: '24px' }}>
                        {TEXT_SCALE_LEVELS.map((_, i) => (
                          <button
                            key={i}
                            onClick={() => textSetLevel(i)}
                            className={`font-semibold leading-none transition-colors cursor-pointer hover:text-accent-hover ${
                              i <= textLevel ? 'text-accent' : 'text-muted'
                            }`}
                            style={{ fontSize: `${10 + i * 2}px`, background: 'none', border: 'none', padding: 0 }}
                          >
                            A
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={textIncrease}
                        disabled={textLevel >= TEXT_SCALE_LEVELS.length - 1}
                        className="rounded-md bg-muted text-text-secondary hover:bg-card-hover flex items-center justify-center font-bold disabled:opacity-30 transition-colors"
                        style={{ width: '32px', height: '32px', fontSize: '14px' }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/activity')
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-card-hover transition-colors flex items-center gap-1.5 ${
                      hasUnseen ? 'text-accent-text font-medium' : 'text-text-secondary'
                    }`}
                  >
                    All Activity
                    {hasUnseen && (
                      <span className="w-1.5 h-1.5 bg-accent rounded-full" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/profile')
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-card-hover transition-colors"
                  >
                    Edit Profile
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/trash')
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-card-hover transition-colors"
                  >
                    Trash
                  </button>
                  <div className="border-t border-line-light">
                    <button
                      onClick={() => {
                        setMenuOpen(false)
                        signOut()
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-card-hover transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        {children}
      </main>
    </div>
  )
}
