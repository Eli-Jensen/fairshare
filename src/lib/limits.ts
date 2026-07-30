/** Shared caps. Kept in one place so the create and restore paths agree. */

/** Trips + groups one account may own. */
export const MAX_TRIPS = 100

/**
 * Expenses a single Google Sheets restore may write. Each expense is one
 * Firestore write and the Spark plan allows 20K/day, so this keeps the
 * worst-case restore at ~5% of the daily budget.
 */
export const MAX_RESTORE_EXPENSES = 1000
