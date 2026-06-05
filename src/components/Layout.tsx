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
                to="/invite"
                className="text-sm text-slate-500 hover:text-primary-600"
              >
                Invite
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
            <NavLink to="/invite" current={location.pathname === '/invite'}>
              Invite
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
