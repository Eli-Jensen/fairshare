import type { Timestamp } from 'firebase/firestore'

export interface UserProfile {
  uid: string
  displayName: string
  email: string
  photoURL: string | null
  googleDisplayName?: string
  googlePhotoURL?: string | null
}

export interface RemovedMember {
  uid: string
  email: string
  displayName: string
  removedAt: Timestamp
}

export interface Trip {
  id: string
  name: string
  createdBy: string
  memberUids: string[]
  inviteCode: string
  invitedEmails?: string[]
  removedMembers?: RemovedMember[]
  deletedAt?: Timestamp | null
  lastRates?: Record<string, number>
  createdAt: Timestamp
}

export interface Expense {
  id: string
  description: string
  amount: number
  currency: string
  exchangeRate: number
  amountUSD: number
  paidBy: string
  splitType: 'equal' | 'exact' | 'percentage' | 'shares'
  splits: Record<string, number>
  date: Timestamp
  createdBy: string
  createdAt: Timestamp
  deletedAt?: Timestamp | null
}

export interface Settlement {
  from: string
  to: string
  amount: number
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

/**
 * Returns a display name for a member, appending their email in parentheses
 * if another member in the same group shares the same display name.
 */
export function getMemberName(
  uid: string,
  members: Record<string, UserProfile>
): string {
  const member = members[uid]
  if (!member) return uid
  const name = member.displayName || member.email
  const isDuplicate = Object.entries(members).some(
    ([otherUid, other]) =>
      otherUid !== uid && (other.displayName || other.email) === name
  )
  if (isDuplicate) return `${name} (${member.email})`
  return name
}
