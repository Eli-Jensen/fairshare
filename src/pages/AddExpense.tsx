import { useParams, useNavigate } from 'react-router-dom'
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { ExpenseForm } from '../components/ExpenseForm'
import { writeActivity } from '../lib/activity'

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
        onSubmit={async (data) => {
          await addDoc(collection(db!, 'trips', id!, 'expenses'), {
            ...data,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
          })
          // Save last-used currency and rate for this trip
          const tripUpdate: Record<string, unknown> = { lastCurrency: data.currency }
          if (data.currency !== 'USD') {
            tripUpdate[`lastRates.${data.currency}`] = data.exchangeRate
          }
          await updateDoc(doc(db!, 'trips', id!), tripUpdate)
          await writeActivity(id!, {
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
