import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  doc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { MemberAvatar } from '../components/MemberAvatar'
import { ConfirmButton } from '../components/ConfirmButton'
import { UndoToast } from '../components/UndoToast'
import type { RemovedMember } from '../lib/types'

interface RecentContact {
  email: string
  name?: string
}

export function TripInvite() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { trip, members, loading } = useTrip(id)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [justInvited, setJustInvited] = useState<string[]>([])
  const [error, setError] = useState('')
  const [recentContacts, setRecentContacts] = useState<RecentContact[]>([])
  const [copied, setCopied] = useState(false)
  const [undoMember, setUndoMember] = useState<{ uid: string; name: string } | null>(null)

  // Load recent contacts from user doc
  useEffect(() => {
    if (!user) return
    async function loadContacts() {
      const snap = await getDoc(doc(db, 'users', user!.uid))
      if (snap.exists()) {
        const data = snap.data()
        setRecentContacts(data.recentContacts ?? [])
      }
    }
    loadContacts()
  }, [user])

  // Clean up expired removed members (>24h)
  useEffect(() => {
    if (!trip?.removedMembers?.length || !id) return
    const now = Date.now()
    const DAY_MS = 24 * 60 * 60 * 1000
    const expired = trip.removedMembers.filter((rm) => {
      const t = rm.removedAt?.toDate?.()
      return t && now - t.getTime() > DAY_MS
    })
    if (expired.length > 0) {
      const kept = trip.removedMembers.filter((rm) => !expired.includes(rm))
      updateDoc(doc(db, 'trips', id), { removedMembers: kept })
    }
  }, [trip?.removedMembers, id])

  const handleUndoMember = useCallback(async () => {
    if (!undoMember || !id || !trip) return
    // Re-add to memberUids and remove from removedMembers
    const updatedRemoved = (trip.removedMembers ?? []).filter(
      (rm) => rm.uid !== undoMember.uid
    )
    await updateDoc(doc(db, 'trips', id), {
      memberUids: arrayUnion(undoMember.uid),
      removedMembers: updatedRemoved,
    })
    setUndoMember(null)
  }, [undoMember, id, trip])

  const dismissUndoMember = useCallback(() => setUndoMember(null), [])

  if (loading || !trip || !user) {
    return <div className="text-center py-10 text-slate-400">Loading...</div>
  }

  const inviteUrl = `${window.location.origin}/join/${trip.inviteCode}`

  // Emails already in the trip (members + pending invites)
  const memberEmails = new Set(
    Object.values(members).map((m) => m.email.toLowerCase())
  )
  const pendingEmails = new Set(
    (trip.invitedEmails ?? []).map((e) => e.toLowerCase())
  )

  function isAlreadyInTrip(checkEmail: string): boolean {
    const lower = checkEmail.toLowerCase()
    return memberEmails.has(lower) || pendingEmails.has(lower)
  }

  async function saveContact(contactEmail: string) {
    if (!user) return
    const lower = contactEmail.toLowerCase()
    const existing = recentContacts.filter((c) => c.email !== lower)
    const updated = [{ email: lower }, ...existing].slice(0, 20)
    setRecentContacts(updated)

    await setDoc(
      doc(db, 'users', user.uid),
      { recentContacts: updated },
      { merge: true }
    )
  }

  async function forgetContact(contactEmail: string) {
    if (!user) return
    const lower = contactEmail.toLowerCase()
    const updated = recentContacts.filter((c) => c.email !== lower)
    setRecentContacts(updated)

    await setDoc(
      doc(db, 'users', user.uid),
      { recentContacts: updated },
      { merge: true }
    )
  }

  async function inviteEmail(inviteTarget: string) {
    const normalized = inviteTarget.trim().toLowerCase()
    if (!normalized || !normalized.includes('@')) {
      setError('Enter a valid email address')
      return
    }

    if (isAlreadyInTrip(normalized)) {
      setError('This person is already in the trip')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      await updateDoc(doc(db, 'trips', id!), {
        invitedEmails: arrayUnion(normalized),
      })
      await saveContact(normalized)
      setJustInvited((prev) => [...prev, normalized])
      setEmail('')
    } catch {
      setError('Failed to invite user')
    } finally {
      setSubmitting(false)
    }
  }

  async function removeMember(uid: string) {
    const member = members[uid]
    if (!member || !id || !trip) return

    const removedEntry: RemovedMember = {
      uid,
      email: member.email,
      displayName: member.displayName,
      removedAt: serverTimestamp() as unknown as import('firebase/firestore').Timestamp,
    }

    const updatedRemoved = [...(trip.removedMembers ?? []), removedEntry]

    await updateDoc(doc(db, 'trips', id), {
      memberUids: arrayRemove(uid),
      removedMembers: updatedRemoved,
    })

    setUndoMember({ uid, name: member.displayName || member.email })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await inviteEmail(email)
  }

  function copyInviteLink() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Filter recent contacts to exclude those already in the trip or just invited
  const suggestableContacts = recentContacts.filter(
    (c) => !isAlreadyInTrip(c.email) && !justInvited.includes(c.email)
  )

  const label = 'block text-sm font-medium text-slate-700 mb-1'

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          to={`/trip/${id}`}
          className="text-slate-400 hover:text-slate-600"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">
          Invite to {trip.name}
        </h1>
      </div>

      {/* Email invite */}
      <div className="mb-6">
        <label className={label}>Invite by email</label>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="email"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            placeholder="friend@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            disabled={submitting}
            className="bg-primary-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors shrink-0"
          >
            {submitting ? '...' : 'Invite'}
          </button>
        </form>
        <p className="text-xs text-slate-400 mt-1">
          They'll see this trip when they sign in to fairshare
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {/* Just invited */}
      {justInvited.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-slate-500 mb-2">Just invited</h3>
          <div className="space-y-1">
            {justInvited.map((e) => (
              <div
                key={e}
                className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {e}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent contacts */}
      {suggestableContacts.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-slate-500 mb-2">Recently added</h3>
          <div className="space-y-1">
            {suggestableContacts.map((contact) => (
              <div
                key={contact.email}
                className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2"
              >
                <span className="text-sm text-slate-700">{contact.email}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => inviteEmail(contact.email)}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700 px-2 py-1 rounded hover:bg-primary-50 transition-colors"
                  >
                    Invite
                  </button>
                  <button
                    onClick={() => forgetContact(contact.email)}
                    className="text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                  >
                    Forget
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current members */}
      <div className="border-t border-slate-200 pt-4 mb-6">
        <h3 className="text-sm font-medium text-slate-700 mb-2">
          Current members ({trip.memberUids.length})
        </h3>
        <div className="space-y-1">
          {trip.memberUids.map((uid) => {
            const member = members[uid]
            const isCurrentUser = uid === user.uid
            return (
              <div
                key={uid}
                className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <MemberAvatar member={member} size="sm" />
                  <div>
                    <span className="text-sm text-slate-700">
                      {member?.displayName ?? 'Loading...'}
                      {isCurrentUser && (
                        <span className="text-slate-400 ml-1">(you)</span>
                      )}
                    </span>
                    {member?.email && (
                      <p className="text-xs text-slate-400">{member.email}</p>
                    )}
                  </div>
                </div>
                {!isCurrentUser && (
                  <ConfirmButton
                    label="Remove"
                    confirmLabel="Confirm?"
                    onConfirm={() => removeMember(uid)}
                    className="text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                    confirmClassName="text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded transition-colors"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Invite link */}
      <div className="border-t border-slate-200 pt-4">
        <label className={label}>Or share invite link</label>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-500 bg-slate-50"
          />
          <button
            onClick={copyInviteLink}
            className="border border-slate-300 rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Anyone with this link can join the trip after signing in
        </p>
      </div>

      {/* Pending invites */}
      {trip.invitedEmails && trip.invitedEmails.length > 0 && (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-medium text-slate-500 mb-2">
            Pending invites ({trip.invitedEmails.length})
          </h3>
          <div className="space-y-1">
            {trip.invitedEmails.map((e) => (
              <div
                key={e}
                className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {e} — hasn't signed in yet
              </div>
            ))}
          </div>
        </div>
      )}

      {undoMember && (
        <UndoToast
          message={`${undoMember.name} removed from trip`}
          onUndo={handleUndoMember}
          onDismiss={dismissUndoMember}
        />
      )}
    </div>
  )
}
