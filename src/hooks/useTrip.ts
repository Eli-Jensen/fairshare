import { useEffect, useRef, useState, useCallback } from 'react'
import {
  doc,
  collection,
  onSnapshot,
  getDocs,
  query,
  orderBy,
  limit,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Trip, Expense, UserProfile, ActivityLogEntry } from '../lib/types'
import { mapExpense, getExpenseCategories } from '../lib/types'
import { useProfileCache } from './useProfileCache'
import { computeBalances } from '../lib/settlement'

const PAGE_SIZE = 20

export function useTrip(tripId: string | undefined) {
  const { getProfiles } = useProfileCache()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [allExpenses, setAllExpenses] = useState<Expense[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [members, setMembers] = useState<Record<string, UserProfile>>({})
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const tripRef = useRef<Trip | null>(null)
  const allLoadedRef = useRef(false)

  // Trip doc listener
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

  // Paginated expense listener — only reads the most recent PAGE_SIZE
  useEffect(() => {
    if (!tripId) return
    allLoadedRef.current = false
    setAllExpenses(null)

    const q = query(
      collection(db, 'trips', tripId, 'expenses'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE + 1) // +1 to detect if there are more
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
          continue
        }
        active.push(mapExpense({ id: d.id, ...data }))
      }
      if (toDelete.length > 0) {
        Promise.all(toDelete.map((d) => deleteDoc(d.ref))).catch(() => {})
      }

      // If we got more than PAGE_SIZE active, there are more to load
      const hasMoreExpenses = active.length > PAGE_SIZE
      setHasMore(hasMoreExpenses)
      setExpenses(hasMoreExpenses ? active.slice(0, PAGE_SIZE) : active)
      setLoading(false)

      // If all expenses fit in one page, update the cache directly
      if (!hasMoreExpenses) {
        allLoadedRef.current = true
        setAllExpenses(active)
        updateExpenseCache(tripId, active)
      }
    })
  }, [tripId])

  // Load ALL expenses — called when Settle Up tab needs full data
  const loadAllExpenses = useCallback(async () => {
    if (!tripId || allLoadedRef.current) return
    const q = query(
      collection(db, 'trips', tripId, 'expenses'),
      orderBy('createdAt', 'desc')
    )
    const snap = await getDocs(q)
    const active: Expense[] = []
    for (const d of snap.docs) {
      if (!d.data().deletedAt) {
        active.push(mapExpense({ id: d.id, ...d.data() }))
      }
    }
    allLoadedRef.current = true
    setAllExpenses(active)
    setExpenses(active) // show all in the list too
    setHasMore(false)
    updateExpenseCache(tripId, active)
  }, [tripId])

  // Fire-and-forget cache update
  function updateExpenseCache(tid: string, active: Expense[]) {
    const t = tripRef.current
    if (!t?.memberUids) return

    const total = active.reduce((s, e) => s + e.amountSettled, 0)
    const latest = active[0] ?? null
    const balances = computeBalances(active, t.memberUids)
    const newDesc = latest?.description ?? null
    const newAmount = latest?.amountSettled ?? null

    // Per-member spending (excluding settlements)
    const spending: Record<string, number> = {}
    for (const uid of t.memberUids) spending[uid] = 0
    for (const exp of active) {
      if (exp.isSettlement) continue
      if (exp.paidByAmounts && Object.keys(exp.paidByAmounts).length > 0) {
        for (const [uid, amt] of Object.entries(exp.paidByAmounts)) {
          spending[uid] = (spending[uid] ?? 0) + amt
        }
      } else {
        spending[exp.paidBy] = (spending[exp.paidBy] ?? 0) + exp.amountSettled
      }
    }

    // Per-category totals
    const catTotals: Record<string, number> = {}
    for (const exp of active) {
      if (exp.isSettlement) continue
      const cats = getExpenseCategories(exp)
      if (cats.length === 0) {
        catTotals['uncategorized'] = (catTotals['uncategorized'] ?? 0) + exp.amountSettled
      } else {
        for (const cat of cats) {
          catTotals[cat] = (catTotals[cat] ?? 0) + exp.amountSettled
        }
      }
    }

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
        cachedMemberSpending: spending,
        cachedCategoryTotals: catTotals,
      }).catch(() => {})
    }
  }

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
      if (toDelete.length > 0) {
        Promise.all(toDelete.map((d) => deleteDoc(d.ref))).catch(() => {})
      }
    })
  }, [tripId])

  return { trip, expenses, allExpenses, hasMore, loadAllExpenses, members, activityLog, loading }
}
