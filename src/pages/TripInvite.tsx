import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  doc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  getDoc,
  setDoc,
  deleteDoc,
  deleteField,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { MemberAvatar } from '../components/MemberAvatar'
import { ConfirmButton } from '../components/ConfirmButton'
import { UndoToast } from '../components/UndoToast'
import { getMemberName, tripLabel, formatMoney, DEFAULT_CURRENCY, type RemovedMember, type UserProfile } from '../lib/types'
import { useTrips } from '../hooks/useTrips'
import { useProfileCache } from '../hooks/useProfileCache'
import { generateInviteCode } from '../lib/invite'
import { writeActivity } from '../lib/activity'

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
  const [resetting, setResetting] = useState(false)
  const [justReset, setJustReset] = useState(false)
  const [undoMember, setUndoMember] = useState<{ uid: string; name: string } | null>(null)
  const { trips: allTrips } = useTrips()
  const { getProfiles } = useProfileCache()

  // Groups the user belongs to (for "import from group")
  const groups = allTrips.filter((t) => t.type === 'group' && t.id !== id)

  // Expandable group members
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [groupProfiles, setGroupProfiles] = useState<Record<string, Record<string, UserProfile>>>({})
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null)

  async function toggleGroup(groupId: string, memberUids: string[]) {
    const next = new Set(expandedGroups)
    if (next.has(groupId)) {
      next.delete(groupId)
      setExpandedGroups(next)
      return
    }
    next.add(groupId)
    setExpandedGroups(next)
    if (!groupProfiles[groupId]) {
      setLoadingGroup(groupId)
      const profiles = await getProfiles(memberUids)
      setGroupProfiles((prev) => ({ ...prev, [groupId]: profiles }))
      setLoadingGroup(null)
    }
  }

  // Recent contacts live in an owner-only subcollection so other users
  // can't read your invite history off the public profile doc
  useEffect(() => {
    if (!user) return
    async function loadContacts() {
      const privRef = doc(db, 'users', user!.uid, 'private', 'contacts')
      const snap = await getDoc(privRef)
      if (snap.exists()) {
        setRecentContacts(snap.data().contacts ?? [])
        return
      }
      // Migrate contacts stored on the public profile doc by older versions
      const userSnap = await getDoc(doc(db, 'users', user!.uid))
      const legacy = userSnap.exists() ? userSnap.data().recentContacts : undefined
      if (legacy?.length) {
        setRecentContacts(legacy)
        setDoc(privRef, { contacts: legacy }).catch(() => {})
        updateDoc(doc(db, 'users', user!.uid), { recentContacts: deleteField() }).catch(() => {})
      }
    }
    loadContacts()
  }, [user?.uid])

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
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  const tl = tripLabel(trip.type)
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

    await setDoc(doc(db, 'users', user.uid, 'private', 'contacts'), { contacts: updated })
  }

  async function forgetContact(contactEmail: string) {
    if (!user) return
    const lower = contactEmail.toLowerCase()
    const updated = recentContacts.filter((c) => c.email !== lower)
    setRecentContacts(updated)

    await setDoc(doc(db, 'users', user.uid, 'private', 'contacts'), { contacts: updated })
  }

  async function inviteEmail(inviteTarget: string) {
    const normalized = inviteTarget.trim().toLowerCase()
    if (!normalized || !normalized.includes('@')) {
      setError('Enter a valid email address')
      return
    }

    if (isAlreadyInTrip(normalized)) {
      setError(`Already in this ${tl}`)
      return
    }

    setSubmitting(true)
    setError('')

    try {
      await updateDoc(doc(db, 'trips', id!), {
        invitedEmails: arrayUnion(normalized),
      })
      writeActivity(id!, {
        action: 'member_invited',
        actorUid: user!.uid,
        targetDescription: normalized,
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
      removedAt: Timestamp.now(),
    }

    const updatedRemoved = [...(trip.removedMembers ?? []), removedEntry]

    await updateDoc(doc(db, 'trips', id), {
      memberUids: arrayRemove(uid),
      removedMembers: updatedRemoved,
    })

    writeActivity(id, {
      action: 'member_removed',
      actorUid: user!.uid,
      targetMemberUid: uid,
      targetDescription: member.displayName || member.email,
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

  // Rotate the invite code: the lookup doc is what JoinTrip resolves, so
  // deleting the old one is what actually kills previously-shared links
  async function resetInviteLink() {
    if (!trip || !id) return
    setResetting(true)
    setError('')
    const oldCode = trip.inviteCode
    const newCode = generateInviteCode()
    try {
      // New lookup first so a valid link always exists, then point the
      // trip at it, then invalidate the old link
      await setDoc(doc(db, 'inviteCodes', newCode), { tripId: id, type: trip.type ?? 'trip' })
      await updateDoc(doc(db, 'trips', id), { inviteCode: newCode })
      if (oldCode) await deleteDoc(doc(db, 'inviteCodes', oldCode))
      setJustReset(true)
      setTimeout(() => setJustReset(false), 3000)
    } catch {
      setError('Failed to reset the link. Try again.')
    } finally {
      setResetting(false)
    }
  }

  // Filter recent contacts to exclude those already in the trip or just invited
  const suggestableContacts = recentContacts.filter(
    (c) => !isAlreadyInTrip(c.email) && !justInvited.includes(c.email)
  )

  const label = 'block text-sm font-medium text-text-secondary mb-1'

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          to={`/trip/${id}`}
          className="text-text-muted hover:text-text-secondary"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-text">
          Invite to {trip.name}
        </h1>
      </div>

      {/* Email invite */}
      <div className="mb-6">
        <label className={label}>Invite by email</label>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="email"
            className="flex-1 border border-line rounded-lg px-3 py-2 text-sm bg-input text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            placeholder="friend@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            disabled={submitting}
            className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors shrink-0"
          >
            {submitting ? '...' : 'Invite'}
          </button>
        </form>
        <p className="text-xs text-text-muted mt-1">
          Appears after they sign in
        </p>
      </div>

      {error && (
        <p className="text-sm text-danger-text bg-danger-bg rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {/* Just invited */}
      {justInvited.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-text-secondary mb-2">Just invited</h3>
          <div className="space-y-1">
            {justInvited.map((e) => (
              <div
                key={e}
                className="flex items-center gap-2 text-sm text-success-text bg-success-bg rounded-lg px-3 py-2"
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

      {/* Import from group */}
      {groups.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-text-secondary mb-2">Add from a group</h3>
          <div className="space-y-1">
            {groups.map((g) => {
              const isExpanded = expandedGroups.has(g.id)
              const profiles = groupProfiles[g.id]
              const isLoading = loadingGroup === g.id
              return (
                <div key={g.id} className="bg-card border border-line rounded-lg overflow-hidden">
                  {/* Group header row */}
                  <div className="flex items-center px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.id, g.memberUids)}
                      className="mr-2 text-text-muted hover:text-text-secondary transition-colors"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.id, g.memberUids)}
                      className="flex-1 text-left"
                    >
                      <span className="text-sm text-text">👥 {g.name}</span>
                      <span className="text-sm text-text-muted ml-2">
                        {g.memberUids.length} member{g.memberUids.length !== 1 ? 's' : ''}
                      </span>
                    </button>
                    <button
                      onClick={async () => {
                        const p = profiles || await getProfiles(g.memberUids)
                        if (!profiles) setGroupProfiles((prev) => ({ ...prev, [g.id]: p }))
                        let added = 0
                        for (const uid of g.memberUids) {
                          const profile = p[uid]
                          if (!profile?.email) continue
                          const em = profile.email.toLowerCase()
                          if (!isAlreadyInTrip(em) && !justInvited.includes(em)) {
                            await inviteEmail(em)
                            added++
                          }
                        }
                        if (added === 0) {
                          setError(`All group members already in this ${tl}`)
                        }
                      }}
                      className="text-sm font-medium text-accent-text hover:text-accent-hover px-2 py-1 rounded hover:bg-accent-soft transition-colors shrink-0"
                    >
                      Add all
                    </button>
                  </div>

                  {/* Expanded member list */}
                  {isExpanded && (
                    <div className="border-t border-line-light px-3 py-2 pl-9 space-y-1">
                      {isLoading && (
                        <p className="text-sm text-text-muted py-1">Loading...</p>
                      )}
                      {profiles && g.memberUids.map((uid) => {
                        const profile = profiles[uid]
                        if (!profile) return null
                        const em = profile.email?.toLowerCase() ?? ''
                        const alreadyAdded = isAlreadyInTrip(em) || justInvited.includes(em)
                        return (
                          <div key={uid} className="flex items-center justify-between py-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <MemberAvatar member={profile} size="sm" />
                              <div className="min-w-0">
                                <p className="text-sm text-text truncate">{profile.displayName || profile.email}</p>
                                {profile.displayName && (
                                  <p className="text-sm text-text-muted truncate">{profile.email}</p>
                                )}
                              </div>
                            </div>
                            {alreadyAdded ? (
                              <span className="text-sm text-text-muted shrink-0">Added</span>
                            ) : (
                              <button
                                onClick={() => inviteEmail(em)}
                                className="text-sm font-medium text-accent-text hover:text-accent-hover px-2 py-1 rounded hover:bg-accent-soft transition-colors shrink-0"
                              >
                                Add
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent contacts */}
      {suggestableContacts.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-text-secondary mb-2">Recently added</h3>
          <div className="space-y-1">
            {suggestableContacts.map((contact) => (
              <div
                key={contact.email}
                className="flex items-center justify-between bg-card border border-line rounded-lg px-3 py-2"
              >
                <span className="text-sm text-text-secondary">{contact.email}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => inviteEmail(contact.email)}
                    className="text-xs font-medium text-accent-text hover:text-accent-hover px-2 py-1 rounded hover:bg-accent-soft transition-colors"
                  >
                    Invite
                  </button>
                  <button
                    onClick={() => forgetContact(contact.email)}
                    className="text-xs text-text-muted hover:text-danger-text px-2 py-1 rounded hover:bg-danger-bg transition-colors"
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
      <div className="border-t border-line pt-4 mb-6">
        <h3 className="text-sm font-medium text-text-secondary mb-2">
          Current members ({trip.memberUids.length})
        </h3>
        <div className="space-y-1">
          {trip.memberUids.map((uid) => {
            const member = members[uid]
            const isCurrentUser = uid === user.uid
            return (
              <div
                key={uid}
                className="flex items-center justify-between bg-card border border-line rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <MemberAvatar member={member} size="sm" />
                  <div>
                    <span className="text-sm text-text-secondary">
                      {getMemberName(uid, members)}
                      {isCurrentUser && (
                        <span className="text-text-muted ml-1">(you)</span>
                      )}
                    </span>
                    {member?.email && (
                      <p className="text-xs text-text-muted">{member.email}</p>
                    )}
                  </div>
                </div>
                {!isCurrentUser && (
                  <ConfirmButton
                    label="Remove"
                    confirmLabel={(() => {
                      const bal = Math.round((trip.cachedBalances?.[uid] ?? 0) * 100) / 100
                      if (Math.abs(bal) <= 0.01) return 'Confirm?'
                      const sc = trip.settlementCurrency ?? DEFAULT_CURRENCY
                      return `${bal > 0 ? 'Owed' : 'Owes'} ${formatMoney(Math.abs(bal), sc)} — remove?`
                    })()}
                    onConfirm={() => removeMember(uid)}
                    className="text-xs text-text-muted hover:text-danger-text px-2 py-1 rounded hover:bg-danger-bg transition-colors"
                    confirmClassName="text-xs font-medium text-danger-text bg-danger-bg px-2 py-1 rounded transition-colors"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Invite link */}
      <div className="border-t border-line pt-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-text-secondary">Invite link</label>
          {resetting ? (
            <span className="text-xs text-text-muted">Resetting…</span>
          ) : (
            <ConfirmButton
              label="Reset link"
              confirmLabel="Reset? Old links stop working"
              onConfirm={resetInviteLink}
              className="text-xs text-text-muted hover:text-danger-text px-2 py-1 rounded hover:bg-danger-bg transition-colors"
              confirmClassName="text-xs font-medium text-danger-text bg-danger-bg px-2 py-1 rounded transition-colors"
            />
          )}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            className="flex-1 border border-line rounded-lg px-3 py-2 text-sm text-text-secondary bg-muted"
          />
          <button
            onClick={copyInviteLink}
            className="border border-line rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-card-hover transition-colors shrink-0"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-text-muted mt-1">
          {justReset ? (
            <span className="text-success-text font-medium">
              Link reset — previously shared links no longer work.
            </span>
          ) : (
            "Anyone with this link can join. Reset it to revoke links you've shared before."
          )}
        </p>
      </div>

      {/* Pending invites */}
      {trip.invitedEmails && trip.invitedEmails.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <h3 className="text-sm font-medium text-text-secondary mb-2">
            Pending invites ({trip.invitedEmails.length})
          </h3>
          <div className="space-y-1">
            {trip.invitedEmails.map((e) => (
              <div
                key={e}
                className="flex items-center gap-2 text-sm text-warn-text bg-warn-bg rounded-lg px-3 py-2"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {e}
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
