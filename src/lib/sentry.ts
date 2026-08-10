/**
 * Crash reporting. Gated on VITE_SENTRY_DSN exactly like the VAPID key and
 * the OAuth client id — unset, and the whole feature is inert (no SDK init,
 * no network). Never active under `npm run dev`.
 *
 * Errors only: no tracing, no session replay. The free tier is 5k events a
 * month and this app's job is to report the crashes nobody was going to see
 * in a console, not to profile itself.
 *
 * Privacy: sendDefaultPii stays false, and beforeSend/beforeBreadcrumb
 * redact invite codes — /join/<code> URLs are live capabilities (the rules
 * accept them as proof of invitation), and a crash report must not be a way
 * for them to leave the household.
 */
import * as Sentry from '@sentry/react'

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined

const redactJoin = (s: string) => s.replace(/\/join\/[^/?#\s]+/g, '/join/[redacted]')

export function initSentry(): void {
  if (!DSN || import.meta.env.DEV) return
  Sentry.init({
    dsn: DSN,
    release: __GIT_SHA__,
    environment: import.meta.env.VITE_BUILD_ENV === 'dev' ? 'dev' : 'prod',
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.url) event.request.url = redactJoin(event.request.url)
      return event
    },
    beforeBreadcrumb(crumb) {
      if (typeof crumb.data?.url === 'string') crumb.data.url = redactJoin(crumb.data.url)
      if (typeof crumb.data?.to === 'string') crumb.data.to = redactJoin(crumb.data.to)
      if (typeof crumb.message === 'string') crumb.message = redactJoin(crumb.message)
      return crumb
    },
  })
}

/** No-ops when Sentry isn't initialized, so callers never need to check. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!DSN || import.meta.env.DEV) return
  Sentry.captureException(error, context ? { extra: context } : undefined)
}
