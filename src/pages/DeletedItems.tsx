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

  useEffect(() => {
    if (!user) return

    const q = query(
      collection(db, 'trips'),
      where('memberUids', 'array-contains', user.uid),
      orderBy('createdAt', 'desc')
    )

    let unsubExpenses: (() => void)[] = []
    const expensesByTrip = new Map<string, DeletedExpense[]>()

    let hasServerData = false

    const unsubTrips = onSnapshot(q, (snap) => {
      const deleted: DeletedTrip[] = []
      for (const d of snap.docs) {
        const data = d.data()
        if (data.deletedAt) {
          deleted.push({ id: d.id, ...data } as DeletedTrip)
        }
      }

      if (!snap.metadata.fromCache) hasServerData = true

      // Don't let a stale cache snapshot clear data we already have from the server
      if (deleted.length > 0 || !snap.metadata.fromCache || !hasServerData) {
        setDeletedTrips(deleted)
      }
      setLoading(false)

      // Rebuild expense listeners for active (non-deleted) trips
      unsubExpenses.forEach((u) => u())
      unsubExpenses = []

      const activeTripIds = new Set<string>()
      for (const tripDoc of snap.docs) {
        if (tripDoc.data().deletedAt) continue
        activeTripIds.add(tripDoc.id)

        const expQ = query(
          collection(db, 'trips', tripDoc.id, 'expenses'),
          orderBy('createdAt', 'desc')
        )

        const unsub = onSnapshot(expQ, (expSnap) => {
          const tripDeleted = expSnap.docs
            .filter((d) => d.data().deletedAt)
            .map((d) => ({
              id: d.id,
              tripId: tripDoc.id,
              tripName: tripDoc.data().name,
              ...d.data(),
            }) as DeletedExpense)
          expensesByTrip.set(tripDoc.id, tripDeleted)

          const all = Array.from(expensesByTrip.values()).flat()
          setDeletedExpenses(all)
        })

        unsubExpenses.push(unsub)
      }

      // Remove stale entries for trips no longer active
      for (const id of expensesByTrip.keys()) {
        if (!activeTripIds.has(id)) expensesByTrip.delete(id)
      }
    })

    return () => {
      unsubTrips()
      unsubExpenses.forEach((u) => u())
    }
  }, [user?.uid])

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
          {(() => {
            const trips = deletedTrips.filter((t) => (t.type ?? 'trip') === 'trip')
            const groups = deletedTrips.filter((t) => t.type === 'group')
            return (
              <>
                {trips.length > 0 && (
                  <DeletedSection
                    label={`Deleted Trips (${trips.length})`}
                    items={trips}
                    restoring={restoring}
                    onRestore={restoreTrip}
                    timeRemaining={timeRemaining}
                  />
                )}
                {groups.length > 0 && (
                  <DeletedSection
                    label={`Deleted Groups (${groups.length})`}
                    items={groups}
                    restoring={restoring}
                    onRestore={restoreTrip}
                    timeRemaining={timeRemaining}
                  />
                )}
              </>
            )
          })()}

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

function DeletedSection({
  label,
  items,
  restoring,
  onRestore,
  timeRemaining,
}: {
  label: string
  items: DeletedTrip[]
  restoring: string | null
  onRestore: (id: string) => void
  timeRemaining: (d: import('firebase/firestore').Timestamp) => string
}) {
  return (
    <div className="mb-8">
      <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wide mb-3">
        {label}
      </h2>
      <div className="space-y-2">
        {items.map((trip) => (
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
              onClick={() => onRestore(trip.id)}
              disabled={restoring === trip.id}
              className="text-sm font-medium text-accent-text hover:text-accent-hover px-3 py-1.5 rounded-lg hover:bg-accent-soft transition-colors disabled:opacity-50"
            >
              {restoring === trip.id ? 'Restoring...' : 'Restore'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
