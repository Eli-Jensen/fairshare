import { useState, useEffect } from 'react'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import type { UserProfile } from '../lib/types'

export function Profile() {
  const { user } = useAuth()
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
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Display Name
          </label>
          <input
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
    </div>
  )
}
