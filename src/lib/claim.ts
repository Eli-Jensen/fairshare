import {
  doc,
  collection,
  getDocs,
  runTransaction,
  updateDoc,
  writeBatch,
  deleteField,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Trip } from './types'
import { remapExpenseRefs, type ExpenseRefs } from './placeholders'

const BATCH_LIMIT = 400 // Firestore caps a batch at 500 writes

/**
 * Called right after a user joins a trip (so they're a member and rules allow
 * trip writes). Atomically detaches any placeholder whose email matches the
 * joiner and records the claim for the reconciler. Returns true if anything
 * was claimed. The expense rewrite is deferred to reconcilePlaceholderClaims.
 */
export async function claimPlaceholdersOnJoin(
  tripId: string,
  uid: string,
  email?: string | null,
): Promise<boolean> {
  if (!email) return false
  const lower = email.toLowerCase()
  const tripRef = doc(db, 'trips', tripId)
  let claimed = false

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(tripRef)
    if (!snap.exists()) return
    const trip = snap.data() as Trip
    const placeholders = trip.placeholderMembers ?? []
    const matching = placeholders.filter((p) => p.email?.toLowerCase() === lower)
    if (matching.length === 0) return

    const matchedIds = new Set(matching.map((m) => m.id))
    const remaining = placeholders.filter((p) => !matchedIds.has(p.id))
    const claims = { ...(trip.placeholderClaims ?? {}) }
    for (const id of matchedIds) claims[id] = uid

    tx.update(tripRef, { placeholderMembers: remaining, placeholderClaims: claims })
    claimed = true
  }).catch(() => { /* best-effort; reconciler can also be re-triggered */ })

  return claimed
}

/**
 * Rewrites every expense + activity reference from each claimed placeholder id
 * to the real uid, then clears those claims. Idempotent and safe to run from
 * any member's device (and repeatedly) — interrupted merges finish on the next
 * trip load. Fetches its own docs so it doesn't depend on UI pagination.
 */
export async function reconcilePlaceholderClaims(
  tripId: string,
  claims: Record<string, string>,
): Promise<void> {
  const entries = Object.entries(claims)
  if (entries.length === 0) return

  // Include soft-deleted expenses so restored history stays consistent.
  const [expSnap, actSnap] = await Promise.all([
    getDocs(collection(db, 'trips', tripId, 'expenses')),
    getDocs(collection(db, 'trips', tripId, 'activity')),
  ])

  let batch = writeBatch(db)
  let ops = 0
  const bump = async () => {
    if (++ops >= BATCH_LIMIT) {
      await batch.commit()
      batch = writeBatch(db)
      ops = 0
    }
  }

  for (const [fromId, toId] of entries) {
    for (const d of expSnap.docs) {
      const update = remapExpenseRefs(d.data() as ExpenseRefs, fromId, toId)
      if (update) {
        batch.update(d.ref, update)
        await bump()
      }
    }
    for (const d of actSnap.docs) {
      const data = d.data()
      const u: Record<string, string> = {}
      if (data.targetMemberUid === fromId) u.targetMemberUid = toId
      if (data.targetPayeeUid === fromId) u.targetPayeeUid = toId
      if (Object.keys(u).length > 0) {
        batch.update(d.ref, u)
        await bump()
      }
    }
  }
  if (ops > 0) await batch.commit()

  // Clear only the claims we processed (ph_ ids have no dots → safe field paths),
  // so a claim that arrived concurrently isn't dropped.
  const clear: Record<string, ReturnType<typeof deleteField>> = {}
  for (const [fromId] of entries) clear[`placeholderClaims.${fromId}`] = deleteField()
  await updateDoc(doc(db, 'trips', tripId), clear)
}
