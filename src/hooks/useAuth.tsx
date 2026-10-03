import {
  createContext,
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

// The person backed out of the popup, or a newer popup superseded it.
// Nothing went wrong, so nothing to show or report.
const BENIGN_SIGN_IN_ERRORS = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
])

interface AuthState {
  user: User | null
  loading: boolean
  firebaseReady: boolean
  /** A sign-in popup is in flight — disable the button so it can't stack a second one. */
  signingIn: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  firebaseReady: false,
  signingIn: false,
  signIn: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(firebaseConfigured)
  const [signingIn, setSigningIn] = useState(false)
  // A ref, not the state: two taps inside one render would both read a stale
  // `signingIn` of false.
  const signInInFlight = useRef(false)

  useEffect(() => {
    if (!auth) return

    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      setLoading(false)
      // A successful sign-in ends HERE, in the same render that swaps the
      // sign-in page out — not when signInWithPopup resolves, which can land
      // a beat earlier and flash the button back to idle.
      setSigningIn(false)
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
  }, [])

  // A second signInWithPopup cancels the first one mid-flight, and Firebase
  // then throws an internal assertion when the first popup's result lands
  // with no promise left to resolve. On iOS that window is wide: back from
  // the popup tab, the page shows the button for a second or two while the
  // credential exchange finishes, which invites a second tap. Sentry caught
  // exactly that (auth/cancelled-popup-request + "Pending promise was never
  // set", one tap apart).
  const signIn = async () => {
    if (!auth || !googleProvider || signInInFlight.current) return
    signInInFlight.current = true
    setSigningIn(true)
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (err) {
      setSigningIn(false)
      const code = (err as { code?: string }).code ?? ''
      if (BENIGN_SIGN_IN_ERRORS.has(code)) return
      if (code === 'auth/popup-blocked') {
        notifyError('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.')
        return
      }
      notifyError("Sign-in didn't go through. Check your connection and try again.")
      if (code !== 'auth/network-request-failed') reportError(err, { where: 'signIn', code })
    } finally {
      signInInFlight.current = false
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
        signingIn,
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
