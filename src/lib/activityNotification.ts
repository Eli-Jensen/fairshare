import type { Trip } from './types'

const SEEN_KEY_PREFIX = 'fairshare-activity-seen-'

export function getActivitySeenTimestamp(uid: string): number {
  try {
    const raw = localStorage.getItem(SEEN_KEY_PREFIX + uid)
    return raw ? parseInt(raw, 10) : 0
  } catch {
    return 0
  }
}

export function setActivitySeenTimestamp(uid: string, timestamp: number): void {
  try {
    localStorage.setItem(SEEN_KEY_PREFIX + uid, String(timestamp))
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * True when any trip has activity from someone else newer than the last
 * time this user opened the Activity page on this device.
 */
export function hasUnseenActivity(uid: string, trips: Trip[]): boolean {
  const seen = getActivitySeenTimestamp(uid)
  return trips.some((trip) => {
    if (trip.lastActivityBy === uid) return false
    const last = trip.lastActivityAt?.toMillis?.() ?? 0
    return last > seen
  })
}
