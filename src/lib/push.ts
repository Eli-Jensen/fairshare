/**
 * Web push: permission, device tokens, and per-user preferences.
 *
 * Everything lives at /users/{uid}/private/push, which the existing
 * owner-only wildcard rule already covers — so this ships without a rules
 * deploy, same reasoning as sheetLinks.ts. Tokens must never move to
 * /users/{uid}: that doc is readable by any signed-in user.
 *
 * The Cloud Functions in functions/src/ are what actually send; a browser
 * cannot (it can't read another user's tokens, and has no send credential).
 * With VITE_FIREBASE_VAPID_KEY unset the whole feature reports itself
 * unsupported and the UI hides it — which is what lets an environment without
 * a web-push certificate behave exactly as it did before.
 *
 * `firebase/messaging` is dynamically imported everywhere so it stays out of
 * the main chunk for the majority of users who never enable push.
 */
import {
  deleteField,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from 'firebase/firestore'
import { app_, db } from './firebase'

// ── Preferences (per user, all devices) ─────────────────────────────────────
// Stored beside the tokens at /users/{uid}/private/push.prefs. SPARSE: an
// absent key means ON, so enabling push gets you everything until you say
// otherwise. The functions honor these server-side, so a muted push never
// leaves Google.
export type PushKind = 'expenses' | 'settlements' | 'comments' | 'members'
export type PushPrefs = Partial<Record<PushKind, boolean>>

export const PUSH_KINDS: { id: PushKind; label: string; hint: string }[] = [
  {
    id: 'expenses',
    label: '🧾 Expenses',
    hint: 'Added, edited or deleted — only ones you’re part of',
  },
  {
    id: 'settlements',
    label: '💸 Payments',
    hint: 'When someone settles up with you',
  },
  {
    id: 'comments',
    label: '💬 Comments',
    hint: 'Replies on expenses you’re in',
  },
  {
    id: 'members',
    label: '👋 People & invites',
    hint: 'Trip invites, joins, departures, and deleted trips',
  },
]

export async function getPushPrefs(uid: string): Promise<PushPrefs> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'push'))
    return (snap.data()?.prefs as PushPrefs | undefined) ?? {}
  } catch {
    return {}
  }
}

export async function setPushPref(uid: string, kind: PushKind, enabled: boolean): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'private', 'push'), { prefs: { [kind]: enabled } }, { merge: true })
}

// ── Per-trip mutes ──────────────────────────────────────────────────────────
// Trips accumulate: last year's ski weekend is settled and done, but it's
// still in your list and can still be edited. Silence one wholesale via
// mutedTrips.{tripId} = true. Sparse — absent means unmuted, and unmuting
// deletes the key rather than writing false, so the map stays small.

export async function getMutedTrips(uid: string): Promise<Record<string, boolean>> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'push'))
    return (snap.data()?.mutedTrips as Record<string, boolean> | undefined) ?? {}
  } catch {
    return {}
  }
}

export async function setTripMuted(uid: string, tripId: string, muted: boolean): Promise<void> {
  await setDoc(
    doc(db, 'users', uid, 'private', 'push'),
    { mutedTrips: { [tripId]: muted ? true : deleteField() } },
    { merge: true }
  )
}

/** Public Web Push (VAPID) key — per project, generated in the Firebase
 *  console under Cloud Messaging → Web Push certificates. Dev and prod keys
 *  are different and not interchangeable. */
export const VAPID_KEY = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) || undefined

const tokenKey = (uid: string) => `fairshare-push-token-${uid}`
// Deliberate opt-out marker, set by disablePush and cleared by enablePush.
// The self-heal below has to tell "user turned this off here" (respect it)
// apart from "the browser wiped site storage" — both erase tokenKey, but only
// an explicit disable writes this.
const optOutKey = (uid: string) => `fairshare-push-off-${uid}`

/** Static prerequisites — config plus browser APIs. Cheap and synchronous. */
export function pushConfigured(): boolean {
  return Boolean(
    VAPID_KEY &&
      app_ &&
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'PushManager' in window
  )
}

/** Full support check, including the messaging SDK's own probe. */
export async function pushSupported(): Promise<boolean> {
  if (!pushConfigured()) return false
  try {
    const { isSupported } = await import('firebase/messaging')
    return await isSupported()
  } catch {
    return false
  }
}

/** Whether push is on for this user on THIS device. */
export function pushEnabled(uid: string): boolean {
  try {
    return (
      Boolean(localStorage.getItem(tokenKey(uid))) &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    )
  } catch {
    return false
  }
}

/**
 * The app's single service worker (offline shell + push), generated by
 * vite.config.ts. Registering by the same URL is idempotent, and passing the
 * registration to getToken below is what stops the FCM SDK from quietly
 * registering a SECOND worker of its own at its own scope.
 */
async function messagingSw(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js')
}

export type EnableResult = 'enabled' | 'denied' | 'unsupported'

/** Ask permission, mint a token for this device, and file it so the functions
 *  can reach us. Must be called from a user gesture. */
export async function enablePush(uid: string): Promise<EnableResult> {
  if (!(await pushSupported())) return 'unsupported'
  const registration = await messagingSw()
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const { getMessaging, getToken } = await import('firebase/messaging')
  const token = await getToken(getMessaging(app_!), {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  })
  if (!token) return 'unsupported'
  await setDoc(
    doc(db, 'users', uid, 'private', 'push'),
    { fcmTokens: arrayUnion(token) },
    { merge: true }
  )
  try {
    localStorage.setItem(tokenKey(uid), token)
    localStorage.removeItem(optOutKey(uid))
  } catch {
    /* localStorage unavailable */
  }
  return 'enabled'
}

/**
 * Self-heal on every app open. FCM tokens rot — a PWA reinstall, cleared site
 * data, or a key rotation invalidates one while the UI still cheerfully says
 * "On", and the server prunes it on the first failed send. After that the
 * device is silent and nothing in the app can tell you.
 *
 * The gate is the PERMISSION, not our own localStorage flag. Android wipes
 * site storage routinely, and that wipe takes the flag AND the push
 * subscription together — so a flag-gated heal abandons exactly the devices
 * that most need healing. If this device may show notifications and the user
 * hasn't deliberately turned push off here, mint a fresh token.
 *
 * Union before remove, so a failed removal degrades to a harmless extra token
 * (the server prunes dead ones on send) rather than to none at all. Never
 * surfaces errors.
 */
export async function refreshPushToken(uid: string): Promise<void> {
  try {
    if (localStorage.getItem(optOutKey(uid))) return // user said no on this device
  } catch {
    /* no localStorage → heal anyway */
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (!(await pushSupported())) return
  try {
    const registration = await messagingSw()
    const { getMessaging, getToken } = await import('firebase/messaging')
    const token = await getToken(getMessaging(app_!), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    })
    if (!token) return
    const old = localStorage.getItem(tokenKey(uid))
    if (old === token) return
    await setDoc(
      doc(db, 'users', uid, 'private', 'push'),
      { fcmTokens: arrayUnion(token) },
      { merge: true }
    )
    if (old) {
      await updateDoc(doc(db, 'users', uid, 'private', 'push'), {
        fcmTokens: arrayRemove(old),
      }).catch(() => {})
    }
    localStorage.setItem(tokenKey(uid), token)
  } catch {
    /* self-heal never complains */
  }
}

/** Ask the server to ping this account's devices now. onPushTestRequested
 *  answers by writing {sentAt, devices, pruned} back onto the same doc; the
 *  full overwrite clears any previous answer. */
export async function requestPushTest(uid: string): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'private', 'pushTest'), {
    requestedAt: serverTimestamp(),
  })
}

/** Drop this device's token, locally and on the server. The opt-out marker
 *  stops the open-time self-heal from quietly undoing a deliberate off. */
export async function disablePush(uid: string): Promise<void> {
  let token: string | null = null
  try {
    token = localStorage.getItem(tokenKey(uid))
    localStorage.removeItem(tokenKey(uid))
    localStorage.setItem(optOutKey(uid), '1')
  } catch {
    /* ignore */
  }
  try {
    const { getMessaging, deleteToken } = await import('firebase/messaging')
    await deleteToken(getMessaging(app_!))
  } catch {
    /* token may already be gone */
  }
  if (token) {
    await updateDoc(doc(db, 'users', uid, 'private', 'push'), {
      fcmTokens: arrayRemove(token),
    }).catch(() => {})
  }
}

export interface ForegroundNote {
  title: string
  body?: string
  link?: string
}

/**
 * Pushes that land while the app is open AND focused. FCM only auto-displays
 * banners for backgrounded pages, and iOS suppresses them for the focused app
 * entirely — so we do both: mirror a system notification where the platform
 * allows it, and hand the note to `onNote` so the app can show its own toast,
 * which is the only reliable signal on a focused iPhone.
 *
 * Returns an unsubscribe, or undefined when push isn't active here.
 */
export async function startForegroundNotifications(
  onNote?: (n: ForegroundNote) => void
): Promise<(() => void) | undefined> {
  if (!(await pushSupported())) return undefined
  if (Notification.permission !== 'granted') return undefined
  const { getMessaging, onMessage } = await import('firebase/messaging')
  const registration = await messagingSw()
  return onMessage(getMessaging(app_!), (payload) => {
    const n = payload.notification
    if (!n?.title) return
    const link = payload.fcmOptions?.link
    onNote?.({ title: n.title, body: n.body, link })
    registration
      .showNotification(n.title, { body: n.body, icon: '/icon-192.png' })
      .catch(() => {})
  })
}
