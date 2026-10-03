/**
 * What to do when signInWithPopup rejects. Pure, so the decision is tested
 * apart from the popup machinery in useAuth.
 */
export type SignInErrorAction =
  | { kind: 'ignore' }
  | { kind: 'tell'; message: string; report: boolean }

// The person backed out of the popup, or a newer popup superseded it.
// Nothing went wrong, so nothing to show or report.
const BENIGN = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
])

export function classifySignInError(err: unknown): SignInErrorAction {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string' && BENIGN.has(code)) return { kind: 'ignore' }
  if (code === 'auth/popup-blocked') {
    return {
      kind: 'tell',
      message: 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
      report: false,
    }
  }
  return {
    kind: 'tell',
    message: "Sign-in didn't go through. Check your connection and try again.",
    // A dropped connection is the person's network, not our bug.
    report: code !== 'auth/network-request-failed',
  }
}
