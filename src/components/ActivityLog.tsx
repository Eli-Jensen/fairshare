import { useState } from 'react'
import type { ActivityLogEntry, UserProfile, TripType } from '../lib/types'
import { formatMoney, getMemberName, tripLabel, DEFAULT_CURRENCY } from '../lib/types'
import { getUndoAction, executeUndo } from '../lib/activityUndo'
import type { UndoAction } from '../lib/activityUndo'
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
  const sc = settlementCurrency ?? DEFAULT_CURRENCY
  const amt = entry.targetAmount ? formatMoney(entry.targetAmount, sc) : ''

  switch (entry.action) {
    case 'expense_added':
      return `${actor} added ${desc} (${amt})`
    case 'expense_edited':
      return `${actor} edited ${desc} (${amt})`
    case 'expense_deleted':
      return `${actor} deleted ${desc} (${amt})`
    case 'settlement_recorded': {
      const payee = entry.targetPayeeUid
        ? getMemberName(entry.targetPayeeUid, members)
        : desc.split(' → ')[1] ?? ''
      const method = entry.paymentMethod ? ` via ${entry.paymentMethod}` : ''
      return `${actor} paid ${payee} ${amt}${method}`
    }
    case 'member_joined':
      return `${actor} joined the ${tl}`
    case 'member_left':
      return `${actor} left the ${tl}`
    case 'member_removed': {
      const removed = entry.targetMemberUid
        ? getMemberName(entry.targetMemberUid, members)
        : entry.targetDescription ?? 'someone'
      return `${actor} removed ${removed} from the ${tl}`
    }
    case 'trip_created':
      return `${actor} created the ${tl}`
    case 'trip_renamed':
      return `${actor} renamed the ${tl} to "${desc}"`
    case 'trip_deleted':
      return `${actor} deleted the ${tl}`
    case 'trip_restored':
      return `${actor} restored the ${tl}`
    case 'currency_changed':
      return `${actor} changed settlement currency (${desc})`
    case 'member_invited':
      return `${actor} invited ${desc}`
    case 'invite_rescinded':
      return `${actor} rescinded the invite for ${desc}`
    case 'expense_restored':
      return `${actor} restored ${desc}${amt ? ` (${amt})` : ''}`
    case 'comment_added':
      return `${actor} commented on ${desc}`
    default:
      return `${actor} performed an action`
  }
}


export function ActivityLog({
  entries,
  members,
  settlementCurrency,
  tripType,
  tripId,
  currentUserUid,
}: {
  entries: ActivityLogEntry[]
  members: Record<string, UserProfile>
  settlementCurrency?: string
  tripType?: TripType
  tripId?: string
  currentUserUid?: string
}) {
  const [undoneIds, setUndoneIds] = useState<Set<string>>(new Set())
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function handleUndo(entry: ActivityLogEntry, undoAction: UndoAction) {
    const tid = entry.tripId ?? tripId
    if (!tid) return

    setLoadingId(entry.id)
    try {
      await executeUndo(entry, tid, undoAction, currentUserUid)
      setUndoneIds((prev) => new Set(prev).add(entry.id))
    } catch {
      // Silently fail — target may already be changed
    }
    setLoadingId(null)
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 text-text-muted">
        No activity yet
      </div>
    )
  }

  return (
    <div className="space-y-1 max-w-lg mx-auto">
      {entries.map((entry) => {
        const time = entry.createdAt?.toDate?.()
        const undoAction = getUndoAction(entry)
        const isUndone = undoneIds.has(entry.id)
        const isLoading = loadingId === entry.id
        return (
          <div key={entry.id} className={`flex items-start gap-2.5 py-2 group ${isUndone ? 'opacity-50' : ''}`}>
            <MemberAvatar member={members[entry.actorUid]} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm text-text-secondary">
                  {isUndone
                    ? <span className="italic">Undone</span>
                    : describeAction(entry, members, settlementCurrency ?? DEFAULT_CURRENCY, tripType)
                  }
                </p>
                {undoAction && !isUndone && (
                  <button
                    onClick={() => handleUndo(entry, undoAction)}
                    disabled={isLoading}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium text-accent-text hover:bg-accent-soft disabled:opacity-50 transition-colors"
                  >
                    {isLoading ? (
                      <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
                        </svg>
                        {undoAction === 'restore' || undoAction === 'restore-trip' ? 'Restore' : 'Undo'}
                      </>
                    )}
                  </button>
                )}
              </div>
              {!isUndone && entry.editDetails && entry.editDetails.length > 0 && (
                <div className="mt-0.5 space-y-0.5">
                  {entry.editDetails.map((detail, j) => (
                    <p key={j} className="text-sm text-text-muted">
                      {detail}
                    </p>
                  ))}
                </div>
              )}
              {time && (
                <p className="text-sm text-text-muted mt-0.5">{relativeTime(time)}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
