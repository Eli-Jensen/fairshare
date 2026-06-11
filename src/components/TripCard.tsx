import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { Trip, UserProfile } from '../lib/types'
import { formatMoney, DEFAULT_CURRENCY } from '../lib/types'
import { placeholderProfiles } from '../lib/placeholders'
import { MemberAvatar } from './MemberAvatar'
import { useProfileCache } from '../hooks/useProfileCache'

export function TripCard({ trip, currentUserUid, onBalanceComputed }: {
  trip: Trip
  currentUserUid?: string
  onBalanceComputed?: (tripId: string, balance: number) => void
}) {
  const { getProfiles } = useProfileCache()
  const [members, setMembers] = useState<Record<string, UserProfile>>({})

  const dateStr = trip.createdAt?.toDate
    ? trip.createdAt.toDate().toLocaleDateString()
    : ''

  const sc = trip.settlementCurrency ?? DEFAULT_CURRENCY
  const totalSpent = trip.cachedTotalSpent ?? 0
  const expenseCount = trip.cachedExpenseCount ?? 0
  const latestDesc = trip.cachedLatestDesc
  const latestAmount = trip.cachedLatestAmount

  useEffect(() => {
    getProfiles(trip.memberUids).then(setMembers)
  }, [trip.memberUids.join(','), getProfiles])

  // Report cached balance to parent for cross-trip summary
  useEffect(() => {
    if (currentUserUid && onBalanceComputed && trip.cachedBalances) {
      onBalanceComputed(trip.id, trip.cachedBalances[currentUserUid] ?? 0)
    }
  }, [trip.cachedBalances, currentUserUid, onBalanceComputed, trip.id])

  return (
    <Link
      to={`/trip/${trip.id}`}
      className="block bg-card rounded-xl border border-line p-4 hover:border-accent hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-text truncate min-w-0">{trip.name}</h3>
        <span className="text-sm text-text-muted shrink-0">{dateStr}</span>
      </div>

      {/* Total and expense count */}
      <div className="flex items-baseline justify-between mt-2 mb-1.5">
        <span className="text-lg font-semibold text-text">
          {formatMoney(totalSpent, sc)}
        </span>
        <span className="text-sm text-text-muted">
          {expenseCount} expense{expenseCount !== 1 && 's'}
        </span>
      </div>

      {/* Latest expense */}
      {latestDesc && latestAmount != null && (
        <div className="flex items-center justify-between text-sm bg-accent-soft border border-accent/20 rounded-md px-2.5 py-1.5 mb-2">
          <span className="truncate text-text">
            Latest: {latestDesc}
          </span>
          <span className="shrink-0 ml-2 font-semibold text-accent-text">
            {formatMoney(latestAmount, sc)}
          </span>
        </div>
      )}

      {/* Members (incl. guests without accounts) */}
      {(() => {
        const guests = placeholderProfiles(trip)
        const guestIds = Object.keys(guests)
        const total = trip.memberUids.length + guestIds.length
        return (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5">
              {trip.memberUids.map((uid) => (
                <div key={uid} className="ring-2 ring-card rounded-full">
                  <MemberAvatar member={members[uid]} size="sm" />
                </div>
              ))}
              {guestIds.map((id) => (
                <div key={id} className="ring-2 ring-card rounded-full">
                  <MemberAvatar member={guests[id]} size="sm" />
                </div>
              ))}
            </div>
            <span className="text-sm text-text-muted">
              {guestIds.length > 0
                ? `${total} ${total === 1 ? 'person' : 'people'}`
                : `${total} member${total !== 1 ? 's' : ''}`}
            </span>
          </div>
        )
      })()}
    </Link>
  )
}
