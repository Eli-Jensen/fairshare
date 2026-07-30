import type { CustomCategory, UserProfile, Expense } from './types'
import {
  AMOUNT_TOLERANCE,
  BALANCE_THRESHOLD,
  DEFAULT_CURRENCY,
  getAllCategories,
} from './types'
import { todayString } from './dates'
import { splitProportionally } from './splits'
import { computeBalances } from './settlement'
import { participantLabel } from './participants'
import { MAX_RESTORE_EXPENSES } from './limits'
import type {
  CellValue,
  ParticipantStatus,
  SheetExpense,
  SheetPerson,
  SheetSnapshot,
} from './sheetSnapshot'
import { SCHEMA_VERSION, largestPayer, serialToYmd, toBalanceInput } from './sheetSnapshot'

/**
 * Reads a Google Sheets backup back into a snapshot. Pure — the caller turns
 * the result into Firestore writes (sheetRestore.ts).
 *
 * The sheet is a user-owned document, so this is parsing hostile input: rows
 * get typed over, columns get deleted, a hidden header row gets removed by
 * someone tidying up. Every recoverable problem produces a warning the preview
 * screen shows; only problems that would corrupt the books are errors.
 *
 * The one invariant that is never negotiated: the restored expenses must make
 * the balances net to zero. Anything else lets a restore invent or destroy
 * money.
 */

const SPLIT_TYPES: Expense['splitType'][] = ['equal', 'exact', 'percentage', 'shares']

/** AMOUNT_TOLERANCE in whole cents, so comparisons don't hit float noise. */
const TOLERANCE_CENTS = Math.round(AMOUNT_TOLERANCE * 100)

/** What the Sheets API hands back per range: ragged rows of raw cell values. */
export type RawGrid = CellValue[][]

export interface RawGrids {
  expenses: RawGrid
  people: RawGrid
  meta: RawGrid
}

export type ParseResult =
  | { ok: true; snapshot: SheetSnapshot; warnings: string[] }
  | { ok: false; error: string; warnings: string[] }

// ── Cell helpers ───────────────────────────────────────────────────────────
// Rows are ragged — the API omits trailing empties — so never index directly.

function cell(row: CellValue[] | undefined, i: number): CellValue {
  if (!row || i < 0 || i >= row.length) return ''
  return row[i] ?? ''
}

function text(row: CellValue[] | undefined, i: number): string {
  const v = cell(row, i)
  return typeof v === 'string' ? v.trim() : String(v)
}

/** A number, or undefined for a blank/unparseable cell. Tolerates a user who
 *  typed "$12.50" over a raw number. */
function num(row: CellValue[] | undefined, i: number): number | undefined {
  const v = cell(row, i)
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'boolean') return undefined
  const s = v.trim()
  if (!s) return undefined
  const cleaned = s.replace(/[^0-9.,\-+]/g, '').replace(/,/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '+') return undefined
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : undefined
}

function isBlank(row: CellValue[] | undefined, i: number): boolean {
  return text(row, i) === ''
}

const round2 = (x: number) => Math.round(x * 100) / 100
const sumValues = (m: Record<string, number>) =>
  Object.values(m).reduce((s, v) => s + v, 0)

// ── Column mapping ─────────────────────────────────────────────────────────

interface ColumnMap {
  fixed: Record<string, number>
  paid: Record<string, number>
  share: Record<string, number>
  /** True when row 1 carried machine keys, so ids came from the sheet itself. */
  fromMachineRow: boolean
}

const HUMAN_FIXED_LABELS: Record<string, string> = {
  date: 'date',
  type: 'type',
  categories: 'categories',
  description: 'description',
  notes: 'notes',
  currency: 'currency',
  'original amount': 'amountOriginal',
  rate: 'exchangeRate',
  'expense id': 'expenseId',
  'split type': 'splitType',
  'category ids': 'categoryIds',
}

/**
 * Where the header lives. The export writes a hidden machine row then a human
 * row, but a user may have deleted either, so both are searched for near the top
 * rather than assumed to be at fixed indices.
 */
function locateHeader(grid: RawGrid): {
  machineRow?: CellValue[]
  humanRow?: CellValue[]
  firstDataRow: number
} | null {
  const SEARCH_DEPTH = Math.min(grid.length, 4)

  for (let i = 0; i < SEARCH_DEPTH; i++) {
    const row = grid[i] ?? []
    const keys = row.map((_, j) => text(row, j))
    if (keys.includes('expenseId') || keys.some((k) => k.startsWith('paid:'))) {
      return { machineRow: row, humanRow: grid[i + 1], firstDataRow: i + 2 }
    }
  }

  for (let i = 0; i < SEARCH_DEPTH; i++) {
    const row = grid[i] ?? []
    const labels = row.map((_, j) => text(row, j).toLowerCase())
    if (labels.includes('description') && labels.some((l) => l.startsWith('amount'))) {
      return { humanRow: row, firstDataRow: i + 1 }
    }
  }

  return null
}

function mapColumnsFromMachineRow(row: CellValue[]): ColumnMap {
  const map: ColumnMap = { fixed: {}, paid: {}, share: {}, fromMachineRow: true }
  for (let i = 0; i < row.length; i++) {
    const key = text(row, i)
    if (!key) continue
    if (key.startsWith('paid:')) map.paid[key.slice(5)] = i
    else if (key.startsWith('share:')) map.share[key.slice(6)] = i
    else map.fixed[key] = i
  }
  return map
}

/**
 * Recover the layout from the human header row when the hidden machine row is
 * gone. Participant columns are matched by the label the export wrote, which is
 * reconstructible from the People tab.
 */
function mapColumnsFromHumanRow(row: CellValue[], people: SheetPerson[]): ColumnMap {
  const map: ColumnMap = { fixed: {}, paid: {}, share: {}, fromMachineRow: false }

  for (let i = 0; i < row.length; i++) {
    const label = text(row, i)
    if (!label) continue
    const lower = label.toLowerCase()
    const fixedKey = HUMAN_FIXED_LABELS[lower]
    if (fixedKey) {
      map.fixed[fixedKey] = i
      continue
    }
    // "Amount (EUR)" — the code varies, so match on the prefix
    if (lower.startsWith('amount') && map.fixed.amountSettled === undefined) {
      map.fixed.amountSettled = i
    }
  }

  const profiles: Record<string, UserProfile> = Object.fromEntries(
    people.map((p) => [
      p.id,
      { uid: p.id, displayName: p.name, email: p.email, photoURL: null },
    ])
  )
  const memberUids = people.filter((p) => p.status !== 'removed').map((p) => p.id)
  const removed = people
    .filter((p) => p.status === 'removed')
    .map((p) => ({ uid: p.id, email: p.email, displayName: p.name }))

  for (const person of people) {
    const label = participantLabel(person.id, profiles, memberUids, removed).toLowerCase()
    for (let i = 0; i < row.length; i++) {
      const header = text(row, i).toLowerCase()
      if (header === `${label} paid`) map.paid[person.id] = i
      else if (header === `${label} share`) map.share[person.id] = i
    }
    // Looser fallback: the name may have been edited, but the suffix survives
    if (map.paid[person.id] === undefined || map.share[person.id] === undefined) {
      const name = person.name.toLowerCase()
      if (!name) continue
      for (let i = 0; i < row.length; i++) {
        const header = text(row, i).toLowerCase()
        if (!header.startsWith(name)) continue
        if (header.endsWith(' paid') && map.paid[person.id] === undefined) {
          map.paid[person.id] = i
        } else if (header.endsWith(' share') && map.share[person.id] === undefined) {
          map.share[person.id] = i
        }
      }
    }
  }

  return map
}

// ── Meta + People ──────────────────────────────────────────────────────────

function parseMeta(grid: RawGrid): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of grid) {
    const key = text(row, 0)
    if (!key || key === 'key' || key === 'Key') continue
    out[key] = text(row, 1)
  }
  return out
}

const STATUSES: ParticipantStatus[] = ['member', 'invited', 'removed']

function parsePeople(grid: RawGrid, warnings: string[]): SheetPerson[] {
  const people: SheetPerson[] = []
  const seen = new Set<string>()
  for (const row of grid) {
    const id = text(row, 0)
    if (!id || id === 'participantId' || id === 'Participant ID') continue
    if (seen.has(id)) {
      warnings.push(`People tab lists "${id}" more than once — kept the first row.`)
      continue
    }
    seen.add(id)
    const rawStatus = text(row, 3).toLowerCase() as ParticipantStatus
    const status = STATUSES.includes(rawStatus) ? rawStatus : 'invited'
    const name = text(row, 1)
    const email = text(row, 2).toLowerCase()
    people.push({
      id,
      name: name || email || id,
      email,
      status,
      isSelf: text(row, 4).toUpperCase() === 'TRUE',
    })
  }
  return people
}

// ── Main ───────────────────────────────────────────────────────────────────

export function parseGrids(grids: RawGrids): ParseResult {
  const warnings: string[] = []
  const fail = (error: string): ParseResult => ({ ok: false, error, warnings })

  const meta = parseMeta(grids.meta)

  const schemaVersion = Number(meta.schemaVersion)
  if (!Number.isFinite(schemaVersion)) {
    return fail(
      "This sheet doesn't look like a FairShare backup — its Meta tab is missing or empty."
    )
  }
  if (schemaVersion > SCHEMA_VERSION) {
    return fail(
      `This backup was created by a newer version of FairShare (format ${schemaVersion}). Update the app and try again.`
    )
  }

  const people = parsePeople(grids.people, warnings)
  if (people.length === 0) {
    return fail('The People tab is empty, so there is no one to restore the expenses to.')
  }

  let settlementCurrency = meta.settlementCurrency
  if (!settlementCurrency) {
    settlementCurrency = DEFAULT_CURRENCY
    warnings.push(
      `The Meta tab has no settlement currency — assuming ${DEFAULT_CURRENCY}.`
    )
  }

  let customCategories: CustomCategory[] = []
  if (meta.customCategoriesJson) {
    try {
      const parsed = JSON.parse(meta.customCategoriesJson)
      if (Array.isArray(parsed)) customCategories = parsed as CustomCategory[]
    } catch {
      warnings.push('Custom categories in the Meta tab were unreadable and were skipped.')
    }
  }

  let tripName = meta.tripName
  if (!tripName) {
    tripName = 'Restored trip'
    warnings.push('The Meta tab has no trip name — you can rename it below.')
  }

  // Columns ────────────────────────────────────────────────────────────────
  // Find the headers rather than assuming rows 1 and 2: deleting the hidden row
  // shifts everything up, and reading data rows as headers (or vice versa) is
  // the difference between a clean restore and a silently truncated one.
  const header = locateHeader(grids.expenses)
  if (!header) {
    return fail(
      "Couldn't find the header row in the Expenses tab, so there's no way to tell which column is which."
    )
  }
  const columns = header.machineRow
    ? mapColumnsFromMachineRow(header.machineRow)
    : mapColumnsFromHumanRow(header.humanRow ?? [], people)
  const firstDataRow = header.firstDataRow

  if (!header.machineRow) {
    warnings.push(
      "The sheet's hidden header row is missing, so columns were matched by their visible titles. Double-check the amounts below."
    )
  }
  if (columns.fixed.amountSettled === undefined) {
    return fail(
      `The Expenses tab has no "Amount (${settlementCurrency})" column, so there are no amounts to restore.`
    )
  }
  const mappedPeople = people.filter(
    (p) => columns.paid[p.id] !== undefined || columns.share[p.id] !== undefined
  )
  if (mappedPeople.length === 0) {
    return fail(
      'None of the people in the People tab have paid/share columns in the Expenses tab.'
    )
  }
  for (const p of people) {
    if (!mappedPeople.includes(p)) {
      warnings.push(
        `"${p.name}" has no columns in the Expenses tab — they will be restored with no expenses.`
      )
    }
  }

  const hasExpenseIdColumn = columns.fixed.expenseId !== undefined
  if (!hasExpenseIdColumn) {
    warnings.push(
      'The hidden Expense ID column is gone, so rows were identified by position.'
    )
  }

  // Rows ───────────────────────────────────────────────────────────────────
  const labelToCategoryId = new Map<string, string>()
  for (const c of getAllCategories(customCategories)) {
    labelToCategoryId.set(c.label.toLowerCase(), c.value)
  }

  const parsed: SheetExpense[] = []
  const seenIds = new Set<string>()

  for (let r = firstDataRow; r < grids.expenses.length; r++) {
    const row = grids.expenses[r]
    const rowNumber = r + 1 // 1-based, as the user sees it

    // One predicate drops the TOTAL row, blank rows, and anything a user typed
    // below the table
    if (hasExpenseIdColumn) {
      if (isBlank(row, columns.fixed.expenseId)) continue
    } else {
      const description = text(row, columns.fixed.description ?? -1)
      if (description.startsWith('TOTAL')) continue
      if (num(row, columns.fixed.amountSettled) === undefined) continue
    }

    const amountSettled = num(row, columns.fixed.amountSettled)
    if (amountSettled === undefined) {
      warnings.push(`Row ${rowNumber} has no amount and was skipped.`)
      continue
    }

    const expenseId = hasExpenseIdColumn
      ? text(row, columns.fixed.expenseId)
      : `row-${rowNumber}`
    if (seenIds.has(expenseId)) {
      warnings.push(`Row ${rowNumber} repeats an expense already listed — skipped.`)
      continue
    }
    seenIds.add(expenseId)

    const description = text(row, columns.fixed.description ?? -1)
    const isSettlement =
      text(row, columns.fixed.type ?? -1).toLowerCase() === 'settlement'

    // Money — a present cell means the person is involved, and a 0 there is a
    // real value (someone excluded from a split), so blanks are the only way to
    // say "not involved"
    const paid: Record<string, number> = {}
    const shares: Record<string, number> = {}
    for (const p of mappedPeople) {
      const pi = columns.paid[p.id]
      if (pi !== undefined && !isBlank(row, pi)) {
        const v = num(row, pi)
        if (v !== undefined) paid[p.id] = v
      }
      const si = columns.share[p.id]
      if (si !== undefined && !isBlank(row, si)) {
        const v = num(row, si)
        if (v !== undefined) shares[p.id] = v
      }
    }

    if (Object.keys(paid).length === 0) {
      warnings.push(
        `Row ${rowNumber} ("${description || expenseId}") has nobody marked as paying — skipped.`
      )
      continue
    }
    if (Object.keys(shares).length === 0) {
      warnings.push(
        `Row ${rowNumber} ("${description || expenseId}") has no shares — skipped.`
      )
      continue
    }

    const paidResult = reconcile(paid, amountSettled)
    const shareResult = reconcile(shares, amountSettled)
    if (paidResult.drifted) {
      warnings.push(
        `Row ${rowNumber} ("${description || expenseId}"): the amounts paid add up to ${round2(paidResult.sum)}, not ${round2(amountSettled)}.`
      )
    }
    if (shareResult.drifted) {
      warnings.push(
        `Row ${rowNumber} ("${description || expenseId}"): the shares add up to ${round2(shareResult.sum)}, not ${round2(amountSettled)}.`
      )
    }

    // The stored amount is authoritative. amount × rate is carried through
    // verbatim — recomputing the settled amount from it would shift balances.
    const amountOriginal = num(row, columns.fixed.amountOriginal ?? -1) ?? amountSettled
    const exchangeRate = num(row, columns.fixed.exchangeRate ?? -1) ?? 1
    const currency = text(row, columns.fixed.currency ?? -1) || settlementCurrency
    if (
      exchangeRate > 0 &&
      Math.abs(
        Math.round(amountOriginal * exchangeRate * 100) - Math.round(amountSettled * 100)
      ) > TOLERANCE_CENTS
    ) {
      warnings.push(
        `Row ${rowNumber} ("${description || expenseId}"): the original amount and rate don't match the ${settlementCurrency} amount. Keeping the ${settlementCurrency} amount.`
      )
    }

    const splitType = readSplitType(
      row,
      columns.fixed.splitType,
      shareResult.values,
      amountSettled,
      rowNumber,
      description || expenseId,
      warnings
    )

    parsed.push({
      expenseId,
      date: readDate(row, columns.fixed.date, rowNumber, warnings),
      isSettlement,
      categoryIds: readCategories(row, columns, labelToCategoryId),
      description,
      notes: text(row, columns.fixed.notes ?? -1),
      currency,
      amountOriginal,
      exchangeRate,
      amountSettled,
      // Settlements are one person paying another; never regenerate the split
      splitType: isSettlement ? 'exact' : splitType,
      paid: paidResult.values,
      shares: shareResult.values,
    })
  }

  if (parsed.length === 0) {
    return fail('No expenses could be read from the Expenses tab.')
  }
  if (parsed.length > MAX_RESTORE_EXPENSES) {
    return fail(
      `This backup has ${parsed.length} expenses, more than the ${MAX_RESTORE_EXPENSES} FairShare can restore at once.`
    )
  }

  // The hard gate: if the books don't net to zero, something in the sheet is
  // wrong in a way we cannot safely guess at
  const balances = computeBalances(
    parsed.map(toBalanceInput),
    people.map((p) => p.id)
  )
  const drift = sumValues(balances)
  if (Math.abs(drift) >= BALANCE_THRESHOLD) {
    return fail(
      `These expenses don't balance — they're off by ${round2(Math.abs(drift))} ${settlementCurrency}. Fix the highlighted rows in the sheet and try again.`
    )
  }

  return {
    ok: true,
    warnings,
    snapshot: {
      schemaVersion,
      sourceTripId: meta.sourceTripId ?? '',
      tripName,
      tripType: meta.tripType === 'group' ? 'group' : 'trip',
      settlementCurrency,
      customCategories,
      exportedAt: meta.exportedAt ?? '',
      exportedBy: meta.exportedBy ?? '',
      people,
      expenses: parsed,
    },
  }
}

// ── Per-field readers ──────────────────────────────────────────────────────

/**
 * Nudge a set of amounts back onto the total when they are within the
 * rounding tolerance, so the restored splits sum to the cent. Beyond the
 * tolerance the values are left alone and reported — a real disagreement is
 * the user's to resolve, not ours to paper over.
 */
function reconcile(
  values: Record<string, number>,
  total: number
): { values: Record<string, number>; sum: number; drifted: boolean } {
  const sum = sumValues(values)
  // Compared in whole cents, like splits.ts: 50 + 49.98 - 100 is
  // -0.0200000000000102 in floating point, which would read as past a 0.02
  // tolerance when it is exactly at it
  const diffCents = Math.round(sum * 100) - Math.round(total * 100)
  if (diffCents === 0) return { values, sum, drifted: false }
  if (Math.abs(diffCents) > TOLERANCE_CENTS) return { values, sum, drifted: true }

  const positiveWeight = Object.values(values).reduce(
    (s, v) => s + (v > 0 ? v : 0),
    0
  )
  // splitProportionally needs positive weight to distribute; with none there is
  // nothing to scale
  if (positiveWeight <= 0) return { values, sum, drifted: true }
  return { values: splitProportionally(total, values), sum, drifted: false }
}

function readDate(
  row: CellValue[] | undefined,
  index: number | undefined,
  rowNumber: number,
  warnings: string[]
): string {
  if (index === undefined) return todayString()
  const raw = cell(row, index)
  if (typeof raw === 'number' && Number.isFinite(raw)) return serialToYmd(raw)
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const serial = num(row, index)
  if (serial !== undefined && serial > 0) return serialToYmd(serial)
  warnings.push(
    `Row ${rowNumber} has an unreadable date${s ? ` ("${s}")` : ''} — using today's date.`
  )
  return todayString()
}

/**
 * `equal` is a recipe, not a record: ExpenseForm re-derives equal shares from
 * the participant list, so an `equal` expense whose shares aren't actually
 * equal would silently change the moment someone opens it. Store it as `exact`.
 */
function readSplitType(
  row: CellValue[] | undefined,
  index: number | undefined,
  shares: Record<string, number>,
  total: number,
  rowNumber: number,
  label: string,
  warnings: string[]
): Expense['splitType'] {
  const raw = (index === undefined ? '' : text(row, index).toLowerCase()) as Expense['splitType']
  const declared = SPLIT_TYPES.includes(raw) ? raw : 'exact'
  if (declared !== 'equal') return declared

  const values = Object.values(shares)
  const even = total / values.length
  const isEven = values.every((v) => Math.abs(v - even) <= 0.01)
  if (isEven) return 'equal'
  warnings.push(
    `Row ${rowNumber} ("${label}") is marked as an even split but the shares differ — saved as an exact split so they're kept as written.`
  )
  return 'exact'
}

function readCategories(
  row: CellValue[] | undefined,
  columns: ColumnMap,
  labelToCategoryId: Map<string, string>
): string[] {
  const idCell = text(row, columns.fixed.categoryIds ?? -1)
  if (idCell) {
    return idCell
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const labels = text(row, columns.fixed.categories ?? -1)
  if (!labels) return []
  return labels
    .split(',')
    .map((s) => labelToCategoryId.get(s.trim().toLowerCase()))
    .filter((v): v is string => Boolean(v))
}

/** Restore writes paidBy/paidByAmounts the way ExpenseForm does. */
export function payerFields(paid: Record<string, number>): {
  paidBy: string
  paidByAmounts?: Record<string, number>
} {
  const ids = Object.keys(paid)
  if (ids.length <= 1) return { paidBy: ids[0] ?? '' }
  return { paidBy: largestPayer(paid), paidByAmounts: paid }
}
