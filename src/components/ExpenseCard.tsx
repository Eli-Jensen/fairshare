import type { Expense, UserProfile } from '../lib/types'
import { formatMoney, getMemberName, getCategoryInfo } from '../lib/types'
import { MemberAvatar } from './MemberAvatar'

export function ExpenseCard({
  expense,
  members,
  onEdit,
  settlementCurrency,
}: {
  expense: Expense
  members: Record<string, UserProfile>
  onEdit?: () => void
  settlementCurrency?: string
}) {
  const payer = members[expense.paidBy]
  const dateStr = expense.date?.toDate
    ? expense.date.toDate().toLocaleDateString()
    : ''

  const categoryInfo = expense.category
    ? getCategoryInfo(expense.category)
    : undefined

  const isSettlement = expense.isSettlement

  return (
    <div
      onClick={onEdit}
      className={`rounded-lg border p-3 ${
        isSettlement
          ? 'bg-accent-soft border-accent/30'
          : 'bg-card border-line'
      } ${onEdit ? 'cursor-pointer hover:border-accent hover:shadow-sm transition-all' : ''}`}
    >
      <div className="flex items-start gap-3">
        {isSettlement ? (
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent-text shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
        ) : (
          <MemberAvatar member={payer} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {isSettlement && (
                <span className="text-xs font-medium text-accent-text shrink-0">Settlement</span>
              )}
              {categoryInfo && !isSettlement && (
                <span className="text-xs shrink-0" title={categoryInfo.label}>{categoryInfo.emoji}</span>
              )}
              <p className="font-medium text-text truncate">
                {expense.description}
              </p>
            </div>
            <p className="font-semibold text-text shrink-0">
              {formatMoney(expense.amountUSD, settlementCurrency ?? 'USD')}
            </p>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <p className="text-sm text-text-secondary">
              {expense.paidByAmounts && Object.keys(expense.paidByAmounts).length > 1
                ? Object.entries(expense.paidByAmounts)
                    .map(([uid, amt]) => `${getMemberName(uid, members)} $${amt.toFixed(2)}`)
                    .join(', ')
                : `${getMemberName(expense.paidBy, members)} paid`}
              {expense.currency !== (settlementCurrency ?? 'USD') && (
                <span className="ml-1 text-xs text-text-muted">
                  ({expense.amount} {expense.currency})
                </span>
              )}
            </p>
            <p className="text-xs text-text-muted">{dateStr}</p>
          </div>
          {!isSettlement && (
            <p className="text-xs text-text-muted mt-0.5">
              {Object.keys(expense.splits).length} people · {expense.splitType}
            </p>
          )}
          {expense.notes && (
            <p className="text-xs text-text-muted mt-1 italic truncate">
              {expense.notes}
            </p>
          )}
          {expense.comments && expense.comments.length > 0 && (
            <p className="text-xs text-accent-text mt-0.5">
              {expense.comments.length} comment{expense.comments.length !== 1 && 's'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
