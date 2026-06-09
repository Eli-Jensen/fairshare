import { describe, it, expect, beforeEach } from 'vitest'
import {
  getActivitySeenTimestamp,
  setActivitySeenTimestamp,
  getActivityLatestTimestamp,
  setActivityLatestTimestamp,
  hasUnseenActivity,
} from '../activityNotification'

// Use a simple in-memory mock for localStorage
const store: Record<string, string> = {}
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
    },
    writable: true,
  })
})

describe('activity seen timestamps', () => {
  it('returns 0 when nothing stored', () => {
    expect(getActivitySeenTimestamp('user1')).toBe(0)
  })

  it('stores and retrieves seen timestamp', () => {
    setActivitySeenTimestamp('user1', 1000)
    expect(getActivitySeenTimestamp('user1')).toBe(1000)
  })

  it('isolates timestamps per user', () => {
    setActivitySeenTimestamp('user1', 1000)
    setActivitySeenTimestamp('user2', 2000)
    expect(getActivitySeenTimestamp('user1')).toBe(1000)
    expect(getActivitySeenTimestamp('user2')).toBe(2000)
  })
})

describe('activity latest timestamps', () => {
  it('returns 0 when nothing stored', () => {
    expect(getActivityLatestTimestamp('user1')).toBe(0)
  })

  it('stores and retrieves latest timestamp', () => {
    setActivityLatestTimestamp('user1', 5000)
    expect(getActivityLatestTimestamp('user1')).toBe(5000)
  })
})

describe('hasUnseenActivity', () => {
  it('returns false when no activity', () => {
    expect(hasUnseenActivity('user1')).toBe(false)
  })

  it('returns true when latest > seen', () => {
    setActivitySeenTimestamp('user1', 1000)
    setActivityLatestTimestamp('user1', 2000)
    expect(hasUnseenActivity('user1')).toBe(true)
  })

  it('returns false when latest <= seen', () => {
    setActivitySeenTimestamp('user1', 3000)
    setActivityLatestTimestamp('user1', 2000)
    expect(hasUnseenActivity('user1')).toBe(false)
  })

  it('returns false when latest equals seen', () => {
    setActivitySeenTimestamp('user1', 1000)
    setActivityLatestTimestamp('user1', 1000)
    expect(hasUnseenActivity('user1')).toBe(false)
  })

  it('returns false when latest is 0', () => {
    setActivitySeenTimestamp('user1', 0)
    setActivityLatestTimestamp('user1', 0)
    expect(hasUnseenActivity('user1')).toBe(false)
  })
})
