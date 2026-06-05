import { useState, useEffect, useCallback } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import { doc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useTrip } from '../hooks/useTrip'
import { useAuth } from '../hooks/useAuth'
import { formatUSD } from '../lib/types'
import { ExpenseCard } from '../components/ExpenseCard'
import { MemberAvatar } from '../components/MemberAvatar'
import { SettlementView } from '../components/SettlementView'
import { UndoToast } from '../components/UndoToast'
import { ConfirmButton } from '../components/ConfirmButton'

type Tab = 'expenses' | 'settle'

export function TripDashboard() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const { trip, expenses, members, loading } = useTrip(id)
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('expenses')
  const [copied, setCopied] = useState(false)
  const [undoInfo, setUndoInfo] = useState<{ id: string; description: string } | null>(null)

  useEffect(() => {
    const state = location.state as { deletedExpenseId?: string; deletedExpenseDesc?: string } | null
    if (state?.deletedExpenseId) {
      setUndoInfo({ id: state.deletedExpenseId, description: state.deletedExpenseDesc ?? 'Expense' })
      // Clear navigation state so refresh doesn't re-show
      window.history.replaceState({}, '')
    }
  }, [location.state])

  const handleUndo = useCallback(async () => {
    if (!undoInfo || !id) return
    await updateDoc(doc(db!, 'trips', id, 'expenses', undoInfo.id), {
      deletedAt: deleteField(),
    })
    setUndoInfo(null)
  }, [undoInfo, id])

  const dismissUndo = useCallback(() => setUndoInfo(null), [])

  if (loading || !trip) {
    return <div className="text-center py-10 text-slate-400">Loading...</div>
  }

  const totalUSD = expenses.reduce((sum, e) => sum + e.amountUSD, 0)

  const inviteUrl = `${window.location.origin}/join/${trip.inviteCode}`
  function copyInvite() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-slate-900">{trip.name}</h1>
          <Link
            to={`/trip/${id}/expense/new`}
            className="bg-primary-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary-700 transition-colors"
          >
            Add Expense
          </Link>
        </div>
        <p className="text-sm text-slate-500">
          Total: {formatUSD(totalUSD)} across {expenses.length} expense
          {expenses.length !== 1 && 's'}
        </p>
      </div>

      {/* Members */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-medium text-slate-500">Members</h3>
          <Link
            to={`/trip/${id}/invite`}
            className="text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            + Invite people
          </Link>
          <span className="text-slate-300">|</span>
          <button
            onClick={copyInvite}
            className="text-xs text-primary-600 hover:text-primary-700"
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {trip.memberUids.map((uid) => (
            <div
              key={uid}
              className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full px-2 py-1"
            >
              <MemberAvatar member={members[uid]} size="sm" />
              <span className="text-xs text-slate-700">
                {members[uid]?.displayName ?? 'Loading...'}
                {uid === user?.uid && (
                  <span className="text-slate-400"> (you)</span>
                )}
              </span>
            </div>
          ))}
          {trip.invitedEmails && trip.invitedEmails.length > 0 && (
            <>
              {trip.invitedEmails.map((email) => (
                <div
                  key={email}
                  className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-2 py-1"
                >
                  <div className="w-5 h-5 rounded-full bg-amber-200 flex items-center justify-center text-[10px] text-amber-700 font-medium">
                    {email[0].toUpperCase()}
                  </div>
                  <span className="text-xs text-amber-700">
                    {email}
                    <span className="text-amber-400 ml-1">(invited)</span>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-4">
        <button
          onClick={() => setTab('expenses')}
          className={`flex-1 text-sm py-2 rounded-md transition-all ${
            tab === 'expenses'
              ? 'bg-white font-medium text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Expenses
        </button>
        <button
          onClick={() => setTab('settle')}
          className={`flex-1 text-sm py-2 rounded-md transition-all ${
            tab === 'settle'
              ? 'bg-white font-medium text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Settle Up
        </button>
      </div>

      {tab === 'expenses' && (
        <div>
          {expenses.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500 mb-3">No expenses yet</p>
              <Link
                to={`/trip/${id}/expense/new`}
                className="text-primary-600 font-medium hover:text-primary-700"
              >
                Add the first expense
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {expenses.map((exp) => (
                <ExpenseCard
                  key={exp.id}
                  expense={exp}
                  members={members}
                  onEdit={() =>
                    navigate(`/trip/${id}/expense/${exp.id}`)
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'settle' && (
        <SettlementView
          expenses={expenses}
          members={members}
          memberUids={trip.memberUids}
        />
      )}

      {/* Danger zone */}
      <div className="mt-10 pt-6 border-t border-slate-200">
        <ConfirmButton
          label="Delete this trip"
          confirmLabel="Tap again to confirm delete"
          onConfirm={async () => {
            await updateDoc(doc(db, 'trips', id!), {
              deletedAt: serverTimestamp(),
            })
            navigate('/', {
              state: { deletedTripId: id, deletedTripName: trip.name },
            })
          }}
          className="text-sm text-slate-400 hover:text-red-500 transition-colors"
          confirmClassName="text-sm text-red-600 font-medium bg-red-50 rounded-lg px-3 py-1.5 transition-colors"
        />
      </div>

      {undoInfo && (
        <UndoToast
          message={`"${undoInfo.description}" deleted`}
          onUndo={handleUndo}
          onDismiss={dismissUndo}
        />
      )}
    </div>
  )
}
