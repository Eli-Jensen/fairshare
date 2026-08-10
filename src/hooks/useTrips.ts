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
import { purgeTripReceipts } from '../lib/image'
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

    setLoading(true)

    const q = query(
      collection(db, 'trips'),
      where('memberUids', 'array-contains', user.uid),
      orderBy('createdAt', 'desc')
    )

    const purged = new Set<string>()

    return onSnapshot(q, (snap) => {
      const now = Date.now()
      const active: Trip[] = []

      for (const d of snap.docs) {
        const data = d.data()

        if (data.deletedAt) {
          const deletedTime = data.deletedAt.toDate?.()
          if (deletedTime && now - deletedTime.getTime() > DAY_MS && !purged.has(d.id)) {
            purged.add(d.id)
            purgeTrip(d.id, data.inviteCode)
          }
          continue
        }

        active.push({ id: d.id, ...data } as Trip)
      }

      setTrips(active)
      setLoading(false)
    }, (err) => {
      console.error('useTrips listener error:', err)
      setLoading(false)
    })
  }, [user?.uid])

  return { trips, loading }
}

/** Permanently delete a trip, its storage objects, its subcollections, and
 *  its invite-code doc. Must run while the caller is still a member (rules
 *  gate every delete on membership, checked against the trip doc — so the
 *  trip doc goes last). STORAGE GOES FIRST for the same reason in reverse:
 *  storage.rules also firestore.get() the trip doc, and once that doc is
 *  gone any surviving objects are permanently undeletable by any client.
 *  The sweep is best-effort and time-boxed (see purgeTripReceipts) so a
 *  bad bucket can never stall the purge chain. */
export async function purgeTrip(tripId: string, inviteCode?: string) {
  try {
    const [expSnap, actSnap] = await Promise.all([
      getDocs(collection(db, 'trips', tripId, 'expenses')),
      getDocs(collection(db, 'trips', tripId, 'activity')),
    ])
    const receiptPaths = expSnap.docs.flatMap(
      (d) => (d.data().receiptPaths as string[] | undefined) ?? []
    )
    await purgeTripReceipts(tripId, receiptPaths)
    await Promise.all([
      ...expSnap.docs.map((d) => deleteDoc(d.ref)),
      ...actSnap.docs.map((d) => deleteDoc(d.ref)),
    ])
    if (inviteCode) {
      // Legacy trips may have no code doc; deleting one is best-effort
      await deleteDoc(doc(db, 'inviteCodes', inviteCode)).catch(() => {})
    }
    await deleteDoc(doc(db, 'trips', tripId))
  } catch {
    // Silently fail — will retry next load
  }
}
