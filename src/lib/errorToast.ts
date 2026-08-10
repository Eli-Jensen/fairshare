import { useSyncExternalStore } from 'react'

/**
 * Global error note — failures must be VISIBLE. Any fire-and-forget write
 * that used to console.error into the void calls notifyError() too; Layout
 * renders the toast. Module-level store, no provider needed. (Pattern shared
 * with the sibling good-boy-points app.)
 *
 * This matters more now that the main write flows don't await server acks:
 * a write that fails ONLINE (rules denial, malformed data) rejects quickly,
 * and this is how the person finds out.
 */

export interface ErrorNote {
  id: number
  message: string
}

let current: ErrorNote | null = null
let nextId = 1
const listeners = new Set<() => void>()

export function notifyError(
  message = "That didn't go through. Check your connection and try again."
): void {
  current = { id: nextId++, message }
  for (const l of listeners) l()
}

export function clearError(): void {
  current = null
  for (const l of listeners) l()
}

export function useErrorNote(): ErrorNote | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current
  )
}
