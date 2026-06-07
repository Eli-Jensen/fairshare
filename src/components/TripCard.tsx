import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Trip, UserProfile, Expense } from '../lib/types'
import { formatMoney } from '../lib/types'
import { MemberAvatar } from './MemberAvatar'

export function TripCard({ trip }: { trip: Trip }) {
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
      orderBy('createdAt', 'desc')
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

  return (
    <Link
      to={`/trip/${trip.id}`}
      className="block bg-card rounded-xl border border-line p-4 hover:border-accent hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-text truncate">{trip.name}</h3>
        <span className="text-xs text-text-muted shrink-0">{dateStr}</span>
      </div>

      {/* Total and expense count */}
      <div className="flex items-baseline justify-between mt-2 mb-1.5">
        <span className="text-lg font-semibold text-text">
          {formatMoney(totalUSD, trip.settlementCurrency ?? 'USD')}
        </span>
        <span className="text-xs text-text-muted">
          {expenseCount} expense{expenseCount !== 1 && 's'}
        </span>
      </div>

      {/* Latest expense */}
      {latestExpense && (
        <div className="flex items-center justify-between text-xs text-text-secondary bg-muted/50 rounded-md px-2.5 py-1.5 mb-2">
          <span className="truncate">
            Latest: {latestExpense.description}
          </span>
          <span className="shrink-0 ml-2 font-medium">
            {formatMoney(latestExpense.amountUSD, trip.settlementCurrency ?? 'USD')}
          </span>
        </div>
      )}

      {/* Members */}
      <div className="flex items-center gap-2">
        <div className="flex -space-x-1.5">
          {trip.memberUids.map((uid) => (
            <div key={uid} className="ring-2 ring-card rounded-full">
              <MemberAvatar member={members[uid]} size="sm" />
            </div>
          ))}
        </div>
        <span className="text-xs text-text-muted">
          {trip.memberUids.length} member{trip.memberUids.length !== 1 && 's'}
        </span>
      </div>
    </Link>
  )
}
