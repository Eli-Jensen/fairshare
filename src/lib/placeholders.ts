import type { Trip, UserProfile } from './types'

/**
 * Placeholder members are invited people who haven't joined yet. They live in
 * trip.placeholderMembers — never in memberUids, which stays the security
 * boundary of real authenticated users. Their `ph_` ids flow through
 * splits/paidBy/balances exactly like uids, and display as the invited email
 * until the person joins and their history is claimed onto their real uid.
 */

/** 'ph_' prefix can never collide with a Firebase uid (alphanumeric only). */
export function generatePlaceholderId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return 'ph_' + Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

export function isPlaceholderId(id: string): boolean {
  return id.startsWith('ph_')
}

/** Everyone who can pay or owe on this trip: real members + invited placeholders. */
export function participantIds(trip: Trip): string[] {
  return [...trip.memberUids, ...(trip.placeholderMembers ?? []).map((p) => p.id)]
}

/** Synthesized profiles for placeholders, shaped like real UserProfiles so the
 *  members map, avatars, and name resolution work unchanged. Shows the email
 *  as the name (no separate name is collected). */
export function placeholderProfiles(trip: Trip): Record<string, UserProfile> {
  const profiles: Record<string, UserProfile> = {}
  for (const ph of trip.placeholderMembers ?? []) {
    profiles[ph.id] = {
      uid: ph.id,
      displayName: ph.name || ph.email,
      email: ph.email,
      photoURL: null,
      isPlaceholder: true,
    }
  }
  return profiles
}

/** The participant-reference fields of an expense (same names in Firestore). */
export interface ExpenseRefs {
  paidBy: string
  paidByAmounts?: Record<string, number>
  splits: Record<string, number>
}

/**
 * Pure: rewrite every reference to `fromId` in an expense to `toId`, merging
 * (summing) when `toId` is already present. Returns only the changed fields
 * (for a Firestore update), or null if the expense doesn't reference `fromId`.
 * Idempotent — re-running on an already-rewritten expense returns null.
 */
export function remapExpenseRefs(exp: ExpenseRefs, fromId: string, toId: string): Partial<ExpenseRefs> | null {
  const update: Partial<ExpenseRefs> = {}
  let changed = false

  if (exp.paidBy === fromId) {
    update.paidBy = toId
    changed = true
  }
  if (exp.paidByAmounts && fromId in exp.paidByAmounts) {
    const m = { ...exp.paidByAmounts }
    m[toId] = Math.round(((m[toId] ?? 0) + m[fromId]) * 100) / 100
    delete m[fromId]
    update.paidByAmounts = m
    changed = true
  }
  if (exp.splits && fromId in exp.splits) {
    const s = { ...exp.splits }
    s[toId] = Math.round(((s[toId] ?? 0) + s[fromId]) * 100) / 100
    delete s[fromId]
    update.splits = s
    changed = true
  }

  return changed ? update : null
}
