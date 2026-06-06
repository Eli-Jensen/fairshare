import { useEffect, useState } from 'react'
import {
  doc,
  collection,
  onSnapshot,
  query,
  orderBy,
  getDoc,
  deleteDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Trip, Expense, UserProfile } from '../lib/types'

export function useTrip(tripId: string | undefined) {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [members, setMembers] = useState<Record<string, UserProfile>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tripId) return

    const unsub = onSnapshot(doc(db, 'trips', tripId), (snap) => {
      if (snap.exists()) {
        setTrip({ id: snap.id, ...snap.data() } as Trip)
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
        active.push({ id: d.id, ...data } as Expense)
      }

      setExpenses(active)
      setLoading(false)
    })
  }, [tripId])

  useEffect(() => {
    if (!trip) return
    const load = async () => {
      const profiles: Record<string, UserProfile> = {}
      for (const uid of trip.memberUids) {
        const snap = await getDoc(doc(db, 'users', uid))
        if (snap.exists()) {
          profiles[uid] = snap.data() as UserProfile
        }
      }
      setMembers(profiles)
    }
    load()
  }, [trip?.memberUids?.join(',')])

  return { trip, expenses, members, loading }
}
