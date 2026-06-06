import { useState, useEffect } from 'react'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import type { UserProfile } from '../lib/types'

export function Profile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [photoURL, setPhotoURL] = useState('')
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
        setPhotoURL(data.photoURL ?? '')
      }
      setLoading(false)
    }
    load()
  }, [user])

  if (loading || !profile || !user) {
    return <div className="text-center py-10 text-slate-400">Loading...</div>
  }

  const googleName = profile.googleDisplayName ?? profile.displayName
  const googlePhoto = profile.googlePhotoURL ?? profile.photoURL
  const hasCustomName = displayName !== googleName
  const hasCustomPhoto = photoURL !== (googlePhoto ?? '')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    await updateDoc(doc(db, 'users', user.uid), {
      displayName: displayName.trim() || googleName,
      photoURL: photoURL.trim() || googlePhoto,
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function resetToGoogle() {
    setDisplayName(googleName)
    setPhotoURL(googlePhoto ?? '')
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Edit Profile</h1>

      {/* Current avatar preview */}
      <div className="flex items-center gap-4 mb-6 p-4 bg-white rounded-lg border border-slate-200">
        <div className="w-16 h-16 rounded-full overflow-hidden shrink-0 bg-slate-100">
          {photoURL ? (
            <img
              src={photoURL}
              alt=""
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <div className="w-full h-full bg-primary-100 text-primary-700 flex items-center justify-center text-2xl font-medium">
              {displayName?.charAt(0)?.toUpperCase() || '?'}
            </div>
          )}
        </div>
        <div>
          <p className="font-medium text-slate-900">{displayName || 'No name set'}</p>
          <p className="text-sm text-slate-400">{profile.email}</p>
          {(hasCustomName || hasCustomPhoto) && (
            <p className="text-xs text-slate-400 mt-0.5">
              Google name: {googleName}
            </p>
          )}
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Display Name
          </label>
          <input
            type="text"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={googleName}
          />
          <p className="text-xs text-slate-400 mt-1">
            This is how other trip members will see you.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Photo URL
          </label>
          <input
            type="url"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            value={photoURL}
            onChange={(e) => setPhotoURL(e.target.value)}
            placeholder="https://..."
          />
          <p className="text-xs text-slate-400 mt-1">
            Paste a link to any image. Leave empty to use your initial.
          </p>
        </div>

        {(hasCustomName || hasCustomPhoto) && (
          <button
            type="button"
            onClick={resetToGoogle}
            className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            Reset to Google defaults
          </button>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-primary-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </form>
    </div>
  )
}
