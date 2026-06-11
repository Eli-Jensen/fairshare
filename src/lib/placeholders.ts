import type { Trip, UserProfile } from './types'

/**
 * Guests (placeholder members) are trip participants without accounts.
 * They live in trip.placeholderMembers — never in memberUids, which stays
 * the security boundary of real authenticated users. Their ids flow through
 * splits/paidBy/balances exactly like uids.
 */

/** 'ph_' prefix can never collide with a Firebase uid (alphanumeric only). */
export function generatePlaceholderId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return 'ph_' + Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

export function isPlaceholderId(id: string): boolean {
  return id.startsWith('ph_')
}

/** Everyone who can pay or owe on this trip: real members + guests. */
export function participantIds(trip: Trip): string[] {
  return [...trip.memberUids, ...(trip.placeholderMembers ?? []).map((p) => p.id)]
}

/** Synthesized profiles for guests, shaped like real UserProfiles so the
 *  members map, avatars, and name resolution work unchanged. */
export function placeholderProfiles(trip: Trip): Record<string, UserProfile> {
  const profiles: Record<string, UserProfile> = {}
  for (const ph of trip.placeholderMembers ?? []) {
    profiles[ph.id] = {
      uid: ph.id,
      displayName: ph.name,
      email: ph.email ?? '',
      photoURL: null,
      isPlaceholder: true,
    }
  }
  return profiles
}
