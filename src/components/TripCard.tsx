import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  doc,
  updateDoc,
  serverTimestamp,
  getDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Trip, UserProfile, Expense } from '../lib/types'
import { formatUSD } from '../lib/types'
import { DeleteModal } from './DeleteModal'
import { MemberAvatar } from './MemberAvatar'

export function TripCard({ trip }: { trip: Trip }) {
  const [editing, setEditing] = useState(false)
  const [nameValue, setNameValue] = useState(trip.name)
  const [showDelete, setShowDelete] = useState(false)
  const [members, setMembers] = useState<Record<string, UserProfile>>({})
  const [totalUSD, setTotalUSD] = useState(0)
  const [latestExpense, setLatestExpense] = useState<Expense | null>(null)
  const [expenseCount, setExpenseCount] = useState(0)

  const dateStr = trip.createdAt?.toDate
    ? trip.createdAt.toDate().toLocaleDateString()
    : ''

  useEffect(() => {
    async function loadMembers() {
      const profiles: Record<string, UserProfile> = {}
      for (const uid of trip.memberUids) {
        const snap = await getDoc(doc(db, 'users', uid))
        if (snap.exists()) profiles[uid] = snap.data() as UserProfile
      }
      setMembers(profiles)
    }
    loadMembers()
  }, [trip.memberUids.join(',')])

  useEffect(() => {
    const q = query(
      collection(db, 'trips', trip.id, 'expenses'),
      orderBy('date', 'desc')
    )
    return onSnapshot(q, (snap) => {
      let total = 0
      let latest: Expense | null = null
      let count = 0

      for (const d of snap.docs) {
        const data = d.data()
        if (data.deletedAt) continue
        total += data.amountUSD ?? 0
        count++
        if (!latest) latest = { id: d.id, ...data } as Expense
      }

      setTotalUSD(total)
      setLatestExpense(latest)
      setExpenseCount(count)
    })
  }, [trip.id])

  async function saveName() {
    const trimmed = nameValue.trim()
    if (!trimmed) {
      setEditing(false)
      setNameValue(trip.name)
      return
    }
    if (trimmed !== trip.name) {
      await updateDoc(doc(db, 'trips', trip.id), { name: trimmed })
    }
    setEditing(false)
  }

  async function deleteTrip() {
    setShowDelete(false)
    await updateDoc(doc(db, 'trips', trip.id), {
      deletedAt: serverTimestamp(),
    })
  }

  return (
    <>
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 hover:border-primary-300 dark:hover:border-primary-600 hover:shadow-sm transition-all">
        <div className="flex items-center justify-between gap-2">
          {editing ? (
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') {
                  setEditing(false)
                  setNameValue(trip.name)
                }
              }}
              onBlur={saveName}
              className="font-semibold text-slate-900 dark:text-slate-100 border-b-2 border-primary-400 outline-none bg-transparent flex-1 min-w-0"
              autoFocus
            />
          ) : (
            <Link to={`/trip/${trip.id}`} className="flex-1 min-w-0">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {trip.name}
              </h3>
            </Link>
          )}

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => {
                e.preventDefault()
                if (editing) {
                  saveName()
                } else {
                  setNameValue(trip.name)
                  setEditing(true)
                }
              }}
              className={`p-1.5 rounded transition-colors ${
                editing
                  ? 'text-primary-600 hover:text-primary-700'
                  : 'text-slate-300 hover:text-slate-500'
              }`}
              title={editing ? 'Save' : 'Edit trip name'}
            >
              {editing ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              )}
            </button>
            {editing && (
              <button
                onClick={(e) => {
                  e.preventDefault()
                  setShowDelete(true)
                }}
                className="p-1.5 rounded text-slate-300 hover:text-red-500 transition-colors"
                title="Delete trip"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <Link to={`/trip/${trip.id}`} className="block mt-2">
          {/* Total and expense count */}
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {formatUSD(totalUSD)}
            </span>
            <span className="text-xs text-slate-400">
              {expenseCount} expense{expenseCount !== 1 && 's'} · {dateStr}
            </span>
          </div>

          {/* Latest expense */}
          {latestExpense && (
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 rounded-md px-2.5 py-1.5 mb-2">
              <span className="truncate">
                Latest: {latestExpense.description}
              </span>
              <span className="shrink-0 ml-2 font-medium">
                {formatUSD(latestExpense.amountUSD)}
              </span>
            </div>
          )}

          {/* Members */}
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5">
              {trip.memberUids.map((uid) => (
                <div key={uid} className="ring-2 ring-white rounded-full">
                  <MemberAvatar member={members[uid]} size="sm" />
                </div>
              ))}
            </div>
            <span className="text-xs text-slate-400">
              {trip.memberUids.length} member{trip.memberUids.length !== 1 && 's'}
            </span>
          </div>
        </Link>
      </div>

      {showDelete && (
        <DeleteModal
          title="Delete this trip for everyone?"
          message={`This will delete "${trip.name}" and all its expenses for every member of this trip, not just you. It will be moved to the trash for 24 hours before being permanently removed.`}
          onCancel={() => setShowDelete(false)}
          onConfirm={deleteTrip}
        />
      )}
    </>
  )
}
