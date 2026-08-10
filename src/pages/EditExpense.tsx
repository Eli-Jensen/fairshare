import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, onSnapshot, updateDoc, deleteField, serverTimestamp, arrayUnion } from 'firebase/firestore'
import type { CustomCategory, Expense } from '../lib/types'
import { getExpenseCategories, mapExpense } from '../lib/types'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { ExpenseForm } from '../components/ExpenseForm'
import { ReactionBar } from '../components/ReactionBar'
import { CommentsSection } from '../components/CommentsSection'
import { writeActivity } from '../lib/activity'
import { notifyError } from '../lib/errorToast'
import { uploadReceipt, deleteReceiptObjects } from '../lib/image'
import { getMemberName, formatMoney, DEFAULT_CURRENCY, BALANCE_THRESHOLD } from '../lib/types'

export function EditExpense() {
  const { id, eid } = useParams<{ id: string; eid: string }>()
  const { user } = useAuth()
  const { trip, expenses, members, participants, loading } = useTrip(id)
  const navigate = useNavigate()
  const [fetchedExpense, setFetchedExpense] = useState<Expense | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)

  // The paginated listener only covers the newest expenses — older ones
  // (deep links, post-"show all" clicks) need their own DOC LISTENER, not a
  // one-shot read: reactions and comment counts land on this doc and must
  // update live even when the page-window listener doesn't cover it.
  const listed = expenses.find((e) => e.id === eid)
  const isListed = Boolean(listed)

  useEffect(() => {
    if (loading || isListed || !id || !eid) return
    return onSnapshot(
      doc(db, 'trips', id, 'expenses', eid),
      (snap) => {
        if (snap.exists() && !snap.data().deletedAt) {
          setFetchedExpense(mapExpense({ id: snap.id, ...snap.data() }))
        } else {
          setFetchFailed(true)
        }
      },
      () => setFetchFailed(true)
    )
  }, [loading, isListed, id, eid])

  const expense = listed ?? fetchedExpense ?? undefined

  if (loading || !trip || !user || (!expense && !fetchFailed)) {
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  if (!expense) {
    return <div className="text-center py-10 text-text-secondary">Expense not found</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text mb-6">Edit Expense</h1>
      <ExpenseForm
        members={members}
        memberUids={participants}
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
        onSubmit={async (data, receipts) => {
          // updateDoc merges, so optional fields the user cleared have to
          // be deleted explicitly or stale values keep driving balances
          const expenseUpdate: Record<string, unknown> = { ...data }

          // Receipts: upload staged, diff removed. Uploads awaited
          // (allSettled — losing a photo never loses the edit); removed
          // objects are deleted only AFTER the doc write succeeds, so a
          // failed write can't leave the doc pointing at deleted objects.
          const removed = (expense.receiptPaths ?? []).filter(
            (p) => !receipts.keptPaths.includes(p)
          )
          let uploaded: string[] = []
          if (receipts.stagedFiles.length > 0) {
            const results = await Promise.allSettled(
              receipts.stagedFiles.map((f) => uploadReceipt(id!, eid!, f))
            )
            uploaded = results
              .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
              .map((r) => r.value)
            const lost = results.length - uploaded.length
            if (lost > 0) {
              notifyError(
                `${lost} photo${lost === 1 ? '' : 's'} didn't upload — the changes are saved without ${lost === 1 ? 'it' : 'them'}.`
              )
            }
          }
          const finalPaths = [...receipts.keptPaths, ...uploaded]
          expenseUpdate.receiptPaths = finalPaths.length > 0 ? finalPaths : deleteField()
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
          // Not awaited — see AddExpense. Durable locally; the ack can
          // arrive after we've navigated away. Removed photo objects are
          // deleted in the write's own then() (doc-first ordering); the
          // reverse orphan from a failed delete is harmless and swept at
          // trip purge.
          updateDoc(doc(db!, 'trips', id!, 'expenses', eid!), expenseUpdate).then(
            () => deleteReceiptObjects(removed),
            (err) => {
              console.error('edit expense failed:', err)
              notifyError("The changes didn't save. Check your connection and try again.")
            }
          )
          updateDoc(doc(db!, 'trips', id!), tripUpdate).catch(() => {})

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
          if (removed.length > 0 || uploaded.length > 0) {
            changes.push(`receipts: ${expense.receiptPaths?.length ?? 0} → ${finalPaths.length}`)
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
        onDelete={() => {
          updateDoc(doc(db!, 'trips', id!, 'expenses', eid!), {
            deletedAt: serverTimestamp(),
          }).catch((err) => {
            console.error('delete expense failed:', err)
            notifyError("The delete didn't go through. Check your connection and try again.")
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

      {/* React to the expense itself */}
      <div className="mt-6">
        <ReactionBar
          tripId={id!}
          expenseId={expense.id}
          reactions={expense.reactions}
          meUid={user.uid}
        />
      </div>

      {/* Thread: frozen legacy rows + live comment docs + composer */}
      <CommentsSection tripId={id!} expense={expense} members={members} meUid={user.uid} />
    </div>
  )
}
