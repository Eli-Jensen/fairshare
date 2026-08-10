import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrips } from '../hooks/useTrips'
import { useProfileCache } from '../hooks/useProfileCache'
import {
  PUSH_KINDS,
  disablePush,
  enablePush,
  getMutedTrips,
  getPushPrefs,
  isThisDeviceRegistered,
  pushConfigured,
  pushEnabled,
  pushSupported,
  requestPushTest,
  setPushPref,
  setTripMuted,
  type PushPrefs,
} from '../lib/push'
import { tripLabel, type UserProfile } from '../lib/types'

export function Profile() {
  const { user } = useAuth()
  const { invalidateProfile } = useProfileCache()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    async function load() {
      const snap = await getDoc(doc(db, 'users', user!.uid))
      if (snap.exists()) {
        const data = snap.data() as UserProfile
        setProfile(data)
        setDisplayName(data.displayName)
      }
      setLoading(false)
    }
    load()
  }, [user?.uid])

  if (loading || !profile || !user) {
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  const googleName = profile.googleDisplayName ?? profile.displayName
  const googlePhoto = profile.googlePhotoURL ?? profile.photoURL
  const hasCustomName = displayName !== googleName

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    await updateDoc(doc(db, 'users', user.uid), {
      displayName: displayName.trim() || googleName,
    })
    invalidateProfile(user.uid)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inputClasses = 'w-full border border-line rounded-lg px-3 py-2 text-sm bg-card text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500'

  return (
    <div>
      <h1 className="text-2xl font-bold text-text mb-6">Edit Profile</h1>

      {/* Current avatar preview */}
      <div className="flex items-center gap-4 mb-6 p-4 bg-card rounded-lg border border-line">
        <div className="w-16 h-16 rounded-full overflow-hidden shrink-0 bg-muted">
          {googlePhoto ? (
            <img
              src={googlePhoto}
              alt=""
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <div className="w-full h-full bg-primary-100 text-accent-text flex items-center justify-center text-2xl font-medium">
              {displayName?.charAt(0)?.toUpperCase() || '?'}
            </div>
          )}
        </div>
        <div>
          <p className="font-medium text-text">{displayName || 'No name set'}</p>
          <p className="text-sm text-text-muted">{profile.email}</p>
          {hasCustomName && (
            <p className="text-xs text-text-muted mt-0.5">
              Google name: {googleName}
            </p>
          )}
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1" htmlFor="profile-name">
            Display Name
          </label>
          <input
            id="profile-name"
            type="text"
            className={inputClasses}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={googleName}
            maxLength={50}
          />
          <p className="text-xs text-text-muted mt-1">
            This is how other members will see you in trips.
          </p>
        </div>

        {hasCustomName && (
          <button
            type="button"
            onClick={() => setDisplayName(googleName)}
            className="text-sm text-text-secondary hover:text-text transition-colors"
          >
            Reset to Google name
          </button>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-accent text-white rounded-lg py-2.5 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </form>

      <PushSettings uid={user.uid} />
    </div>
  )
}

// iOS only delivers web push to an installed PWA, and read once at module
// load so rendering stays pure.
const IS_STANDALONE =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true))
const IS_IOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)

type PushState = 'checking' | 'unsupported' | 'off' | 'on' | 'denied' | 'busy'

type PushTestState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'done'; devices: number; pruned: number; thisDevice: boolean }
  | { phase: 'timeout' }

const switchClasses = (on: boolean) =>
  `relative h-5 w-9 shrink-0 rounded-full transition-colors ${
    on ? 'bg-accent' : 'bg-muted ring-1 ring-line'
  }`
const knobClasses = (on: boolean) =>
  `absolute top-0.5 h-4 w-4 rounded-full bg-card shadow transition-[left] ${
    on ? 'left-[18px]' : 'left-0.5'
  }`

/**
 * Push notifications: a per-device on/off, then per-kind and per-trip mutes
 * that apply to every device. Absent prefs mean ON, so the switches read
 * `?? true`.
 */
function PushSettings({ uid }: { uid: string }) {
  const [state, setState] = useState<PushState>(() => (pushConfigured() ? 'checking' : 'unsupported'))
  const [prefs, setPrefs] = useState<PushPrefs | null>(null)
  const [muted, setMuted] = useState<Record<string, boolean> | null>(null)
  const [test, setTest] = useState<PushTestState>({ phase: 'idle' })
  const { trips } = useTrips()
  const testCleanup = useRef<(() => void) | null>(null)
  const section = useRef<HTMLElement>(null)

  // Stop watching the pushTest doc if the page unmounts mid-test.
  useEffect(() => () => testCleanup.current?.(), [])

  // Arrived from the avatar menu's Notifications row, which lands on
  // /profile#push. This section sits below the profile form, so without the
  // scroll you'd get the top of a page about display names. A frame's delay
  // lets the lazily-loaded page finish laying out first; the highlight
  // explains why the page moved.
  const { hash } = useLocation()
  const [flag, setFlag] = useState(false)
  useEffect(() => {
    if (hash !== '#push') return
    const frame = requestAnimationFrame(() => {
      section.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlag(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [hash])

  useEffect(() => {
    if (!pushConfigured()) return
    let live = true
    pushSupported().then((ok) => {
      if (!live) return
      if (!ok) return setState('unsupported')
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied')
        return setState('denied')
      setState(pushEnabled(uid) ? 'on' : 'off')
    })
    getPushPrefs(uid).then((p) => live && setPrefs(p))
    getMutedTrips(uid).then((m) => live && setMuted(m))
    return () => {
      live = false
    }
  }, [uid])

  async function toggle() {
    if (state === 'on') {
      setState('busy')
      await disablePush(uid)
      setState('off')
    } else if (state === 'off') {
      setState('busy')
      try {
        const result = await enablePush(uid)
        setState(result === 'enabled' ? 'on' : result === 'denied' ? 'denied' : 'unsupported')
      } catch (err) {
        console.error('enablePush failed:', err)
        setState('off')
      }
    }
  }

  function togglePref(kind: (typeof PUSH_KINDS)[number]['id']) {
    const next = !(prefs?.[kind] ?? true)
    setPrefs((p) => ({ ...(p ?? {}), [kind]: next }))
    setPushPref(uid, kind, next).catch((err) => console.error('setPushPref failed:', err))
  }

  function toggleTripMute(tripId: string) {
    const nextMuted = !muted?.[tripId]
    setMuted((m) => ({ ...(m ?? {}), [tripId]: nextMuted }))
    setTripMuted(uid, tripId, nextMuted).catch((err) => console.error('setTripMuted failed:', err))
  }

  /** End-to-end check: a real push, answered by the server with a device
   *  count — turns "notifications don't work" into a ten-second test. */
  async function sendTest() {
    if (test.phase === 'sending') return
    setTest({ phase: 'sending' })
    testCleanup.current?.()
    try {
      await requestPushTest(uid)
    } catch (err) {
      console.error('requestPushTest failed:', err)
      setTest({ phase: 'idle' })
      return
    }
    const timer = window.setTimeout(() => {
      testCleanup.current?.()
      setTest({ phase: 'timeout' })
    }, 20000)
    const unsub = onSnapshot(doc(db, 'users', uid, 'private', 'pushTest'), (snap) => {
      const d = snap.data()
      if (!d?.sentAt) return
      testCleanup.current?.()
      const devices = d.devices ?? 0
      const pruned = d.pruned ?? 0
      // The count alone can't tell you whether YOUR machine was in it, which
      // is the only thing you actually want to know when nothing shows up.
      isThisDeviceRegistered(uid).then((thisDevice) =>
        setTest({ phase: 'done', devices, pruned, thisDevice })
      )
    })
    testCleanup.current = () => {
      window.clearTimeout(timer)
      unsub()
      testCleanup.current = null
    }
  }

  return (
    <section
      id="push"
      ref={section}
      className={`mt-8 border-t border-line pt-6 scroll-mt-4 ${flag ? 'animate-highlight' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium text-text">🔔 Push notifications</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {state === 'unsupported' &&
              (pushConfigured()
                ? 'Not supported in this browser.'
                : 'Not set up for this environment yet.')}
            {state === 'denied' &&
              'Blocked — allow notifications for this site in your browser settings.'}
            {state === 'on' && 'This device gets pinged about your trips and groups.'}
            {(state === 'off' || state === 'busy' || state === 'checking') &&
              'Get pinged when an expense is added or someone settles up with you.'}
          </p>
          {IS_IOS && !IS_STANDALONE && state !== 'on' && (
            <p className="mt-1 text-xs text-text-muted">
              On iPhone this only works from the installed app — open the Share menu and
              choose “Add to Home Screen” first.
            </p>
          )}
        </div>
        <button
          onClick={toggle}
          disabled={state === 'checking' || state === 'busy' || state === 'unsupported' || state === 'denied'}
          aria-pressed={state === 'on'}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            state === 'on'
              ? 'bg-accent text-white hover:bg-accent-hover'
              : 'border border-line bg-card text-text-secondary hover:bg-card-hover'
          }`}
        >
          {state === 'busy' || state === 'checking' ? '…' : state === 'on' ? 'On' : 'Enable'}
        </button>
      </div>

      {/* Per-kind, across all your devices */}
      {state === 'on' && prefs !== null && (
        <ul className="mt-4 space-y-2">
          {PUSH_KINDS.map((k) => {
            const on = prefs[k.id] ?? true
            return (
              <li key={k.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-text">{k.label}</div>
                  <div className="text-xs text-text-muted">{k.hint}</div>
                </div>
                <button
                  onClick={() => togglePref(k.id)}
                  role="switch"
                  aria-checked={on}
                  aria-label={`${k.label} notifications`}
                  className={switchClasses(on)}
                >
                  <span className={knobClasses(on)} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Per-trip mutes. With one trip the toggle above IS the mute, so this
          only earns its space once there's a choice to make. */}
      {state === 'on' && muted !== null && trips.length > 1 && (
        <div className="mt-4 border-t border-line-light pt-4">
          <p className="text-sm text-text">🔕 Per trip</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Silence one you’re done with and keep the rest. Applies to all your devices.
          </p>
          <ul className="mt-2 space-y-2">
            {trips.map((t) => {
              const on = !muted[t.id]
              return (
                <li key={t.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm text-text">{t.name}</span>
                  <button
                    onClick={() => toggleTripMute(t.id)}
                    role="switch"
                    aria-checked={on}
                    aria-label={`Notifications from the ${t.name} ${tripLabel(t.type)}`}
                    className={switchClasses(on)}
                  >
                    <span className={knobClasses(on)} />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {state === 'on' && (
        <div className="mt-4 border-t border-line-light pt-4">
          <button
            onClick={sendTest}
            disabled={test.phase === 'sending'}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-card-hover disabled:opacity-50 transition-colors"
          >
            {test.phase === 'sending' ? 'Sending…' : '📨 Send test notification'}
          </button>
          {test.phase === 'done' && (
            <p className="mt-2 text-xs text-text-secondary">
              {test.devices < 1
                ? '⚠️ No device received it — turn notifications off and back on above to re-register this one.'
                : test.thisDevice
                  ? `✅ Sent to ${test.devices} device${test.devices === 1 ? '' : 's'}, including this one.${
                      test.devices > 1 ? ` (The other ${test.devices - 1} are your other devices.)` : ''
                    } Nothing appeared? This device accepted it, so the block is downstream — check that your browser is allowed to show notifications in your computer’s own settings, and that Do Not Disturb is off.`
                  : `⚠️ Sent to ${test.devices} device${test.devices === 1 ? '' : 's'}, but NOT this one — it isn’t registered. Turn notifications off and back on above to re-register it.`}
              {test.pruned >= 1 &&
                ` Cleaned up ${test.pruned} dead registration${test.pruned === 1 ? '' : 's'}.`}
            </p>
          )}
          {test.phase === 'timeout' && (
            <p className="mt-2 text-xs text-text-muted">
              ⏳ No answer from the server — give it a minute and try again.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
