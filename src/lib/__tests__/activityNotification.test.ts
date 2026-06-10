import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  getActivitySeenTimestamp,
  setActivitySeenTimestamp,
  hasUnseenActivity,
} from '../activityNotification'
import type { Trip } from '../types'

// Use a simple in-memory mock for localStorage
const store: Record<string, string> = {}
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    },
    configurable: true,
  })
})

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

describe('seen timestamp storage', () => {
  it('round-trips per user', () => {
    setActivitySeenTimestamp('user1', 5000)
    expect(getActivitySeenTimestamp('user1')).toBe(5000)
    expect(getActivitySeenTimestamp('user2')).toBe(0)
  })
})

describe('hasUnseenActivity', () => {
  it('is false with no trips', () => {
    expect(hasUnseenActivity('u1', [])).toBe(false)
  })

  it('is false for trips without activity stamps (legacy data)', () => {
    expect(hasUnseenActivity('u1', [trip({})])).toBe(false)
  })

  it("lights for someone else's activity newer than last seen", () => {
    setActivitySeenTimestamp('u1', 1000)
    const trips = [trip({ lastActivityAt: Timestamp.fromMillis(2000), lastActivityBy: 'u2' })]
    expect(hasUnseenActivity('u1', trips)).toBe(true)
  })

  it('does not light for your own activity', () => {
    setActivitySeenTimestamp('u1', 1000)
    const trips = [trip({ lastActivityAt: Timestamp.fromMillis(2000), lastActivityBy: 'u1' })]
    expect(hasUnseenActivity('u1', trips)).toBe(false)
  })

  it('does not light for activity already seen', () => {
    setActivitySeenTimestamp('u1', 3000)
    const trips = [trip({ lastActivityAt: Timestamp.fromMillis(2000), lastActivityBy: 'u2' })]
    expect(hasUnseenActivity('u1', trips)).toBe(false)
  })

  it('lights when any one of several trips is unseen', () => {
    setActivitySeenTimestamp('u1', 1000)
    const trips = [
      trip({ id: 'a', lastActivityAt: Timestamp.fromMillis(500), lastActivityBy: 'u2' }),
      trip({ id: 'b', lastActivityAt: Timestamp.fromMillis(2000), lastActivityBy: 'u3' }),
    ]
    expect(hasUnseenActivity('u1', trips)).toBe(true)
  })
})
