import { useEffect, useState } from 'react'
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  deleteDoc,
  getDocs,
  doc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from './useAuth'
import type { Trip } from '../lib/types'

const DAY_MS = 24 * 60 * 60 * 1000

export function useTrips() {
  const { user } = useAuth()
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setTrips([])
      setLoading(false)
      return
    }

    const q = query(
      collection(db, 'trips'),
      where('memberUids', 'array-contains', user.uid),
      orderBy('createdAt', 'desc')
    )

    return onSnapshot(q, (snap) => {
      const now = Date.now()
      const active: Trip[] = []

      for (const d of snap.docs) {
        const data = d.data()

        if (data.deletedAt) {
          // Permanently delete trips soft-deleted more than 24h ago
          const deletedTime = data.deletedAt.toDate?.()
          if (deletedTime && now - deletedTime.getTime() > DAY_MS) {
            purgeTrip(d.id)
          }
          continue // Skip soft-deleted trips
        }

        active.push({ id: d.id, ...data } as Trip)
      }

      setTrips(active)
      setLoading(false)
    })
  }, [user?.uid])

  return { trips, loading }
}

/** Permanently delete a trip and all its expenses */
async function purgeTrip(tripId: string) {
  try {
    const expSnap = await getDocs(collection(db, 'trips', tripId, 'expenses'))
    for (const expDoc of expSnap.docs) {
      await deleteDoc(expDoc.ref)
    }
    await deleteDoc(doc(db, 'trips', tripId))
  } catch {
    // Silently fail — will retry next load
  }
}
