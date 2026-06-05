import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useTrip } from '../hooks/useTrip'
import { useAuth } from '../hooks/useAuth'
import { formatUSD } from '../lib/types'
import { ExpenseCard } from '../components/ExpenseCard'
import { MemberAvatar } from '../components/MemberAvatar'
import { SettlementView } from '../components/SettlementView'

type Tab = 'expenses' | 'settle'

export function TripDashboard() {
  const { id } = useParams<{ id: string }>()
  const { trip, expenses, members, loading } = useTrip(id)
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('expenses')
  const [copied, setCopied] = useState(false)

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
          <button
            onClick={copyInvite}
            className="text-xs text-primary-600 hover:text-primary-700"
          >
            {copied ? 'Copied!' : 'Copy invite link'}
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
    </div>
  )
}
