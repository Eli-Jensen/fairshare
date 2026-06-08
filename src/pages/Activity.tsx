import { useEffect, useState } from 'react'
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useProfileCache } from '../hooks/useProfileCache'
import { formatMoney, getMemberName, tripLabel } from '../lib/types'
import type { ActivityLogEntry, UserProfile, Trip } from '../lib/types'
import { MemberAvatar } from '../components/MemberAvatar'

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

export function Activity() {
  const { user } = useAuth()
  const { getProfiles } = useProfileCache()
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [members, setMembers] = useState<Record<string, UserProfile>>({})
  const [loading, setLoading] = useState(true)

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

      // Collect all member UIDs for profile loading
      const allUids = new Set<string>()
      for (const trip of trips) {
        for (const uid of trip.memberUids) allUids.add(uid)
      }
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
                return (
                  <a
                    key={entry.id}
                    href={`/trip/${entry.tripId}`}
                    className="flex items-start gap-2.5 py-2.5 px-3 -mx-3 rounded-lg hover:bg-card-hover transition-colors"
                  >
                    <MemberAvatar member={members[entry.actorUid]} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${isSettlement ? 'text-text font-medium' : 'text-text-secondary'}`}>
                        {describeAction(entry, members, 'USD')}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-sm text-accent-text">
                          {entry.tripName}
                        </span>
                        {time && (
                          <span className="text-sm text-text-muted">{relativeTime(time)}</span>
                        )}
                      </div>
                    </div>
                  </a>
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
