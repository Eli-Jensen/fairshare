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
      const toDelete: typeof snap.docs = []
      for (const d of snap.docs) {
        const data = d.data()
        if (data.deletedAt) {
          const deletedTime = data.deletedAt.toDate?.()
          if (deletedTime && now - deletedTime.getTime() > DAY_MS) {
            toDelete.push(d)
          }
          continue // Skip soft-deleted expenses
        }
        active.push(mapExpense({ id: d.id, ...data }))
      }
      // Clean up expired soft-deletes after processing (fire-and-forget)
      if (toDelete.length > 0) {
        Promise.all(toDelete.map((d) => deleteDoc(d.ref))).catch(() => {})
      }

      setExpenses(active)
      setLoading(false)

      // Fire-and-forget: update denormalized summary on the trip doc
      // so TripCard on the home page doesn't need its own expense listener
      const t = tripRef.current
      if (t?.memberUids) {
        const total = active.reduce((s, e) => s + e.amountSettled, 0)
        const latest = active[0] ?? null
        const balances = computeBalances(active, t.memberUids)
        const newDesc = latest?.description ?? null
        const newAmount = latest?.amountSettled ?? null

        // Only write if something actually changed (avoid wasting writes)
        const changed =
          t.cachedExpenseCount !== active.length ||
          t.cachedTotalSpent !== total ||
          t.cachedLatestDesc !== newDesc ||
          t.cachedLatestAmount !== newAmount ||
          JSON.stringify(t.cachedBalances ?? {}) !== JSON.stringify(balances)

        if (changed) {
          updateDoc(doc(db, 'trips', tripId), {
            cachedExpenseCount: active.length,
            cachedTotalSpent: total,
            cachedLatestDesc: newDesc,
            cachedLatestAmount: newAmount,
            cachedBalances: balances,
          }).catch(() => {})
        }
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
      const toDelete: typeof snap.docs = []

      for (const d of snap.docs) {
        const data = d.data()
        const createdTime = data.createdAt?.toDate?.()
        if (createdTime) {
          const age = now - createdTime.getTime()
          const isSettlement = data.action === 'settlement_recorded'
          const maxAge = isSettlement ? TWO_WEEKS_MS : WEEK_MS
          if (age > maxAge) {
            toDelete.push(d)
            continue
          }
        }
        active.push({ id: d.id, ...data } as ActivityLogEntry)
      }

      setActivityLog(active)
      // Clean up expired entries after processing (fire-and-forget)
      if (toDelete.length > 0) {
        Promise.all(toDelete.map((d) => deleteDoc(d.ref))).catch(() => {})
      }
    })
  }, [tripId])

  return { trip, expenses, members, activityLog, loading }
}
