import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { involvedParticipantIds, participantLabel } from '../participants'
import type { Expense, UserProfile, RemovedMember } from '../types'

const now = Timestamp.now()

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1',
    description: 'Lunch',
    amount: 100,
    currency: 'USD',
    exchangeRate: 1,
    amountSettled: 100,
    paidBy: 'alice',
    splitType: 'equal',
    splits: { alice: 50, bob: 50 },
    createdBy: 'alice',
    createdAt: now,
    date: now,
    ...overrides,
  }
}

const members: Record<string, UserProfile> = {
  alice: { uid: 'alice', displayName: 'Alice', email: 'alice@test.com', photoURL: null },
  bob: { uid: 'bob', displayName: 'Bob', email: 'bob@test.com', photoURL: null },
  ph_guest: {
    uid: 'ph_guest',
    displayName: 'guest@test.com',
    email: 'guest@test.com',
    photoURL: null,
    isPlaceholder: true,
  },
}

describe('involvedParticipantIds', () => {
  it('keeps current members in order, first', () => {
    expect(involvedParticipantIds([expense()], ['alice', 'bob'])).toEqual(['alice', 'bob'])
  })

  it('appends someone who owes but is no longer a member', () => {
    const ids = involvedParticipantIds(
      [expense({ splits: { alice: 50, carol: 50 } })],
      ['alice', 'bob']
    )
    expect(ids).toEqual(['alice', 'bob', 'carol'])
  })

  it('appends a former member who paid', () => {
    const ids = involvedParticipantIds([expense({ paidBy: 'dave' })], ['alice', 'bob'])
    expect(ids).toContain('dave')
  })

  it('appends multi-payer participants', () => {
    const ids = involvedParticipantIds(
      [expense({ paidByAmounts: { alice: 60, erin: 40 } })],
      ['alice', 'bob']
    )
    expect(ids).toContain('erin')
  })

  it('does not duplicate a member referenced many ways', () => {
    const ids = involvedParticipantIds(
      [expense(), expense({ id: 'e2' }), expense({ id: 'e3', paidBy: 'bob' })],
      ['alice', 'bob']
    )
    expect(ids).toEqual(['alice', 'bob'])
  })

  it('returns members even when there are no expenses', () => {
    expect(involvedParticipantIds([], ['alice'])).toEqual(['alice'])
  })
})

describe('participantLabel', () => {
  it('returns a plain name for a current member', () => {
    expect(participantLabel('alice', members, ['alice', 'bob'])).toBe('Alice')
  })

  it('marks a placeholder as invited', () => {
    expect(participantLabel('ph_guest', members, ['alice', 'ph_guest'])).toBe(
      'guest@test.com (invited)'
    )
  })

  it('marks a non-member with a profile as removed', () => {
    expect(participantLabel('bob', members, ['alice'])).toBe('Bob (removed)')
  })

  it('falls back to the removedMembers record when the profile is gone', () => {
    const removed: RemovedMember[] = [
      { uid: 'carol', email: 'carol@test.com', displayName: 'Carol', removedAt: now },
    ]
    expect(participantLabel('carol', members, ['alice'], removed)).toBe('Carol (removed)')
  })

  it('uses the email when a removed member has no display name', () => {
    const removed: RemovedMember[] = [
      { uid: 'carol', email: 'carol@test.com', displayName: '', removedAt: now },
    ]
    expect(participantLabel('carol', members, ['alice'], removed)).toBe(
      'carol@test.com (removed)'
    )
  })

  it('falls back to the raw id when nothing resolves', () => {
    expect(participantLabel('ghost', members, ['alice'])).toBe('ghost')
  })

  it('disambiguates duplicate display names with the email', () => {
    const dupes: Record<string, UserProfile> = {
      a1: { uid: 'a1', displayName: 'Alex', email: 'a1@test.com', photoURL: null },
      a2: { uid: 'a2', displayName: 'Alex', email: 'a2@test.com', photoURL: null },
    }
    expect(participantLabel('a1', dupes, ['a1', 'a2'])).toBe('Alex (a1@test.com)')
  })
})
