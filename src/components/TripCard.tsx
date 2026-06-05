import { Link } from 'react-router-dom'
import type { Trip } from '../lib/types'

export function TripCard({ trip }: { trip: Trip }) {
  const dateStr = trip.createdAt?.toDate
    ? trip.createdAt.toDate().toLocaleDateString()
    : ''

  return (
    <Link
      to={`/trip/${trip.id}`}
      className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-primary-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">{trip.name}</h3>
        <span className="text-xs text-slate-400">{dateStr}</span>
      </div>
      <p className="text-sm text-slate-500 mt-1">
        {trip.memberUids.length} member{trip.memberUids.length !== 1 && 's'}
      </p>
    </Link>
  )
}
