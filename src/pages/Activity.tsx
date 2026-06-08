import { useEffect, useState } from 'react'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useProfileCache } from '../hooks/useProfileCache'
import { formatMoney, getMemberName, tripLabel, DEFAULT_CURRENCY } from '../lib/types'
import type { ActivityLogEntry, UserProfile, Trip } from '../lib/types'
import { MemberAvatar } from '../components/MemberAvatar'
import {
  getActivitySeenTimestamp,
  setActivitySeenTimestamp,
  setActivityLatestTimestamp,
} from '../lib/activityNotification'

const MAX_ENTRIES_PER_TRIP = 20

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

function describeAction(
  entry: ActivityLogEntry,
  members: Record<string, UserProfile>,
  sc: string,
): string {
  const actor = getMemberName(entry.actorUid, members)
  const desc = entry.targetDescription ?? ''
  const amt = entry.targetAmount ? formatMoney(entry.targetAmount, sc) : ''

  switch (entry.action) {
    case 'expense_added':
      return `${actor} added ${desc} (${amt})`
    case 'expense_edited':
      return `${actor} edited ${desc} (${amt})`
    case 'expense_deleted':
      return `${actor} deleted ${desc} (${amt})`
    case 'settlement_recorded': {
      const payee = entry.targetPayeeUid
        ? getMemberName(entry.targetPayeeUid, members)
        : desc.split(' → ')[1] ?? ''
      const method = entry.paymentMethod ? ` via ${entry.paymentMethod}` : ''
      return `${actor} paid ${payee} ${amt}${method}`
    }
    case 'member_joined':
      return `${actor} joined`
    case 'member_left':
      return `${actor} left`
    case 'member_removed':
      return `${actor} was removed`
    case 'trip_created':
      return `${actor} created this ${tripLabel(undefined)}`
    default:
      return `${actor} performed an action`
  }
}

/** Which actions can be undone, and what the undo does */
function getUndoAction(entry: ActivityLogEntry): 'soft-delete' | 'restore' | null {
  if (!entry.targetExpenseId || !entry.tripId) return null
  if (entry.action === 'expense_added' || entry.action === 'settlement_recorded') return 'soft-delete'
  if (entry.action === 'expense_deleted') return 'restore'
  return null
}

export function Activity() {
  const { user } = useAuth()
  const { getProfiles } = useProfileCache()
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [members, setMembers] = useState<Record<string, UserProfile>>({})
  const [loading, setLoading] = useState(true)
  const [seenTimestamp, setSeenTimestamp] = useState(0)
  const [undoneIds, setUndoneIds] = useState<Set<string>>(new Set())
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [tripCurrencies, setTripCurrencies] = useState<Record<string, string>>({})

  // Read the old "seen" timestamp for highlighting, then mark as seen now
  useEffect(() => {
    if (!user?.uid) return
    const seen = getActivitySeenTimestamp(user.uid)
    setSeenTimestamp(seen)
    setActivitySeenTimestamp(user.uid, Date.now())
    return () => {
      // Update again on unmount to catch entries that arrived while viewing
      setActivitySeenTimestamp(user.uid, Date.now())
    }
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return

    // Step 1: listen to all trips the user is in
    const tripsQ = query(
      collection(db, 'trips'),
      where('memberUids', 'array-contains', user.uid),
    )

    let activityUnsubs: (() => void)[] = []
    const entriesByTrip = new Map<string, ActivityLogEntry[]>()

    const unsubTrips = onSnapshot(tripsQ, (tripSnap) => {
      // Clean up old activity listeners
      activityUnsubs.forEach((u) => u())
      activityUnsubs = []
      entriesByTrip.clear()

      const trips = tripSnap.docs
        .filter((d) => !d.data().deletedAt)
        .map((d) => ({ id: d.id, ...d.data() }) as Trip)

      if (trips.length === 0) {
        setEntries([])
        setLoading(false)
        return
      }

      // Collect all member UIDs and settlement currencies
      const allUids = new Set<string>()
      const currencies: Record<string, string> = {}
      for (const trip of trips) {
        for (const uid of trip.memberUids) allUids.add(uid)
        currencies[trip.id] = trip.settlementCurrency ?? DEFAULT_CURRENCY
      }
      setTripCurrencies(currencies)
      getProfiles(Array.from(allUids)).then(setMembers)

      let loadedCount = 0

      // Step 2: listen to activity for each trip
      for (const trip of trips) {
        const actQ = query(
          collection(db, 'trips', trip.id, 'activity'),
          orderBy('createdAt', 'desc'),
          limit(MAX_ENTRIES_PER_TRIP),
        )

        const unsub = onSnapshot(actQ, (actSnap) => {
          const tripEntries: ActivityLogEntry[] = actSnap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            tripId: trip.id,
            tripName: trip.name,
          }) as ActivityLogEntry)

          entriesByTrip.set(trip.id, tripEntries)

          // Merge and sort all entries
          const all = Array.from(entriesByTrip.values())
            .flat()
            .sort((a, b) => {
              const aTime = a.createdAt?.toDate?.()?.getTime() ?? 0
              const bTime = b.createdAt?.toDate?.()?.getTime() ?? 0
              return bTime - aTime
            })
          setEntries(all)

          // Update latest timestamp for notification dot
          if (all.length > 0 && user?.uid) {
            const latestTime = all[0].createdAt?.toDate?.()?.getTime() ?? 0
            if (latestTime > 0) {
              setActivityLatestTimestamp(user.uid, latestTime)
            }
          }

          loadedCount++
          if (loadedCount >= trips.length) setLoading(false)
        })

        activityUnsubs.push(unsub)
      }
    })

    return () => {
      unsubTrips()
      activityUnsubs.forEach((u) => u())
    }
  }, [user?.uid])

  async function handleUndo(entry: ActivityLogEntry, undoAction: 'soft-delete' | 'restore') {
    if (!entry.tripId || !entry.targetExpenseId) return

    setLoadingId(entry.id)
    try {
      const expenseRef = doc(db, 'trips', entry.tripId, 'expenses', entry.targetExpenseId)
      if (undoAction === 'soft-delete') {
        await updateDoc(expenseRef, { deletedAt: serverTimestamp() })
      } else {
        await updateDoc(expenseRef, { deletedAt: deleteField() })
      }
      setUndoneIds((prev) => new Set(prev).add(entry.id))
    } catch {
      // Silently fail — expense may already be deleted
    }
    setLoadingId(null)
  }

  if (loading) {
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  if (entries.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-text mb-6">Activity</h1>
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-text-secondary">No activity yet</p>
        </div>
      </div>
    )
  }

  // Group entries by date
  const grouped: { label: string; entries: ActivityLogEntry[] }[] = []
  let currentLabel = ''
  for (const entry of entries) {
    const date = entry.createdAt?.toDate?.()
    if (!date) continue
    const label = formatDateLabel(date)
    if (label !== currentLabel) {
      currentLabel = label
      grouped.push({ label, entries: [] })
    }
    grouped[grouped.length - 1].entries.push(entry)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text mb-6">Activity</h1>
      <div className="space-y-6">
        {grouped.map((group) => (
          <div key={group.label}>
            <h2 className="text-sm font-medium text-text-muted uppercase tracking-wide mb-2">
              {group.label}
            </h2>
            <div className="space-y-1">
              {group.entries.map((entry) => {
                const time = entry.createdAt?.toDate?.()
                const isSettlement = entry.action === 'settlement_recorded'
                const entryTime = time?.getTime() ?? 0
                const isNew = seenTimestamp > 0 && entryTime > seenTimestamp
                const undoAction = getUndoAction(entry)
                const isUndone = undoneIds.has(entry.id)
                const isUndoLoading = loadingId === entry.id
                return (
                  <div
                    key={entry.id}
                    className={`flex items-start gap-2.5 py-2.5 px-3 -mx-3 rounded-lg transition-colors group ${
                      isUndone ? 'opacity-50' : ''
                    } ${
                      isSettlement
                        ? 'bg-accent-soft'
                        : ''
                    } ${isNew ? 'animate-highlight' : ''}`}
                  >
                    {isSettlement && entry.targetPayeeUid ? (
                      <div className="relative w-9 h-6 shrink-0">
                        <div className="absolute top-0 left-0 z-10 ring-2 ring-card rounded-full">
                          <MemberAvatar member={members[entry.actorUid]} size="sm" />
                        </div>
                        <div className="absolute top-0 left-3 z-0">
                          <MemberAvatar member={members[entry.targetPayeeUid]} size="sm" />
                        </div>
                      </div>
                    ) : (
                      <MemberAvatar member={members[entry.actorUid]} size="sm" />
                    )}
                    <a
                      href={`/trip/${entry.tripId}`}
                      className="flex-1 min-w-0"
                    >
                      <p className={`text-sm ${isSettlement ? 'text-text font-medium' : 'text-text-secondary'}`}>
                        {isUndone
                          ? <span className="italic">Undone</span>
                          : describeAction(entry, members, tripCurrencies[entry.tripId!] ?? DEFAULT_CURRENCY)
                        }
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-sm text-accent-text">
                          {entry.tripName}
                        </span>
                        {time && (
                          <span className="text-sm text-text-muted">{relativeTime(time)}</span>
                        )}
                      </div>
                    </a>
                    {undoAction && !isUndone && (
                      <button
                        onClick={() => handleUndo(entry, undoAction)}
                        disabled={isUndoLoading}
                        className="shrink-0 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100 transition-opacity px-2 py-1 rounded-md text-xs font-medium text-text-muted hover:text-text-secondary hover:bg-muted disabled:opacity-50 self-center"
                        title={undoAction === 'restore' ? 'Restore' : 'Undo'}
                      >
                        {isUndoLoading ? (
                          <span className="inline-block w-3.5 h-3.5 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatDateLabel(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const entryDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.floor((today.getTime() - entryDate.getTime()) / (24 * 60 * 60 * 1000))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' })
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}
