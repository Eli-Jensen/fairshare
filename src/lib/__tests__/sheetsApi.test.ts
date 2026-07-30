import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  SheetsError,
  batchUpdate,
  createSpreadsheet,
  driveListBackups,
  getSpreadsheetMeta,
  valuesBatchGet,
  valuesBatchUpdate,
} from '../sheetsApi'

/**
 * The Sheets/Drive calls, against a stubbed fetch.
 *
 * Worth testing precisely because the real thing can't be reached from CI: the
 * error mapping decides every message the user sees when a backup fails, and
 * `valueInputOption: RAW` is the only thing standing between a description of
 * "=SUM(A1)" and a formula being injected into someone's spreadsheet.
 */

function stubFetch(response: {
  ok?: boolean
  status?: number
  body?: unknown
  reject?: boolean
}) {
  const spy = vi.fn(async () => {
    if (response.reject) throw new TypeError('Failed to fetch')
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    } as Response
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

function googleError(message: string, extras: Record<string, unknown> = {}) {
  return { error: { message, ...extras } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('request shape', () => {
  it('sends the bearer token and JSON content type', async () => {
    const spy = stubFetch({ body: { spreadsheetId: 'sid' } })
    await getSpreadsheetMeta('tok123', 'sid')
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok123')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('writes values as RAW, never USER_ENTERED', async () => {
    // USER_ENTERED would turn a description of "=SUM(A1)" into a live formula
    // in the user's own spreadsheet, and reinterpret "1-2" as a date
    const spy = stubFetch({ body: {} })
    await valuesBatchUpdate('tok', 'sid', [
      { range: "'Expenses'!A1", values: [['=SUM(A1)']] },
    ])
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/values:batchUpdate')
    const body = JSON.parse(init.body as string)
    expect(body.valueInputOption).toBe('RAW')
    expect(body.data[0].values[0][0]).toBe('=SUM(A1)')
  })

  it('reads values unformatted, so numbers come back as numbers', async () => {
    const spy = stubFetch({ body: { valueRanges: [] } })
    await valuesBatchGet('tok', 'sid', ["'Expenses'!A:Z", "'Meta'!A:B"])
    const [url] = spy.mock.calls[0] as unknown as [string]
    expect(url).toContain('valueRenderOption=UNFORMATTED_VALUE')
    expect(url).toContain('dateTimeRenderOption=SERIAL_NUMBER')
    expect(url).toContain(encodeURIComponent("'Expenses'!A:Z"))
    expect(url).toContain(encodeURIComponent("'Meta'!A:B"))
  })

  it('posts the create payload', async () => {
    const spy = stubFetch({ body: { spreadsheetId: 'new', spreadsheetUrl: 'u' } })
    const result = await createSpreadsheet('tok', {
      properties: { title: 'FairShare — Italy' },
      sheets: [{ properties: { sheetId: 1, title: 'Expenses' } }],
    })
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string).properties.title).toBe('FairShare — Italy')
    expect(result.spreadsheetId).toBe('new')
  })

  it('wraps batchUpdate requests in a requests array', async () => {
    const spy = stubFetch({ body: {} })
    await batchUpdate('tok', 'sid', [{ addSheet: { properties: { sheetId: 2 } } }])
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain(':batchUpdate')
    expect(JSON.parse(init.body as string).requests).toHaveLength(1)
  })

  it('asks Drive only for sheets this app created', async () => {
    // The drive.file scope means this can never see the rest of the user's Drive
    const spy = stubFetch({ body: { files: [] } })
    await driveListBackups('tok')
    const [url] = spy.mock.calls[0] as unknown as [string]
    const query = decodeURIComponent(url)
    expect(query).toContain("appProperties has { key='fairshareSchema' and value='1' }")
    expect(query).toContain('trashed=false')
    expect(query).toContain("mimeType='application/vnd.google-apps.spreadsheet'")
  })
})

describe('error classification', () => {
  async function failWith(status: number, body: unknown): Promise<SheetsError> {
    stubFetch({ ok: false, status, body })
    try {
      await getSpreadsheetMeta('tok', 'sid')
    } catch (err) {
      return err as SheetsError
    }
    throw new Error('expected the call to reject')
  }

  it('maps 401 to an expired connection', async () => {
    const err = await failWith(401, googleError('Invalid Credentials'))
    expect(err).toBeInstanceOf(SheetsError)
    expect(err.kind).toBe('unauthenticated')
  })

  it('maps a disabled API to its own kind, not a generic 403', async () => {
    // The first failure a fresh Google Cloud project produces — it needs a
    // developer to enable the API, so it must not read as a user problem
    const err = await failWith(
      403,
      googleError(
        'Google Sheets API has not been used in project 12345 before or it is disabled.',
        {
          errors: [
            {
              reason: 'accessNotConfigured',
              extendedHelp: 'https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=12345',
            },
          ],
        }
      )
    )
    expect(err.kind).toBe('api_disabled')
    expect(err.helpUrl).toContain('console.developers.google.com')
  })

  it('detects a disabled API from the message alone', async () => {
    const err = await failWith(
      403,
      googleError('Google Drive API has not been used in project 9 before or it is disabled.')
    )
    expect(err.kind).toBe('api_disabled')
  })

  it('maps a 403 rate limit to rate_limited, not forbidden', async () => {
    const err = await failWith(
      403,
      googleError('Rate Limit Exceeded', { errors: [{ reason: 'rateLimitExceeded' }] })
    )
    expect(err.kind).toBe('rate_limited')
  })

  it('maps a plain 403 to forbidden', async () => {
    const err = await failWith(403, googleError('The caller does not have permission'))
    expect(err.kind).toBe('forbidden')
  })

  it('maps 404 to not_found', async () => {
    expect((await failWith(404, googleError('Requested entity was not found.'))).kind).toBe(
      'not_found'
    )
  })

  it('maps 429 to rate_limited', async () => {
    expect((await failWith(429, googleError('Too many requests'))).kind).toBe('rate_limited')
  })

  it('recognizes the grid-limits 400, which sheetSync recovers from', async () => {
    const err = await failWith(
      400,
      googleError(
        "Range ('Expenses'!A1:BZ2400) exceeds grid limits. Max rows: 1000, max columns: 26"
      )
    )
    expect(err.kind).toBe('grid_limits')
  })

  it('does not mistake an ordinary 400 for a grid problem', async () => {
    expect((await failWith(400, googleError('Invalid JSON payload'))).kind).toBe('unknown')
  })

  it('reads reasons out of the newer details array too', async () => {
    const err = await failWith(
      403,
      googleError('quota', { details: [{ reason: 'rateLimitExceeded' }] })
    )
    expect(err.kind).toBe('rate_limited')
  })

  it('still classifies when the error body is not JSON', async () => {
    // A proxy or captive portal can return HTML with a 403
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => {
          throw new SyntaxError('Unexpected token <')
        },
      }) as unknown as Response)
    )
    await expect(getSpreadsheetMeta('tok', 'sid')).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
    })
  })

  it('maps a network failure to offline', async () => {
    stubFetch({ reject: true })
    await expect(getSpreadsheetMeta('tok', 'sid')).rejects.toMatchObject({
      kind: 'offline',
      status: 0,
    })
  })

  it('carries the message from Google through for anything unrecognized', async () => {
    const err = await failWith(500, googleError('Internal error encountered.'))
    expect(err.kind).toBe('unknown')
    expect(err.message).toBe('Internal error encountered.')
  })
})
