import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

let app: FirebaseApp | undefined
let _auth: Auth | undefined
let _db: Firestore | undefined
let _googleProvider: GoogleAuthProvider | undefined

if (firebaseConfigured) {
  app = initializeApp(firebaseConfig)
  _auth = getAuth(app)
  _db = getFirestore(app)
  _googleProvider = new GoogleAuthProvider()
}

// All protected routes require auth, which requires Firebase to be configured,
// so these are safe to assert as non-null where used.
export const auth = _auth as Auth
export const db = _db as Firestore
export const googleProvider = _googleProvider as GoogleAuthProvider
