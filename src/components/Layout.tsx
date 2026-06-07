import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close menu on navigation
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  return (
    <div className="min-h-screen flex flex-col bg-page text-text transition-colors">
      <header className="bg-card border-b border-line sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1.5 text-xl font-bold text-accent-text ">
            <svg className="w-6 h-6" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="7" fill="currentColor"/>
              <circle cx="13" cy="16" r="7.5" fill="none" stroke="white" strokeWidth="2" opacity="0.9"/>
              <circle cx="19" cy="16" r="7.5" fill="none" stroke="white" strokeWidth="2" opacity="0.9"/>
            </svg>
            fairshare
          </Link>
          {user && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-transparent hover:ring-primary-200 transition-all"
              >
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt=""
                    className="w-full h-full"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full bg-primary-100 text-accent-text  flex items-center justify-center text-sm font-medium">
                    {user.displayName?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                )}
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 bg-card border border-line rounded-lg shadow-lg py-1 w-52 z-50 animate-slide-up">
                  <div className="px-3 py-2 border-b border-line-light">
                    <p className="text-sm font-medium text-text truncate">
                      {user.displayName}
                    </p>
                    <p className="text-xs text-text-muted truncate">{user.email}</p>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-xs text-text-muted mb-1.5">Theme</p>
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
                    View Recently Deleted
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
              )}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        {children}
      </main>
    </div>
  )
}
