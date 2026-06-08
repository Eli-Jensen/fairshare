import { useEffect, useState } from 'react'
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  updateDoc,
  deleteField,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { formatMoney } from '../lib/types'
import type { Trip, Expense } from '../lib/types'

interface DeletedTrip extends Trip {
  deletedAt: import('firebase/firestore').Timestamp
}

interface DeletedExpense extends Expense {
  tripId: string
  tripName: string
}

export function DeletedItems() {
  const { user } = useAuth()
  const [deletedTrips, setDeletedTrips] = useState<DeletedTrip[]>([])
  const [deletedExpenses, setDeletedExpenses] = useState<DeletedExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)

  // Listen for soft-deleted trips
  useEffect(() => {
    if (!user) return

    const q = query(
      collection(db, 'trips'),
      where('memberUids', 'array-contains', user.uid),
      orderBy('createdAt', 'desc')
    )

    return onSnapshot(q, (snap) => {
      const deleted: DeletedTrip[] = []
      for (const d of snap.docs) {
        const data = d.data()
        if (data.deletedAt) {
          deleted.push({ id: d.id, ...data } as DeletedTrip)
        }
      }
      setDeletedTrips(deleted)
      setLoading(false)
    })
  }, [user])

  // Scan active trips for soft-deleted expenses
  useEffect(() => {
    if (!user) return

    const q = query(
      collection(db, 'trips'),
      where('memberUids', 'array-contains', user.uid)
    )

    let unsubExpenses: (() => void)[] = []

    const unsubTrips = onSnapshot(q, (tripSnap) => {
      // Clean up previous expense listeners
      unsubExpenses.forEach((u) => u())
      unsubExpenses = []

      const allDeleted: DeletedExpense[] = []
      let pending = tripSnap.docs.length

      if (pending === 0) {
        setDeletedExpenses([])
        return
      }

      for (const tripDoc of tripSnap.docs) {
        const tripData = tripDoc.data()
        if (tripData.deletedAt) {
          pending--
          if (pending === 0) setDeletedExpenses(allDeleted)
          continue
        }

        const expQ = query(
          collection(db, 'trips', tripDoc.id, 'expenses'),
          orderBy('createdAt', 'desc')
        )

        const unsub = onSnapshot(expQ, (expSnap) => {
          // Remove old entries for this trip
          const others = allDeleted.filter((e) => e.tripId !== tripDoc.id)
          const newDeleted = expSnap.docs
            .filter((d) => d.data().deletedAt)
            .map(
              (d) =>
                ({
                  id: d.id,
                  tripId: tripDoc.id,
                  tripName: tripData.name,
                  ...d.data(),
                }) as DeletedExpense
            )
          allDeleted.length = 0
          allDeleted.push(...others, ...newDeleted)
          setDeletedExpenses([...allDeleted])
        })

        unsubExpenses.push(unsub)
        pending--
        if (pending === 0 && allDeleted.length > 0) {
          setDeletedExpenses([...allDeleted])
        }
      }
    })

    return () => {
      unsubTrips()
      unsubExpenses.forEach((u) => u())
    }
  }, [user])

  async function restoreTrip(tripId: string) {
    setRestoring(tripId)
    await updateDoc(doc(db, 'trips', tripId), {
      deletedAt: deleteField(),
    })
    setRestoring(null)
  }

  async function restoreExpense(tripId: string, expenseId: string) {
    setRestoring(expenseId)
    await updateDoc(doc(db, 'trips', tripId, 'expenses', expenseId), {
      deletedAt: deleteField(),
    })
    setRestoring(null)
  }

  function timeRemaining(deletedAt: import('firebase/firestore').Timestamp): string {
    if (!deletedAt?.toDate) return ''
    const msLeft = deletedAt.toDate().getTime() + 24 * 60 * 60 * 1000 - Date.now()
    if (msLeft <= 0) return 'Expiring soon'
    const hours = Math.floor(msLeft / (60 * 60 * 1000))
    const mins = Math.floor((msLeft % (60 * 60 * 1000)) / (60 * 1000))
    if (hours > 0) return `${hours}h ${mins}m left`
    return `${mins}m left`
  }

  if (loading) {
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  const isEmpty = deletedTrips.length === 0 && deletedExpenses.length === 0

  return (
    <div>
      <h1 className="text-2xl font-bold text-text mb-2">Trash</h1>
      <p className="text-sm text-text-secondary mb-6">
        Removed after 24 hours
      </p>

      {isEmpty ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <p className="text-text-secondary">Nothing in the trash</p>
        </div>
      ) : (
        <>
          {deletedTrips.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                Deleted Trips ({deletedTrips.length})
              </h2>
              <div className="space-y-2">
                {deletedTrips.map((trip) => (
                  <div
                    key={trip.id}
                    className="flex items-center justify-between bg-card border border-line rounded-lg px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-text-secondary line-through">
                        {trip.name}
                      </p>
                      <p className="text-xs text-text-muted">
                        {trip.memberUids.length} members
                        {trip.deletedAt && ` · ${timeRemaining(trip.deletedAt)}`}
                      </p>
                    </div>
                    <button
                      onClick={() => restoreTrip(trip.id)}
                      disabled={restoring === trip.id}
                      className="text-sm font-medium text-accent-text hover:text-accent-hover px-3 py-1.5 rounded-lg hover:bg-accent-soft transition-colors disabled:opacity-50"
                    >
                      {restoring === trip.id ? 'Restoring...' : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {deletedExpenses.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
                Deleted Expenses ({deletedExpenses.length})
              </h2>
              <div className="space-y-2">
                {deletedExpenses.map((exp) => (
                  <div
                    key={exp.id}
                    className="flex items-center justify-between bg-card border border-line rounded-lg px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-text-secondary line-through">
                        {exp.description}
                      </p>
                      <p className="text-xs text-text-muted">
                        {formatMoney(exp.amountUSD)} in {exp.tripName}
                        {exp.deletedAt && ` · ${timeRemaining(exp.deletedAt)}`}
                      </p>
                    </div>
                    <button
                      onClick={() => restoreExpense(exp.tripId, exp.id)}
                      disabled={restoring === exp.id}
                      className="text-sm font-medium text-accent-text hover:text-accent-hover px-3 py-1.5 rounded-lg hover:bg-accent-soft transition-colors disabled:opacity-50"
                    >
                      {restoring === exp.id ? 'Restoring...' : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
