import { useParams, useNavigate } from 'react-router-dom'
import { collection, serverTimestamp, doc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { ExpenseForm } from '../components/ExpenseForm'
import { writeActivity } from '../lib/activity'
import { notifyError } from '../lib/errorToast'
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
        onSubmit={(data) => {
          // Deliberately NOT awaited: with offline persistence the write is
          // durable the moment the SDK accepts it, but the promise doesn't
          // settle until the SERVER acks — awaiting it pinned the Save
          // spinner forever on a plane. addDoc's ref (and id) is minted
          // synchronously, so the activity link and navigation don't need
          // the ack either. A rejection (rules, bad data) online surfaces
          // through the global error toast.
          const tripUpdate: Record<string, unknown> = { lastCurrency: data.currency }
          if (data.currency !== (trip.settlementCurrency ?? DEFAULT_CURRENCY)) {
            tripUpdate[`lastRates.${data.currency}`] = data.exchangeRate
          }
          const expenseRef = doc(collection(db!, 'trips', id!, 'expenses'))
          setDoc(expenseRef, {
            ...data,
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
