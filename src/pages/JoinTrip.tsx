import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  doc,
  setDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { Spinner } from '../components/Spinner'
import { useAuth } from '../hooks/useAuth'
import { tripLabel } from '../lib/types'
import { writeActivity } from '../lib/activity'
import { claimPlaceholdersOnJoin } from '../lib/claim'
import type { TripType } from '../lib/types'

export function JoinTrip() {
  const { inviteCode } = useParams<{ inviteCode: string }>()
  const { user, signIn, signingIn, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'joining' | 'error'>('loading')
  const [error, setError] = useState('')
  const [joinType, setJoinType] = useState<TripType>('trip')

  // Declared before the effect that calls it (react-hooks lint reads source
  // order, not hoisting).
  async function joinTrip() {
    if (!user || !inviteCode) return
    // The join path reads code docs and runs a placeholder-claim transaction
    // — server-only work that would sit on "Joining…" forever offline.
    if (!navigator.onLine) {
      setError('Joining needs an internet connection — open this link again once you’re back online.')
      setStatus('error')
      return
    }
    setStatus('joining')

    try {
      // Ensure user profile exists
      await setDoc(
        doc(db, 'users', user.uid),
        {
          uid: user.uid,
          displayName: user.displayName ?? '',
          email: user.email ?? '',
          photoURL: user.photoURL ?? null,
        },
        { merge: true }
      )

      // Trips aren't readable until you're a member, so invite codes
      // resolve through the open /inviteCodes lookup collection
      const codeSnap = await getDoc(doc(db, 'inviteCodes', inviteCode))
      if (!codeSnap.exists()) {
        setError('Invalid invite link')
        setStatus('error')
        return
      }
      const { tripId, type } = codeSnap.data() as { tripId: string; type?: TripType }
      setJoinType(type ?? 'trip')

      // Members (and email invitees) can read the trip up front — use that to
      // skip the join write if already a member, or refuse a deleted trip.
      let verifiedActive = false
      try {
        const tripSnap = await getDoc(doc(db, 'trips', tripId))
        if (tripSnap.exists()) {
          if (tripSnap.data().deletedAt) {
            setError(`This ${tripLabel(type ?? 'trip')} has been deleted`)
            setStatus('error')
            return
          }
          if (tripSnap.data().memberUids?.includes(user.uid)) {
            navigate(`/trip/${tripId}`, { replace: true })
            return
          }
          verifiedActive = true
        }
      } catch {
        // Permission denied — not a member or invitee yet, proceed with the self-join
      }

      // `joinedWith` proves we hold a live invite code: rules compare it to
      // the trip's current inviteCode, which a non-member can't read. Without
      // it the tripId alone would be enough to join.
      await updateDoc(doc(db, 'trips', tripId), {
        memberUids: arrayUnion(user.uid),
        joinedWith: inviteCode,
      })
      // Invite-link joiners who weren't email-invited couldn't read the trip
      // until now. Confirm it wasn't deleted; if it was, undo the join and bail
      // so nobody lands on a deleted "zombie" trip.
      if (!verifiedActive) {
        const recheck = await getDoc(doc(db, 'trips', tripId))
        if (recheck.data()?.deletedAt) {
          await updateDoc(doc(db, 'trips', tripId), {
            memberUids: arrayRemove(user.uid),
          }).catch(() => {})
          setError(`This ${tripLabel(type ?? 'trip')} has been deleted`)
          setStatus('error')
          return
        }
      }
      // Now a member: clear any pending email invite for this user, then
      // claim any placeholder for this email so prior history merges over.
      if (user.email) {
        await updateDoc(doc(db, 'trips', tripId), {
          invitedEmails: arrayRemove(user.email.toLowerCase()),
        }).catch(() => {})
      }
      await claimPlaceholdersOnJoin(tripId, user.uid, user.email)
      writeActivity(tripId, {
        action: 'member_joined',
        actorUid: user.uid,
        targetMemberUid: user.uid,
      })

      navigate(`/trip/${tripId}`, { replace: true })
    } catch {
      setError('Failed to join trip')
      setStatus('error')
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setStatus('loading')
      return
    }
    if (inviteCode) {
      joinTrip()
    }
  }, [user, authLoading, inviteCode])

  if (authLoading || status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <h2 className="text-xl font-semibold text-text">Join {joinType === 'group' ? 'Group' : 'Trip'}</h2>
        {!user ? (
          <>
            <p className="text-text-secondary">Sign in to join this {tripLabel(joinType)}</p>
            <button
              onClick={signIn}
              disabled={signingIn}
              className="flex items-center gap-3 bg-card border border-line rounded-lg px-6 py-3 text-sm font-medium text-text-secondary hover:bg-card-hover shadow-sm transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              {signingIn ? (
                <Spinner className="w-5 h-5" />
              ) : (
                <svg viewBox="0 0 24 24" className="w-5 h-5">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
              )}
              {signingIn ? 'Signing in…' : 'Sign in with Google'}
            </button>
          </>
        ) : (
          <p className="flex items-center gap-2 text-text-muted">
            <Spinner className="w-4 h-4" />
            Loading…
          </p>
        )}
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-danger-text">{error}</p>
        <button
          onClick={() => navigate('/')}
          className="text-accent-text font-medium hover:text-accent-hover"
        >
          Go to home
        </button>
      </div>
    )
  }

  // Joining is several sequential round-trips — the self-join write, then the
  // placeholder claim transaction, then the reconcile — and on a cold network
  // that's long enough that a bare line of text reads as "stuck". Say what's
  // happening and keep something moving.
  return (
    <div
      className="flex flex-col items-center justify-center py-20 gap-3"
      role="status"
      aria-live="polite"
    >
      <Spinner className="w-8 h-8 text-accent" />
      <p className="text-text-secondary font-medium">Joining {tripLabel(joinType)}…</p>
      <p className="text-sm text-text-muted">Setting up your shared expenses</p>
    </div>
  )
}
