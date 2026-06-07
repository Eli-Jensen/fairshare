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
  lastCurrency?: string
  settlementCurrency: string // e.g. 'USD', 'EUR', 'GBP'
  simplifyDebts?: boolean // defaults to true
  createdAt: Timestamp
}

export interface Expense {
  id: string
  description: string
  amount: number
  currency: string
  exchangeRate: number
  /** Amount in the trip's settlement currency. Field is named amountUSD
   *  for backward compatibility with existing Firestore docs. */
  amountUSD: number
  paidBy: string
  paidByAmounts?: Record<string, number>
  splitType: 'equal' | 'exact' | 'percentage' | 'shares'
  splits: Record<string, number>
  date: Timestamp
  notes?: string
  category?: ExpenseCategory
  isSettlement?: boolean
  comments?: Array<{ uid: string; text: string; createdAt: Timestamp }>
  createdBy: string
  createdAt: Timestamp
  deletedAt?: Timestamp | null
}

export type ExpenseCategory = 'food' | 'transport' | 'accommodation' | 'activities' | 'shopping' | 'other'

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string; emoji: string }[] = [
  { value: 'food', label: 'Food', emoji: '🍽️' },
  { value: 'transport', label: 'Transport', emoji: '🚗' },
  { value: 'accommodation', label: 'Accommodation', emoji: '🏨' },
  { value: 'activities', label: 'Activities', emoji: '🎯' },
  { value: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { value: 'other', label: 'Other', emoji: '📦' },
]

export interface Settlement {
  from: string
  to: string
  amount: number
}

export interface ActivityLogEntry {
  id: string
  action: 'expense_added' | 'expense_edited' | 'expense_deleted' | 'settlement_recorded' | 'member_joined' | 'member_left' | 'member_removed' | 'trip_created'
  actorUid: string
  targetDescription?: string
  targetAmount?: number
  createdAt: Timestamp
}

/**
 * Format a monetary amount in any currency using the browser's Intl API.
 * Falls back gracefully if the currency code is unknown.
 */
export function formatMoney(amount: number, currencyCode: string = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).format(amount)
  } catch {
    // Unknown currency code — fall back to simple format
    return `${currencyCode} ${amount.toFixed(2)}`
  }
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
