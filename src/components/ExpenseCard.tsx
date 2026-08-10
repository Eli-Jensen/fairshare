import type { Expense, UserProfile, CustomCategory } from '../lib/types'
import { formatMoney, getMemberName, getCategoryInfo, getExpenseCategories, DEFAULT_CURRENCY } from '../lib/types'
import { formatDateOnly } from '../lib/dates'
import { MemberAvatar } from './MemberAvatar'

export function ExpenseCard({
  expense,
  members,
  onEdit,
  settlementCurrency,
  customCategories,
  pending,
}: {
  expense: Expense
  members: Record<string, UserProfile>
  onEdit?: () => void
  settlementCurrency?: string
  customCategories?: CustomCategory[]
  /** Latest write not yet acked by the server (offline save). */
  pending?: boolean
}) {
  const payer = members[expense.paidBy]
  const sc = settlementCurrency ?? DEFAULT_CURRENCY
  const dateStr = formatDateOnly(expense.date)

  const expenseCategories = getExpenseCategories(expense)
    .map((c) => getCategoryInfo(c, customCategories))
    .filter(Boolean) as { label: string; emoji: string }[]

  const isSettlement = expense.isSettlement

  return (
    // role/tabIndex instead of a <button>: the card nests real buttons
    // (member avatars), and buttons can't contain buttons.
    <div
      onClick={onEdit}
      role={onEdit ? 'button' : undefined}
      tabIndex={onEdit ? 0 : undefined}
      onKeyDown={
        onEdit
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onEdit()
              }
            }
          : undefined
      }
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
                <span className="text-sm font-medium text-accent-text shrink-0">Settlement</span>
              )}
              {expenseCategories.length > 0 && !isSettlement && (
                <span className="text-sm shrink-0" title={expenseCategories.map((c) => c.label).join(', ')}>
                  {expenseCategories.map((c) => c.emoji).join('')}
                </span>
              )}
              <p className="font-medium text-text truncate">
                {expense.description}
              </p>
            </div>
            <p className="font-semibold text-text shrink-0">
              {formatMoney(expense.amountSettled, sc)}
            </p>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <p className="text-sm text-text-secondary">
              {expense.paidByAmounts && Object.keys(expense.paidByAmounts).length > 1
                ? Object.entries(expense.paidByAmounts)
                    .map(([uid, amt]) => `${getMemberName(uid, members)} ${formatMoney(amt, sc)}`)
                    .join(', ')
                : `${getMemberName(expense.paidBy, members)} paid`}
              {expense.currency !== sc && (
                <span className="ml-1 text-sm text-text-muted">
                  ({expense.amount} {expense.currency})
                </span>
              )}
            </p>
            <p className="text-sm text-text-muted">
              {dateStr}
              {(expense.receiptPaths?.length ?? 0) > 0 && (
                <span
                  className="ml-1.5"
                  title={`${expense.receiptPaths!.length} receipt photo${expense.receiptPaths!.length === 1 ? '' : 's'}`}
                  aria-label={`${expense.receiptPaths!.length} receipt photo${expense.receiptPaths!.length === 1 ? '' : 's'}`}
                >
                  📷{expense.receiptPaths!.length > 1 ? expense.receiptPaths!.length : ''}
                </span>
              )}
              {pending && (
                <span
                  className="ml-1.5 text-warn-text"
                  title="Saved on this device — will sync when online"
                  aria-label="Waiting to sync"
                >
                  🕓
                </span>
              )}
            </p>
          </div>
          {!isSettlement && (
            <p className="text-sm text-text-muted mt-0.5">
              {Object.keys(expense.splits).length} {Object.keys(expense.splits).length === 1 ? 'person' : 'people'} · {expense.splitType}
            </p>
          )}
          {expense.notes && (
            <p className="text-sm text-text-muted mt-1 italic truncate">
              {expense.notes}
            </p>
          )}
          {expense.comments && expense.comments.length > 0 && (
            <p className="text-sm text-accent-text mt-0.5">
              {expense.comments.length} comment{expense.comments.length !== 1 && 's'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
