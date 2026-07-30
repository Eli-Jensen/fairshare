import type { CellValue } from './sheetSnapshot'

/**
 * Thin REST wrappers over Sheets v4 and Drive v3. Plain `fetch` with a bearer
 * token — the official client libraries would add hundreds of kilobytes to do
 * what amounts to four POSTs.
 *
 * Everything funnels failures through `SheetsError` so the UI has one shape to
 * map to user-facing copy, rather than each call site re-deriving what a 403
 * means.
 */

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE = 'https://www.googleapis.com/drive/v3/files'

export type SheetsErrorKind =
  | 'unauthenticated' // 401 — token expired or revoked
  | 'forbidden' // 403 — the grant doesn't cover this file
  | 'api_disabled' // 403 accessNotConfigured — Sheets/Drive API not enabled
  | 'not_found' // 404 — sheet deleted or trashed
  | 'rate_limited' // 429 / rateLimitExceeded
  | 'grid_limits' // 400 — data is bigger than the sheet's grid
  | 'offline'
  | 'unknown'

export class SheetsError extends Error {
  kind: SheetsErrorKind
  status: number
  /** Present for api_disabled: the console URL that turns the API on. */
  helpUrl?: string

  constructor(kind: SheetsErrorKind, status: number, message: string, helpUrl?: string) {
    super(message)
    this.name = 'SheetsError'
    this.kind = kind
    this.status = status
    this.helpUrl = helpUrl
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number
    message?: string
    status?: string
    errors?: { reason?: string; message?: string; extendedHelp?: string }[]
    details?: { reason?: string; metadata?: Record<string, string> }[]
  }
}

function classify(status: number, body: GoogleErrorBody): SheetsError {
  const err = body.error
  const message = err?.message ?? `Google returned ${status}.`
  const reasons = [
    ...(err?.errors ?? []).map((e) => e.reason),
    ...(err?.details ?? []).map((d) => d.reason),
  ].filter(Boolean) as string[]
  const helpUrl = err?.errors?.find((e) => e.extendedHelp)?.extendedHelp

  if (status === 401) return new SheetsError('unauthenticated', status, message)
  if (status === 403) {
    if (reasons.includes('accessNotConfigured') || /has not been used in project/.test(message)) {
      return new SheetsError('api_disabled', status, message, helpUrl)
    }
    if (reasons.includes('rateLimitExceeded') || reasons.includes('userRateLimitExceeded')) {
      return new SheetsError('rate_limited', status, message)
    }
    return new SheetsError('forbidden', status, message)
  }
  if (status === 404) return new SheetsError('not_found', status, message)
  if (status === 429) return new SheetsError('rate_limited', status, message)
  // The grid is not auto-grown by values.update, so this is a routine,
  // recoverable condition rather than a real failure — sheetSync resizes and
  // retries on it
  if (status === 400 && /exceeds grid limits/i.test(message)) {
    return new SheetsError('grid_limits', status, message)
  }
  return new SheetsError('unknown', status, message)
}

async function call<T>(url: string, init: RequestInit, token: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })
  } catch {
    // fetch only rejects on a network-level failure; every HTTP status resolves
    throw new SheetsError('offline', 0, "Couldn't reach Google. Are you online?")
  }

  if (!response.ok) {
    let body: GoogleErrorBody = {}
    try {
      body = (await response.json()) as GoogleErrorBody
    } catch {
      // A non-JSON error body (a proxy page, say) — the status still classifies
    }
    throw classify(response.status, body)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

// ── Sheets types ───────────────────────────────────────────────────────────

export interface GridProperties {
  rowCount?: number
  columnCount?: number
  frozenRowCount?: number
}

export interface SheetProperties {
  sheetId: number
  title: string
  index?: number
  hidden?: boolean
  gridProperties?: GridProperties
}

export interface SpreadsheetMeta {
  spreadsheetId: string
  spreadsheetUrl: string
  properties?: { title?: string }
  sheets?: { properties: SheetProperties }[]
}

/** A Sheets batchUpdate request. Loosely typed on purpose: we build a small,
 *  fixed set of them in sheetFormat.ts and the full union is enormous. */
export type SheetRequest = Record<string, unknown>

export interface BatchUpdateResponse {
  replies?: { addSheet?: { properties?: SheetProperties } }[]
}

export interface ValueRange {
  range: string
  majorDimension?: 'ROWS' | 'COLUMNS'
  values?: CellValue[][]
}

// ── Sheets calls ───────────────────────────────────────────────────────────

const META_FIELDS =
  'spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount,frozenRowCount))'

export function createSpreadsheet(
  token: string,
  body: {
    properties: { title: string; locale?: string; timeZone?: string }
    sheets: { properties: SheetProperties }[]
  }
): Promise<SpreadsheetMeta> {
  return call<SpreadsheetMeta>(
    `${SHEETS}?fields=${encodeURIComponent(META_FIELDS)}`,
    { method: 'POST', body: JSON.stringify(body) },
    token
  )
}

/** Structure only — small, and the input to tab reconciliation. */
export function getSpreadsheetMeta(
  token: string,
  spreadsheetId: string
): Promise<SpreadsheetMeta> {
  return call<SpreadsheetMeta>(
    `${SHEETS}/${spreadsheetId}?fields=${encodeURIComponent(META_FIELDS)}`,
    { method: 'GET' },
    token
  )
}

export function batchUpdate(
  token: string,
  spreadsheetId: string,
  requests: SheetRequest[]
): Promise<BatchUpdateResponse> {
  return call<BatchUpdateResponse>(
    `${SHEETS}/${spreadsheetId}:batchUpdate`,
    { method: 'POST', body: JSON.stringify({ requests }) },
    token
  )
}

/**
 * Writes cell values. RAW, never USER_ENTERED: a description of "=SUM(A1)" or
 * "1-2" must land in the user's spreadsheet as text, not as a formula Sheets
 * evaluates or a date it autocorrects.
 */
export function valuesBatchUpdate(
  token: string,
  spreadsheetId: string,
  data: ValueRange[]
): Promise<unknown> {
  return call(
    `${SHEETS}/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        includeValuesInResponse: false,
        data,
      }),
    },
    token
  )
}

/** Reads cell values. UNFORMATTED_VALUE so numbers come back as numbers and
 *  dates as serials, rather than as locale-formatted strings we'd have to undo. */
export function valuesBatchGet(
  token: string,
  spreadsheetId: string,
  ranges: string[]
): Promise<{ valueRanges?: ValueRange[] }> {
  const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')
  return call(
    `${SHEETS}/${spreadsheetId}/values:batchGet?${query}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
    { method: 'GET' },
    token
  )
}

// ── Drive calls ────────────────────────────────────────────────────────────

export interface DriveFile {
  id: string
  name: string
  modifiedTime?: string
  trashed?: boolean
  appProperties?: Record<string, string>
}

/**
 * Tags the file so it can be found again from a different device, or after the
 * user's local link record is gone. Can't be set through the Sheets create
 * call, hence the separate PATCH.
 */
export function driveSetAppProperties(
  token: string,
  fileId: string,
  appProperties: Record<string, string>
): Promise<DriveFile> {
  return call<DriveFile>(
    `${DRIVE}/${fileId}?fields=id,name,appProperties`,
    { method: 'PATCH', body: JSON.stringify({ appProperties }) },
    token
  )
}

export function driveGetFile(token: string, fileId: string): Promise<DriveFile> {
  return call<DriveFile>(
    `${DRIVE}/${fileId}?fields=id,name,trashed,modifiedTime,appProperties`,
    { method: 'GET' },
    token
  )
}

/**
 * Every FairShare backup in this user's Drive. Under the drive.file scope this
 * only ever returns files the app itself created, so it needs no broad Drive
 * permission and can't see anything else the user owns.
 */
export function driveListBackups(token: string): Promise<{ files?: DriveFile[] }> {
  const q = [
    "mimeType='application/vnd.google-apps.spreadsheet'",
    "appProperties has { key='fairshareSchema' and value='1' }",
    'trashed=false',
  ].join(' and ')
  return call(
    `${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime,appProperties)&orderBy=modifiedTime desc&pageSize=50`,
    { method: 'GET' },
    token
  )
}
