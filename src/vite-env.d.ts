/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_ALLOWED_EMAILS?: string
  readonly VITE_BUILD_ENV?: string
  /** Google OAuth web client id. Unset = the Sheets backup feature is hidden. */
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID?: string
  /** Public Web Push (VAPID) key. Unset = push notifications are hidden. */
  readonly VITE_FIREBASE_VAPID_KEY?: string
  /** Sentry DSN (public client key). Unset = crash reporting is off. */
  readonly VITE_SENTRY_DSN?: string
  /** KLIPY GIF-search content key (public, rate-limited). Unset = the GIF
   *  button hides itself. */
  readonly VITE_KLIPY_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Build-time constants injected by vite.config.ts `define`
declare const __APP_VERSION__: string
declare const __GIT_SHA__: string
declare const __BUILD_DATE__: string
