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
  // [what, entry, expected undo]. Each undoable action needs the field its
  // undo acts on; without it the entry is a record only.
  it.each([
    ['expense added', { action: 'expense_added', targetExpenseId: 'e1' }, 'soft-delete'],
    ['expense added, no target', { action: 'expense_added' }, null],
    ['payment recorded', { action: 'settlement_recorded', targetExpenseId: 'e1' }, 'soft-delete'],
    ['expense deleted', { action: 'expense_deleted', targetExpenseId: 'e1' }, 'restore'],
    ['expense restored', { action: 'expense_restored', targetExpenseId: 'e1' }, 'soft-delete'],
    ['expense edited', { action: 'expense_edited', targetExpenseId: 'e1', previousValues: { amount: 50 } }, 'revert-edit'],
    ['expense edited, no previous values', { action: 'expense_edited', targetExpenseId: 'e1' }, null],
    ['member removed', { action: 'member_removed', targetMemberUid: 'u2' }, 're-add-member'],
    ['member joined', { action: 'member_joined', targetMemberUid: 'u2' }, 'remove-member'],
    ['member invited', { action: 'member_invited', targetDescription: 'test@test.com' }, 'uninvite'],
    ['member left', { action: 'member_left' }, null],
    ['trip renamed', { action: 'trip_renamed', previousValues: { name: 'Old Name' } }, 'revert-rename'],
    ['currency changed', { action: 'currency_changed', previousValues: { settlementCurrency: 'EUR' } }, 'revert-currency'],
    ['trip deleted', { action: 'trip_deleted' }, 'restore-trip'],
    ['trip restored', { action: 'trip_restored' }, 're-delete-trip'],
    ['trip created', { action: 'trip_created' }, null],
    ['comment added', { action: 'comment_added' }, null],
  ] as [string, Partial<ActivityLogEntry>, string | null][])('%s → %s', (_what, overrides, expected) => {
    expect(getUndoAction(entry(overrides))).toBe(expected)
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
