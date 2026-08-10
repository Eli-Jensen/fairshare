import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

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
let _storage: FirebaseStorage | undefined
let _googleProvider: GoogleAuthProvider | undefined

if (firebaseConfigured) {
  app = initializeApp(firebaseConfig)
  _auth = getAuth(app)
  // Enable offline persistence so the app works on spotty wifi/planes
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  })
  // Default bucket from firebaseConfig.storageBucket (receipts + comment
  // photos). Uploads have NO offline queue, unlike Firestore writes.
  _storage = getStorage(app)
  _googleProvider = new GoogleAuthProvider()
}

// All protected routes require auth, which requires Firebase to be configured,
// so these are safe to assert as non-null where used.
export const auth = _auth as Auth
export const db = _db as Firestore
export const storage = _storage as FirebaseStorage
export const googleProvider = _googleProvider as GoogleAuthProvider
// getMessaging() needs the app instance itself. Kept possibly-undefined
// (unlike the asserted exports above) because push.ts checks it as part of
// deciding whether the feature is available at all.
export const app_ = app
