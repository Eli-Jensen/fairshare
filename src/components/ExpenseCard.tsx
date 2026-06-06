import type { Expense, UserProfile } from '../lib/types'
import { formatUSD, getMemberName } from '../lib/types'
import { MemberAvatar } from './MemberAvatar'

export function ExpenseCard({
  expense,
  members,
  onEdit,
}: {
  expense: Expense
  members: Record<string, UserProfile>
  onEdit?: () => void
}) {
  const payer = members[expense.paidBy]
  const dateStr = expense.date?.toDate
    ? expense.date.toDate().toLocaleDateString()
    : ''

  return (
    <div
      onClick={onEdit}
      className={`bg-white rounded-lg border border-slate-200 p-3 ${
        onEdit ? 'cursor-pointer hover:border-primary-300 hover:shadow-sm transition-all' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <MemberAvatar member={payer} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-slate-900 truncate">
              {expense.description}
            </p>
            <p className="font-semibold text-slate-900 shrink-0">
              {formatUSD(expense.amountUSD)}
            </p>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <p className="text-sm text-slate-500">
              {getMemberName(expense.paidBy, members)} paid
              {expense.currency !== 'USD' && (
                <span className="ml-1 text-xs text-slate-400">
                  ({expense.amount} {expense.currency})
                </span>
              )}
            </p>
            <p className="text-xs text-slate-400">{dateStr}</p>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Split: {Object.keys(expense.splits).length} people ({expense.splitType})
          </p>
        </div>
      </div>
    </div>
  )
}
