const SEEN_KEY_PREFIX = 'fairshare-activity-seen-'
const LATEST_KEY_PREFIX = 'fairshare-activity-latest-'

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

export function getActivityLatestTimestamp(uid: string): number {
  try {
    const raw = localStorage.getItem(LATEST_KEY_PREFIX + uid)
    return raw ? parseInt(raw, 10) : 0
  } catch {
    return 0
  }
}

export function setActivityLatestTimestamp(uid: string, timestamp: number): void {
  try {
    localStorage.setItem(LATEST_KEY_PREFIX + uid, String(timestamp))
  } catch {
    // localStorage full or unavailable
  }
}

export function hasUnseenActivity(uid: string): boolean {
  const seen = getActivitySeenTimestamp(uid)
  const latest = getActivityLatestTimestamp(uid)
  return latest > seen && latest > 0
}
