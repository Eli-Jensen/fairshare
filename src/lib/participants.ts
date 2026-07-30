import type { Expense, UserProfile, RemovedMember } from './types'
import { getMemberName } from './types'
import { isPlaceholderId } from './placeholders'

/**
 * Who belongs in the books of a trip, and what to call them.
 *
 * Shared by the CSV export and the Google Sheets snapshot: both need the same
 * ordered participant list and the same labels, and both break if a person who
 * paid or owes is left out (the balances stop summing to zero).
 */

/**
 * Everyone referenced by these expenses, in a stable order: current
 * participants first, then anyone who paid or owes but is no longer one (a
 * removed member). Dropping the latter would leave the balances unbalanced.
 */
export function involvedParticipantIds(
  expenses: Expense[],
  memberUids: string[]
): string[] {
  const involved = new Set<string>()
  for (const exp of expenses) {
    involved.add(exp.paidBy)
    for (const uid of Object.keys(exp.splits)) involved.add(uid)
    for (const uid of Object.keys(exp.paidByAmounts ?? {})) involved.add(uid)
  }
  const extraUids = Array.from(involved).filter((u) => !memberUids.includes(u))
  return [...memberUids, ...extraUids]
}

/**
 * Display label for a participant, annotated with how they relate to the trip
 * now: "(removed)" for a former member, "(invited)" for a guest who hasn't
 * joined. Falls back to the removedMembers record, then the raw id.
 */
export function participantLabel(
  uid: string,
  members: Record<string, UserProfile>,
  memberUids: string[],
  removedMembers?: Pick<RemovedMember, 'uid' | 'email' | 'displayName'>[]
): string {
  if (members[uid]) {
    const n = getMemberName(uid, members)
    if (!memberUids.includes(uid)) return `${n} (removed)`
    return isPlaceholderId(uid) ? `${n} (invited)` : n
  }
  const rm = removedMembers?.find((r) => r.uid === uid)
  if (rm) return `${rm.displayName || rm.email} (removed)`
  return uid
}
