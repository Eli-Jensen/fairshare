import { useParams, useNavigate } from 'react-router-dom'
import { collection, addDoc, serverTimestamp, doc, updateDoc, arrayUnion } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { ExpenseForm } from '../components/ExpenseForm'
import { writeActivity } from '../lib/activity'
import type { CustomCategory } from '../lib/types'

export function AddExpense() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { trip, members, loading } = useTrip(id)
  const navigate = useNavigate()

  if (loading || !trip || !user) {
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text mb-6">Add Expense</h1>
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
        onSubmit={async (data) => {
          // Run all writes in parallel — they're independent
          const tripUpdate: Record<string, unknown> = { lastCurrency: data.currency }
          if (data.currency !== (trip.settlementCurrency ?? 'USD')) {
            tripUpdate[`lastRates.${data.currency}`] = data.exchangeRate
          }
          await Promise.all([
            addDoc(collection(db!, 'trips', id!, 'expenses'), {
              ...data,
              createdBy: user.uid,
              createdAt: serverTimestamp(),
            }),
            updateDoc(doc(db!, 'trips', id!), tripUpdate),
          ])
          // Activity log is fire-and-forget — don't block navigation
          writeActivity(id!, {
            action: 'expense_added',
            actorUid: user.uid,
            targetDescription: data.description,
            targetAmount: data.amountUSD,
          })
          navigate(`/trip/${id}`)
        }}
      />
    </div>
  )
}
