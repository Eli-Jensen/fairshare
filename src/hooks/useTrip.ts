import { useEffect, useRef, useState, useCallback } from 'react'
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

const PAGE_SIZE = 20
const DAY_MS = 24 * 60 * 60 * 1000

export function useTrip(tripId: string | undefined) {
  const { getProfiles } = useProfileCache()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [allExpenses, setAllExpenses] = useState<Expense[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [members, setMembers] = useState<Record<string, UserProfile>>({})
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  // When true the expense listener subscribes without a page limit, so
  // "all expenses" stays live instead of going stale after the first load
  const [allMode, setAllMode] = useState(false)
  const tripRef = useRef<Trip | null>(null)
  const allExpensesRef = useRef<Expense[] | null>(null)
  const allResolversRef = useRef<((expenses: Expense[]) => void)[]>([])

  // Trip doc listener
  useEffect(() => {
    if (!tripId) return

    const unsub = onSnapshot(
      doc(db, 'trips', tripId),
      (snap) => {
        if (snap.exists()) {
          const t = { id: snap.id, ...snap.data() } as Trip
          setTrip(t)
          tripRef.current = t
        }
      },
      (err) => {
        // Happens when access is revoked mid-session (e.g. removed member)
        console.error('useTrip trip listener error:', err)
        setLoading(false)
      }
    )

    return unsub
  }, [tripId])

  // Fire-and-forget cache update for the home-page trip cards
  function updateExpenseCache(tid: string, active: Expense[]) {
    const t = tripRef.current
    if (!t?.memberUids) return

    const total = active.reduce((s, e) => s + e.amountSettled, 0)
    const latest = active[0] ?? null
    const balances = computeBalances(active, t.memberUids)
    const newDesc = latest?.description ?? null
    const newAmount = latest?.amountSettled ?? null

    const changed =
      t.cachedExpenseCount !== active.length ||
      t.cachedTotalSpent !== total ||
      t.cachedLatestDesc !== newDesc ||
      t.cachedLatestAmount !== newAmount ||
      JSON.stringify(t.cachedBalances ?? {}) !== JSON.stringify(balances)

    if (changed) {
      updateDoc(doc(db, 'trips', tid), {
        cachedExpenseCount: active.length,
        cachedTotalSpent: total,
        cachedLatestDesc: newDesc,
        cachedLatestAmount: newAmount,
        cachedBalances: balances,
      }).catch(() => {})
    }
  }

  // Expense listener — paginated until loadAllExpenses switches to full
  useEffect(() => {
    if (!tripId) return
    setAllMode(false)
    setAllExpenses(null)
    allExpensesRef.current = null
  }, [tripId])

  useEffect(() => {
    if (!tripId) return

    const base = collection(db, 'trips', tripId, 'expenses')
    const q = allMode
      ? query(base, orderBy('createdAt', 'desc'))
      : query(base, orderBy('createdAt', 'desc'), limit(PAGE_SIZE + 1))

    return onSnapshot(q, (snap) => {
      const now = Date.now()

      const active: Expense[] = []
      const toDelete: typeof snap.docs = []
      for (const d of snap.docs) {
        const data = d.data()
        if (data.deletedAt) {
          const deletedTime = data.deletedAt.toDate?.()
          if (deletedTime && now - deletedTime.getTime() > DAY_MS) {
            toDelete.push(d)
          }
          continue
        }
        active.push(mapExpense({ id: d.id, ...data }))
      }
      if (toDelete.length > 0) {
        Promise.all(toDelete.map((d) => deleteDoc(d.ref))).catch(() => {})
      }

      if (allMode) {
        setHasMore(false)
        setExpenses(active)
        setAllExpenses(active)
        allExpensesRef.current = active
        updateExpenseCache(tripId, active)
        for (const resolve of allResolversRef.current) resolve(active)
        allResolversRef.current = []
      } else {
        const hasMoreExpenses = active.length > PAGE_SIZE
        setHasMore(hasMoreExpenses)
        setExpenses(hasMoreExpenses ? active.slice(0, PAGE_SIZE) : active)
        if (hasMoreExpenses) {
          setAllExpenses(null)
          allExpensesRef.current = null
        } else {
          setAllExpenses(active)
          allExpensesRef.current = active
          updateExpenseCache(tripId, active)
        }
      }
      setLoading(false)
    }, (err) => {
      console.error('useTrip expense listener error:', err)
      setLoading(false)
    })
  }, [tripId, allMode])

  // Resolves with the complete expense list (and keeps it live afterwards)
  const loadAllExpenses = useCallback((): Promise<Expense[]> => {
    if (allExpensesRef.current) return Promise.resolve(allExpensesRef.current)
    const promise = new Promise<Expense[]>((resolve) => {
      allResolversRef.current.push(resolve)
    })
    setAllMode(true)
    return promise
  }, [])

  // Profiles for current members plus anyone removed (their names still
  // appear in balances, exports, and the activity log). cachedBalances
  // keys cover members removed long ago whose removedMembers entry expired.
  useEffect(() => {
    if (!trip) return
    const uids = new Set(trip.memberUids)
    for (const rm of trip.removedMembers ?? []) uids.add(rm.uid)
    for (const uid of Object.keys(trip.cachedBalances ?? {})) uids.add(uid)
    getProfiles(Array.from(uids)).then(setMembers)
  }, [
    trip?.memberUids?.join(','),
    trip?.removedMembers?.length,
    Object.keys(trip?.cachedBalances ?? {}).join(','),
    getProfiles,
  ])

  // Activity log subscription
  useEffect(() => {
    if (!tripId) return

    const q = query(
      collection(db, 'trips', tripId, 'activity'),
      orderBy('createdAt', 'desc'),
      limit(50)
    )

    const WEEK_MS = 7 * DAY_MS
    const TWO_WEEKS_MS = 14 * DAY_MS

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
      if (toDelete.length > 0) {
        Promise.all(toDelete.map((d) => deleteDoc(d.ref))).catch(() => {})
      }
    }, (err) => {
      console.error('useTrip activity listener error:', err)
    })
  }, [tripId])

  return { trip, expenses, allExpenses, hasMore, loadAllExpenses, members, activityLog, loading }
}
