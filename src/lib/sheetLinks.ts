import { doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore'
import { db } from './firebase'

/**
 * Which spreadsheet backs up which trip, stored per user at
 * `/users/{uid}/private/sheetSync`.
 *
 * Per-user rather than on the trip doc, for three reasons: the sheet lives in
 * one person's Drive and only they can write to it, so a trip-level field would
 * be a promise the app can't keep for anyone else; the existing
 * `/users/{uid}/private/{docId}` rule already covers it, so no rules change and
 * no manual prod rules deploy; and it survives the trip being deleted, which is
 * exactly the case a restore exists for.
 */

export interface SheetLink {
  spreadsheetId: string
  spreadsheetUrl: string
  title: string
  /** Epoch millis — a plain number so it can live inside a map field. */
  lastSyncedAt: number
  /** Snapshot hash at the last successful sync; skips no-op syncs. */
  lastSyncedHash: string
  /** Formatting generation, so a bump can trigger a re-apply. */
  formatVersion: number
  /** Grid dimensions last written, to spot a structural change cheaply. */
  participantCount: number
  autoSync: boolean
}

export type SheetLinks = Record<string, SheetLink>

function linkDoc(uid: string) {
  return doc(db, 'users', uid, 'private', 'sheetSync')
}

/** All of this user's backup links. One read, and it's tiny. */
export async function loadSheetLinks(uid: string): Promise<SheetLinks> {
  try {
    const snap = await getDoc(linkDoc(uid))
    if (!snap.exists()) return {}
    return (snap.data().links ?? {}) as SheetLinks
  } catch {
    // A backup link is a convenience, never a blocker for viewing a trip
    return {}
  }
}

/**
 * Write one trip's link without touching the others.
 *
 * A dotted field path rather than setDoc, so two tabs syncing different trips
 * can't clobber each other. Safe because Firestore auto-ids never contain a dot.
 */
export async function saveSheetLink(
  uid: string,
  tripId: string,
  link: SheetLink
): Promise<void> {
  const ref = linkDoc(uid)
  try {
    await updateDoc(ref, { [`links.${tripId}`]: link })
  } catch {
    // updateDoc fails when the doc doesn't exist yet — first backup on this account
    await setDoc(ref, { links: { [tripId]: link } }, { merge: true })
  }
}

export async function removeSheetLink(uid: string, tripId: string): Promise<void> {
  await updateDoc(linkDoc(uid), { [`links.${tripId}`]: deleteField() }).catch(() => {})
}
