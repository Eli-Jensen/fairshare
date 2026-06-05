import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()
  const location = useLocation()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-primary-600">
            fairshare
          </Link>
          {user && (
            <div className="flex items-center gap-3">
              <Link
                to="/trash"
                className="text-sm text-slate-400 hover:text-slate-600"
                title="Recently deleted"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </Link>
              <button
                onClick={signOut}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                Sign out
              </button>
              {user.photoURL && (
                <img
                  src={user.photoURL}
                  alt=""
                  className="w-8 h-8 rounded-full"
                  referrerPolicy="no-referrer"
                />
              )}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        {children}
      </main>

      {user && (
        <nav className="bg-white border-t border-slate-200 sticky bottom-0 sm:hidden">
          <div className="flex justify-around py-2">
            <NavLink to="/" current={location.pathname === '/'}>
              Trips
            </NavLink>
            <NavLink to="/trip/new" current={location.pathname === '/trip/new'}>
              New Trip
            </NavLink>
            <NavLink to="/trash" current={location.pathname === '/trash'}>
              Trash
            </NavLink>
          </div>
        </nav>
      )}
    </div>
  )
}

function NavLink({
  to,
  current,
  children,
}: {
  to: string
  current: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className={`text-sm px-3 py-1 rounded-md ${
        current
          ? 'text-primary-600 font-medium'
          : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </Link>
  )
}
