import { useParams, useNavigate } from 'react-router-dom'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { ExpenseForm } from '../components/ExpenseForm'

export function EditExpense() {
  const { id, eid } = useParams<{ id: string; eid: string }>()
  const { user } = useAuth()
  const { trip, expenses, members, loading } = useTrip(id)
  const navigate = useNavigate()

  const expense = expenses.find((e) => e.id === eid)

  if (loading || !trip || !user) {
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
        memberUids={trip.memberUids}
        currentUserUid={user.uid}
        tripRates={trip.lastRates}
        existing={expense}
        onSubmit={async (data) => {
          await updateDoc(doc(db!, 'trips', id!, 'expenses', eid!), data)
          if (data.currency !== 'USD') {
            await updateDoc(doc(db!, 'trips', id!), {
              [`lastRates.${data.currency}`]: data.exchangeRate,
            })
          }
          navigate(`/trip/${id}`)
        }}
        onDelete={async () => {
          // Soft delete — mark with timestamp instead of removing
          await updateDoc(doc(db!, 'trips', id!, 'expenses', eid!), {
            deletedAt: serverTimestamp(),
          })
          navigate(`/trip/${id}`, {
            state: {
              deletedExpenseId: eid,
              deletedExpenseDesc: expense.description,
            },
          })
        }}
      />
    </div>
  )
}
