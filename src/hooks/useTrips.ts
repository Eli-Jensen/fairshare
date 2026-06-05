import { useEffect, useState } from 'react'
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from './useAuth'
import type { Trip } from '../lib/types'

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
      setTrips(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Trip))
      setLoading(false)
    })
  }, [user])

  return { trips, loading }
}
