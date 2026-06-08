import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, updateDoc, serverTimestamp, arrayUnion, Timestamp } from 'firebase/firestore'
import type { CustomCategory } from '../lib/types'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { ExpenseForm } from '../components/ExpenseForm'
import { MemberAvatar } from '../components/MemberAvatar'
import { writeActivity } from '../lib/activity'
import { getMemberName, formatMoney } from '../lib/types'

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime()
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

export function EditExpense() {
  const { id, eid } = useParams<{ id: string; eid: string }>()
  const { user } = useAuth()
  const { trip, expenses, members, loading } = useTrip(id)
  const navigate = useNavigate()
  const [commentText, setCommentText] = useState('')
  const [addingComment, setAddingComment] = useState(false)

  const expense = expenses.find((e) => e.id === eid)

  if (loading || !trip || !user) {
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  if (!expense) {
    return <div className="text-center py-10 text-text-secondary">Expense not found</div>
  }

  async function addComment() {
    if (!commentText.trim() || !user || !id || !eid) return
    setAddingComment(true)
    await updateDoc(doc(db, 'trips', id, 'expenses', eid), {
      comments: arrayUnion({
        uid: user.uid,
        text: commentText.trim(),
        createdAt: Timestamp.now(),
      }),
    })
    setCommentText('')
    setAddingComment(false)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text mb-6">Edit Expense</h1>
      <ExpenseForm
        members={members}
        memberUids={trip.memberUids}
        currentUserUid={user.uid}
        tripRates={trip.lastRates}
        tripLastCurrency={trip.lastCurrency}
        settlementCurrency={trip.settlementCurrency}
        customCategories={trip.customCategories}
        onAddCategory={async (cat: CustomCategory) => {
          await updateDoc(doc(db!, 'trips', id!), {
            customCategories: arrayUnion(cat),
          })
        }}
        existing={expense}
        onSubmit={async (data) => {
          // Run both writes in parallel
          const tripUpdate: Record<string, unknown> = { lastCurrency: data.currency }
          if (data.currency !== (trip.settlementCurrency ?? 'USD')) {
            tripUpdate[`lastRates.${data.currency}`] = data.exchangeRate
          }
          await Promise.all([
            updateDoc(doc(db!, 'trips', id!, 'expenses', eid!), data),
            updateDoc(doc(db!, 'trips', id!), tripUpdate),
          ])

          // Compute what changed for the activity log
          const sc = trip.settlementCurrency ?? 'USD'
          const changes: string[] = []
          if (expense.description !== data.description) {
            changes.push(`description: "${expense.description}" → "${data.description}"`)
          }
          if (Math.abs(expense.amountUSD - data.amountUSD) > 0.01) {
            changes.push(`amount: ${formatMoney(expense.amountUSD, sc)} → ${formatMoney(data.amountUSD, sc)}`)
          }
          if (expense.currency !== data.currency) {
            changes.push(`currency: ${expense.currency} → ${data.currency}`)
          }
          if (expense.paidBy !== data.paidBy) {
            changes.push(`payer: ${getMemberName(expense.paidBy, members)} → ${getMemberName(data.paidBy, members)}`)
          }
          if (expense.splitType !== data.splitType) {
            changes.push(`split: ${expense.splitType} → ${data.splitType}`)
          }

          // Activity log is fire-and-forget
          writeActivity(id!, {
            action: 'expense_edited',
            actorUid: user.uid,
            targetDescription: data.description,
            targetAmount: data.amountUSD,
            editDetails: changes.length > 0 ? changes : undefined,
          })
          navigate(`/trip/${id}`)
        }}
        onDelete={async () => {
          await updateDoc(doc(db!, 'trips', id!, 'expenses', eid!), {
            deletedAt: serverTimestamp(),
          })
          // Fire-and-forget
          writeActivity(id!, {
            action: 'expense_deleted',
            actorUid: user.uid,
            targetDescription: expense.description,
            targetAmount: expense.amountUSD,
          })
          navigate(`/trip/${id}`, {
            state: {
              deletedExpenseId: eid,
              deletedExpenseDesc: expense.description,
            },
          })
        }}
      />

      {/* Comments section */}
      <div className="mt-6 pt-6 border-t border-line">
        <h3 className="text-sm font-medium text-text-secondary mb-3">
          Comments {expense.comments?.length ? `(${expense.comments.length})` : ''}
        </h3>

        {expense.comments && expense.comments.length > 0 && (
          <div className="space-y-3 mb-4">
            {expense.comments.map((c, i) => {
              const time = c.createdAt?.toDate?.()
              return (
                <div key={i} className="flex gap-2">
                  <MemberAvatar member={members[c.uid]} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-text">
                        {getMemberName(c.uid, members)}
                      </span>
                      {time && (
                        <span className="text-xs text-text-muted">{relativeTime(time)}</span>
                      )}
                    </div>
                    <p className="text-sm text-text-secondary mt-0.5">{c.text}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 border border-line rounded-lg px-3 py-2 text-sm bg-input text-text focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="Add a comment..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && commentText.trim()) addComment()
            }}
          />
          <button
            onClick={addComment}
            disabled={!commentText.trim() || addingComment}
            className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors shrink-0"
          >
            {addingComment ? '...' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}
