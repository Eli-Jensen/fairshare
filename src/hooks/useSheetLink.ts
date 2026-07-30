import { useCallback, useEffect, useRef, useState } from 'react'
import type { Trip, Expense, UserProfile } from '../lib/types'
import {
  GoogleAuthError,
  clearCachedToken,
  getCachedToken,
  isGoogleConfigured,
  requestToken,
} from '../lib/googleAuth'
import { SheetsError } from '../lib/sheetsApi'
import type { SheetProperties } from '../lib/sheetsApi'
import { buildSnapshot, hashSnapshot } from '../lib/sheetSnapshot'
import { createBackupSheet, describeMissingSheet, syncBackupSheet } from '../lib/sheetSync'
import { loadSheetLinks, removeSheetLink, saveSheetLink } from '../lib/sheetLinks'
import type { SheetLink } from '../lib/sheetLinks'

/**
 * Backup state for one trip.
 *
 * The important rule lives in `maybeAutoSync`: automatic syncing may only ever
 * use a token that is already in memory. It must never call `requestToken()`,
 * because that needs a user gesture and would either be blocked as a popup or —
 * worse — actually open one out of nowhere while someone is typing. So an
 * expired token degrades to an "out of date" badge, not a prompt.
 */

export type SheetStatus =
  | 'unconfigured' // no OAuth client id in this build — feature is hidden
  | 'unlinked' // no backup sheet yet
  | 'linked'
  | 'working'

export interface SheetError {
  message: string
  /** Offer to create a replacement sheet rather than retrying the old one. */
  canRecreate?: boolean
  /** The failure needs a fresh token, which needs a click. */
  needsReconnect?: boolean
}

interface SnapshotSource {
  trip: Trip | null
  members: Record<string, UserProfile>
  participants: string[]
  currentUid: string | undefined
  loadAllExpenses: () => Promise<Expense[]>
}

const AUTO_SYNC_DEBOUNCE_MS = 10_000

export function useSheetLink(tripId: string | undefined, source: SnapshotSource) {
  const [link, setLink] = useState<SheetLink | null>(null)
  const [status, setStatus] = useState<SheetStatus>(
    isGoogleConfigured() ? 'unlinked' : 'unconfigured'
  )
  const [error, setError] = useState<SheetError | null>(null)
  const [linksLoaded, setLinksLoaded] = useState(false)
  /** Snapshot hash of what's on screen now, vs what was last written. */
  const [pendingHash, setPendingHash] = useState<string | null>(null)

  // Cached tab structure, so a second sync in the same session skips a call
  const knownSheets = useRef<SheetProperties[] | undefined>(undefined)
  // One sync at a time per trip: two overlapping value writes to the same
  // spreadsheet would interleave
  const inFlight = useRef(false)
  const autoSyncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const { trip, members, participants, currentUid, loadAllExpenses } = source

  // Derived, not set in an effect: with nothing to fetch there is nothing to
  // wait for, so "loaded" is already true rather than true-on-the-next-render
  const nothingToLoad = !currentUid || !tripId || !isGoogleConfigured()
  const loaded = nothingToLoad || linksLoaded

  useEffect(() => {
    if (nothingToLoad) return
    let cancelled = false
    loadSheetLinks(currentUid).then((links) => {
      if (cancelled) return
      const existing = links[tripId] ?? null
      setLink(existing)
      setStatus(existing ? 'linked' : 'unlinked')
      setLinksLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [currentUid, tripId, nothingToLoad])

  const buildCurrentSnapshot = useCallback(async () => {
    if (!trip || !currentUid) return null
    // Resolves with the complete list — the expenses in this closure are the
    // paginated first page
    const all = await loadAllExpenses()
    return buildSnapshot({
      trip,
      expenses: all,
      members,
      participants,
      currentUid,
      exportedAt: new Date().toISOString(),
    })
  }, [trip, members, participants, currentUid, loadAllExpenses])

  const describeError = useCallback(
    async (err: unknown, token: string | null): Promise<SheetError> => {
      if (err instanceof GoogleAuthError) {
        return { message: err.message, needsReconnect: err.kind !== 'not_configured' }
      }
      if (err instanceof SheetsError) {
        switch (err.kind) {
          case 'unauthenticated':
            clearCachedToken()
            return {
              message: 'Your Google connection expired.',
              needsReconnect: true,
            }
          case 'api_disabled':
            // A deployment problem, not something the user can act on
            console.error('Sheets/Drive API not enabled:', err.message, err.helpUrl)
            return { message: "Sheets backup isn't set up for this version of the app." }
          case 'forbidden':
            return {
              message:
                "FairShare doesn't have permission to write to that sheet any more.",
              canRecreate: true,
              needsReconnect: true,
            }
          case 'not_found': {
            const fate = token && link
              ? await describeMissingSheet(token, link.spreadsheetId)
              : 'gone'
            return {
              message:
                fate === 'trashed'
                  ? "Your backup sheet is in your Google Drive trash. Restore it there, or create a new one."
                  : "Your backup sheet can't be found — it may have been deleted.",
              canRecreate: true,
            }
          }
          case 'rate_limited':
            return { message: 'Google is busy right now. Try again in a moment.' }
          case 'offline':
            return { message: "You're offline — try again when you're back." }
          default:
            return { message: err.message }
        }
      }
      return { message: 'Something went wrong backing up to Google Sheets.' }
    },
    [link]
  )

  /**
   * Shared tail of create/sync: build the snapshot, run the work, persist the
   * link, map failures. Callers pass a closure that already holds the token, so
   * the token never has to be threaded through here.
   */
  const run = useCallback(
    async (
      work: (
        snapshot: NonNullable<Awaited<ReturnType<typeof buildCurrentSnapshot>>>
      ) => Promise<{ link: SheetLink }>
    ) => {
      if (!currentUid || !tripId || inFlight.current) return
      inFlight.current = true
      setStatus('working')
      setError(null)
      try {
        const snapshot = await buildCurrentSnapshot()
        if (!snapshot) return
        const result = await work(snapshot)
        await saveSheetLink(currentUid, tripId, result.link)
        setLink(result.link)
        setPendingHash(result.link.lastSyncedHash)
        setStatus('linked')
      } catch (err) {
        knownSheets.current = undefined
        setError(await describeError(err, getCachedToken()))
        setStatus(link ? 'linked' : 'unlinked')
      } finally {
        inFlight.current = false
      }
    },
    [currentUid, tripId, buildCurrentSnapshot, describeError, link]
  )

  /** MUST be called straight from a click — see googleAuth.ts. */
  const connectAndCreate = useCallback(() => {
    // requestToken() first, with nothing awaited before it — an await here
    // would drop the user-activation flag and the popup would be blocked
    return requestToken().then(
      (token) => run((snapshot) => createBackupSheet(token, tripId!, snapshot)),
      async (err) => {
        setError(await describeError(err, null))
      }
    )
  }, [run, tripId, describeError])

  /** MUST be called straight from a click when no token is cached. */
  const syncNow = useCallback(() => {
    if (!link) return Promise.resolve()
    return requestToken().then(
      (token) =>
        run((snapshot) => syncBackupSheet(token, link, snapshot, knownSheets.current)),
      async (err) => {
        setError(await describeError(err, null))
      }
    )
  }, [link, run, describeError])

  const unlink = useCallback(async () => {
    if (!currentUid || !tripId) return
    await removeSheetLink(currentUid, tripId)
    setLink(null)
    setStatus('unlinked')
    setError(null)
    knownSheets.current = undefined
  }, [currentUid, tripId])

  /** Recompute the current hash so the UI can say whether the sheet is stale. */
  useEffect(() => {
    if (!link || !trip || !currentUid) return
    let cancelled = false
    buildCurrentSnapshot().then((snapshot) => {
      if (!cancelled && snapshot) setPendingHash(hashSnapshot(snapshot))
    })
    return () => {
      cancelled = true
    }
  }, [link?.spreadsheetId, trip?.lastActivityAt, buildCurrentSnapshot, currentUid])

  const isStale = Boolean(link && pendingHash && pendingHash !== link.lastSyncedHash)

  /**
   * Automatic sync, in-session only. Silent by construction: no cached token
   * means no sync and no prompt.
   */
  useEffect(() => {
    if (!link?.autoSync || !isStale || status === 'working') return
    if (!getCachedToken()) return

    clearTimeout(autoSyncTimer.current)
    autoSyncTimer.current = setTimeout(() => {
      const token = getCachedToken()
      if (!token || inFlight.current) return
      void run((snapshot) => syncBackupSheet(token, link, snapshot, knownSheets.current))
    }, AUTO_SYNC_DEBOUNCE_MS)

    return () => clearTimeout(autoSyncTimer.current)
  }, [link, isStale, status, run])

  const setAutoSync = useCallback(
    async (autoSync: boolean) => {
      if (!currentUid || !tripId || !link) return
      const next = { ...link, autoSync }
      setLink(next)
      await saveSheetLink(currentUid, tripId, next)
    },
    [currentUid, tripId, link]
  )

  return {
    status,
    link,
    error,
    loaded,
    isStale,
    /** True when a sync would need a click to get a token first. */
    needsGesture: !getCachedToken(),
    connectAndCreate,
    syncNow,
    unlink,
    setAutoSync,
    dismissError: () => setError(null),
  }
}
