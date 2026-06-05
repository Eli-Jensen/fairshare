import { useParams, useNavigate } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { ExpenseForm } from '../components/ExpenseForm'

export function AddExpense() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { trip, members, loading } = useTrip(id)
  const navigate = useNavigate()

  if (loading || !trip || !user) {
    return <div className="text-center py-10 text-slate-400">Loading...</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Add Expense</h1>
      <ExpenseForm
        members={members}
        memberUids={trip.memberUids}
        currentUserUid={user.uid}
        onSubmit={async (data) => {
          await addDoc(collection(db, 'trips', id!, 'expenses'), {
            ...data,
            createdBy: user.uid,
            createdAt: serverTimestamp(),
          })
          navigate(`/trip/${id}`)
        }}
      />
    </div>
  )
}
