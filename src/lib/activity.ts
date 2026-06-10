import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { ActivityLogEntry } from './types'

type ActivityData = Omit<ActivityLogEntry, 'id' | 'createdAt'>

export async function writeActivity(tripId: string, entry: ActivityData): Promise<void> {
  try {
    await addDoc(collection(db, 'trips', tripId, 'activity'), {
      ...entry,
      createdAt: serverTimestamp(),
    })
    // Powers the unseen-activity dot and lets the global feed skip
    // refetching trips with no new activity
    updateDoc(doc(db, 'trips', tripId), {
      lastActivityAt: serverTimestamp(),
      lastActivityBy: entry.actorUid,
    }).catch(() => {})
  } catch {
    // Activity logging is best-effort — don't block the main operation
  }
}
