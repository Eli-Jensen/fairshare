import type { ActivityLogEntry, UserProfile, TripType } from '../lib/types'
import { formatMoney, getMemberName, tripLabel } from '../lib/types'
import { MemberAvatar } from './MemberAvatar'

function relativeTime(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

function describeAction(entry: ActivityLogEntry, members: Record<string, UserProfile>, settlementCurrency: string, type?: TripType): string {
  const tl = tripLabel(type)
  const actor = getMemberName(entry.actorUid, members)
  const desc = entry.targetDescription ?? ''
  const amt = entry.targetAmount ? ` (${formatMoney(entry.targetAmount, settlementCurrency ?? 'USD')})` : ''

  switch (entry.action) {
    case 'expense_added':
      return `${actor} added ${desc}${amt}`
    case 'expense_edited':
      return `${actor} edited ${desc}${amt}`
    case 'expense_deleted':
      return `${actor} deleted ${desc}${amt}`
    case 'settlement_recorded':
      return `${actor} recorded a payment${amt}`
    case 'member_joined':
      return `${actor} joined the ${tl}`
    case 'member_left':
      return `${actor} left the ${tl}`
    case 'member_removed':
      return `${actor} was removed from the ${tl}`
    case 'trip_created':
      return `${actor} created the ${tl}`
    default:
      return `${actor} performed an action`
  }
}

export function ActivityLog({
  entries,
  members,
  settlementCurrency,
  tripType,
}: {
  entries: ActivityLogEntry[]
  members: Record<string, UserProfile>
  settlementCurrency?: string
  tripType?: TripType
}) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted">
        No activity yet.
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {entries.map((entry) => {
        const time = entry.createdAt?.toDate?.()
        return (
          <div key={entry.id} className="flex items-start gap-2.5 py-2">
            <MemberAvatar member={members[entry.actorUid]} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-secondary">
                {describeAction(entry, members, settlementCurrency ?? 'USD', tripType)}
              </p>
              {entry.editDetails && entry.editDetails.length > 0 && (
                <div className="mt-0.5 space-y-0.5">
                  {entry.editDetails.map((detail, j) => (
                    <p key={j} className="text-xs text-text-muted">
                      {detail}
                    </p>
                  ))}
                </div>
              )}
              {time && (
                <p className="text-xs text-text-muted mt-0.5">{relativeTime(time)}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
