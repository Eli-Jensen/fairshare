import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
  deleteField,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { purgeTrip } from '../hooks/useTrips'
import { formatMoney, mapExpense } from '../lib/types'
import type { Trip, Expense } from '../lib/types'
import { writeActivity } from '../lib/activity'
import { notifyError } from '../lib/errorToast'
import { deleteReceiptObjects } from '../lib/image'

const DAY_MS = 24 * 60 * 60 * 1000

// Module-level so a remount doesn't re-attempt purges in the same session
const purgedTripIds = new Set<string>()

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

  useEffect(() => {
    if (!user) return

    const q = query(
      collection(db, 'trips'),
      where('memberUids', 'array-contains', user.uid),
      orderBy('createdAt', 'desc')
    )

    let cancelled = false

    const unsubTrips = onSnapshot(q, async (snap) => {
      const now = Date.now()
      const deleted: DeletedTrip[] = []
      const activeTripDocs: { id: string; name: string }[] = []

      for (const d of snap.docs) {
        const data = d.data()
        if (data.deletedAt) {
          const deletedTime = data.deletedAt.toDate?.()
          if (deletedTime && now - deletedTime.getTime() > DAY_MS) {
            // Expired — don't offer a restore for a trip whose expenses
            // may already be purged; finish the purge instead
            if (!purgedTripIds.has(d.id)) {
              purgedTripIds.add(d.id)
              purgeTrip(d.id, data.inviteCode)
            }
          } else {
            deleted.push({ id: d.id, ...data } as DeletedTrip)
          }
        } else {
          activeTripDocs.push({ id: d.id, name: data.name })
        }
      }

      setDeletedTrips(deleted)

      // Fetch only soft-deleted expenses instead of scanning every doc
      const allDeleted: DeletedExpense[] = []
      await Promise.all(activeTripDocs.map(async (trip) => {
        const expSnap = await getDocs(
          query(collection(db, 'trips', trip.id, 'expenses'), where('deletedAt', '!=', null))
        )
        for (const d of expSnap.docs) {
          const data = d.data()
          const deletedTime = data.deletedAt?.toDate?.()
          if (deletedTime && now - deletedTime.getTime() > DAY_MS) {
            // Photos go with the doc (trip doc still exists → rules allow)
            deleteReceiptObjects(data.receiptPaths)
            deleteDoc(d.ref).catch(() => {})
            continue
          }
          allDeleted.push({
            ...mapExpense({ id: d.id, ...data }),
            tripId: trip.id,
            tripName: trip.name,
          } as DeletedExpense)
        }
      }))

      if (!cancelled) {
        setDeletedExpenses(allDeleted)
        setLoading(false)
      }
    }, (err) => {
      console.error('DeletedItems listener error:', err)
      setLoading(false)
    })

    return () => {
      cancelled = true
      unsubTrips()
    }
  }, [user?.uid])

  // Restores are fire-and-forget: awaiting the server ack froze the row in
  // its "restoring" state offline, for a write that's already durable.
  function restoreTrip(tripId: string) {
    const trip = deletedTrips.find((t) => t.id === tripId)
    updateDoc(doc(db, 'trips', tripId), {
      deletedAt: deleteField(),
    }).catch((err) => {
      console.error('restore trip failed:', err)
      notifyError("The restore didn't go through. Check your connection and try again.")
    })
    if (user) {
      writeActivity(tripId, {
        action: 'trip_restored',
        actorUid: user.uid,
        targetDescription: trip?.name,
      })
    }
  }

  function restoreExpense(tripId: string, expenseId: string) {
    const exp = deletedExpenses.find((e) => e.id === expenseId)
    updateDoc(doc(db, 'trips', tripId, 'expenses', expenseId), {
      deletedAt: deleteField(),
    }).catch((err) => {
      console.error('restore expense failed:', err)
      notifyError("The restore didn't go through. Check your connection and try again.")
    })
    if (user) {
      writeActivity(tripId, {
        action: 'expense_restored',
        actorUid: user.uid,
        targetDescription: exp?.description,
        targetAmount: exp?.amountSettled,
        targetExpenseId: expenseId,
      })
    }
  }

  function timeRemaining(deletedAt: import('firebase/firestore').Timestamp): string {
    if (!deletedAt?.toDate) return ''
    // eslint-disable-next-line react-hooks/purity -- countdown label; going stale until the next snapshot re-render is deliberate and harmless
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
                    onRestore={restoreTrip}
                    timeRemaining={timeRemaining}
                  />
                )}
                {groups.length > 0 && (
                  <DeletedSection
                    label={`Deleted Groups (${groups.length})`}
                    items={groups}
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
                      <p className="text-sm text-text-muted">
                        {formatMoney(exp.amountSettled)} in {exp.tripName}
                        {exp.deletedAt && ` · ${timeRemaining(exp.deletedAt)}`}
                      </p>
                    </div>
                    <button
                      onClick={() => restoreExpense(exp.tripId, exp.id)}
                      className="text-sm font-medium text-accent-text hover:text-accent-hover px-3 py-1.5 rounded-lg hover:bg-accent-soft transition-colors"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Trash only holds items for 24h, so this is where someone lands after
          leaving it too late — the Sheets backup is the only way back. */}
      <div className="border-t border-line pt-4 mt-8">
        <p className="text-xs text-text-muted">
          Deleted something more than 24 hours ago?{' '}
          <Link to="/restore" className="text-accent-text hover:text-accent-hover font-medium">
            Restore it from a Google Sheet backup
          </Link>
          .
        </p>
      </div>
    </div>
  )
}

function DeletedSection({
  label,
  items,
  onRestore,
  timeRemaining,
}: {
  label: string
  items: DeletedTrip[]
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
              <p className="text-sm text-text-muted">
                {trip.memberUids.length} member{trip.memberUids.length !== 1 ? 's' : ''}
                {trip.deletedAt && ` · ${timeRemaining(trip.deletedAt)}`}
              </p>
            </div>
            <button
              onClick={() => onRestore(trip.id)}
              className="text-sm font-medium text-accent-text hover:text-accent-hover px-3 py-1.5 rounded-lg hover:bg-accent-soft transition-colors"
            >
              Restore
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
