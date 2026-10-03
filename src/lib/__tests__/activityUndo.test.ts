import { describe, it, expect } from 'vitest'
import { getUndoAction, undoWindowMs } from '../activityUndo'
import type { ActivityLogEntry } from '../types'
import { Timestamp } from 'firebase/firestore'

function entry(overrides: Partial<ActivityLogEntry>): ActivityLogEntry {
  return {
    id: 'a1',
    actorUid: 'user1',
    createdAt: Timestamp.now(),
    action: 'expense_added',
    ...overrides,
  } as ActivityLogEntry
}

describe('getUndoAction', () => {
  // Expense actions
  it('returns soft-delete for expense_added with targetExpenseId', () => {
    expect(getUndoAction(entry({ action: 'expense_added', targetExpenseId: 'e1' }))).toBe('soft-delete')
  })

  it('returns null for expense_added without targetExpenseId', () => {
    expect(getUndoAction(entry({ action: 'expense_added' }))).toBeNull()
  })

  it('returns soft-delete for settlement_recorded with targetExpenseId', () => {
    expect(getUndoAction(entry({ action: 'settlement_recorded', targetExpenseId: 'e1' }))).toBe('soft-delete')
  })

  it('returns restore for expense_deleted with targetExpenseId', () => {
    expect(getUndoAction(entry({ action: 'expense_deleted', targetExpenseId: 'e1' }))).toBe('restore')
  })

  it('returns soft-delete for expense_restored', () => {
    expect(getUndoAction(entry({ action: 'expense_restored', targetExpenseId: 'e1' }))).toBe('soft-delete')
  })

  it('returns revert-edit for expense_edited with previousValues', () => {
    expect(getUndoAction(entry({
      action: 'expense_edited',
      targetExpenseId: 'e1',
      previousValues: { amount: 50 },
    }))).toBe('revert-edit')
  })

  it('returns null for expense_edited without previousValues', () => {
    expect(getUndoAction(entry({ action: 'expense_edited', targetExpenseId: 'e1' }))).toBeNull()
  })

  // Member actions
  it('returns re-add-member for member_removed', () => {
    expect(getUndoAction(entry({ action: 'member_removed', targetMemberUid: 'u2' }))).toBe('re-add-member')
  })

  it('returns remove-member for member_joined', () => {
    expect(getUndoAction(entry({ action: 'member_joined', targetMemberUid: 'u2' }))).toBe('remove-member')
  })

  it('returns uninvite for member_invited', () => {
    expect(getUndoAction(entry({ action: 'member_invited', targetDescription: 'test@test.com' }))).toBe('uninvite')
  })

  it('returns null for member_left', () => {
    expect(getUndoAction(entry({ action: 'member_left' }))).toBeNull()
  })

  // Trip actions
  it('returns revert-rename for trip_renamed with previousValues', () => {
    expect(getUndoAction(entry({
      action: 'trip_renamed',
      previousValues: { name: 'Old Name' },
    }))).toBe('revert-rename')
  })

  it('returns revert-currency for currency_changed', () => {
    expect(getUndoAction(entry({
      action: 'currency_changed',
      previousValues: { settlementCurrency: 'EUR' },
    }))).toBe('revert-currency')
  })

  it('returns restore-trip for trip_deleted', () => {
    expect(getUndoAction(entry({ action: 'trip_deleted' }))).toBe('restore-trip')
  })

  it('returns re-delete-trip for trip_restored', () => {
    expect(getUndoAction(entry({ action: 'trip_restored' }))).toBe('re-delete-trip')
  })

  // Non-undoable
  it('returns null for trip_created', () => {
    expect(getUndoAction(entry({ action: 'trip_created' }))).toBeNull()
  })

  it('returns null for comment_added', () => {
    expect(getUndoAction(entry({ action: 'comment_added' }))).toBeNull()
  })

  describe('undo window', () => {
    const DAY = 24 * 60 * 60 * 1000
    const now = Date.UTC(2026, 9, 3, 12)
    const aged = (days: number, overrides: Partial<ActivityLogEntry> = {}) =>
      entry({ createdAt: Timestamp.fromMillis(now - days * DAY), ...overrides })

    it('keeps undo on entries inside a week', () => {
      expect(getUndoAction(aged(6.9, { targetExpenseId: 'e1' }), now)).toBe('soft-delete')
    })

    it('drops undo on entries older than a week — history stays, but read-only', () => {
      expect(getUndoAction(aged(7.1, { targetExpenseId: 'e1' }), now)).toBeNull()
      expect(getUndoAction(aged(30, {
        action: 'expense_edited', targetExpenseId: 'e1', previousValues: { amount: 50 },
      }), now)).toBeNull()
      expect(getUndoAction(aged(30, { action: 'trip_deleted' }), now)).toBeNull()
    })

    it('gives payments two weeks', () => {
      const pay = (days: number) => aged(days, { action: 'settlement_recorded', targetExpenseId: 'e1' })
      expect(getUndoAction(pay(13.9), now)).toBe('soft-delete')
      expect(getUndoAction(pay(14.1), now)).toBeNull()
      expect(undoWindowMs('settlement_recorded')).toBe(14 * DAY)
    })

    it('treats an entry still awaiting its server timestamp as fresh', () => {
      expect(getUndoAction(entry({ targetExpenseId: 'e1', createdAt: undefined }), now)).toBe('soft-delete')
      expect(getUndoAction(entry({ targetExpenseId: 'e1', createdAt: null as never }), now)).toBe('soft-delete')
    })
  })
})
