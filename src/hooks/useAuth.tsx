import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { doc, setDoc, getDoc } from 'firebase/firestore'
import { auth, db, googleProvider, firebaseConfigured } from '../lib/firebase'
import { notifyError } from '../lib/errorToast'
import { reportError } from '../lib/sentry'
import { classifySignInError } from '../lib/signInError'

/**
 * idle    — nothing in flight; the button says "Sign in with Google".
 * working — a popup is out; the button is locked, so a second tap can't
 *           cancel a sign-in that is about to succeed.
 * stalled — still no answer well after the person came back, so the popup
 *           was most likely abandoned. The button unlocks as a retry.
 */
export type SignInStatus = 'idle' | 'working' | 'stalled'

// How long the page must have been in front of the person, still waiting,
// before we call it stalled. Sentry's breadcrumbs put a real iOS return →
// credential exchange at ~0.5s, with the auth state landing shortly after;
// 6s is a wide margin for a slow phone connection.
const STALL_AFTER_RETURN_MS = 6000
// Backstop for browsers that never fire focus/visibility for the popup round
// trip. Harmless if the person is still in the popup: the unlocked button is
// behind it, and finishing there still signs them in.
const STALL_BACKSTOP_MS = 45000

interface AuthState {
  user: User | null
  loading: boolean
  firebaseReady: boolean
  signInStatus: SignInStatus
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  firebaseReady: false,
  signInStatus: 'idle',
  signIn: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(firebaseConfigured)
  const [signInStatus, setSignInStatusState] = useState<SignInStatus>('idle')
  // Mirrors signInStatus for the tap guard: two taps inside one render would
  // both read a stale 'idle' from state.
  const signInStatusRef = useRef<SignInStatus>('idle')
  // Bumped per attempt, so a retry's superseded attempt can't touch state
  // when its cancellation arrives.
  const signInAttempt = useRef(0)
  const setSignInStatus = useCallback((next: SignInStatus) => {
    signInStatusRef.current = next
    setSignInStatusState(next)
  }, [])

  useEffect(() => {
    if (!auth) return

    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      setLoading(false)
      // A successful sign-in ends HERE, in the same render that swaps the
      // sign-in page out — not when signInWithPopup resolves, which can land
      // a beat earlier and flash the button back to idle.
      setSignInStatus('idle')
      if (firebaseUser?.email && db) {
        try {
          const userRef = doc(db, 'users', firebaseUser.uid)
          const existing = await getDoc(userRef)
          const googleName = firebaseUser.displayName ?? ''
          const googlePhoto = firebaseUser.photoURL ?? null

          if (existing.exists()) {
            // Only write if Google data actually changed (avoids wasting
            // a write on every token refresh / tab focus)
            const data = existing.data()
            if (
              data.email !== firebaseUser.email ||
              data.googleDisplayName !== googleName ||
              data.googlePhotoURL !== googlePhoto
            ) {
              await setDoc(
                userRef,
                {
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  googleDisplayName: googleName,
                  googlePhotoURL: googlePhoto,
                },
                { merge: true }
              )
            }
          } else {
            await setDoc(userRef, {
              uid: firebaseUser.uid,
              displayName: googleName,
              email: firebaseUser.email,
              photoURL: googlePhoto,
              googleDisplayName: googleName,
              googlePhotoURL: googlePhoto,
            })
          }
        } catch (err) {
          console.error('Failed to sync user profile:', err)
        }
      }
    })
  }, [setSignInStatus])

  // Unlock a sign-in that has gone quiet. The clock starts when the person
  // is back on this page (focus, or the tab becoming visible on iOS where the
  // popup is a separate tab) and restarts on each return, so time spent in
  // the Google window never counts.
  useEffect(() => {
    if (signInStatus !== 'working') return
    const stall = () => {
      if (signInStatusRef.current === 'working') setSignInStatus('stalled')
    }
    let returnTimer: number | undefined
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return
      window.clearTimeout(returnTimer)
      returnTimer = window.setTimeout(stall, STALL_AFTER_RETURN_MS)
    }
    const backstop = window.setTimeout(stall, STALL_BACKSTOP_MS)
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.clearTimeout(returnTimer)
      window.clearTimeout(backstop)
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [signInStatus, setSignInStatus])

  // A second signInWithPopup cancels the first one mid-flight, and Firebase
  // then throws an internal assertion when the first popup's result lands
  // with no promise left to resolve. On iOS that window is wide: back from
  // the popup tab, the page shows the button for a second or two while the
  // credential exchange finishes, which invites a second tap. Sentry caught
  // exactly that (auth/cancelled-popup-request + "Pending promise was never
  // set", one tap apart). So taps are ignored while 'working'; once
  // 'stalled', a tap is a deliberate retry. Firebase cancels the old attempt
  // and closes its window, so a retry never leaves two popups racing.
  const signIn = async () => {
    if (!auth || !googleProvider || signInStatusRef.current === 'working') return
    const attempt = ++signInAttempt.current
    setSignInStatus('working')
    try {
      // Success ends in onAuthStateChanged, which resets the status.
      await signInWithPopup(auth, googleProvider)
    } catch (err) {
      // Superseded by a retry: its cancellation is the retry working.
      if (attempt !== signInAttempt.current) return
      setSignInStatus('idle')
      const action = classifySignInError(err)
      if (action.kind === 'ignore') return
      notifyError(action.message)
      if (action.report) {
        reportError(err, { where: 'signIn', code: (err as { code?: string }).code })
      }
    }
  }

  const signOut = async () => {
    if (!auth) return
    await firebaseSignOut(auth)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        firebaseReady: firebaseConfigured,
        signInStatus,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
