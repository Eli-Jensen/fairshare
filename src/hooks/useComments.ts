import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Comment } from '../lib/types'

/** Live thread for one expense. Small collections; asc = chat order. */
export function useComments(tripId: string | undefined, expenseId: string | undefined) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tripId || !expenseId) return
    const q = query(
      collection(db, 'trips', tripId, 'expenses', expenseId, 'comments'),
      orderBy('createdAt', 'asc')
    )
    return onSnapshot(
      q,
      (snap) => {
        setComments(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Comment))
        setLoading(false)
      },
      (err) => {
        console.error('useComments listener error:', err)
        setLoading(false)
      }
    )
  }, [tripId, expenseId])

  return { comments, loading }
}
