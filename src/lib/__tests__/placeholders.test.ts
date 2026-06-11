import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  generatePlaceholderId,
  isPlaceholderId,
  participantIds,
  placeholderProfiles,
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

const dad = { id: 'ph_abc123', name: 'Dad', createdBy: 'u1', createdAt: Timestamp.fromMillis(0) }
const mom = { id: 'ph_def456', name: 'Mom', email: 'mom@gmail.com', createdBy: 'u1', createdAt: Timestamp.fromMillis(0) }

describe('generatePlaceholderId', () => {
  it('is prefixed and unique', () => {
    const a = generatePlaceholderId()
    const b = generatePlaceholderId()
    expect(a).toMatch(/^ph_[a-z0-9]{12}$/)
    expect(a).not.toBe(b)
    expect(isPlaceholderId(a)).toBe(true)
    expect(isPlaceholderId('aB3dEf28CharFirebaseUidXyz12')).toBe(false)
  })
})

describe('participantIds', () => {
  it('is just memberUids when there are no guests', () => {
    expect(participantIds(trip({}))).toEqual(['u1', 'u2'])
  })

  it('appends guest ids after real members', () => {
    expect(participantIds(trip({ placeholderMembers: [dad, mom] }))).toEqual([
      'u1', 'u2', 'ph_abc123', 'ph_def456',
    ])
  })
})

describe('placeholderProfiles', () => {
  it('synthesizes profiles shaped like real users', () => {
    const profiles = placeholderProfiles(trip({ placeholderMembers: [dad, mom] }))
    expect(profiles['ph_abc123']).toEqual({
      uid: 'ph_abc123',
      displayName: 'Dad',
      email: '',
      photoURL: null,
      isPlaceholder: true,
    })
    expect(profiles['ph_def456'].email).toBe('mom@gmail.com')
  })

  it('resolves names through getMemberName', () => {
    const profiles = placeholderProfiles(trip({ placeholderMembers: [dad] }))
    expect(getMemberName('ph_abc123', profiles)).toBe('Dad')
  })

  it('disambiguates duplicate names using "guest" when there is no email', () => {
    const realDad = {
      uid: 'u9',
      displayName: 'Dad',
      email: 'realdad@gmail.com',
      photoURL: null,
    }
    const profiles = {
      ...placeholderProfiles(trip({ placeholderMembers: [dad] })),
      u9: realDad,
    }
    expect(getMemberName('ph_abc123', profiles)).toBe('Dad (guest)')
    expect(getMemberName('u9', profiles)).toBe('Dad (realdad@gmail.com)')
  })
})
