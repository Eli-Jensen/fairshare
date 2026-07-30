import type { SheetSnapshot, Grid } from './sheetSnapshot'
import { FORMAT_VERSION, TABS, hashSnapshot, snapshotToGrids } from './sheetSnapshot'
import {
  createSheetProperties,
  desiredSheets,
  formatRequests,
  formatRequestsForSheet,
  structuralDiff,
} from './sheetFormat'
import {
  SheetsError,
  batchUpdate,
  createSpreadsheet,
  driveGetFile,
  driveSetAppProperties,
  getSpreadsheetMeta,
  valuesBatchUpdate,
} from './sheetsApi'
import type { SheetProperties, ValueRange } from './sheetsApi'
import type { SheetLink } from './sheetLinks'

/**
 * Pushes a snapshot into a Google Sheet.
 *
 * Cost is the thing being optimised here. A routine sync is two API calls: read
 * the tab structure, write the values. A third appears only when something
 * about the shape changed — a tab was deleted or renamed, or the number of
 * participants or expenses moved the grid size. Creation is four.
 *
 * All the ordering rules exist for one reason: `values.update` fails outright
 * when the target range is bigger than the sheet's grid, and unlike
 * `values.append` it will not grow the grid itself. So every structural change
 * has to land before a single value is written.
 */

const APP_PROPERTY_SCHEMA = '1'

export interface SyncResult {
  link: SheetLink
  /** How many Google API calls this took — surfaced in dev logging only. */
  calls: number
}

function spreadsheetTitle(tripName: string): string {
  return `FairShare — ${tripName}`
}

/** Values for every tab, addressed from A1 so a 2-D array fills the rectangle. */
function valueRanges(grids: Grid[]): ValueRange[] {
  return grids.map((grid) => ({
    range: `'${grid.title}'!A1`,
    majorDimension: 'ROWS' as const,
    values: grid.values,
  }))
}

function rowCountsOf(grids: Grid[]): {
  expenses: number
  people: number
  summary: number
  meta: number
} {
  const byTitle = Object.fromEntries(grids.map((g) => [g.title, g.values.length]))
  return {
    expenses: byTitle[TABS.expenses.title] ?? 0,
    people: byTitle[TABS.people.title] ?? 0,
    summary: byTitle[TABS.summary.title] ?? 0,
    meta: byTitle[TABS.meta.title] ?? 0,
  }
}

/** Creates the spreadsheet in the user's Drive and fills it. */
export async function createBackupSheet(
  token: string,
  tripId: string,
  snapshot: SheetSnapshot
): Promise<SyncResult> {
  const { grids, layout } = snapshotToGrids(snapshot)
  const desired = desiredSheets(layout, rowCountsOf(grids))

  // Structure only, no data — so the value-writing path is the same one every
  // later sync uses, and only has to be right once
  const meta = await createSpreadsheet(token, {
    properties: {
      title: spreadsheetTitle(snapshot.tripName),
      locale: 'en_US',
      timeZone: resolvedTimeZone(),
    },
    sheets: createSheetProperties(desired),
  })

  await batchUpdate(token, meta.spreadsheetId, formatRequests(layout))

  // Tagging the file is what lets a restore find it later from another device,
  // or after the local link record is gone. Best-effort: a missing tag costs
  // discoverability, not the backup.
  await driveSetAppProperties(token, meta.spreadsheetId, {
    fairshareTripId: tripId,
    fairshareSchema: APP_PROPERTY_SCHEMA,
  }).catch(() => {})

  await valuesBatchUpdate(token, meta.spreadsheetId, valueRanges(grids))

  return {
    calls: 4,
    link: {
      spreadsheetId: meta.spreadsheetId,
      spreadsheetUrl: meta.spreadsheetUrl,
      title: meta.properties?.title ?? spreadsheetTitle(snapshot.tripName),
      lastSyncedAt: Date.now(),
      lastSyncedHash: hashSnapshot(snapshot),
      formatVersion: FORMAT_VERSION,
      participantCount: layout.participantCount,
      autoSync: true,
    },
  }
}

/**
 * Rewrites an existing backup sheet.
 *
 * `knownSheets` lets a repeat sync in the same page session skip the structure
 * read and drop to a single call. It is only ever a cache of what we last saw;
 * any write failure discards it.
 */
export async function syncBackupSheet(
  token: string,
  link: SheetLink,
  snapshot: SheetSnapshot,
  knownSheets?: SheetProperties[]
): Promise<SyncResult> {
  const { grids, layout } = snapshotToGrids(snapshot)
  const desired = desiredSheets(layout, rowCountsOf(grids))
  let calls = 0

  let actual = knownSheets
  if (!actual) {
    const meta = await getSpreadsheetMeta(token, link.spreadsheetId)
    calls++
    actual = (meta.sheets ?? []).map((s) => s.properties)
    link = {
      ...link,
      spreadsheetUrl: meta.spreadsheetUrl || link.spreadsheetUrl,
      title: meta.properties?.title ?? link.title,
    }
  }

  const diff = structuralDiff(actual, desired)
  const requests = [...diff.requests]

  // A recreated tab lost its formatting along with its data
  for (const sheetId of diff.recreated) {
    requests.push(...formatRequestsForSheet(layout, sheetId))
  }
  // Column indices shift when the participant list changes, so the formatting
  // has to move with them
  const formatStale =
    link.formatVersion !== FORMAT_VERSION ||
    link.participantCount !== layout.participantCount
  if (formatStale && diff.recreated.length === 0) {
    requests.push(...formatRequests(layout))
  }

  if (requests.length > 0) {
    await batchUpdate(token, link.spreadsheetId, requests)
    calls++
  }

  try {
    await valuesBatchUpdate(token, link.spreadsheetId, valueRanges(grids))
    calls++
  } catch (err) {
    // Belt and braces: if the grid was somehow still too small — a stale
    // knownSheets cache, or a resize the user made mid-sync — force it and
    // retry once rather than failing a backup over a recoverable condition
    if (err instanceof SheetsError && err.kind === 'grid_limits') {
      const forced = structuralDiff([], desired)
      await batchUpdate(token, link.spreadsheetId, forced.requests)
      await valuesBatchUpdate(token, link.spreadsheetId, valueRanges(grids))
      calls += 2
    } else {
      throw err
    }
  }

  return {
    calls,
    link: {
      ...link,
      lastSyncedAt: Date.now(),
      lastSyncedHash: hashSnapshot(snapshot),
      formatVersion: FORMAT_VERSION,
      participantCount: layout.participantCount,
    },
  }
}

/**
 * Why a sheet 404s: deleted outright, or sitting in the Drive trash. Worth
 * distinguishing, because one of them the user can undo themselves.
 */
export async function describeMissingSheet(
  token: string,
  spreadsheetId: string
): Promise<'trashed' | 'gone'> {
  try {
    const file = await driveGetFile(token, spreadsheetId)
    return file.trashed ? 'trashed' : 'gone'
  } catch {
    return 'gone'
  }
}

function resolvedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
