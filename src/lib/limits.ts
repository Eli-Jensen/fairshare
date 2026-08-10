/** Shared caps. Kept in one place so the create and restore paths agree. */

/** Trips + groups one account may own. */
export const MAX_TRIPS = 100

/** Receipt photos per expense. UI-enforced; storage.rules caps size/type. */
export const MAX_RECEIPTS_PER_EXPENSE = 3
/** Keep in sync with storage.rules (`request.resource.size < 2MB`). */
export const MAX_RECEIPT_BYTES = 2 * 1024 * 1024

/**
 * Expenses a single Google Sheets restore may write. Each expense is one
 * Firestore write and the Spark plan allows 20K/day, so this keeps the
 * worst-case restore at ~5% of the daily budget.
 */
export const MAX_RESTORE_EXPENSES = 1000
