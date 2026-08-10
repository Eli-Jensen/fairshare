import type {
  Trip,
  Expense,
  UserProfile,
  CustomCategory,
  TripType,
} from './types'
import {
  DEFAULT_CURRENCY,
  getCategoryInfo,
  getExpenseCategories,
} from './types'
import { timestampToDateString } from './dates'
import { involvedParticipantIds, participantLabel } from './participants'
import { computeBalances, simplifyDebts } from './settlement'
import type { BalanceInput } from './settlement'

/**
 * Turns a trip into the grid of cell values that becomes its Google Sheets
 * backup. Pure — no Firestore, no network, no clock.
 *
 * Two rules make the sheet both readable by a person and losslessly parseable
 * back into a trip (see sheetParse.ts):
 *
 *  1. Cells hold raw numbers and date serials, never formatted strings. The
 *     currency symbols and date patterns are display formatting applied
 *     separately (sheetFormat.ts), so nothing has to be un-formatted on the way
 *     back in.
 *  2. Row 1 of every tab is a machine-key header, hidden in the UI; row 2 is
 *     the human header. Participant columns are keyed by participant *id* in
 *     row 1, so a rename — or two people with the same display name — can never
 *     orphan a column.
 */

export const SCHEMA_VERSION = 1
/** Bump when the formatting requests change, to trigger a re-apply. */
export const FORMAT_VERSION = 1

export const TABS = {
  expenses: { sheetId: 1, title: 'Expenses' },
  people: { sheetId: 2, title: 'People' },
  summary: { sheetId: 3, title: 'Summary' },
  meta: { sheetId: 4, title: 'Meta' },
} as const

/** Fixed columns before the per-participant block. */
const FIXED_KEYS = [
  'date',
  'type',
  'categories',
  'description',
  'notes',
  'currency',
  'amountOriginal',
  'exchangeRate',
  'amountSettled',
] as const
/** Machine-only columns after the per-participant block. */
const TRAILING_KEYS = ['expenseId', 'splitType', 'categoryIds'] as const

export const FIXED_COLUMN_COUNT = FIXED_KEYS.length
export const TRAILING_COLUMN_COUNT = TRAILING_KEYS.length

export type CellValue = string | number | boolean

export interface Grid {
  sheetId: number
  title: string
  values: CellValue[][]
}

/** Shape of the written sheet — what sheetFormat needs to size and style it. */
export interface SheetLayout {
  participantCount: number
  /** Index of the first trailing machine-only column. */
  machineColumnStart: number
  expensesColumnCount: number
  expensesRowCount: number
  settlementCurrency: string
}

export type ParticipantStatus = 'member' | 'invited' | 'removed'

export interface SheetPerson {
  id: string
  name: string
  email: string
  status: ParticipantStatus
  isSelf: boolean
}

/** One expense in sheet terms: participant ids intact, amounts as numbers. */
export interface SheetExpense {
  expenseId: string
  /** YYYY-MM-DD, date-only. */
  date: string
  isSettlement: boolean
  categoryIds: string[]
  description: string
  notes: string
  currency: string
  amountOriginal: number
  exchangeRate: number
  amountSettled: number
  splitType: Expense['splitType']
  /** Only the ids actually present in paidBy/paidByAmounts. A 0 here is real. */
  paid: Record<string, number>
  /** Only the ids actually present in splits. A 0 here is real. */
  shares: Record<string, number>
}

export interface SheetSnapshot {
  schemaVersion: number
  sourceTripId: string
  tripName: string
  tripType: TripType
  settlementCurrency: string
  customCategories: CustomCategory[]
  exportedAt: string
  exportedBy: string
  people: SheetPerson[]
  expenses: SheetExpense[]
}

// ── Date serials ───────────────────────────────────────────────────────────
// Sheets counts days from 1899-12-30. Everything goes through UTC so a DST
// boundary can't shift a date-only value by a day.

const SERIAL_EPOCH_OFFSET = 25569 // days from 1899-12-30 to 1970-01-01
const MS_PER_DAY = 86400000

/** YYYY-MM-DD → Sheets date serial. */
export function ymdToSerial(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1) / MS_PER_DAY + SERIAL_EPOCH_OFFSET
}

/** Sheets date serial → YYYY-MM-DD. Fractional serials floor to their day. */
export function serialToYmd(serial: number): string {
  const date = new Date((Math.floor(serial) - SERIAL_EPOCH_OFFSET) * MS_PER_DAY)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * A Sheets number-format pattern for a currency code, e.g. USD → `"$"#,##0.00`.
 * Always two decimals: the app stores decimal amounts and splits in cents, so
 * a zero-decimal currency like JPY would hide real data.
 */
export function currencyNumberPattern(code: string): string {
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).formatToParts(0)
    const symbolIndex = parts.findIndex((p) => p.type === 'currency')
    const numberIndex = parts.findIndex((p) => p.type === 'integer')
    const symbol = parts[symbolIndex]?.value
    if (!symbol || numberIndex < 0) return `#,##0.00" ${code}"`
    const quoted = `"${symbol.replace(/"/g, '')}"`
    return symbolIndex < numberIndex ? `${quoted}#,##0.00` : `#,##0.00${quoted}`
  } catch {
    // Malformed currency code — Intl throws rather than guessing
    return `#,##0.00" ${code}"`
  }
}

// ── Snapshot ───────────────────────────────────────────────────────────────

/** computeBalances input for a parsed/serialized expense. */
export function toBalanceInput(e: SheetExpense): BalanceInput {
  const payers = Object.keys(e.paid)
  return {
    paidBy: payers.length > 0 ? largestPayer(e.paid) : '',
    paidByAmounts: payers.length > 1 ? e.paid : undefined,
    amountSettled: e.amountSettled,
    splits: e.shares,
  }
}

/** The payer who covered the most — how ExpenseForm derives `paidBy`. */
export function largestPayer(paid: Record<string, number>): string {
  let best = ''
  let bestAmount = -Infinity
  for (const [uid, amount] of Object.entries(paid)) {
    if (amount > bestAmount) {
      best = uid
      bestAmount = amount
    }
  }
  return best
}

export function buildSnapshot(args: {
  trip: Trip
  /** The complete, non-deleted expense list (loadAllExpenses already filters). */
  expenses: Expense[]
  members: Record<string, UserProfile>
  /** memberUids + placeholder ids, from useTrip. */
  participants: string[]
  currentUid: string
  /** ISO string — passed in rather than read from the clock, to stay pure. */
  exportedAt: string
}): SheetSnapshot {
  const { trip, expenses, members, participants, currentUid, exportedAt } = args
  const ids = involvedParticipantIds(expenses, participants)

  const people: SheetPerson[] = ids.map((id) => {
    const profile = members[id]
    const removed = trip.removedMembers?.find((r) => r.uid === id)
    const status: ParticipantStatus = !participants.includes(id)
      ? 'removed'
      : trip.memberUids.includes(id)
        ? 'member'
        : 'invited'
    return {
      id,
      // The plain name, not participantLabel's annotated one — restore reuses
      // this verbatim as the guest's name
      name: profile?.displayName || profile?.email || removed?.displayName || id,
      email: profile?.email || removed?.email || '',
      status,
      isSelf: id === currentUid,
    }
  })

  const rows: SheetExpense[] = expenses.map((exp) => {
    const paid =
      exp.paidByAmounts && Object.keys(exp.paidByAmounts).length > 0
        ? { ...exp.paidByAmounts }
        : { [exp.paidBy]: exp.amountSettled }
    return {
      expenseId: exp.id,
      date: timestampToDateString(exp.date),
      isSettlement: Boolean(exp.isSettlement),
      categoryIds: getExpenseCategories(exp),
      description: exp.description,
      notes: exp.notes ?? '',
      currency: exp.currency,
      amountOriginal: exp.amount,
      exchangeRate: exp.exchangeRate,
      amountSettled: exp.amountSettled,
      splitType: exp.splitType,
      paid,
      shares: { ...exp.splits },
    }
  })

  // Chronological reads better than the newest-first listener order, and makes
  // the sheet (and its content hash) stable across reloads
  rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.expenseId.localeCompare(b.expenseId)
  )

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceTripId: trip.id,
    tripName: trip.name,
    tripType: trip.type ?? 'trip',
    settlementCurrency: trip.settlementCurrency || DEFAULT_CURRENCY,
    customCategories: trip.customCategories ?? [],
    exportedAt,
    exportedBy: currentUid,
    people,
    expenses: rows,
  }
}

// ── Grids ──────────────────────────────────────────────────────────────────

const META_NOTE =
  'FairShare overwrites these tabs on each backup. Edits here do not sync back — but a Restore will import whatever is here.'

/** Fields deliberately not backed up, so a reader knows what is missing. */
const META_OMITTED = 'comments (incl. reactions, GIFs, photos), receipt photos, per-expense author, activity log, exchange-rate cache'

export function snapshotToGrids(snapshot: SheetSnapshot): {
  grids: Grid[]
  layout: SheetLayout
} {
  const sc = snapshot.settlementCurrency
  const people = snapshot.people
  const n = people.length
  const machineColumnStart = FIXED_COLUMN_COUNT + 2 * n
  const columnCount = machineColumnStart + TRAILING_COLUMN_COUNT

  // Expenses ───────────────────────────────────────────────────────────────
  const machineRow: CellValue[] = [
    ...FIXED_KEYS,
    ...people.flatMap((p) => [`paid:${p.id}`, `share:${p.id}`]),
    ...TRAILING_KEYS,
  ]
  // Column headers reuse the CSV export's labels, so "(invited)"/"(removed)"
  // and the duplicate-name disambiguation read the same in both exports
  const labelProfiles: Record<string, UserProfile> = Object.fromEntries(
    people.map((p) => [
      p.id,
      { uid: p.id, displayName: p.name, email: p.email, photoURL: null },
    ])
  )
  const labelMemberUids = people
    .filter((p) => p.status !== 'removed')
    .map((p) => p.id)
  const labelRemoved = people
    .filter((p) => p.status === 'removed')
    .map((p) => ({ uid: p.id, email: p.email, displayName: p.name }))
  const label = (id: string) =>
    participantLabel(id, labelProfiles, labelMemberUids, labelRemoved)
  const humanRow: CellValue[] = [
    'Date',
    'Type',
    'Categories',
    'Description',
    'Notes',
    'Currency',
    'Original amount',
    'Rate',
    `Amount (${sc})`,
    ...people.flatMap((p) => [`${label(p.id)} paid`, `${label(p.id)} share`]),
    'Expense ID',
    'Split type',
    'Category IDs',
  ]

  const expenseRows: CellValue[][] = snapshot.expenses.map((e) => [
    ymdToSerial(e.date),
    e.isSettlement ? 'Settlement' : 'Expense',
    e.categoryIds
      .map((c) => getCategoryInfo(c, snapshot.customCategories)?.label)
      .filter(Boolean)
      .join(', '),
    e.description,
    e.notes,
    e.currency,
    e.amountOriginal,
    e.exchangeRate,
    e.amountSettled,
    // An explicit 0 is meaningful (an excluded participant); an absent id is
    // not the same thing, so it stays blank
    ...people.flatMap((p) => [
      p.id in e.paid ? e.paid[p.id] : '',
      p.id in e.shares ? e.shares[p.id] : '',
    ]),
    e.expenseId,
    e.splitType,
    e.categoryIds.join(','),
  ])

  const total = snapshot.expenses
    .filter((e) => !e.isSettlement)
    .reduce((s, e) => s + e.amountSettled, 0)
  const blank: CellValue[] = Array(columnCount).fill('')
  const totalRow: CellValue[] = Array(columnCount).fill('')
  totalRow[3] = 'TOTAL (expenses)'
  totalRow[8] = Math.round(total * 100) / 100

  const expensesValues = [machineRow, humanRow, ...expenseRows, blank, totalRow]

  // People ─────────────────────────────────────────────────────────────────
  const peopleValues: CellValue[][] = [
    ['participantId', 'name', 'email', 'status', 'self'],
    ['Participant ID', 'Name', 'Email', 'Status', 'You'],
    ...people.map((p) => [p.id, p.name, p.email, p.status, p.isSelf ? 'TRUE' : '']),
  ]

  // Summary ────────────────────────────────────────────────────────────────
  const balanceInputs = snapshot.expenses.map(toBalanceInput)
  const balances = computeBalances(
    balanceInputs,
    people.map((p) => p.id)
  )
  const paidTotals: Record<string, number> = {}
  const shareTotals: Record<string, number> = {}
  for (const e of snapshot.expenses) {
    if (e.isSettlement) continue
    for (const [id, amt] of Object.entries(e.paid)) {
      paidTotals[id] = (paidTotals[id] ?? 0) + amt
    }
    for (const [id, amt] of Object.entries(e.shares)) {
      shareTotals[id] = (shareTotals[id] ?? 0) + amt
    }
  }
  const round2 = (x: number) => Math.round(x * 100) / 100
  const summaryValues: CellValue[][] = [
    ['person', 'totalPaid', 'totalShare', 'balance'],
    ['Person', 'Total paid', 'Total share', 'Balance'],
    ...people.map((p) => [
      label(p.id),
      round2(paidTotals[p.id] ?? 0),
      round2(shareTotals[p.id] ?? 0),
      round2(balances[p.id] ?? 0),
    ]),
    ['', '', '', ''],
    ['Remaining settlements', '', '', ''],
    ['From', 'To', `Amount (${sc})`, ''],
    ...simplifyDebts(balances).map((d) => [
      label(d.from),
      label(d.to),
      d.amount,
      '',
    ]),
  ]

  // Meta ───────────────────────────────────────────────────────────────────
  const metaValues: CellValue[][] = [
    ['key', 'value'],
    ['Key', 'Value'],
    ['schemaVersion', String(snapshot.schemaVersion)],
    ['formatVersion', String(FORMAT_VERSION)],
    ['appVersion', appVersion()],
    ['sourceTripId', snapshot.sourceTripId],
    ['tripName', snapshot.tripName],
    ['tripType', snapshot.tripType],
    ['settlementCurrency', sc],
    ['customCategoriesJson', JSON.stringify(snapshot.customCategories)],
    ['exportedAt', snapshot.exportedAt],
    ['exportedBy', snapshot.exportedBy],
    ['expenseCount', String(snapshot.expenses.length)],
    ['contentHash', hashSnapshot(snapshot)],
    ['notBackedUp', META_OMITTED],
    ['note', META_NOTE],
  ]

  return {
    grids: [
      { ...TABS.expenses, values: expensesValues },
      { ...TABS.people, values: peopleValues },
      { ...TABS.summary, values: summaryValues },
      { ...TABS.meta, values: metaValues },
    ],
    layout: {
      participantCount: n,
      machineColumnStart,
      expensesColumnCount: columnCount,
      expensesRowCount: expensesValues.length,
      settlementCurrency: sc,
    },
  }
}

/** `__APP_VERSION__` is injected by Vite; absent under plain vitest. */
function appVersion(): string {
  try {
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown'
  } catch {
    return 'unknown'
  }
}

// ── Content hash ───────────────────────────────────────────────────────────

/**
 * FNV-1a over a key-sorted JSON rendering. Synchronous (crypto.subtle is
 * async and this is called on every render to decide whether a sync is a
 * no-op) and only ever compared against itself.
 */
export function hashSnapshot(snapshot: SheetSnapshot): string {
  // exportedAt changes on every call, so it can't take part in a hash whose
  // whole job is to answer "has anything actually changed?"
  let hash = 0x811c9dc5
  const json = canonicalJson({ ...snapshot, exportedAt: '' })
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}
