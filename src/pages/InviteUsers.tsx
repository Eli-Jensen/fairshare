import { useState } from 'react'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'

export function InviteUsers() {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [invited, setInvited] = useState<string[]>([])
  const [error, setError] = useState('')

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const normalized = email.trim().toLowerCase()
    if (!normalized || !normalized.includes('@')) {
      setError('Enter a valid email address')
      return
    }

    if (!user) return
    setSubmitting(true)

    try {
      await setDoc(doc(db, 'allowedUsers', normalized), {
        invitedBy: user.uid,
        invitedAt: serverTimestamp(),
      })
      setInvited((prev) => [...prev, normalized])
      setEmail('')
    } catch {
      setError('Failed to invite user')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Invite People</h1>
      <p className="text-sm text-slate-500 mb-6">
        Add someone's Google email so they can sign in and use the app.
      </p>

      <form onSubmit={handleInvite} className="flex gap-2 mb-6">
        <input
          type="email"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          placeholder="friend@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button
          type="submit"
          disabled={submitting}
          className="bg-primary-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors shrink-0"
        >
          {submitting ? '...' : 'Invite'}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {invited.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-500 mb-2">
            Just invited
          </h3>
          <div className="space-y-1">
            {invited.map((e) => (
              <div
                key={e}
                className="text-sm text-slate-700 bg-emerald-50 rounded-lg px-3 py-2"
              >
                {e}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
