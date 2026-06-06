import { useState, useEffect, useRef } from 'react'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { ImageCropper } from '../components/ImageCropper'
import type { UserProfile } from '../lib/types'

export function Profile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [photoURL, setPhotoURL] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [cropperSrc, setCropperSrc] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type and size
    if (!file.type.startsWith('image/')) return
    if (file.size > 10 * 1024 * 1024) return // 10MB max

    const reader = new FileReader()
    reader.onload = () => {
      setCropperSrc(reader.result as string)
    }
    reader.readAsDataURL(file)

    // Reset input so the same file can be re-selected
    e.target.value = ''
  }

  function handleCropComplete(croppedDataUrl: string) {
    setPhotoURL(croppedDataUrl)
    setCropperSrc(null)
  }

  const inputClasses = 'w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500'

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-6">Edit Profile</h1>

      {/* Current avatar preview */}
      <div className="flex items-center gap-4 mb-6 p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="relative w-16 h-16 rounded-full overflow-hidden shrink-0 bg-slate-100 dark:bg-slate-700 group"
        >
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
            <div className="w-full h-full bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 flex items-center justify-center text-2xl font-medium">
              {displayName?.charAt(0)?.toUpperCase() || '?'}
            </div>
          )}
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
            <svg className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
        </button>
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">{displayName || 'No name set'}</p>
          <p className="text-sm text-slate-400">{profile.email}</p>
          {(hasCustomName || hasCustomPhoto) && (
            <p className="text-xs text-slate-400 mt-0.5">
              Google name: {googleName}
            </p>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Display Name
          </label>
          <input
            type="text"
            className={inputClasses}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={googleName}
          />
          <p className="text-xs text-slate-400 mt-1">
            This is how other trip members will see you.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Profile Photo
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Upload photo
            </button>
            {photoURL && photoURL !== googlePhoto && (
              <button
                type="button"
                onClick={() => setPhotoURL(googlePhoto ?? '')}
                className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-3 py-2 transition-colors"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Upload a photo and crop it to fit. Click your avatar above to upload.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Or paste a photo URL
          </label>
          <input
            type="url"
            className={inputClasses}
            value={photoURL.startsWith('data:') ? '' : photoURL}
            onChange={(e) => setPhotoURL(e.target.value)}
            placeholder="https://..."
          />
        </div>

        {(hasCustomName || hasCustomPhoto) && (
          <button
            type="button"
            onClick={resetToGoogle}
            className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
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

      {/* Image cropper modal */}
      {cropperSrc && (
        <ImageCropper
          imageSrc={cropperSrc}
          onCropComplete={handleCropComplete}
          onCancel={() => setCropperSrc(null)}
        />
      )}
    </div>
  )
}
