import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  arrayUnion,
  doc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'

export function JoinTrip() {
  const { inviteCode } = useParams<{ inviteCode: string }>()
  const { user, isAllowed, signIn, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'joining' | 'error' | 'not-allowed'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      setStatus('loading')
      return
    }

    if (isAllowed === false) {
      setStatus('not-allowed')
      return
    }

    if (isAllowed && inviteCode) {
      joinTrip()
    }
  }, [user, isAllowed, authLoading, inviteCode])

  async function joinTrip() {
    if (!user || !inviteCode) return
    setStatus('joining')

    try {
      const q = query(
        collection(db, 'trips'),
        where('inviteCode', '==', inviteCode)
      )
      const snap = await getDocs(q)

      if (snap.empty) {
        setError('Invalid invite link')
        setStatus('error')
        return
      }

      const tripDoc = snap.docs[0]
      const tripData = tripDoc.data()

      if (tripData.memberUids.includes(user.uid)) {
        navigate(`/trip/${tripDoc.id}`, { replace: true })
        return
      }

      await updateDoc(doc(db, 'trips', tripDoc.id), {
        memberUids: arrayUnion(user.uid),
      })

      navigate(`/trip/${tripDoc.id}`, { replace: true })
    } catch {
      setError('Failed to join trip')
      setStatus('error')
    }
  }

  if (authLoading || status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-6">
        <h2 className="text-xl font-semibold text-slate-900">Join Trip</h2>
        {!user ? (
          <>
            <p className="text-slate-500">Sign in to join this trip</p>
            <button
              onClick={signIn}
              className="flex items-center gap-3 bg-white border border-slate-300 rounded-lg px-6 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
            >
              Sign in with Google
            </button>
          </>
        ) : (
          <p className="text-slate-400">Loading...</p>
        )}
      </div>
    )
  }

  if (status === 'not-allowed') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-2xl">
          🔒
        </div>
        <h2 className="text-xl font-semibold text-slate-900">Access Restricted</h2>
        <p className="text-slate-500 max-w-sm">
          You need to be invited to the app before you can join trips. Ask an
          existing member to invite <strong>{user?.email}</strong>.
        </p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center py-20">
      <p className="text-slate-400">Joining trip...</p>
    </div>
  )
}
