import {
  doc,
  updateDoc,
  serverTimestamp,
  deleteField,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore'
import { db } from './firebase'
import type { ActivityLogEntry } from './types'
import { writeActivity } from './activity'

export type UndoAction =
  | 'soft-delete'      // expense_added, settlement_recorded, expense_restored
  | 'restore'          // expense_deleted
  | 'revert-edit'      // expense_edited (restore previousValues on expense)
  | 're-add-member'    // member_removed
  | 'remove-member'    // member_joined
  | 'uninvite'         // member_invited
  | 'revert-rename'    // trip_renamed (restore previousValues on trip)
  | 'revert-currency'  // currency_changed (restore previousValues on trip)
  | 'restore-trip'     // trip_deleted
  | 're-delete-trip'   // trip_restored

/**
 * Determine what undo action applies to a given activity entry.
 * Returns null if the action is not undoable.
 */
export function getUndoAction(entry: ActivityLogEntry): UndoAction | null {
  switch (entry.action) {
    // Expense actions
    case 'expense_added':
    case 'settlement_recorded':
      return entry.targetExpenseId ? 'soft-delete' : null
    case 'expense_deleted':
      return entry.targetExpenseId ? 'restore' : null
    case 'expense_restored':
      return entry.targetExpenseId ? 'soft-delete' : null
    case 'expense_edited':
      return entry.targetExpenseId && entry.previousValues ? 'revert-edit' : null

    // Member actions
    case 'member_removed':
      return entry.targetMemberUid ? 're-add-member' : null
    case 'member_joined':
      return entry.targetMemberUid ? 'remove-member' : null
    case 'member_invited':
      return entry.targetDescription ? 'uninvite' : null

    // Trip actions
    case 'trip_renamed':
      return entry.previousValues ? 'revert-rename' : null
    case 'currency_changed':
      return entry.previousValues ? 'revert-currency' : null
    case 'trip_deleted':
      return 'restore-trip'
    case 'trip_restored':
      return 're-delete-trip'

    // Not undoable
    case 'member_left':
    case 'trip_created':
    case 'comment_added':
      return null

    default:
      return null
  }
}

/**
 * Execute the undo for a given activity entry.
 * Throws on Firestore errors — caller should catch.
 *
 * Every counter-entry written here carries `suppressPush: true`. Undoing an
 * add writes an `expense_deleted` entry, and pushing that would contradict the
 * "Alice added Dinner" notification everyone got seconds earlier. The first
 * push stands (it was true when it was sent); the retraction stays quiet and
 * lives in the activity log instead.
 */
export async function executeUndo(
  entry: ActivityLogEntry,
  tripId: string,
  undoAction: UndoAction,
  actorUid?: string
): Promise<void> {
  const tripRef = doc(db, 'trips', tripId)

  switch (undoAction) {
    // Expense undo actions
    case 'soft-delete': {
      if (!entry.targetExpenseId) return
      const expenseRef = doc(db, 'trips', tripId, 'expenses', entry.targetExpenseId)
      await updateDoc(expenseRef, { deletedAt: serverTimestamp() })
      if (actorUid) {
        writeActivity(tripId, {
          action: 'expense_deleted',
          actorUid,
          suppressPush: true,
          targetDescription: entry.targetDescription,
          targetAmount: entry.targetAmount,
          targetExpenseId: entry.targetExpenseId,
        })
      }
      break
    }
    case 'restore': {
      if (!entry.targetExpenseId) return
      const expenseRef = doc(db, 'trips', tripId, 'expenses', entry.targetExpenseId)
      await updateDoc(expenseRef, { deletedAt: deleteField() })
      if (actorUid) {
        writeActivity(tripId, {
          action: 'expense_restored',
          actorUid,
          suppressPush: true,
          targetDescription: entry.targetDescription,
          targetAmount: entry.targetAmount,
          targetExpenseId: entry.targetExpenseId,
        })
      }
      break
    }
    case 'revert-edit': {
      if (!entry.targetExpenseId || !entry.previousValues) return
      const expenseRef = doc(db, 'trips', tripId, 'expenses', entry.targetExpenseId)
      await updateDoc(expenseRef, entry.previousValues)
      if (actorUid) {
        writeActivity(tripId, {
          action: 'expense_edited',
          actorUid,
          suppressPush: true,
          targetDescription: entry.targetDescription,
          targetAmount: entry.targetAmount,
          targetExpenseId: entry.targetExpenseId,
          editDetails: ['reverted to previous values'],
        })
      }
      break
    }

    // Member undo actions
    case 're-add-member': {
      if (!entry.targetMemberUid) return
      await updateDoc(tripRef, { memberUids: arrayUnion(entry.targetMemberUid) })
      if (actorUid) {
        writeActivity(tripId, {
          action: 'member_joined',
          actorUid,
          suppressPush: true,
          targetMemberUid: entry.targetMemberUid,
          targetDescription: entry.targetDescription,
        })
      }
      break
    }
    case 'remove-member': {
      if (!entry.targetMemberUid) return
      await updateDoc(tripRef, { memberUids: arrayRemove(entry.targetMemberUid) })
      if (actorUid) {
        writeActivity(tripId, {
          action: 'member_removed',
          actorUid,
          suppressPush: true,
          targetMemberUid: entry.targetMemberUid,
          targetDescription: entry.targetDescription,
        })
      }
      break
    }
    case 'uninvite': {
      if (!entry.targetDescription) return
      await updateDoc(tripRef, { invitedEmails: arrayRemove(entry.targetDescription) })
      break
    }

    // Trip undo actions
    case 'revert-rename': {
      if (!entry.previousValues) return
      const oldName = entry.previousValues.name as string | undefined
      await updateDoc(tripRef, entry.previousValues)
      if (actorUid) {
        writeActivity(tripId, {
          action: 'trip_renamed',
          actorUid,
          suppressPush: true,
          targetDescription: oldName ?? '',
          previousValues: { name: entry.targetDescription },
          editDetails: [`name: "${entry.targetDescription}" → "${oldName}"`],
        })
      }
      break
    }
    case 'revert-currency': {
      if (!entry.previousValues) return
      const oldCurrency = entry.previousValues.settlementCurrency as string | undefined
      await updateDoc(tripRef, entry.previousValues)
      if (actorUid) {
        writeActivity(tripId, {
          action: 'currency_changed',
          actorUid,
          suppressPush: true,
          targetDescription: `reverted to ${oldCurrency}`,
          previousValues: entry.targetDescription ? { settlementCurrency: entry.targetDescription.split(' → ')[1] } : undefined,
          editDetails: [`settlement currency: reverted to ${oldCurrency}`],
        })
      }
      break
    }
    case 'restore-trip': {
      await updateDoc(tripRef, { deletedAt: deleteField() })
      if (actorUid) {
        writeActivity(tripId, {
          action: 'trip_restored',
          actorUid,
          suppressPush: true,
          targetDescription: entry.targetDescription,
        })
      }
      break
    }
    case 're-delete-trip': {
      await updateDoc(tripRef, { deletedAt: serverTimestamp() })
      if (actorUid) {
        writeActivity(tripId, {
          action: 'trip_deleted',
          actorUid,
          suppressPush: true,
          targetDescription: entry.targetDescription,
        })
      }
      break
    }
  }
}
