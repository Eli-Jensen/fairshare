import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import { doc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useTrip } from '../hooks/useTrip'
import { useAuth } from '../hooks/useAuth'
import { formatMoney, getMemberName, tripLabel, EXPENSE_CATEGORIES } from '../lib/types'
import type { RemovedMember, ExpenseCategory } from '../lib/types'
import { ExpenseCard } from '../components/ExpenseCard'
import { MemberAvatar } from '../components/MemberAvatar'
import { SettlementView } from '../components/SettlementView'
import { ActivityLog } from '../components/ActivityLog'
import { UndoToast } from '../components/UndoToast'
import { DeleteModal } from '../components/DeleteModal'
import { tripToCsv, downloadCsv, openInGoogleSheets } from '../lib/export'
import { writeActivity } from '../lib/activity'
import { arrayRemove, addDoc, collection, Timestamp } from 'firebase/firestore'

type Tab = 'expenses' | 'settle' | 'activity'

export function TripDashboard() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const { trip, expenses, members, activityLog, loading } = useTrip(id)
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('expenses')
  const [copied, setCopied] = useState(false)
  const [undoInfo, setUndoInfo] = useState<{ id: string; description: string } | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [removeMemberUid, setRemoveMemberUid] = useState<string | null>(null)
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | ''>('')
  const [undoSettlement, setUndoSettlement] = useState<{ id: string; description: string } | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)

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

  function startEditing() {
    if (!trip) return
    setNameValue(trip.name)
    setEditingName(true)
  }

  async function saveName() {
    const trimmed = nameValue.trim()
    if (!trimmed || !id) {
      setEditingName(false)
      return
    }
    await updateDoc(doc(db, 'trips', id), { name: trimmed })
    setEditingName(false)
  }

  if (loading || !trip) {
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  const sc = trip.settlementCurrency ?? 'USD'
  const totalUSD = expenses.reduce((sum, e) => sum + e.amountUSD, 0)
  const tl = tripLabel(trip.type)

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
          <div className="flex items-center gap-1.5 flex-1 min-w-0 mr-3">
            {editingName ? (
              <input
                ref={nameInputRef}
                type="text"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName()
                  if (e.key === 'Escape') setEditingName(false)
                }}
                className="text-2xl font-bold text-text border-b-2 border-primary-400 outline-none bg-transparent flex-1 min-w-0"
                autoFocus
              />
            ) : (
              <h1 className="text-2xl font-bold text-text truncate">{trip.name}</h1>
            )}
            <button
              onClick={editingName ? saveName : startEditing}
              className={`p-1 transition-colors shrink-0 ${
                editingName
                  ? 'text-accent-text hover:text-primary-700'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
              title={editingName ? 'Save' : `Edit ${tl} name`}
            >
              {editingName ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              )}
            </button>
            {editingName && (
              <button
                onClick={() => setShowDeleteModal(true)}
                className="p-1 text-text-muted hover:text-red-500 transition-colors shrink-0"
                title={`Delete ${tl}`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
          <Link
            to={`/trip/${id}/expense/new`}
            className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover transition-colors shrink-0"
          >
            Add Expense
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-secondary">
            Total: {formatMoney(totalUSD, sc)} across {expenses.length} expense
            {expenses.length !== 1 && 's'}
          </p>
          {expenses.length > 0 && (
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="text-xs text-text-muted hover:text-text-secondary flex items-center gap-1 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export
              </button>
              {showExportMenu && (
                <div className="absolute right-0 mt-1 bg-card border border-line rounded-lg shadow-lg py-1 z-20 w-48">
                  <button
                    onClick={() => {
                      const csv = tripToCsv(trip.name, expenses, members, trip.memberUids, sc)
                      openInGoogleSheets(csv)
                      setShowExportMenu(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-card-hover"
                  >
                    Export to Google Sheets
                  </button>
                  <button
                    onClick={() => {
                      const csv = tripToCsv(trip.name, expenses, members, trip.memberUids, sc)
                      downloadCsv(csv, `${trip.name.replace(/\s+/g, '-').toLowerCase()}.csv`)
                      setShowExportMenu(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-card-hover"
                  >
                    Download CSV
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Members */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-medium text-text-secondary">Members</h3>
          <Link
            to={`/trip/${id}/invite`}
            className="text-xs text-accent-text hover:text-accent-hover font-medium"
          >
            + Invite people
          </Link>
          <span className="text-text-muted">|</span>
          <button
            onClick={copyInvite}
            className="text-xs text-accent-text hover:text-accent-hover"
          >
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {trip.memberUids.map((uid) => {
            const isCurrentUser = uid === user?.uid
            const canRemove = editingName && !isCurrentUser
            const canLeave = editingName && isCurrentUser
            return (
              <button
                key={uid}
                type="button"
                onClick={() => {
                  if (canRemove) setRemoveMemberUid(uid)
                  if (canLeave) setShowLeaveModal(true)
                }}
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 transition-all ${
                  canRemove
                    ? 'bg-red-50 border border-red-200 cursor-pointer hover:bg-red-100'
                    : canLeave
                      ? 'bg-amber-50 border border-amber-200 cursor-pointer hover:bg-amber-100'
                      : 'bg-card border border-line cursor-default'
                }`}
              >
                <MemberAvatar member={members[uid]} size="sm" showInfoOnClick={!editingName} />
                <span className={`text-xs ${
                  canRemove ? 'text-red-700' : canLeave ? 'text-amber-700' : 'text-text-secondary'
                }`}>
                  {getMemberName(uid, members)}
                  {isCurrentUser && (
                    <span className={canLeave ? 'text-amber-500' : 'text-text-muted'}> (you)</span>
                  )}
                </span>
                {canRemove && (
                  <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {canLeave && (
                  <svg className="w-3 h-3 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                )}
              </button>
            )
          })}
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
      <div className="flex gap-1 bg-muted rounded-lg p-1 mb-4">
        {(['expenses', 'settle', 'activity'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 text-sm py-2 rounded-md transition-all ${
              tab === t
                ? 'bg-active font-medium text-text shadow-sm'
                : 'text-text-secondary hover:text-text'
            }`}
          >
            {t === 'expenses' ? 'Expenses' : t === 'settle' ? 'Settle Up' : 'Activity'}
          </button>
        ))}
      </div>

      {tab === 'expenses' && (
        <div>
          {/* Category filter */}
          {expenses.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-3 mb-2 -mx-1 px-1">
              <button
                onClick={() => setCategoryFilter('')}
                className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap transition-all ${
                  categoryFilter === ''
                    ? 'bg-accent-soft border-accent text-accent-text font-medium'
                    : 'bg-card border-line text-text-secondary'
                }`}
              >
                All
              </button>
              {EXPENSE_CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setCategoryFilter(cat.value)}
                  className={`text-xs px-2.5 py-1 rounded-full border whitespace-nowrap transition-all ${
                    categoryFilter === cat.value
                      ? 'bg-accent-soft border-accent text-accent-text font-medium'
                      : 'bg-card border-line text-text-secondary'
                  }`}
                >
                  {cat.emoji} {cat.label}
                </button>
              ))}
            </div>
          )}

          {expenses.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-secondary mb-3">No expenses yet</p>
              <Link
                to={`/trip/${id}/expense/new`}
                className="text-accent-text font-medium hover:text-accent-hover"
              >
                Add the first expense
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {expenses
                .filter((exp) => !categoryFilter || exp.category === categoryFilter)
                .map((exp) => (
                  <ExpenseCard
                    key={exp.id}
                    expense={exp} settlementCurrency={sc}
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
          settlementCurrency={sc}
          onRecordSettlement={async (from, to, amount, method) => {
            const fromName = getMemberName(from, members)
            const toName = getMemberName(to, members)
            const desc = `${fromName} paid ${toName}${method ? ` via ${method}` : ''}`
            const ref = await addDoc(collection(db, 'trips', id!, 'expenses'), {
              description: desc,
              amount,
              currency: sc,
              exchangeRate: 1,
              amountUSD: amount,
              paidBy: from,
              splitType: 'exact' as const,
              splits: { [to]: amount },
              date: Timestamp.now(),
              isSettlement: true,
              createdBy: user!.uid,
              createdAt: serverTimestamp(),
            })
            await writeActivity(id!, {
              action: 'settlement_recorded',
              actorUid: user!.uid,
              targetDescription: `${fromName} → ${toName}`,
              targetAmount: amount,
            })
            setUndoSettlement({ id: ref.id, description: desc })
          }}
        />
      )}

      {tab === 'activity' && (
        <ActivityLog entries={activityLog} members={members} settlementCurrency={sc} tripType={trip.type} />
      )}

      {showDeleteModal && (
        <DeleteModal
          title={`Delete this ${tl} for everyone?`}
          message={`This will permanently delete "${trip.name}" and all its expenses for every member of this ${tl}, not just you. This action is moved to the trash for 24 hours before being permanently removed.`}
          onCancel={() => setShowDeleteModal(false)}
          onConfirm={async () => {
            setShowDeleteModal(false)
            await updateDoc(doc(db, 'trips', id!), {
              deletedAt: serverTimestamp(),
            })
            navigate('/', {
              state: { deletedTripId: id, deletedTripName: trip.name },
            })
          }}
        />
      )}

      {showLeaveModal && (
        <DeleteModal
          title={`Leave this ${tl}?`}
          message="You'll no longer see this ${tl} or its expenses. Your past expenses will remain for other members."
          onCancel={() => setShowLeaveModal(false)}
          onConfirm={() => {
            setShowLeaveModal(false)
            setShowLeaveConfirm(true)
          }}
        />
      )}

      {showLeaveConfirm && (
        <DeleteModal
          title="Are you sure?"
          message="This cannot be undone. You will need to be re-invited to rejoin this ${tl}."
          onCancel={() => setShowLeaveConfirm(false)}
          onConfirm={async () => {
            setShowLeaveConfirm(false)
            if (user) {
              await updateDoc(doc(db, 'trips', id!), {
                memberUids: arrayRemove(user.uid),
              })
              navigate('/')
            }
          }}
        />
      )}

      {removeMemberUid && members[removeMemberUid] && (
        <DeleteModal
          title="Remove member?"
          message={`Do you want to remove ${getMemberName(removeMemberUid, members)} from the ${tl}?`}
          onCancel={() => setRemoveMemberUid(null)}
          onConfirm={async () => {
            const uid = removeMemberUid
            const member = members[uid]
            setRemoveMemberUid(null)

            const removedEntry: RemovedMember = {
              uid,
              email: member.email,
              displayName: member.displayName,
              removedAt: serverTimestamp() as unknown as import('firebase/firestore').Timestamp,
            }
            const updatedRemoved = [...(trip.removedMembers ?? []), removedEntry]

            await updateDoc(doc(db, 'trips', id!), {
              memberUids: arrayRemove(uid),
              removedMembers: updatedRemoved,
            })
          }}
        />
      )}

      {undoInfo && (
        <UndoToast
          message={`"${undoInfo.description}" deleted`}
          onUndo={handleUndo}
          onDismiss={dismissUndo}
        />
      )}

      {undoSettlement && (
        <UndoToast
          message={`Payment recorded: ${undoSettlement.description}`}
          onUndo={async () => {
            await updateDoc(doc(db, 'trips', id!, 'expenses', undoSettlement.id), {
              deletedAt: serverTimestamp(),
            })
            setUndoSettlement(null)
          }}
          onDismiss={() => setUndoSettlement(null)}
        />
      )}
    </div>
  )
}
