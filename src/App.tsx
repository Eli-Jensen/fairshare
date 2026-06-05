import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { CreateTrip } from './pages/CreateTrip'
import { TripDashboard } from './pages/TripDashboard'
import { AddExpense } from './pages/AddExpense'
import { EditExpense } from './pages/EditExpense'
import { JoinTrip } from './pages/JoinTrip'
import { InviteUsers } from './pages/InviteUsers'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isAllowed, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        Loading...
      </div>
    )
  }

  if (!user || !isAllowed) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/join/:inviteCode" element={<JoinTrip />} />
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
            path="/invite"
            element={
              <ProtectedRoute>
                <InviteUsers />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
