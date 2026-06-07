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
        </Routes>
      </Layout>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
