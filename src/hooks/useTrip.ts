import { useEffect, useRef, useState } from 'react'
import {
  doc,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Trip, Expense, UserProfile, ActivityLogEntry } from '../lib/types'
import { mapExpense } from '../lib/types'
import { useProfileCache } from './useProfileCache'
import { computeBalances } from '../lib/settlement'

export function useTrip(tripId: string | undefined) {
  const { getProfiles } = useProfileCache()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [members, setMembers] = useState<Record<string, UserProfile>>({})
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const tripRef = useRef<Trip | null>(null)

  useEffect(() => {
    if (!tripId) return

    const unsub = onSnapshot(doc(db, 'trips', tripId), (snap) => {
      if (snap.exists()) {
        const t = { id: snap.id, ...snap.data() } as Trip
        setTrip(t)
        tripRef.current = t
      }
    })

    return unsub
  }, [tripId])

  useEffect(() => {
    if (!tripId) return

    const q = query(
      collection(db, 'trips', tripId, 'expenses'),
      orderBy('createdAt', 'desc')
    )

    return onSnapshot(q, (snap) => {
      const now = Date.now()
      const DAY_MS = 24 * 60 * 60 * 1000

      const active: Expense[] = []
      for (const d of snap.docs) {
        const data = d.data()
        if (data.deletedAt) {
          // Permanently delete expenses soft-deleted more than 24h ago
          const deletedTime = data.deletedAt.toDate?.()
          if (deletedTime && now - deletedTime.getTime() > DAY_MS) {
            deleteDoc(d.ref)
          }
          continue // Skip soft-deleted expenses
        }
        active.push(mapExpense({ id: d.id, ...data }))
      }

      setExpenses(active)
      setLoading(false)

      // Fire-and-forget: update denormalized summary on the trip doc
      // so TripCard on the home page doesn't need its own expense listener
      const memberUids = tripRef.current?.memberUids
      if (memberUids) {
        const total = active.reduce((s, e) => s + e.amountSettled, 0)
        const latest = active[0] ?? null
        const balances = computeBalances(active, memberUids)
        updateDoc(doc(db, 'trips', tripId), {
          cachedExpenseCount: active.length,
          cachedTotalSpent: total,
          cachedLatestDesc: latest?.description ?? null,
          cachedLatestAmount: latest?.amountSettled ?? null,
          cachedBalances: balances,
        }).catch(() => {}) // silently ignore (permission errors, etc.)
      }
    })
  }, [tripId])

  useEffect(() => {
    if (!trip) return
    getProfiles(trip.memberUids).then(setMembers)
  }, [trip?.memberUids?.join(','), getProfiles])

  // Activity log subscription
  useEffect(() => {
    if (!tripId) return

    const q = query(
      collection(db, 'trips', tripId, 'activity'),
      orderBy('createdAt', 'desc'),
      limit(50)
    )

    const WEEK_MS = 7 * 24 * 60 * 60 * 1000
    const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000

    return onSnapshot(q, (snap) => {
      const now = Date.now()
      const active: ActivityLogEntry[] = []

      for (const d of snap.docs) {
        const data = d.data()
        const createdTime = data.createdAt?.toDate?.()
        if (createdTime) {
          const age = now - createdTime.getTime()
          const isSettlement = data.action === 'settlement_recorded'
          const maxAge = isSettlement ? TWO_WEEKS_MS : WEEK_MS
          if (age > maxAge) {
            deleteDoc(d.ref)
            continue
          }
        }
        active.push({ id: d.id, ...data } as ActivityLogEntry)
      }

      setActivityLog(active)
    })
  }, [tripId])

  return { trip, expenses, members, activityLog, loading }
}
