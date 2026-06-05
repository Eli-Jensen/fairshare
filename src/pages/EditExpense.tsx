import { useParams, useNavigate } from 'react-router-dom'
import { doc, updateDoc, deleteDoc } from 'firebase/firestore'
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
    return <div className="text-center py-10 text-slate-400">Loading...</div>
  }

  if (!expense) {
    return <div className="text-center py-10 text-slate-500">Expense not found</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Edit Expense</h1>
      <ExpenseForm
        members={members}
        memberUids={trip.memberUids}
        currentUserUid={user.uid}
        existing={expense}
        onSubmit={async (data) => {
          await updateDoc(doc(db, 'trips', id!, 'expenses', eid!), data)
          navigate(`/trip/${id}`)
        }}
        onDelete={async () => {
          if (confirm('Delete this expense?')) {
            await deleteDoc(doc(db, 'trips', id!, 'expenses', eid!))
            navigate(`/trip/${id}`)
          }
        }}
      />
    </div>
  )
}
