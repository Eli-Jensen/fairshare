import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useProfileCache } from '../hooks/useProfileCache'
import { formatMoney, getMemberName, tripLabel, DEFAULT_CURRENCY } from '../lib/types'
import { getUndoAction, executeUndo } from '../lib/activityUndo'
import type { UndoAction } from '../lib/activityUndo'
import type { ActivityLogEntry, UserProfile, Trip } from '../lib/types'
import { MemberAvatar } from '../components/MemberAvatar'
import {
  getActivitySeenTimestamp,
  setActivitySeenTimestamp,
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
    case 'member_removed': {
      const removed = entry.targetMemberUid
        ? getMemberName(entry.targetMemberUid, members)
        : entry.targetDescription ?? 'someone'
      return `${actor} removed ${removed}`
    }
    case 'trip_created':
      return `${actor} created this ${tripLabel(undefined)}`
    case 'trip_renamed':
      return `${actor} renamed to "${desc}"`
    case 'trip_deleted':
      return `${actor} deleted`
    case 'trip_restored':
      return `${actor} restored`
    case 'currency_changed':
      return `${actor} changed currency (${desc})`
    case 'member_invited':
      return `${actor} invited ${desc}`
    case 'placeholder_added':
      return `${actor} added ${desc} as a guest`
    case 'placeholder_removed':
      return `${actor} removed guest ${desc}`
    case 'expense_restored':
      return `${actor} restored ${desc}${amt ? ` (${amt})` : ''}`
    case 'comment_added':
      return `${actor} commented on ${desc}`
    default:
      return `${actor} performed an action`
  }
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
  // Per-trip cache keyed on lastActivityAt — the trips listener fires on
  // every trip-doc change (cache writes included), so only refetch the
  // activity of trips whose stamp actually moved
  const activityCache = useRef<Record<string, { stamp: number; entries: ActivityLogEntry[] }>>({})

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

    let cancelled = false

    const unsubTrips = onSnapshot(tripsQ, async (tripSnap) => {
      // Keep soft-deleted trips in the list so their "trip deleted" event
      // still surfaces here (and stays restorable). They fall off for good
      // once purged ~24h later. Their other history is filtered out below.
      const trips = tripSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Trip)

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

      // One-time reads for activity entries (no persistent per-trip listeners)
      const allEntries: ActivityLogEntry[] = []
      await Promise.all(trips.map(async (trip) => {
        // A deleted trip contributes only its "trip deleted" event — its
        // other history would just be noise in the global feed.
        const isDeleted = !!trip.deletedAt
        const displayName = isDeleted ? `${trip.name} (deleted)` : trip.name
        const stamp = trip.lastActivityAt?.toMillis?.() ?? 0
        const cached = activityCache.current[trip.id]
        if (cached && cached.stamp === stamp) {
          for (const e of cached.entries) {
            allEntries.push({ ...e, tripName: displayName })
          }
          return
        }
        const actQ = query(
          collection(db, 'trips', trip.id, 'activity'),
          orderBy('createdAt', 'desc'),
          limit(MAX_ENTRIES_PER_TRIP),
        )
        const actSnap = await getDocs(actQ)
        const tripEntries = actSnap.docs
          .map((d) => ({
            id: d.id,
            ...d.data(),
            tripId: trip.id,
            tripName: displayName,
          } as ActivityLogEntry))
          .filter((e) => !isDeleted || e.action === 'trip_deleted')
        activityCache.current[trip.id] = { stamp, entries: tripEntries }
        allEntries.push(...tripEntries)
      }))

      if (cancelled) return

      allEntries.sort((a, b) => {
        const aTime = a.createdAt?.toDate?.()?.getTime() ?? 0
        const bTime = b.createdAt?.toDate?.()?.getTime() ?? 0
        return bTime - aTime
      })
      setEntries(allEntries)
      setLoading(false)
    })

    return () => {
      cancelled = true
      unsubTrips()
    }
  }, [user?.uid])

  async function handleUndo(entry: ActivityLogEntry, undoAction: UndoAction) {
    if (!entry.tripId) return

    setLoadingId(entry.id)
    try {
      await executeUndo(entry, entry.tripId, undoAction, user?.uid)
      setUndoneIds((prev) => new Set(prev).add(entry.id))
    } catch {
      // Silently fail — target may already be changed
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
            <div className="space-y-1 max-w-lg mx-auto">
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
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link to={`/trip/${entry.tripId}`} className="min-w-0">
                          <p className={`text-sm ${isSettlement ? 'text-text font-medium' : 'text-text-secondary'}`}>
                            {isUndone
                              ? <span className="italic">Undone</span>
                              : describeAction(entry, members, tripCurrencies[entry.tripId!] ?? DEFAULT_CURRENCY)
                            }
                          </p>
                        </Link>
                        {undoAction && !isUndone && (
                          <button
                            onClick={(e) => { e.preventDefault(); handleUndo(entry, undoAction) }}
                            disabled={isUndoLoading}
                            className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-accent-text hover:bg-accent-soft disabled:opacity-50 transition-colors"
                          >
                            {isUndoLoading ? (
                              <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <>
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
                                </svg>
                                {undoAction === 'restore' || undoAction === 'restore-trip' ? 'Restore' : 'Undo'}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      {!isUndone && entry.editDetails && entry.editDetails.length > 0 && (
                        <div className="mt-0.5 space-y-0.5">
                          {entry.editDetails.map((detail, j) => (
                            <p key={j} className="text-sm text-text-muted">
                              {detail}
                            </p>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        <Link to={`/trip/${entry.tripId}`} className="text-sm text-accent-text">
                          {entry.tripName}
                        </Link>
                        {time && (
                          <span className="text-sm text-text-muted">{relativeTime(time)}</span>
                        )}
                      </div>
                    </div>
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
