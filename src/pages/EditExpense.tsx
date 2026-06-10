import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc, deleteField, serverTimestamp, arrayUnion, Timestamp } from 'firebase/firestore'
import type { CustomCategory, Expense } from '../lib/types'
import { getExpenseCategories, mapExpense } from '../lib/types'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { ExpenseForm } from '../components/ExpenseForm'
import { MemberAvatar } from '../components/MemberAvatar'
import { writeActivity } from '../lib/activity'
import { getMemberName, formatMoney, DEFAULT_CURRENCY, BALANCE_THRESHOLD } from '../lib/types'

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
  const [fetchedExpense, setFetchedExpense] = useState<Expense | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)

  // The paginated listener only covers the newest expenses — older ones
  // (deep links, post-"show all" clicks) need a direct read
  const listed = expenses.find((e) => e.id === eid)
  const expense = listed ?? fetchedExpense ?? undefined
  const isListed = Boolean(listed)

  useEffect(() => {
    if (loading || isListed || !id || !eid) return
    getDoc(doc(db, 'trips', id, 'expenses', eid))
      .then((snap) => {
        if (snap.exists() && !snap.data().deletedAt) {
          setFetchedExpense(mapExpense({ id: snap.id, ...snap.data() }))
        } else {
          setFetchFailed(true)
        }
      })
      .catch(() => setFetchFailed(true))
  }, [loading, isListed, id, eid])

  if (loading || !trip || !user || (!expense && !fetchFailed)) {
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  if (!expense) {
    return <div className="text-center py-10 text-text-secondary">Expense not found</div>
  }

  async function addComment() {
    if (!commentText.trim() || !user || !id || !eid || !expense) return
    setAddingComment(true)
    try {
      await updateDoc(doc(db, 'trips', id, 'expenses', eid), {
        comments: arrayUnion({
          uid: user.uid,
          text: commentText.trim(),
          createdAt: Timestamp.now(),
        }),
      })
      writeActivity(id, {
        action: 'comment_added',
        actorUid: user.uid,
        targetDescription: expense.description,
        targetExpenseId: eid,
      })
      setCommentText('')
      if (!isListed) {
        // No live listener covers this expense — refresh it directly
        const snap = await getDoc(doc(db, 'trips', id, 'expenses', eid))
        if (snap.exists()) setFetchedExpense(mapExpense({ id: snap.id, ...snap.data() }))
      }
    } finally {
      setAddingComment(false)
    }
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
        onUpdateCategories={async (cats: CustomCategory[]) => {
          await updateDoc(doc(db!, 'trips', id!), { customCategories: cats })
        }}
        existing={expense}
        onSubmit={async (data) => {
          // updateDoc merges, so optional fields the user cleared have to
          // be deleted explicitly or stale values keep driving balances
          const expenseUpdate: Record<string, unknown> = { ...data }
          if (!data.paidByAmounts && expense.paidByAmounts) {
            expenseUpdate.paidByAmounts = deleteField()
          }
          if (!data.notes && expense.notes) {
            expenseUpdate.notes = deleteField()
          }
          const newCats = data.categories ?? []
          if (newCats.length === 0 && getExpenseCategories(expense).length > 0) {
            expenseUpdate.categories = deleteField()
            expenseUpdate.category = deleteField()
          } else if (expense.category) {
            // Migrate the legacy single-category field on any edit
            expenseUpdate.category = deleteField()
          }

          const tripUpdate: Record<string, unknown> = { lastCurrency: data.currency }
          if (data.currency !== (trip.settlementCurrency ?? DEFAULT_CURRENCY)) {
            tripUpdate[`lastRates.${data.currency}`] = data.exchangeRate
          }
          await Promise.all([
            updateDoc(doc(db!, 'trips', id!, 'expenses', eid!), expenseUpdate),
            updateDoc(doc(db!, 'trips', id!), tripUpdate),
          ])

          // Compute what changed for the activity log
          const sc = trip.settlementCurrency ?? DEFAULT_CURRENCY
          const changes: string[] = []
          if (expense.description !== data.description) {
            changes.push(`description: "${expense.description}" → "${data.description}"`)
          }
          if (Math.abs(expense.amountSettled - data.amountUSD) > BALANCE_THRESHOLD) {
            changes.push(`amount: ${formatMoney(expense.amountSettled, sc)} → ${formatMoney(data.amountUSD, sc)}`)
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

          // Build previousValues from old expense for undo (uses Firestore field names)
          const prev: Record<string, unknown> = {}
          if (expense.description !== data.description) prev.description = expense.description
          if (Math.abs(expense.amountSettled - data.amountUSD) > BALANCE_THRESHOLD) prev.amountUSD = expense.amountSettled
          if (expense.currency !== data.currency) prev.currency = expense.currency
          if (expense.exchangeRate !== data.exchangeRate) prev.exchangeRate = expense.exchangeRate
          if (expense.amount !== data.amount) prev.amount = expense.amount
          if (expense.paidBy !== data.paidBy) prev.paidBy = expense.paidBy
          if (expense.splitType !== data.splitType) prev.splitType = expense.splitType
          if (JSON.stringify(expense.splits) !== JSON.stringify(data.splits)) prev.splits = expense.splits
          if (expense.paidByAmounts && JSON.stringify(expense.paidByAmounts) !== JSON.stringify(data.paidByAmounts)) {
            prev.paidByAmounts = expense.paidByAmounts
          } else if (!expense.paidByAmounts && data.paidByAmounts) {
            // Empty map reads as "single payer" everywhere balances are computed
            prev.paidByAmounts = {}
          }
          const oldCats = getExpenseCategories(expense)
          if (JSON.stringify(oldCats) !== JSON.stringify(newCats)) {
            // Firestore rejects undefined values, so previousValues must
            // only ever contain real values (empty array = "no categories")
            prev.categories = oldCats
          }
          if ((expense.notes ?? '') !== (data.notes ?? '')) prev.notes = expense.notes ?? ''

          // Activity log is fire-and-forget
          writeActivity(id!, {
            action: 'expense_edited',
            actorUid: user.uid,
            targetDescription: data.description,
            targetAmount: data.amountUSD,
            targetExpenseId: eid!,
            editDetails: changes.length > 0 ? changes : undefined,
            previousValues: Object.keys(prev).length > 0 ? prev : undefined,
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
            targetAmount: expense.amountSettled,
            targetExpenseId: eid!,
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
