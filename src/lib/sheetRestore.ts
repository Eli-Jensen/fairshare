import {
  Timestamp,
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import type { PlaceholderMember } from './types'
import { FIRESTORE_AMOUNT_FIELD } from './types'
import { parseDateString } from './dates'
import { generatePlaceholderId } from './placeholders'
import { generateInviteCode } from './invite'
import { writeActivity } from './activity'
import { MAX_RESTORE_EXPENSES } from './limits'
import type { SheetPerson, SheetSnapshot } from './sheetSnapshot'
import { payerFields } from './sheetParse'

/**
 * Turns a parsed backup into a real trip.
 *
 * A restore always creates a NEW trip owned by whoever is restoring. It cannot
 * recreate the original one: Firestore rules only allow a trip to be created
 * with `memberUids == [you]`, and re-adding other people's accounts without
 * their say-so would be wrong even if the rules allowed it. So everyone else
 * comes back as a `ph_` placeholder — a real participant who owes and is owed,
 * displayed by email — and the existing claim-on-join flow reattaches their
 * history to their account the moment they follow the invite link.
 */

/** How each person in the sheet will be recreated. */
export interface ParticipantPlan {
  person: SheetPerson
  /** 'self' — the restoring user; 'guest' — a new placeholder. */
  kind: 'self' | 'guest'
  /** Editable in the preview: what the guest will be invited as. */
  email: string
}

export interface RestorePlan {
  tripName: string
  participants: ParticipantPlan[]
}

export interface RestoreResult {
  tripId: string
  expenseCount: number
  /** Guests with no email — they cannot auto-merge when they join. */
  unlinkableNames: string[]
}

/**
 * Default mapping: whoever the sheet marked as `self` (or matches the
 * restoring user's email) becomes the restoring user; everyone else a guest.
 */
export function buildRestorePlan(
  snapshot: SheetSnapshot,
  currentUserEmail: string | null | undefined
): RestorePlan {
  const email = (currentUserEmail ?? '').toLowerCase()
  let selfTaken = false
  const participants = snapshot.people.map((person) => {
    const isSelf =
      !selfTaken && (person.isSelf || (Boolean(email) && person.email === email))
    if (isSelf) selfTaken = true
    return {
      person,
      kind: (isSelf ? 'self' : 'guest') as ParticipantPlan['kind'],
      email: person.email,
    }
  })
  return { tripName: snapshot.tripName, participants }
}

/** Firestore caps a batch at 500; 400 matches the reconciler in claim.ts. */
const BATCH_LIMIT = 400

export async function restoreFromSnapshot(args: {
  snapshot: SheetSnapshot
  plan: RestorePlan
  uid: string
  spreadsheetId: string
}): Promise<RestoreResult> {
  const { snapshot, plan, uid, spreadsheetId } = args

  if (snapshot.expenses.length > MAX_RESTORE_EXPENSES) {
    throw new Error(
      `This backup has ${snapshot.expenses.length} expenses, more than the ${MAX_RESTORE_EXPENSES} FairShare can restore at once.`
    )
  }

  // Old participant id → new id. Everyone who isn't the restorer gets a fresh
  // placeholder id; reusing the old ones would collide with the source trip if
  // it still exists, and a ph_ id means nothing outside the trip that made it.
  const idMap = new Map<string, string>()
  const placeholderMembers: PlaceholderMember[] = []
  const invitedEmails: string[] = []
  const unlinkableNames: string[] = []
  const createdAt = Timestamp.now()

  for (const entry of plan.participants) {
    if (entry.kind === 'self') {
      idMap.set(entry.person.id, uid)
      continue
    }
    const id = generatePlaceholderId()
    idMap.set(entry.person.id, id)
    const email = entry.email.trim().toLowerCase()
    placeholderMembers.push({
      id,
      email,
      // Keep the name so an emailless guest still reads as a person rather
      // than a blank chip
      ...(entry.person.name && entry.person.name !== email
        ? { name: entry.person.name }
        : {}),
      createdBy: uid,
      createdAt,
    })
    if (email) {
      // Only real addresses: an empty string here would make rescind's
      // arrayRemove('') a no-op against a value that shouldn't exist
      if (!invitedEmails.includes(email)) invitedEmails.push(email)
    } else {
      // claimPlaceholdersOnJoin matches on email alone, so this person can
      // never auto-merge — the preview warns about them by name
      unlinkableNames.push(entry.person.name || 'a guest')
    }
  }

  const remap = (id: string) => idMap.get(id) ?? id
  const remapMap = (m: Record<string, number>) => {
    const out: Record<string, number> = {}
    for (const [id, amount] of Object.entries(m)) {
      const to = remap(id)
      out[to] = Math.round(((out[to] ?? 0) + amount) * 100) / 100
    }
    return out
  }

  const inviteCode = generateInviteCode()

  // The trip doc must exist and be committed BEFORE any expense write. The
  // expense rule reads `get(/trips/$(tripId)).data.memberUids`, and inside a
  // writeBatch that get() sees pre-commit state — so batching the trip create
  // together with the expenses would be denied.
  const tripRef = await addDoc(collection(db, 'trips'), {
    name: plan.tripName.trim() || snapshot.tripName,
    type: snapshot.tripType,
    createdBy: uid,
    memberUids: [uid],
    invitedEmails,
    inviteCode,
    settlementCurrency: snapshot.settlementCurrency,
    ...(placeholderMembers.length > 0 ? { placeholderMembers } : {}),
    ...(snapshot.customCategories.length > 0
      ? { customCategories: snapshot.customCategories }
      : {}),
    createdAt: serverTimestamp(),
    // Flat, not nested — keeps serverTimestamp() out of a map, and lets the
    // duplicate-restore guard scan the already-loaded trip list
    restoredFromSheetId: spreadsheetId,
    restoredFromTripId: snapshot.sourceTripId,
    restoredSchemaVersion: snapshot.schemaVersion,
    restoredAt: serverTimestamp(),
  })

  // Expenses in batches: one round trip per 400 docs instead of per doc
  const expensesRef = collection(db, 'trips', tripRef.id, 'expenses')
  let batch = writeBatch(db)
  let ops = 0
  for (const expense of snapshot.expenses) {
    const paid = remapMap(expense.paid)
    const { paidBy, paidByAmounts } = payerFields(paid)
    const record: Record<string, unknown> = {
      description: expense.description,
      amount: expense.amountOriginal,
      currency: expense.currency,
      exchangeRate: expense.exchangeRate,
      // Firestore's field name, not the TS one — see types.ts
      [FIRESTORE_AMOUNT_FIELD]: expense.amountSettled,
      paidBy,
      splitType: expense.splitType,
      splits: remapMap(expense.shares),
      date: Timestamp.fromDate(parseDateString(expense.date)),
      createdBy: uid,
      createdAt: serverTimestamp(),
    }
    // Optional fields are omitted rather than written as undefined
    if (paidByAmounts) record.paidByAmounts = paidByAmounts
    if (expense.notes) record.notes = expense.notes
    if (expense.categoryIds.length > 0) record.categories = expense.categoryIds
    if (expense.isSettlement) record.isSettlement = true

    batch.set(doc(expensesRef), record)
    if (++ops >= BATCH_LIMIT) {
      await batch.commit()
      batch = writeBatch(db)
      ops = 0
    }
  }
  if (ops > 0) await batch.commit()

  // Best-effort, exactly as trip creation does it — the dashboard backfills a
  // missing code doc on view
  setDoc(doc(db, 'inviteCodes', inviteCode), {
    tripId: tripRef.id,
    type: snapshot.tripType,
  }).catch(() => {})

  // Reuses trip_created rather than adding a union member: trip_restored
  // already means un-trashing, and a new action would ripple into the activity
  // log and its undo map
  writeActivity(tripRef.id, {
    action: 'trip_created',
    actorUid: uid,
    targetDescription: plan.tripName.trim() || snapshot.tripName,
  })

  return {
    tripId: tripRef.id,
    expenseCount: snapshot.expenses.length,
    unlinkableNames,
  }
}
