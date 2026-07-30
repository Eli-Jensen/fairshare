/**
 * OAuth for the Google Sheets backup, using Google Identity Services' token
 * model directly rather than Firebase Auth.
 *
 * Two constraints shape everything here:
 *
 *  1. **There is no silent refresh in the browser.** GIS issues an access token
 *     good for about an hour and never a refresh token — that only exists for
 *     server-side flows, and this app has no server. So a new token always
 *     costs a user gesture. `getCachedToken()` and `requestToken()` are
 *     deliberately separate functions so a caller cannot accidentally trigger a
 *     popup from a background timer: anything automatic must go through
 *     `getCachedToken()` and give up when it returns null.
 *
 *  2. **The gesture is fragile.** `requestToken()` must be reached from a click
 *     handler with no `await` before it. Safari and Chrome both discard the
 *     user-activation flag across an await, and the popup is then blocked. If
 *     you find yourself wanting to load data first and authorize second, load
 *     it after the token instead.
 *
 * The token lives in a module variable and nowhere else — not localStorage, not
 * sessionStorage, never logged. Losing it on reload is the correct trade: it is
 * a bearer credential for the user's Drive.
 */

/** Per-file access: FairShare can only ever see sheets it created itself. */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
/** Treat a token as expired early, so a sync can't die mid-flight. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined) ?? ''

// ── Minimal ambient types ──────────────────────────────────────────────────
// Hand-written rather than pulling in @types/google.accounts: this is the whole
// surface we use, and the feature is meant to add zero dependencies.

interface TokenResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}

interface GisOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }): TokenClient
  hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean
  revoke(token: string, done?: () => void): void
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOAuth2 } }
  }
}

// ── Errors ─────────────────────────────────────────────────────────────────

export type AuthErrorKind =
  | 'not_configured'
  | 'popup_blocked'
  | 'cancelled'
  | 'scope_declined'
  | 'script_failed'
  | 'unknown'

export class GoogleAuthError extends Error {
  kind: AuthErrorKind

  constructor(kind: AuthErrorKind, message: string) {
    super(message)
    this.name = 'GoogleAuthError'
    this.kind = kind
  }
}

// ── Script loading ─────────────────────────────────────────────────────────

let scriptPromise: Promise<GisOAuth2> | null = null

/** Injected on first use, not in index.html — this keeps the ~40KB GIS script
 *  off the critical path for the many users who never open a backup page. */
function loadGis(): Promise<GisOAuth2> {
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<GisOAuth2>((resolve, reject) => {
    const ready = window.google?.accounts?.oauth2
    if (ready) return resolve(ready)

    const fail = () => {
      // Let a later attempt retry rather than caching the failure forever
      scriptPromise = null
      reject(
        new GoogleAuthError(
          'script_failed',
          "Couldn't reach Google to sign in. Check your connection and try again."
        )
      )
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    const script = existing ?? document.createElement('script')
    script.addEventListener('load', () => {
      const oauth2 = window.google?.accounts?.oauth2
      if (oauth2) resolve(oauth2)
      else fail()
    })
    script.addEventListener('error', fail)

    if (!existing) {
      script.src = GIS_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  })

  return scriptPromise
}

// ── Token cache ────────────────────────────────────────────────────────────

let cached: { token: string; expiresAt: number } | null = null

export function isGoogleConfigured(): boolean {
  return CLIENT_ID.length > 0
}

/**
 * The current token, or null. Never touches the network or shows UI — safe to
 * call from an effect or a timer, which is exactly what auto-sync does.
 */
export function getCachedToken(): string | null {
  if (!cached) return null
  if (Date.now() >= cached.expiresAt - EXPIRY_MARGIN_MS) {
    cached = null
    return null
  }
  return cached.token
}

/** Drop the cached token — call after a 401 so the UI asks for a fresh one. */
export function clearCachedToken(): void {
  cached = null
}

/**
 * Get an access token, showing Google's account/consent dialog.
 *
 * MUST be called synchronously from a user gesture. Awaiting anything first
 * loses the activation and the popup is blocked.
 */
export function requestToken(opts: { forceConsent?: boolean } = {}): Promise<string> {
  if (!isGoogleConfigured()) {
    return Promise.reject(
      new GoogleAuthError(
        'not_configured',
        'Google Sheets backup is not set up in this version of the app.'
      )
    )
  }

  const existing = getCachedToken()
  if (existing && !opts.forceConsent) return Promise.resolve(existing)

  return loadGis().then(
    (oauth2) =>
      new Promise<string>((resolve, reject) => {
        let settled = false
        const client = oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: DRIVE_FILE_SCOPE,
          callback: (response) => {
            if (settled) return
            settled = true
            if (response.error || !response.access_token) {
              reject(
                new GoogleAuthError(
                  'unknown',
                  response.error_description || 'Google turned down the sign-in request.'
                )
              )
              return
            }
            // The consent screen lets the user untick the permission and
            // continue, which yields a token that can't touch Drive at all
            if (!oauth2.hasGrantedAllScopes(response, DRIVE_FILE_SCOPE)) {
              reject(
                new GoogleAuthError(
                  'scope_declined',
                  "FairShare needs permission to create a spreadsheet in your Drive. Try again and leave the checkbox ticked."
                )
              )
              return
            }
            cached = {
              token: response.access_token,
              expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
            }
            resolve(response.access_token)
          },
          error_callback: (error) => {
            if (settled) return
            settled = true
            const type = error.type ?? ''
            if (type === 'popup_failed_to_open') {
              reject(
                new GoogleAuthError(
                  'popup_blocked',
                  'Your browser blocked the Google sign-in window. Allow popups for this site and try again.'
                )
              )
            } else {
              reject(new GoogleAuthError('cancelled', 'Google sign-in was cancelled.'))
            }
          },
        })
        client.requestAccessToken(opts.forceConsent ? { prompt: 'consent' } : undefined)
      })
  )
}

/**
 * Hand the token back to Google and forget it. This revokes FairShare's access
 * to every sheet it created for this user — those files stay in their Drive but
 * become unreachable to the app, permanently. Only for an explicit disconnect.
 */
export function revokeToken(): void {
  const token = cached?.token
  cached = null
  if (!token) return
  window.google?.accounts?.oauth2?.revoke(token)
}

/** Test seam — resets module state between cases. */
export function __resetGoogleAuthForTests(): void {
  cached = null
  scriptPromise = null
}
