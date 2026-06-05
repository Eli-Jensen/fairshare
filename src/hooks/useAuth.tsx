import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db, googleProvider, firebaseConfigured } from '../lib/firebase'

interface AuthState {
  user: User | null
  loading: boolean
  isAllowed: boolean | null
  firebaseReady: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  isAllowed: null,
  firebaseReady: false,
  signIn: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(firebaseConfigured)
  const [isAllowed, setIsAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    if (!auth) return

    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser?.email && db) {
        const allowed = await checkAllowed(firebaseUser.email)
        setIsAllowed(allowed)
        if (allowed) {
          await setDoc(
            doc(db, 'users', firebaseUser.uid),
            {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName ?? '',
              email: firebaseUser.email,
              photoURL: firebaseUser.photoURL ?? null,
            },
            { merge: true }
          )
        }
      } else {
        setIsAllowed(null)
      }
      setLoading(false)
    })
  }, [])

  const signIn = async () => {
    if (!auth || !googleProvider) return
    await signInWithPopup(auth, googleProvider)
  }

  const signOut = async () => {
    if (!auth) return
    await firebaseSignOut(auth)
    setIsAllowed(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAllowed,
        firebaseReady: firebaseConfigured,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

async function checkAllowed(email: string): Promise<boolean> {
  if (!db) return false
  const snap = await getDoc(doc(db, 'allowedUsers', email.toLowerCase()))
  return snap.exists()
}

export function useAuth() {
  return useContext(AuthContext)
}
