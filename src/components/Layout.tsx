import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTrips } from '../hooks/useTrips'
import { useTheme } from '../hooks/useTheme'
import { useAccent, ACCENTS } from '../hooks/useAccent'
import { useTextScale, TEXT_SCALE_LEVELS } from '../hooks/useTextScale'
import { hasUnseenActivity } from '../lib/activityNotification'
import { refreshPushToken, startForegroundNotifications, type ForegroundNote } from '../lib/push'
import { hasUnseenChangelog } from '../lib/changelog'
import { useAutoUpdate } from '../hooks/useAutoUpdate'
import { useOnline } from '../hooks/useOnline'
import { useErrorNote, clearError } from '../lib/errorToast'

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()
  // Shares the same query (and billing) as the Home page's listener; the
  // lastActivityAt stamps on trip docs drive the unseen dot
  const { trips } = useTrips()
  const { theme, setTheme } = useTheme()
  const { accent, setAccent } = useAccent()
  const { level: textLevel, increase: textIncrease, decrease: textDecrease, setLevel: textSetLevel } = useTextScale()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [hasUnseen, setHasUnseen] = useState(false)
  const [note, setNote] = useState<ForegroundNote | null>(null)
  // Lazy initializer, not a render-time read — localStorage during render
  // would make this component impure.
  const [newStuff, setNewStuff] = useState(() => hasUnseenChangelog())

  // A deploy landing while this tab is open reloads it, rather than letting old
  // code keep writing to Firestore.
  useAutoUpdate()
  const online = useOnline()
  const errorNote = useErrorNote()

  // Close menu on navigation, re-check unseen activity
  useEffect(() => {
    setMenuOpen(false)
    if (user?.uid) {
      setHasUnseen(hasUnseenActivity(user.uid, trips))
    }
  }, [location.pathname, user?.uid, trips])

  // Push, on every app open. The token self-heal is gated on the PERMISSION
  // rather than on our own "is push on here" flag: a site-storage wipe erases
  // that flag and the push subscription together, so a flag-gated heal would
  // abandon exactly the devices that just went silent.
  useEffect(() => {
    if (!user?.uid) return
    refreshPushToken(user.uid)
    let stop: (() => void) | undefined
    let cancelled = false
    // FCM only auto-displays banners for backgrounded pages, and iOS shows
    // nothing at all for the focused app — so mirror it in-page.
    startForegroundNotifications((n) => setNote(n)).then((unsub) => {
      if (cancelled) unsub?.()
      else stop = unsub
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [user?.uid])

  useEffect(() => {
    if (!note) return
    const t = window.setTimeout(() => setNote(null), 6000)
    return () => window.clearTimeout(t)
  }, [note])

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
            {import.meta.env.VITE_BUILD_ENV === 'dev' && (
              <span className="text-[10px] font-bold tracking-wider bg-warn-bg text-warn-text border border-warn-border rounded px-1.5 py-0.5 select-none">
                DEV
              </span>
            )}
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
                {(hasUnseen || newStuff) && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-accent rounded-full ring-2 ring-card" />
                )}
              </button>

              {menuOpen && (
                <>
                {/* Invisible backdrop — catches outside clicks so they don't pass
                    through to trip cards; a button so Escape-via-tab works too */}
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-40 cursor-default"
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
                  <div className="px-3 py-2">
                    <p className="text-sm text-text-muted mb-1.5">Color</p>
                    <div className="flex gap-2">
                      {ACCENTS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setAccent(opt.value)}
                          aria-label={opt.label}
                          title={opt.label}
                          className="w-7 h-7 rounded-full flex items-center justify-center border border-line transition-transform hover:scale-110"
                          style={{ backgroundColor: opt.swatch }}
                        >
                          {accent === opt.value && (
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
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
                      <div className="flex-1 flex items-end justify-center" style={{ gap: '2px', height: '24px' }}>
                        {TEXT_SCALE_LEVELS.map((_, i) => (
                          <button
                            key={i}
                            onClick={() => textSetLevel(i)}
                            className={`font-semibold leading-none transition-colors cursor-pointer hover:text-accent-hover ${
                              i <= textLevel ? 'text-accent' : 'text-muted'
                            }`}
                            style={{ fontSize: `${9 + i}px`, background: 'none', border: 'none', padding: 0 }}
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
                      setNewStuff(false)
                      navigate('/whats-new')
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-card-hover transition-colors flex items-center gap-1.5 ${
                      newStuff ? 'text-accent-text font-medium' : 'text-text-secondary'
                    }`}
                  >
                    What's New
                    {newStuff && <span className="w-1.5 h-1.5 bg-accent rounded-full" />}
                  </button>
                  {/* Same page as Edit Profile, but nobody looks for
                      notification settings under "edit your profile" — the
                      hash scrolls to the section and flags it. */}
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/profile#push')
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-card-hover transition-colors"
                  >
                    Notifications
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
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/restore')
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-card-hover transition-colors"
                  >
                    Restore from Sheet
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
                  <Link
                    to="/whats-new"
                    onClick={() => {
                      setMenuOpen(false)
                      setNewStuff(false)
                    }}
                    className="block px-3 pt-1.5 pb-1 text-[11px] text-text-muted border-t border-line-light hover:text-text-secondary transition-colors"
                  >
                    v{__APP_VERSION__} · {__GIT_SHA__} · {__BUILD_DATE__}
                    {import.meta.env.VITE_BUILD_ENV === 'dev' && ' · dev'}
                  </Link>
                </div>
                </>
              )}
            </div>
          )}
        </div>
        {/* Firestore queues writes silently while offline — SAY so, or taps
            that never visibly confirm read as broken. */}
        {!online && (
          <div className="border-t border-warn-border bg-warn-bg px-4 py-1.5 text-center text-xs font-medium text-warn-text">
            📡 You’re offline — changes will save and sync when you’re back.
          </div>
        )}
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        {children}
      </main>

      {/* Global failure toast — fire-and-forget writes that fail ONLINE
          (rules denial, bad data) reject fast and surface here instead of
          dying in the console. */}
      {errorNote && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(24rem,calc(100vw-2rem))] bg-card border border-danger-border rounded-lg shadow-lg px-4 py-3 animate-slide-up flex items-start gap-2"
        >
          <p className="flex-1 text-sm text-text">{errorNote.message}</p>
          <button
            type="button"
            onClick={clearError}
            aria-label="Dismiss"
            className="shrink-0 text-text-muted hover:text-text"
          >
            ✕
          </button>
        </div>
      )}

      {/* In-page mirror of a push that arrived while this tab was focused —
          the only reliable signal on iOS, which suppresses system banners for
          the app you're looking at. */}
      {note && (
        <button
          onClick={() => {
            const link = note.link
            setNote(null)
            if (link) {
              const path = link.startsWith('http') ? new URL(link).pathname : link
              navigate(path)
            }
          }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] text-left bg-card border border-line rounded-lg shadow-lg px-4 py-3 animate-slide-up"
        >
          <p className="text-sm font-medium text-text truncate">{note.title}</p>
          {note.body && <p className="text-sm text-text-secondary">{note.body}</p>}
        </button>
      )}
    </div>
  )
}
