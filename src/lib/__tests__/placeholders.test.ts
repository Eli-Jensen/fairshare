import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  generatePlaceholderId,
  isPlaceholderId,
  participantIds,
  placeholderProfiles,
  remapExpenseRefs,
  type ExpenseRefs,
} from '../placeholders'
import { getMemberName } from '../types'
import type { Trip } from '../types'

function trip(overrides: Partial<Trip>): Trip {
  return {
    id: 't1',
    name: 'Test trip',
    createdBy: 'u1',
    memberUids: ['u1', 'u2'],
    inviteCode: 'code',
    settlementCurrency: 'USD',
    createdAt: Timestamp.fromMillis(0),
    ...overrides,
  } as Trip
}

const dad = { id: 'ph_abc123', email: 'dad@gmail.com', createdBy: 'u1', createdAt: Timestamp.fromMillis(0) }
const mom = { id: 'ph_def456', email: 'mom@gmail.com', createdBy: 'u1', createdAt: Timestamp.fromMillis(0) }

describe('generatePlaceholderId', () => {
  it('is prefixed, unique, and never looks like a uid', () => {
    const a = generatePlaceholderId()
    expect(a).toMatch(/^ph_[a-z0-9]{12}$/)
    expect(a).not.toBe(generatePlaceholderId())
    expect(isPlaceholderId(a)).toBe(true)
    expect(isPlaceholderId('aB3dEf28CharFirebaseUidXyz12')).toBe(false)
  })
})

describe('participantIds', () => {
  it('appends placeholder ids after real members', () => {
    expect(participantIds(trip({ placeholderMembers: [dad, mom] }))).toEqual([
      'u1', 'u2', 'ph_abc123', 'ph_def456',
    ])
  })
})

describe('placeholderProfiles', () => {
  it('shows the email as the display name', () => {
    const profiles = placeholderProfiles(trip({ placeholderMembers: [dad] }))
    expect(profiles['ph_abc123']).toEqual({
      uid: 'ph_abc123',
      displayName: 'dad@gmail.com',
      email: 'dad@gmail.com',
      photoURL: null,
      isPlaceholder: true,
    })
    expect(getMemberName('ph_abc123', profiles)).toBe('dad@gmail.com')
  })
})

describe('remapExpenseRefs', () => {
  it('returns null when the expense does not reference fromId', () => {
    const exp: ExpenseRefs = { paidBy: 'u1', splits: { u1: 10, u2: 10 } }
    expect(remapExpenseRefs(exp, 'ph_abc123', 'u9')).toBeNull()
  })

  it('rewrites paidBy and the split key', () => {
    const exp: ExpenseRefs = { paidBy: 'ph_abc123', splits: { ph_abc123: 30, u2: 30 } }
    expect(remapExpenseRefs(exp, 'ph_abc123', 'u9')).toEqual({
      paidBy: 'u9',
      splits: { u9: 30, u2: 30 },
    })
  })

  it('rewrites multi-payer amounts', () => {
    const exp: ExpenseRefs = {
      paidBy: 'u2',
      paidByAmounts: { ph_abc123: 40, u2: 60 },
      splits: { ph_abc123: 50, u2: 50 },
    }
    expect(remapExpenseRefs(exp, 'ph_abc123', 'u9')).toEqual({
      paidByAmounts: { u9: 40, u2: 60 },
      splits: { u9: 50, u2: 50 },
    })
  })

  it('merges (sums) when the target id is already present', () => {
    const exp: ExpenseRefs = {
      paidBy: 'ph_abc123',
      paidByAmounts: { ph_abc123: 20, u9: 5 },
      splits: { ph_abc123: 25, u9: 15 },
    }
    expect(remapExpenseRefs(exp, 'ph_abc123', 'u9')).toEqual({
      paidBy: 'u9',
      paidByAmounts: { u9: 25 },
      splits: { u9: 40 },
    })
  })

  it('is idempotent — a second pass finds nothing to change', () => {
    const exp: ExpenseRefs = { paidBy: 'ph_abc123', splits: { ph_abc123: 10, u2: 10 } }
    const once = remapExpenseRefs(exp, 'ph_abc123', 'u9')!
    const applied: ExpenseRefs = { ...exp, ...once } as ExpenseRefs
    expect(remapExpenseRefs(applied, 'ph_abc123', 'u9')).toBeNull()
  })
})
