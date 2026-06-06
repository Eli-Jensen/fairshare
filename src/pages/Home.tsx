import { useEffect, useState, useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  arrayUnion,
  arrayRemove,
  deleteField,
  doc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrips } from '../hooks/useTrips'
import { TripCard } from '../components/TripCard'
import { UndoToast } from '../components/UndoToast'
import type { Trip } from '../lib/types'

export function Home() {
  const { user, signIn, firebaseReady, loading: authLoading } = useAuth()
  const { trips, loading: tripsLoading } = useTrips()
  const location = useLocation()
  const [undoTrip, setUndoTrip] = useState<{ id: string; name: string } | null>(null)
  const [pendingInvites, setPendingInvites] = useState<Trip[]>([])
  const [joiningTrip, setJoiningTrip] = useState<string | null>(null)

  // Handle undo toast for deleted trips
  useEffect(() => {
    const state = location.state as { deletedTripId?: string; deletedTripName?: string } | null
    if (state?.deletedTripId) {
      setUndoTrip({ id: state.deletedTripId, name: state.deletedTripName ?? 'Trip' })
      window.history.replaceState({}, '')
    }
  }, [location.state])

  const handleUndoTrip = useCallback(async () => {
    if (!undoTrip) return
    await updateDoc(doc(db, 'trips', undoTrip.id), {
      deletedAt: deleteField(),
    })
    setUndoTrip(null)
  }, [undoTrip])

  const dismissUndoTrip = useCallback(() => setUndoTrip(null), [])

  // Listen for pending invites (trips where user's email is in invitedEmails)
  useEffect(() => {
    if (!user?.email) return

    const q = query(
      collection(db, 'trips'),
      where('invitedEmails', 'array-contains', user.email.toLowerCase())
    )

    return onSnapshot(q, (snap) => {
      const invited: Trip[] = []
      for (const d of snap.docs) {
        const data = d.data()
        if (!data.deletedAt && !data.memberUids?.includes(user.uid)) {
          invited.push({ id: d.id, ...data } as Trip)
        }
      }
      setPendingInvites(invited)
    })
  }, [user?.email, user?.uid])

  async function joinTrip(tripId: string) {
    if (!user) return
    setJoiningTrip(tripId)
    await updateDoc(doc(db, 'trips', tripId), {
      memberUids: arrayUnion(user.uid),
      invitedEmails: arrayRemove(user.email!.toLowerCase()),
    })
    setJoiningTrip(null)
  }

  async function declineInvite(tripId: string) {
    if (!user) return
    await updateDoc(doc(db, 'trips', tripId), {
      invitedEmails: arrayRemove(user.email!.toLowerCase()),
    })
  }

  if (!firebaseReady) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">fairshare</h1>
          <p className="text-slate-500 mb-4">Split trip expenses with friends and family</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 max-w-md text-sm text-amber-800">
          <p className="font-medium mb-1">Firebase not configured</p>
          <p>
            Create a <code className="bg-amber-100 px-1 rounded">.env</code> file
            in the project root with your Firebase config values.
          </p>
        </div>
      </div>
    )
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-slate-400">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">fairshare</h1>
          <p className="text-slate-500 dark:text-slate-400">Split trip expenses with friends and family</p>
        </div>
        <button
          onClick={signIn}
          className="flex items-center gap-3 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-6 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-sm transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Sign in with Google
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
            Trip Invites ({pendingInvites.length})
          </h2>
          <div className="space-y-2">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="bg-primary-50 dark:bg-primary-900/30 border border-primary-200 dark:border-primary-700 rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-900">{invite.name}</h3>
                  <span className="text-xs text-slate-400">
                    {invite.memberUids.length} member{invite.memberUids.length !== 1 && 's'}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mb-3">
                  You've been invited to join this trip.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => joinTrip(invite.id)}
                    disabled={joiningTrip === invite.id}
                    className="bg-primary-600 text-white rounded-lg px-4 py-1.5 text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
                  >
                    {joiningTrip === invite.id ? 'Joining...' : 'Join Trip'}
                  </button>
                  <button
                    onClick={() => declineInvite(invite.id)}
                    className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5 transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Your Trips</h1>
        <Link
          to="/trip/new"
          className="bg-primary-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary-700 transition-colors"
        >
          New Trip
        </Link>
      </div>

      {tripsLoading ? (
        <div className="text-center py-10 text-slate-400">Loading trips...</div>
      ) : trips.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-500 mb-4">No trips yet</p>
          <Link
            to="/trip/new"
            className="text-primary-600 font-medium hover:text-primary-700"
          >
            Create your first trip
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}

      {undoTrip && (
        <UndoToast
          message={`"${undoTrip.name}" deleted`}
          onUndo={handleUndoTrip}
          onDismiss={dismissUndoTrip}
        />
      )}
    </div>
  )
}
