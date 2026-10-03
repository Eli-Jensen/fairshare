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
import { GoogleSignInButton } from '../components/GoogleSignInButton'
import { useAuth } from '../hooks/useAuth'
import { tripLabel } from '../lib/types'
import { writeActivity } from '../lib/activity'
import { claimPlaceholdersOnJoin } from '../lib/claim'
import type { TripType } from '../lib/types'

export function JoinTrip() {
  const { inviteCode } = useParams<{ inviteCode: string }>()
  const { user, loading: authLoading } = useAuth()
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
            <GoogleSignInButton />
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
