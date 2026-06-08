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
import { BalanceSummary } from '../components/BalanceSummary'
import { UndoToast } from '../components/UndoToast'
import type { Trip } from '../lib/types'
import { DEFAULT_CURRENCY } from '../lib/types'
import { writeActivity } from '../lib/activity'

export function Home() {
  const { user, signIn, firebaseReady, loading: authLoading } = useAuth()
  const { trips: allTrips, loading: tripsLoading } = useTrips()
  const location = useLocation()
  const [undoTrip, setUndoTrip] = useState<{ id: string; name: string } | null>(null)
  const [pendingInvites, setPendingInvites] = useState<Trip[]>([])
  const [joiningTrip, setJoiningTrip] = useState<string | null>(null)
  const [tripBalances, setTripBalances] = useState<Record<string, number>>({})
  const [showAllTrips, setShowAllTrips] = useState(false)

  // Separate trips from groups
  const tripItems = allTrips.filter((t) => (t.type ?? 'trip') === 'trip')
  const groupItems = allTrips.filter((t) => t.type === 'group')

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
    writeActivity(tripId, {
      action: 'member_joined',
      actorUid: user.uid,
      targetMemberUid: user.uid,
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
          <h1 className="text-3xl font-bold text-text mb-2">fairshare</h1>
          <p className="text-text-secondary mb-4">Split trip expenses with friends and family</p>
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
        <div className="text-text-muted">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-text mb-2">fairshare</h1>
          <p className="text-text-secondary">Split trip expenses with friends and family</p>
        </div>
        <button
          onClick={signIn}
          className="flex items-center gap-3 bg-card border border-line rounded-lg px-6 py-3 text-sm font-medium text-text-secondary hover:bg-card-hover shadow-sm transition-colors"
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
      {/* Pending invites — separated by type */}
      {pendingInvites.length > 0 && (() => {
        const tripInvites = pendingInvites.filter((i) => (i.type ?? 'trip') === 'trip')
        const groupInvites = pendingInvites.filter((i) => i.type === 'group')

        return (
          <div className="mb-8 space-y-4">
            {tripInvites.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                  Trip Invites ({tripInvites.length})
                </h2>
                <div className="space-y-2">
                  {tripInvites.map((invite) => (
                    <InviteCard
                      key={invite.id}
                      invite={invite}
                      label="trip"
                      joining={joiningTrip === invite.id}
                      onJoin={() => joinTrip(invite.id)}
                      onDecline={() => declineInvite(invite.id)}
                    />
                  ))}
                </div>
              </div>
            )}
            {groupInvites.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                  Group Invites ({groupInvites.length})
                </h2>
                <div className="space-y-2">
                  {groupInvites.map((invite) => (
                    <InviteCard
                      key={invite.id}
                      invite={invite}
                      label="group"
                      joining={joiningTrip === invite.id}
                      onJoin={() => joinTrip(invite.id)}
                      onDecline={() => declineInvite(invite.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Cross-trip balance summary */}
      {!tripsLoading && allTrips.length > 0 && (
        <BalanceSummary
          tripBalances={tripBalances}
          trips={allTrips}
          settlementCurrency={DEFAULT_CURRENCY}
        />
      )}

      {tripsLoading ? (
        <div className="text-center py-10 text-text-muted">Loading...</div>
      ) : tripItems.length === 0 && groupItems.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-text-secondary mb-4">No trips or groups yet</p>
          <Link
            to="/trip/new"
            className="text-accent-text font-medium hover:text-accent-hover"
          >
            Create one
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Trips column */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h1 className="text-2xl font-bold text-text">Trips</h1>
              <Link
                to="/trip/new"
                className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                New
              </Link>
            </div>
            {tripItems.length > 0 ? (
              <>
                <div className="space-y-3">
                  {(showAllTrips ? tripItems : tripItems.slice(0, 3)).map((trip) => (
                    <TripCard
                      key={trip.id}
                      trip={trip}
                      currentUserUid={user.uid}
                      onBalanceComputed={(tripId, balance) =>
                        setTripBalances((prev) => ({ ...prev, [tripId]: balance }))
                      }
                    />
                  ))}
                </div>
                {tripItems.length > 3 && !showAllTrips && (
                  <button
                    onClick={() => setShowAllTrips(true)}
                    className="w-full mt-2 text-sm text-accent-text hover:text-accent-hover py-2 transition-colors"
                  >
                    Show all ({tripItems.length})
                  </button>
                )}
                {showAllTrips && tripItems.length > 3 && (
                  <button
                    onClick={() => setShowAllTrips(false)}
                    className="w-full mt-2 text-sm text-text-muted hover:text-text-secondary py-2 transition-colors"
                  >
                    Show less
                  </button>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-text-muted">No trips yet</div>
            )}
          </div>

          {/* Groups column */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-2xl font-bold text-text">Groups</h2>
              <Link
                to="/trip/new"
                className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                New
              </Link>
            </div>
            {groupItems.length > 0 ? (
              <div className="space-y-3">
                {groupItems.map((trip) => (
                  <TripCard
                    key={trip.id}
                    trip={trip}
                    currentUserUid={user.uid}
                    onBalanceComputed={(tripId, balance) =>
                      setTripBalances((prev) => ({ ...prev, [tripId]: balance }))
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-text-muted">No groups yet</div>
            )}
          </div>
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

function InviteCard({
  invite,
  label,
  joining,
  onJoin,
  onDecline,
}: {
  invite: Trip
  label: 'trip' | 'group'
  joining: boolean
  onJoin: () => void
  onDecline: () => void
}) {
  return (
    <div className="bg-accent-soft border border-primary-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {label === 'group' && <span className="text-sm">👥</span>}
          <h3 className="font-semibold text-text">{invite.name}</h3>
        </div>
        <span className="text-sm text-text-muted">
          {invite.memberUids.length} member{invite.memberUids.length !== 1 ? 's' : ''}
        </span>
      </div>
      <p className="text-sm text-text-secondary mb-3">
        You've been invited to join this {label}.
      </p>
      <div className="flex gap-2">
        <button
          onClick={onJoin}
          disabled={joining}
          className="bg-accent text-white rounded-lg px-4 py-1.5 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {joining ? (
            <span className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Joining
            </span>
          ) : `Join ${label === 'trip' ? 'Trip' : 'Group'}`}
        </button>
        <button
          onClick={onDecline}
          className="text-sm text-text-secondary hover:text-text px-3 py-1.5 transition-colors"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
