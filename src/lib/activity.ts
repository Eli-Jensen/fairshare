import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import type { ActivityLogEntry } from './types'

type ActivityData = Omit<ActivityLogEntry, 'id' | 'createdAt'>

export async function writeActivity(tripId: string, entry: ActivityData): Promise<void> {
  try {
    await addDoc(collection(db, 'trips', tripId, 'activity'), {
      ...entry,
      createdAt: serverTimestamp(),
    })
  } catch {
    // Activity logging is best-effort — don't block the main operation
  }
}
