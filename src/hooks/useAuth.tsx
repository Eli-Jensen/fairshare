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
import { doc, setDoc, getDoc } from 'firebase/firestore'
import { auth, db, googleProvider, firebaseConfigured } from '../lib/firebase'

interface AuthState {
  user: User | null
  loading: boolean
  firebaseReady: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  firebaseReady: false,
  signIn: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(firebaseConfigured)

  useEffect(() => {
    if (!auth) return

    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      setLoading(false)
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

  const signIn = async () => {
    if (!auth || !googleProvider) return
    await signInWithPopup(auth, googleProvider)
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
