import type { Timestamp } from 'firebase/firestore'

// ── Constants ──────────────────────────────────────────────────────────
/** Default settlement currency for trips that don't specify one */
export const DEFAULT_CURRENCY = 'USD'
/** Tolerance for comparing monetary amounts (e.g. split totals) */
export const AMOUNT_TOLERANCE = 0.02
/** Threshold below which a balance is considered zero */
export const BALANCE_THRESHOLD = 0.01

export interface UserProfile {
  uid: string
  displayName: string
  email: string
  photoURL: string | null
  googleDisplayName?: string
  googlePhotoURL?: string | null
  /** Synthesized profile for a guest (placeholder member) — not in /users */
  isPlaceholder?: boolean
}

/** An invited-but-not-yet-joined participant. Created by inviting an email;
 *  lives on the trip doc and its `ph_` id is used everywhere a uid is
 *  (splits, paidBy, balances). Displays as the email until the person joins,
 *  at which point their history is claimed onto their real uid. */
export interface PlaceholderMember {
  id: string     // 'ph_' + random — can never collide with a Firebase uid
  email: string  // lowercase; the link to the real account when they join
  name?: string  // usually unset (we show the email); reserved
  createdBy: string
  createdAt: Timestamp
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
  /** Invite code echoed by the most recent link-join, which is how the rules
   *  verify a self-joiner actually holds a live invite. Written by JoinTrip;
   *  never read by the app. */
  joinedWith?: string
  invitedEmails?: string[]
  removedMembers?: RemovedMember[]
  placeholderMembers?: PlaceholderMember[]
  /** Pending placeholder→uid merges, recorded when someone joins and picked
   *  up by the reconciler that rewrites expense references. ph_ ids → uids. */
  placeholderClaims?: Record<string, string>
  deletedAt?: Timestamp | null
  lastRates?: Record<string, number>
  lastCurrency?: string
  settlementCurrency: string // e.g. 'USD', 'EUR', 'GBP'
  customCategories?: CustomCategory[]
  createdAt: Timestamp
  // Denormalized expense summary (updated by useTrip when full data is loaded)
  cachedExpenseCount?: number
  cachedTotalSpent?: number
  cachedLatestDesc?: string | null
  cachedLatestAmount?: number | null
  cachedBalances?: Record<string, number>
  // Stamped by writeActivity — powers the unseen-activity dot and lets the
  // global Activity page skip refetching unchanged trips
  lastActivityAt?: Timestamp
  lastActivityBy?: string
}

export interface Expense {
  id: string
  description: string
  amount: number       // amount in the original currency
  currency: string     // the currency the expense was entered in
  exchangeRate: number // multiplier: amount × exchangeRate = amountSettled
  /** Amount converted to the trip's settlement currency.
   *  Stored as `amountUSD` in Firestore for backward compatibility. */
  amountSettled: number
  paidBy: string
  paidByAmounts?: Record<string, number>
  splitType: 'equal' | 'exact' | 'percentage' | 'shares'
  splits: Record<string, number>
  date: Timestamp
  notes?: string
  category?: ExpenseCategory        // legacy single category
  categories?: ExpenseCategory[]    // multi-tag categories (preferred)
  isSettlement?: boolean
  comments?: Array<{ uid: string; text: string; createdAt: Timestamp }>
  createdBy: string
  createdAt: Timestamp
  deletedAt?: Timestamp | null
}

/**
 * Map a raw Firestore expense document to the Expense interface.
 * Handles the `amountUSD` → `amountSettled` field rename.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapExpense(doc: { id: string } & Record<string, any>): Expense {
  const { amountUSD, ...rest } = doc
  return { ...rest, amountSettled: amountUSD ?? 0 } as Expense
}

/** The Firestore field name for amountSettled (legacy, do not rename in Firestore) */
export const FIRESTORE_AMOUNT_FIELD = 'amountUSD'

/** Get all categories for an expense (handles both legacy `category` and new `categories` field). */
export function getExpenseCategories(expense: Expense): string[] {
  if (expense.categories && expense.categories.length > 0) return expense.categories
  if (expense.category) return [expense.category]
  return []
}

export type ExpenseCategory = string

export interface CategoryInfo {
  value: string
  label: string
  emoji: string
}

export const EXPENSE_CATEGORIES: CategoryInfo[] = [
  { value: 'food', label: 'Food', emoji: '🍽️' },
  { value: 'transport', label: 'Transport', emoji: '✈️' },
  { value: 'accommodation', label: 'Housing', emoji: '🏨' },
  { value: 'entertainment', label: 'Fun', emoji: '🎭' },
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
  action:
    | 'expense_added' | 'expense_edited' | 'expense_deleted' | 'expense_restored'
    | 'settlement_recorded'
    | 'member_joined' | 'member_left' | 'member_removed' | 'member_invited'
    | 'invite_rescinded'
    | 'trip_created' | 'trip_renamed' | 'trip_deleted' | 'trip_restored'
    | 'currency_changed'
    | 'comment_added'
    | 'history_cleared'
  actorUid: string
  targetDescription?: string
  targetAmount?: number
  targetExpenseId?: string   // the expense doc id — enables undo from activity
  targetMemberUid?: string   // for member actions: the member who was added/removed
  targetPayeeUid?: string    // for settlements: who received the payment
  // For settlements: who actually clicked Record payment. `actorUid` is the
  // PAYER (so the log reads "Bob paid Carol" whoever typed it), and anyone in
  // the trip may record on someone else's behalf — push needs to tell the two
  // apart so it doesn't skip notifying the payer.
  recordedBy?: string
  paymentMethod?: string     // for settlements: e.g. "Venmo", "Cash"
  editDetails?: string[]     // e.g. ["amount: $50 → $60", "description: Lunch → Dinner"]
  previousValues?: Record<string, unknown>  // old field values for undo (uses Firestore field names)
  tripId?: string            // set when querying across trips for global activity
  tripName?: string          // set when querying across trips for global activity
  // Set by the undo paths in activityUndo.ts. Undoing an add writes a
  // counter-entry (expense_deleted), and pushing that would contradict the
  // notification that already went out seconds earlier — so the Cloud Function
  // skips these entirely. They still appear in the activity log.
  suppressPush?: boolean
  createdAt: Timestamp
}

/**
 * Format a monetary amount in any currency using the browser's Intl API.
 * Falls back gracefully if the currency code is unknown.
 */
export function formatMoney(amount: number, currencyCode: string = DEFAULT_CURRENCY): string {
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
  if (isDuplicate) return `${name} (${member.email || 'guest'})`
  return name
}
