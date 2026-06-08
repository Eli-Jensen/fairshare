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

export type TripType = 'trip' | 'group'

/** Returns "trip" or "group" label for display text */
export function tripLabel(type?: TripType): string {
  return type === 'group' ? 'group' : 'trip'
}

export interface Trip {
  id: string
  name: string
  type?: TripType // defaults to 'trip' for backward compat
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
  customCategories?: CustomCategory[]
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

export type ExpenseCategory = string

export interface CategoryInfo {
  value: string
  label: string
  emoji: string
}

export const EXPENSE_CATEGORIES: CategoryInfo[] = [
  { value: 'food', label: 'Food', emoji: '🍽️' },
  { value: 'transport', label: 'Transport', emoji: '🚗' },
  { value: 'accommodation', label: 'Housing', emoji: '🏨' },
  { value: 'entertainment', label: 'Entertainment', emoji: '🎭' },
  { value: 'other', label: 'Other', emoji: '📦' },
]

const LEGACY_CATEGORIES: Record<string, { label: string; emoji: string }> = {
  food_and_drink: { label: 'Food & Drink', emoji: '🍽️' },
  groceries: { label: 'Groceries', emoji: '🛒' },
  activities: { label: 'Activities', emoji: '🎯' },
  shopping: { label: 'Shopping', emoji: '🛍️' },
  health: { label: 'Health', emoji: '💊' },
  tips: { label: 'Tips', emoji: '💰' },
  services: { label: 'Services', emoji: '🔧' },
}

export interface CustomCategory {
  id: string   // unique slug, e.g. "drinks", "souvenirs"
  label: string // display text, max 20 chars
  emoji: string // single emoji
}

/** Get display info for a category by its value/id. Checks defaults, legacy, then trip customs. */
export function getCategoryInfo(
  value: string,
  customCategories?: CustomCategory[]
): { label: string; emoji: string } | undefined {
  const defaultCat = EXPENSE_CATEGORIES.find((c) => c.value === value)
  if (defaultCat) return defaultCat
  if (LEGACY_CATEGORIES[value]) return LEGACY_CATEGORIES[value]
  const custom = customCategories?.find((c) => c.id === value)
  if (custom) return { label: custom.label, emoji: custom.emoji }
  return undefined
}

/** Get all available categories for a trip (defaults + custom). */
export function getAllCategories(customCategories?: CustomCategory[]): CategoryInfo[] {
  const cats = [...EXPENSE_CATEGORIES]
  if (customCategories) {
    for (const c of customCategories) {
      cats.push({ value: c.id, label: c.label, emoji: c.emoji })
    }
  }
  return cats
}

/** Check if an emoji+label combo already exists in defaults or custom categories. */
export function categoryExists(
  emoji: string,
  label: string,
  customCategories?: CustomCategory[]
): boolean {
  const key = `${emoji}${label.toLowerCase().trim()}`
  for (const cat of EXPENSE_CATEGORIES) {
    if (`${cat.emoji}${cat.label.toLowerCase()}` === key) return true
  }
  if (customCategories) {
    for (const cat of customCategories) {
      if (`${cat.emoji}${cat.label.toLowerCase().trim()}` === key) return true
    }
  }
  return false
}

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
  targetPayeeUid?: string   // for settlements: who received the payment
  paymentMethod?: string    // for settlements: e.g. "Venmo", "Cash"
  editDetails?: string[]    // e.g. ["amount: $50 → $60", "description: Lunch → Dinner"]
  tripId?: string           // set when querying across trips for global activity
  tripName?: string         // set when querying across trips for global activity
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
