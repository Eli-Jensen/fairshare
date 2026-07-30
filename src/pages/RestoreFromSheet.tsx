import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTrips } from '../hooks/useTrips'
import { GoogleAuthError, isGoogleConfigured, requestToken } from '../lib/googleAuth'
import { SheetsError, driveListBackups, valuesBatchGet } from '../lib/sheetsApi'
import type { DriveFile, ValueRange } from '../lib/sheetsApi'
import { TABS } from '../lib/sheetSnapshot'
import type { CellValue, SheetSnapshot } from '../lib/sheetSnapshot'
import { parseGrids } from '../lib/sheetParse'
import type { RawGrids } from '../lib/sheetParse'
import { buildRestorePlan, restoreFromSnapshot } from '../lib/sheetRestore'
import type { RestorePlan } from '../lib/sheetRestore'
import { formatMoney, tripLabel } from '../lib/types'
import { MAX_TRIPS } from '../lib/limits'

/**
 * Rebuild a trip from a Google Sheets backup.
 *
 * The preview is the point of this page. A restore writes a whole trip and
 * invites people to it, so nothing happens until the user has seen what they
 * are about to create — how many expenses, who comes back and as what, and
 * every warning the parser raised about the state of the sheet.
 */

type Stage = 'connect' | 'pick' | 'preview' | 'restoring'

/** The Summary tab is human-only, so it isn't fetched. */
const READ_RANGES = [TABS.expenses, TABS.people, TABS.meta].map((t) => `'${t.title}'!A:ZZ`)

/** Shape the batchGet response into what the parser expects. */
function gridsFromRanges(valueRanges: ValueRange[] | undefined): RawGrids {
  const grid = (i: number) => (valueRanges?.[i]?.values ?? []) as CellValue[][]
  return { expenses: grid(0), people: grid(1), meta: grid(2) }
}

/** Accepts a full Sheets URL or a bare id. */
function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const fromUrl = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (fromUrl) return fromUrl[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed
  return null
}

export function RestoreFromSheet() {
  const { user } = useAuth()
  const { trips } = useTrips()
  const navigate = useNavigate()

  const [stage, setStage] = useState<Stage>('connect')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<DriveFile[]>([])
  const [manualId, setManualId] = useState('')
  const [token, setToken] = useState<string | null>(null)

  const [snapshot, setSnapshot] = useState<SheetSnapshot | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [plan, setPlan] = useState<RestorePlan | null>(null)
  const [sourceId, setSourceId] = useState('')

  const describe = useCallback((err: unknown): string => {
    if (err instanceof GoogleAuthError) return err.message
    if (err instanceof SheetsError) {
      if (err.kind === 'unauthenticated') return 'Your Google connection expired. Connect again.'
      if (err.kind === 'not_found') return "That sheet can't be found, or FairShare doesn't have access to it."
      if (err.kind === 'api_disabled') return "Sheets backup isn't set up for this version of the app."
      if (err.kind === 'offline') return "You're offline — try again when you're back."
      return err.message
    }
    return err instanceof Error ? err.message : 'Something went wrong.'
  }, [])

  /** MUST run straight from a click — see googleAuth.ts. */
  const connect = useCallback(() => {
    setBusy(true)
    setError(null)
    requestToken().then(
      async (t) => {
        setToken(t)
        try {
          // Under drive.file this can only ever see sheets FairShare created
          const result = await driveListBackups(t)
          setFiles(result.files ?? [])
          setStage('pick')
        } catch (err) {
          setError(describe(err))
        } finally {
          setBusy(false)
        }
      },
      (err) => {
        setError(describe(err))
        setBusy(false)
      }
    )
  }, [describe])

  const loadSheet = useCallback(
    async (spreadsheetId: string) => {
      if (!token) return
      setBusy(true)
      setError(null)
      try {
        const result = await valuesBatchGet(token, spreadsheetId, READ_RANGES)
        const parsed = parseGrids(gridsFromRanges(result.valueRanges))
        if (!parsed.ok) {
          setError(parsed.error)
          setWarnings(parsed.warnings)
          return
        }
        setSnapshot(parsed.snapshot)
        setWarnings(parsed.warnings)
        setPlan(buildRestorePlan(parsed.snapshot, user?.email))
        setSourceId(spreadsheetId)
        setStage('preview')
      } catch (err) {
        setError(describe(err))
      } finally {
        setBusy(false)
      }
    },
    [token, user?.email, describe]
  )

  const doRestore = useCallback(async () => {
    if (!snapshot || !plan || !user) return
    setStage('restoring')
    setError(null)
    try {
      const result = await restoreFromSnapshot({
        snapshot,
        plan,
        uid: user.uid,
        spreadsheetId: sourceId,
      })
      navigate(`/trip/${result.tripId}`)
    } catch (err) {
      setError(describe(err))
      setStage('preview')
    }
  }, [snapshot, plan, user, sourceId, navigate, describe])

  if (!isGoogleConfigured()) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-text mb-4">Restore from a Google Sheet</h1>
        <p className="text-sm text-text-muted">
          Google Sheets backup isn't available in this version of the app.
        </p>
      </div>
    )
  }

  const atLimit = trips.length >= MAX_TRIPS
  const duplicate = snapshot
    ? trips.find((t) => (t as { restoredFromSheetId?: string }).restoredFromSheetId === sourceId)
    : undefined

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/" className="text-text-muted hover:text-text-secondary">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-text">Restore from a Google Sheet</h1>
      </div>

      {error && (
        <p className="text-sm text-danger-text bg-danger-bg rounded-lg px-3 py-2 mb-4">{error}</p>
      )}

      {stage === 'connect' && (
        <div>
          <p className="text-sm text-text-secondary mb-3">
            Rebuild a trip or group from a backup sheet in your Google Drive. FairShare can
            only see sheets it created itself.
          </p>
          <button
            onClick={connect}
            disabled={busy}
            className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {busy ? 'Connecting…' : 'Find my backups'}
          </button>
        </div>
      )}

      {stage === 'pick' && (
        <div>
          <h3 className="text-sm font-medium text-text-secondary mb-2">Your backups</h3>
          {files.length === 0 ? (
            <p className="text-sm text-text-muted mb-4">
              No FairShare backups found in your Drive. If you have the sheet's link, paste it
              below.
            </p>
          ) : (
            <div className="space-y-2 mb-6">
              {files.map((file) => (
                <button
                  key={file.id}
                  onClick={() => loadSheet(file.id)}
                  disabled={busy}
                  className="w-full text-left bg-card border border-line rounded-lg px-3 py-2 hover:bg-card-hover disabled:opacity-50 transition-colors"
                >
                  <span className="text-sm text-text block">{file.name}</span>
                  {file.modifiedTime && (
                    <span className="text-xs text-text-muted">
                      Last changed {new Date(file.modifiedTime).toLocaleDateString()}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-line pt-4">
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Or paste a sheet link
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="flex-1 border border-line rounded-lg px-3 py-2 text-sm bg-input text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <button
                onClick={() => {
                  const id = extractSpreadsheetId(manualId)
                  if (!id) {
                    setError("That doesn't look like a Google Sheets link.")
                    return
                  }
                  void loadSheet(id)
                }}
                disabled={busy || !manualId.trim()}
                className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors shrink-0"
              >
                {busy ? '…' : 'Open'}
              </button>
            </div>
          </div>
        </div>
      )}

      {stage !== 'connect' && stage !== 'pick' && snapshot && plan && (
        <div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {tripLabel(snapshot.tripType) === 'group' ? 'Group name' : 'Trip name'}
            </label>
            <input
              type="text"
              value={plan.tripName}
              onChange={(e) => setPlan({ ...plan, tripName: e.target.value })}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-input text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div className="bg-card border border-line rounded-lg px-3 py-2 mb-4">
            <p className="text-sm text-text">
              {snapshot.expenses.length} expense{snapshot.expenses.length === 1 ? '' : 's'} ·{' '}
              {formatMoney(
                snapshot.expenses
                  .filter((e) => !e.isSettlement)
                  .reduce((s, e) => s + e.amountSettled, 0),
                snapshot.settlementCurrency
              )}{' '}
              total
            </p>
            {snapshot.exportedAt && (
              <p className="text-xs text-text-muted mt-0.5">
                Backed up {new Date(snapshot.exportedAt).toLocaleString()}
              </p>
            )}
          </div>

          {duplicate && (
            <div className="bg-warn-bg border border-warn-border rounded-lg px-3 py-2 mb-4">
              <p className="text-sm text-warn-text">
                You already restored this sheet — it became "{duplicate.name}". Restoring again
                makes a second, separate copy.
              </p>
            </div>
          )}

          {atLimit && (
            <div className="bg-danger-bg rounded-lg px-3 py-2 mb-4">
              <p className="text-sm text-danger-text">
                You've reached the limit of {MAX_TRIPS} trips and groups. Delete an old one to
                restore this.
              </p>
            </div>
          )}

          <div className="border-t border-line pt-4 mb-4">
            <h3 className="text-sm font-medium text-text-secondary mb-1">Who comes back</h3>
            <p className="text-xs text-text-muted mb-3">
              Everyone except you is restored as an invited guest. Their share of every expense
              is kept, and their history joins up with their account when they accept the
              invite — which only works if the email is right.
            </p>
            <div className="space-y-2">
              {plan.participants.map((entry, i) => (
                <div
                  key={entry.person.id}
                  className="bg-card border border-line rounded-lg px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-text truncate">{entry.person.name}</span>
                    <span className="text-xs text-text-muted shrink-0">
                      {entry.kind === 'self' ? 'you' : 'invited guest'}
                    </span>
                  </div>
                  {entry.kind === 'guest' && (
                    <>
                      <input
                        type="email"
                        value={entry.email}
                        placeholder="their@email.com"
                        onChange={(e) => {
                          const next = [...plan.participants]
                          next[i] = { ...entry, email: e.target.value }
                          setPlan({ ...plan, participants: next })
                        }}
                        className="w-full mt-1.5 border border-line rounded-lg px-2 py-1 text-xs bg-input text-text focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                      {!entry.email.trim() && (
                        <p className="text-xs text-warn-text mt-1">
                          Without an email, {entry.person.name} won't link up automatically when
                          they join — you'd have to invite them by email later.
                        </p>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-text-muted mt-2">
              Anyone you give an email to will be able to see this{' '}
              {tripLabel(snapshot.tripType)} once they sign in with it.
            </p>
          </div>

          {warnings.length > 0 && (
            <div className="bg-warn-bg border border-warn-border rounded-lg px-3 py-2 mb-4">
              <p className="text-sm text-warn-text font-medium mb-1">
                Worth checking before you restore
              </p>
              <ul className="text-xs text-warn-text space-y-1 list-disc pl-4">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={doRestore}
              disabled={stage === 'restoring' || atLimit}
              className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {stage === 'restoring'
                ? 'Restoring…'
                : `Restore ${snapshot.expenses.length} expense${snapshot.expenses.length === 1 ? '' : 's'}`}
            </button>
            <button
              onClick={() => {
                setStage('pick')
                setSnapshot(null)
                setWarnings([])
                setError(null)
              }}
              disabled={stage === 'restoring'}
              className="text-sm text-text-muted hover:text-text-secondary px-2 py-1 disabled:opacity-50"
            >
              Pick a different sheet
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
