import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()
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
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-1.5 text-xl font-bold text-primary-600">
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
                  <div className="w-full h-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-medium">
                    {user.displayName?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                )}
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg py-1 w-52 z-50 animate-slide-up">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {user.displayName}
                    </p>
                    <p className="text-xs text-slate-400 truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/profile')
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Edit Profile
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/trash')
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    View Recently Deleted
                  </button>
                  <div className="border-t border-slate-100">
                    <button
                      onClick={() => {
                        setMenuOpen(false)
                        signOut()
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 transition-colors"
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

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        {children}
      </main>
    </div>
  )
}
