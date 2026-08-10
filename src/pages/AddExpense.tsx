import { useParams, useNavigate } from 'react-router-dom'
import { collection, serverTimestamp, doc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { ExpenseForm } from '../components/ExpenseForm'
import { writeActivity } from '../lib/activity'
import { notifyError } from '../lib/errorToast'
import { uploadReceipt } from '../lib/image'
import type { CustomCategory } from '../lib/types'
import { DEFAULT_CURRENCY } from '../lib/types'

export function AddExpense() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { trip, members, participants, loading } = useTrip(id)
  const navigate = useNavigate()

  if (loading || !trip || !user) {
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text mb-6">Add Expense</h1>
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
        onSubmit={async (data, receipts) => {
          const tripUpdate: Record<string, unknown> = { lastCurrency: data.currency }
          if (data.currency !== (trip.settlementCurrency ?? DEFAULT_CURRENCY)) {
            tripUpdate[`lastRates.${data.currency}`] = data.exchangeRate
          }
          // Ref first — the photos upload under the expense's own id.
          const expenseRef = doc(collection(db!, 'trips', id!, 'expenses'))

          // Uploads ARE awaited (they have no offline queue and the doc
          // should point at objects that exist), but failures only cost the
          // photos, never the expense: allSettled + a toast for the losses.
          let receiptPaths: string[] = []
          if (receipts.stagedFiles.length > 0) {
            const results = await Promise.allSettled(
              receipts.stagedFiles.map((f) => uploadReceipt(id!, expenseRef.id, f))
            )
            receiptPaths = results
              .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
              .map((r) => r.value)
            const lost = results.length - receiptPaths.length
            if (lost > 0) {
              notifyError(
                `${lost} photo${lost === 1 ? '' : 's'} didn't upload — the expense is saved without ${lost === 1 ? 'it' : 'them'}.`
              )
            }
          }

          // The doc write is deliberately NOT awaited: durable locally the
          // moment the SDK accepts it; the ack can land after navigation.
          // An online rejection surfaces via the global toast.
          setDoc(expenseRef, {
            ...data,
            // Omit-when-empty convention — never write undefined/[]
            ...(receiptPaths.length > 0 ? { receiptPaths } : {}),
            createdBy: user.uid,
            createdAt: serverTimestamp(),
          }).catch((err) => {
            console.error('add expense failed:', err)
            notifyError("The expense didn't save. Check your connection and try again.")
          })
          updateDoc(doc(db!, 'trips', id!), tripUpdate).catch(() => {})
          // Activity log is fire-and-forget — don't block navigation
          writeActivity(id!, {
            action: 'expense_added',
            actorUid: user.uid,
            targetDescription: data.description,
            targetAmount: data.amountUSD,
            targetExpenseId: expenseRef.id,
          })
          navigate(`/trip/${id}`)
        }}
      />
    </div>
  )
}
