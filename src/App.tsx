import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { CreateTrip } from './pages/CreateTrip'
import { TripDashboard } from './pages/TripDashboard'
import { AddExpense } from './pages/AddExpense'
import { EditExpense } from './pages/EditExpense'
import { JoinTrip } from './pages/JoinTrip'
import { TripInvite } from './pages/TripInvite'
import { DeletedItems } from './pages/DeletedItems'
import { Profile } from './pages/Profile'
import { Activity } from './pages/Activity'

/** Comma-separated email whitelist — when set, only these users can access the app */
const ALLOWED_EMAILS: string[] | null = import.meta.env.VITE_ALLOWED_EMAILS
  ? (import.meta.env.VITE_ALLOWED_EMAILS as string).split(',').map((e) => e.trim().toLowerCase())
  : null

function AccessGate({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth()

  if (!ALLOWED_EMAILS || loading || !user) return <>{children}</>

  if (!ALLOWED_EMAILS.includes(user.email?.toLowerCase() ?? '')) {
    return (
      <div className="text-center py-20 px-4">
        <h1 className="text-2xl font-bold text-text mb-2">Access Restricted</h1>
        <p className="text-text-secondary mb-1">
          This environment is restricted to authorized testers.
        </p>
        <p className="text-sm text-text-muted mb-6">{user.email}</p>
        <button
          onClick={signOut}
          className="text-accent-text font-medium hover:text-accent-hover transition-colors"
        >
          Sign out
        </button>
      </div>
    )
  }

  return <>{children}</>
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted">
        Loading...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Layout>
        <AccessGate>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/join/:inviteCode" element={<JoinTrip />} />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/activity"
            element={
              <ProtectedRoute>
                <Activity />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trash"
            element={
              <ProtectedRoute>
                <DeletedItems />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trip/new"
            element={
              <ProtectedRoute>
                <CreateTrip />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trip/:id"
            element={
              <ProtectedRoute>
                <TripDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trip/:id/invite"
            element={
              <ProtectedRoute>
                <TripInvite />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trip/:id/expense/new"
            element={
              <ProtectedRoute>
                <AddExpense />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trip/:id/expense/:eid"
            element={
              <ProtectedRoute>
                <EditExpense />
              </ProtectedRoute>
            }
          />
          <Route
            path="*"
            element={
              <div className="text-center py-20">
                <h1 className="text-4xl font-bold text-text-muted mb-2">404</h1>
                <p className="text-text-secondary mb-4">Page not found</p>
                <a href="/" className="text-accent-text font-medium hover:text-accent-hover">
                  Go home
                </a>
              </div>
            }
          />
        </Routes>
        </AccessGate>
      </Layout>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
