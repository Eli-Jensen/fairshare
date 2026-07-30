import type { SheetLayout } from './sheetSnapshot'
import {
  FIXED_COLUMN_COUNT,
  TRAILING_COLUMN_COUNT,
  TABS,
  currencyNumberPattern,
} from './sheetSnapshot'
import type { SheetProperties, SheetRequest } from './sheetsApi'

/**
 * Builds the Sheets `batchUpdate` requests that shape the backup spreadsheet:
 * what size each tab is, and how it looks.
 *
 * Pure — every function here maps values to request objects, which is what lets
 * the sizing rules be tested without touching Google.
 *
 * Note on colours: these are literal RGB, not the app's semantic tokens. The
 * "never hardcode colours" rule in CLAUDE.md is about the app's own UI, which
 * has to follow the user's theme. A spreadsheet in someone's Drive has no
 * access to our CSS variables and no dark mode to respond to.
 */

const HEADER_ROWS = 2
const FROZEN_ROWS = 2
/** Sheets rejects a grid whose frozen rows don't fit inside it. */
const MIN_ROWS = FROZEN_ROWS + 1

const HEADER_BG = { red: 0.93, green: 0.95, blue: 0.99 }

export const PEOPLE_COLUMN_COUNT = 5
export const SUMMARY_COLUMN_COUNT = 4
export const META_COLUMN_COUNT = 2

/** The size every tab should be for a given snapshot. */
export interface DesiredSheet {
  sheetId: number
  title: string
  index: number
  hidden: boolean
  rowCount: number
  columnCount: number
  frozenRowCount: number
}

export function desiredSheets(
  layout: SheetLayout,
  rowCounts: { expenses: number; people: number; summary: number; meta: number }
): DesiredSheet[] {
  const rows = (n: number) => Math.max(n, MIN_ROWS)
  return [
    {
      ...TABS.expenses,
      index: 0,
      hidden: false,
      rowCount: rows(rowCounts.expenses),
      columnCount: layout.expensesColumnCount,
      frozenRowCount: FROZEN_ROWS,
    },
    {
      ...TABS.people,
      index: 1,
      hidden: false,
      rowCount: rows(rowCounts.people),
      columnCount: PEOPLE_COLUMN_COUNT,
      frozenRowCount: FROZEN_ROWS,
    },
    {
      ...TABS.summary,
      index: 2,
      hidden: false,
      rowCount: rows(rowCounts.summary),
      columnCount: SUMMARY_COLUMN_COUNT,
      frozenRowCount: FROZEN_ROWS,
    },
    {
      ...TABS.meta,
      index: 3,
      hidden: true,
      rowCount: rows(rowCounts.meta),
      columnCount: META_COLUMN_COUNT,
      frozenRowCount: FROZEN_ROWS,
    },
  ]
}

/** The `sheets` array for a spreadsheets.create call. */
export function createSheetProperties(desired: DesiredSheet[]): {
  properties: SheetProperties
}[] {
  return desired.map((d) => ({
    properties: {
      sheetId: d.sheetId,
      title: d.title,
      index: d.index,
      hidden: d.hidden,
      gridProperties: {
        rowCount: d.rowCount,
        columnCount: d.columnCount,
        frozenRowCount: d.frozenRowCount,
      },
    },
  }))
}

// ── Structural reconciliation ──────────────────────────────────────────────

export interface StructuralDiff {
  requests: SheetRequest[]
  /** Tabs that had to be recreated — their formatting must be reapplied. */
  recreated: number[]
}

/**
 * What must change to make the live spreadsheet match `desired`.
 *
 * Returns an empty request list when nothing moved, which is what keeps a
 * steady-state sync down to two API calls. Three things are reconciled:
 *
 *  - **A deleted tab** is re-added. Its formatting is lost with it, so the
 *    caller reapplies that too.
 *  - **A renamed tab** is renamed back, because the value write addresses
 *    ranges by title. Decisions are made on sheetId, which the user can't
 *    change; only the final A1 range uses the title.
 *  - **A wrongly sized grid** is resized. This is not cosmetic: `values.update`
 *    fails outright when the data is bigger than the grid (it does not
 *    auto-grow — only `values.append` does), so growing must happen first.
 *    Shrinking matters too, and doubles as the cleanup for stale trailing rows:
 *    reducing rowCount deletes those cells, which saves a separate
 *    `values.batchClear` call. The cost is that anything a user typed below or
 *    to the right of the table goes with them — hence the warning in Meta.
 */
export function structuralDiff(
  actual: SheetProperties[],
  desired: DesiredSheet[]
): StructuralDiff {
  const requests: SheetRequest[] = []
  const recreated: number[] = []
  const byId = new Map(actual.map((s) => [s.sheetId, s]))

  for (const want of desired) {
    const have = byId.get(want.sheetId)

    if (!have) {
      requests.push({
        addSheet: {
          properties: {
            sheetId: want.sheetId,
            title: want.title,
            index: want.index,
            hidden: want.hidden,
            gridProperties: {
              rowCount: want.rowCount,
              columnCount: want.columnCount,
              frozenRowCount: want.frozenRowCount,
            },
          },
        },
      })
      recreated.push(want.sheetId)
      continue
    }

    if (have.title !== want.title) {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId: want.sheetId, title: want.title },
          fields: 'title',
        },
      })
    }

    const grid = have.gridProperties ?? {}
    if (
      grid.rowCount !== want.rowCount ||
      grid.columnCount !== want.columnCount ||
      grid.frozenRowCount !== want.frozenRowCount
    ) {
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId: want.sheetId,
            gridProperties: {
              rowCount: want.rowCount,
              columnCount: want.columnCount,
              frozenRowCount: want.frozenRowCount,
            },
          },
          fields:
            'gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount',
        },
      })
    }
  }

  return { requests, recreated }
}

// ── Presentation ───────────────────────────────────────────────────────────

function headerStyle(sheetId: number, columnCount: number): SheetRequest[] {
  return [
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColorStyle: { rgbColor: HEADER_BG },
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
          },
        },
        fields:
          'userEnteredFormat(textFormat,backgroundColorStyle,verticalAlignment,wrapStrategy)',
      },
    },
    // Row 1 carries the machine keys — useful to the parser, noise to a reader
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser',
      },
    },
  ]
}

function numberFormat(
  sheetId: number,
  startColumnIndex: number,
  endColumnIndex: number,
  type: string,
  pattern: string
): SheetRequest {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: HEADER_ROWS, startColumnIndex, endColumnIndex },
      cell: { userEnteredFormat: { numberFormat: { type, pattern } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  }
}

function columnWidth(
  sheetId: number,
  startIndex: number,
  endIndex: number,
  pixelSize: number
): SheetRequest {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex, endIndex },
      properties: { pixelSize },
      fields: 'pixelSize',
    },
  }
}

/**
 * Every formatting request for the whole spreadsheet.
 *
 * Applied at creation, and reapplied only when the participant count changes
 * (which moves every column index) or when FORMAT_VERSION is bumped. Reapplying
 * on every sync would waste payload and stomp any tweaks the user made to
 * their own document.
 */
export function formatRequests(layout: SheetLayout): SheetRequest[] {
  const { participantCount: n, machineColumnStart, expensesColumnCount } = layout
  const money = currencyNumberPattern(layout.settlementCurrency)
  const expenses = TABS.expenses.sheetId

  return [
    ...headerStyle(expenses, expensesColumnCount),
    numberFormat(expenses, 0, 1, 'DATE', 'yyyy-mm-dd'),
    numberFormat(expenses, 6, 7, 'NUMBER', '#,##0.00'),
    numberFormat(expenses, 7, 8, 'NUMBER', '0.0000'),
    // The settled amount and every paid/share column are one contiguous block
    numberFormat(expenses, 8, FIXED_COLUMN_COUNT + 2 * n, 'CURRENCY', money),
    columnWidth(expenses, 3, 4, 240), // Description
    columnWidth(expenses, 4, 5, 200), // Notes
    {
      repeatCell: {
        range: { sheetId: expenses, startRowIndex: HEADER_ROWS, startColumnIndex: 4, endColumnIndex: 5 },
        cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat.wrapStrategy',
      },
    },
    columnWidth(expenses, FIXED_COLUMN_COUNT, machineColumnStart, 110),
    // The id/split-type/category-id block: needed to restore, distracting to read
    {
      updateDimensionProperties: {
        range: {
          sheetId: expenses,
          dimension: 'COLUMNS',
          startIndex: machineColumnStart,
          endIndex: machineColumnStart + TRAILING_COLUMN_COUNT,
        },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser',
      },
    },
    // endRowIndex omitted so the filter stays valid as rows come and go
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId: expenses,
            startRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: machineColumnStart,
          },
        },
      },
    },

    ...headerStyle(TABS.people.sheetId, PEOPLE_COLUMN_COUNT),
    columnWidth(TABS.people.sheetId, 1, 3, 200),

    ...headerStyle(TABS.summary.sheetId, SUMMARY_COLUMN_COUNT),
    columnWidth(TABS.summary.sheetId, 0, 1, 220),
    numberFormat(TABS.summary.sheetId, 1, SUMMARY_COLUMN_COUNT, 'CURRENCY', money),

    ...headerStyle(TABS.meta.sheetId, META_COLUMN_COUNT),
    columnWidth(TABS.meta.sheetId, 0, 1, 180),
    columnWidth(TABS.meta.sheetId, 1, 2, 420),
    {
      updateSheetProperties: {
        properties: { sheetId: TABS.meta.sheetId, hidden: true },
        fields: 'hidden',
      },
    },
  ]
}

/** Formatting for a single tab that had to be recreated mid-sync. */
export function formatRequestsForSheet(
  layout: SheetLayout,
  sheetId: number
): SheetRequest[] {
  return formatRequests(layout).filter((request) => {
    const body = Object.values(request)[0] as Record<string, unknown> | undefined
    const range = body?.range as { sheetId?: number } | undefined
    const properties = body?.properties as { sheetId?: number } | undefined
    const filter = body?.filter as { range?: { sheetId?: number } } | undefined
    const target = range?.sheetId ?? properties?.sheetId ?? filter?.range?.sheetId
    return target === sheetId
  })
}
