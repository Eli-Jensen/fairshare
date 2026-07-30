import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import { doc, updateDoc, deleteField, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useTrip } from '../hooks/useTrip'
import { purgeTrip } from '../hooks/useTrips'
import { reconcilePlaceholderClaims } from '../lib/claim'
import { useAuth } from '../hooks/useAuth'
import { formatMoney, getMemberName, tripLabel, getAllCategories, getExpenseCategories, DEFAULT_CURRENCY } from '../lib/types'
import type { RemovedMember, PlaceholderMember } from '../lib/types'
import { ExpenseCard } from '../components/ExpenseCard'
import { MemberAvatar } from '../components/MemberAvatar'
import { SettlementView } from '../components/SettlementView'
import { ActivityLog } from '../components/ActivityLog'
import { UndoToast } from '../components/UndoToast'
import { DeleteModal } from '../components/DeleteModal'
import { tripToCsv, downloadCsv } from '../lib/export'
import { CurrencyPicker } from '../components/CurrencyPicker'
import { writeActivity } from '../lib/activity'
import { arrayRemove, addDoc, collection, Timestamp } from 'firebase/firestore'

type Tab = 'expenses' | 'settle' | 'activity'

// Trips created before the /inviteCodes lookup existed need their code doc
// backfilled — once per trip per session is plenty
const ensuredInviteCodes = new Set<string>()

export function TripDashboard() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const { trip, expenses, allExpenses, hasMore, loadAllExpenses, members, participants, activityLog, loading } = useTrip(id)
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>(() => {
    const params = new URLSearchParams(location.search)
    const t = params.get('tab')
    if (t === 'settle' || t === 'activity') return t
    return 'expenses'
  })
  const [undoInfo, setUndoInfo] = useState<{ id: string; description: string } | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [removeMemberUid, setRemoveMemberUid] = useState<string | null>(null)
  const [removeMemberName, setRemoveMemberName] = useState('')
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set())
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLongPress = useRef(false)
  const [undoSettlement, setUndoSettlement] = useState<{ id: string; description: string } | null>(null)
  const [showClearModal, setShowClearModal] = useState(false)
  const [clearUndo, setClearUndo] = useState<{ ids: string[]; count: number } | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const state = location.state as { deletedExpenseId?: string; deletedExpenseDesc?: string } | null
    if (state?.deletedExpenseId) {
      setUndoInfo({ id: state.deletedExpenseId, description: state.deletedExpenseDesc ?? 'Expense' })
      // Clear navigation state so refresh doesn't re-show
      window.history.replaceState({}, '')
    }
  }, [location.state])

  useEffect(() => {
    if (!id || !trip?.inviteCode || ensuredInviteCodes.has(id)) return
    ensuredInviteCodes.add(id)
    setDoc(
      doc(db, 'inviteCodes', trip.inviteCode),
      { tripId: id, type: trip.type ?? 'trip' },
      { merge: true }
    ).catch(() => {})
  }, [id, trip?.inviteCode])

  // Settlements and category subtotals are only correct over the full set
  useEffect(() => {
    if ((tab === 'settle' || categoryFilter.size > 0) && !allExpenses) {
      loadAllExpenses()
    }
  }, [tab, categoryFilter, allExpenses, loadAllExpenses])

  // Finish any pending placeholder→member merges (someone joined and claimed
  // their invited email). Idempotent; the first member to load the trip after
  // a join completes the expense rewrite, then the claims clear.
  const claimsKey = JSON.stringify(trip?.placeholderClaims ?? {})
  useEffect(() => {
    if (!id) return
    const claims = trip?.placeholderClaims
    if (!claims || Object.keys(claims).length === 0) return
    reconcilePlaceholderClaims(id, claims).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, claimsKey])

  const handleUndo = useCallback(async () => {
    if (!undoInfo || !id) return
    await updateDoc(doc(db!, 'trips', id, 'expenses', undoInfo.id), {
      deletedAt: deleteField(),
    })
    setUndoInfo(null)
  }, [undoInfo, id])

  const dismissUndo = useCallback(() => setUndoInfo(null), [])

  // Clear a fully-settled group's history: soft-delete every active expense to
  // Trash — they net to $0, so balances stay settled. Offers a one-tap undo.
  async function clearSettledHistory() {
    if (!id || !user) return
    const all = await loadAllExpenses()
    if (all.length === 0) return
    await Promise.all(
      all.map((e) => updateDoc(doc(db, 'trips', id, 'expenses', e.id), { deletedAt: serverTimestamp() })),
    )
    writeActivity(id, {
      action: 'history_cleared',
      actorUid: user.uid,
      targetDescription: `${all.length} expense${all.length !== 1 ? 's' : ''}`,
    })
    setClearUndo({ ids: all.map((e) => e.id), count: all.length })
  }

  const handleClearUndo = useCallback(async () => {
    if (!clearUndo || !id) return
    await Promise.all(
      clearUndo.ids.map((eid) => updateDoc(doc(db, 'trips', id, 'expenses', eid), { deletedAt: deleteField() })),
    )
    setClearUndo(null)
  }, [clearUndo, id])

  // Rescind a pending invite: drop the email and its placeholder participant.
  // Same write the Invite page does; the × is balance-guarded in the chip.
  async function rescindInvite(ph: PlaceholderMember) {
    if (!trip || !id || !user) return
    await updateDoc(doc(db, 'trips', id), {
      invitedEmails: arrayRemove(ph.email),
      placeholderMembers: (trip.placeholderMembers ?? []).filter((p) => p.id !== ph.id),
    })
    writeActivity(id, {
      action: 'invite_rescinded',
      actorUid: user.uid,
      targetMemberUid: ph.id,
      targetDescription: ph.email,
    })
  }

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
    const oldName = trip?.name
    await updateDoc(doc(db, 'trips', id), { name: trimmed })
    if (oldName && oldName !== trimmed) {
      writeActivity(id, {
        action: 'trip_renamed',
        actorUid: user!.uid,
        targetDescription: trimmed,
        previousValues: { name: oldName },
        editDetails: [`name: "${oldName}" → "${trimmed}"`],
      })
    }
    setEditingName(false)
  }

  if (loading || !trip) {
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  const sc = trip.settlementCurrency ?? DEFAULT_CURRENCY
  // Use cached totals (accurate even when paginated)
  const totalSettled = trip.cachedTotalSpent ?? expenses.reduce((sum, e) => sum + e.amountSettled, 0)
  const totalCount = trip.cachedExpenseCount ?? expenses.length
  const tl = tripLabel(trip.type)

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 flex-1 min-w-0 mr-3">
            {editingName ? (
              <>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName()
                    if (e.key === 'Escape') { setNameValue(trip.name); setEditingName(false) }
                  }}
                  className="text-2xl font-bold text-text border-b-2 border-primary-400 outline-none bg-transparent flex-1 min-w-0"
                  autoFocus
                />
                <button
                  onClick={saveName}
                  className="p-1.5 rounded-lg text-accent-text hover:bg-accent-soft transition-colors shrink-0"
                  title="Save changes"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <button
                  onClick={() => { setNameValue(trip.name); setEditingName(false) }}
                  className="p-1.5 rounded-lg text-text-muted hover:bg-card-hover transition-colors shrink-0"
                  title="Cancel"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="p-1.5 rounded-lg text-danger-text hover:bg-danger-bg transition-colors shrink-0"
                  title={`Delete ${tl}`}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-text truncate">{trip.name}</h1>
                <button
                  onClick={startEditing}
                  className="p-1 text-text-muted hover:text-text-secondary transition-colors shrink-0"
                  title={`Edit ${tl} name`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </>
            )}
          </div>
          <Link
            to={`/trip/${id}/expense/new`}
            className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover transition-colors shrink-0"
          >
            Add Expense
          </Link>
        </div>
        {editingName && (
          <div className="flex items-center gap-2 mt-2 mb-1">
            <label className="text-sm text-text-secondary">Settlement currency:</label>
            {totalCount > 0 ? (
              // Stored amounts are in this currency — switching would
              // relabel them without converting, corrupting balances
              <span className="text-sm text-text-muted">
                {sc} (locked once expenses exist)
              </span>
            ) : (
              <CurrencyPicker
                value={sc}
                onChange={async (code) => {
                  const oldCurrency = sc
                  await updateDoc(doc(db, 'trips', id!), { settlementCurrency: code })
                  writeActivity(id!, {
                    action: 'currency_changed',
                    actorUid: user!.uid,
                    targetDescription: `${oldCurrency} → ${code}`,
                    previousValues: { settlementCurrency: oldCurrency },
                    editDetails: [`settlement currency: ${oldCurrency} → ${code}`],
                  })
                }}
              />
            )}
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-secondary">
            Total: {formatMoney(totalSettled, sc)} across {totalCount} expense
            {totalCount !== 1 && 's'}
          </p>
          {expenses.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="text-sm text-text-muted hover:text-text-secondary flex items-center gap-1 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export
              </button>
              {showExportMenu && (
                <>
                <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
                <div className="absolute right-0 mt-1 bg-card border border-line rounded-lg shadow-lg py-1 z-20 w-48">
                  <Link
                    to={`/trip/${id}/backup`}
                    onClick={() => setShowExportMenu(false)}
                    className="block w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-card-hover"
                  >
                    Back up to Google Sheets
                  </Link>
                  <button
                    onClick={async () => {
                      // loadAllExpenses resolves with the full list — the
                      // allExpenses state in this closure is stale
                      const all = await loadAllExpenses()
                      const csv = tripToCsv(trip.name, all, members, participants, sc, trip.customCategories, trip.removedMembers)
                      downloadCsv(csv, `${trip.name.replace(/\s+/g, '-').toLowerCase()}.csv`)
                      setShowExportMenu(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-card-hover"
                  >
                    Download CSV
                  </button>
                </div>
                </>
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
            className="text-sm text-accent-text hover:text-accent-hover font-medium"
          >
            + Invite
          </Link>
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
                  if (canRemove) {
                    setRemoveMemberUid(uid)
                    setRemoveMemberName(getMemberName(uid, members))
                  }
                  if (canLeave) setShowLeaveModal(true)
                }}
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 transition-all ${
                  canRemove
                    ? 'bg-danger-bg border border-danger-text/20 cursor-pointer hover:bg-danger-bg/80'
                    : canLeave
                      ? 'bg-warn-bg border border-warn-border cursor-pointer hover:bg-warn-bg/80'
                      : 'bg-card border border-line cursor-default'
                }`}
              >
                <MemberAvatar member={members[uid]} size="sm" showInfoOnClick={!editingName} />
                <span className={`text-sm ${
                  canRemove ? 'text-danger-text' : canLeave ? 'text-warn-text' : 'text-text-secondary'
                }`}>
                  {getMemberName(uid, members)}
                  {isCurrentUser && (
                    <span className={canLeave ? 'text-warn-text' : 'text-text-muted'}> (you)</span>
                  )}
                </span>
                {canRemove && (
                  <svg className="w-3 h-3 text-danger-text/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {canLeave && (
                  <svg className="w-3 h-3 text-warn-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                )}
              </button>
            )
          })}
          {(trip.placeholderMembers ?? []).map((ph) => {
            const bal = Math.round((trip.cachedBalances?.[ph.id] ?? 0) * 100) / 100
            const canRescind = editingName && Math.abs(bal) <= 0.01
            const blockedByBalance = editingName && Math.abs(bal) > 0.01
            return (
              <button
                key={ph.id}
                type="button"
                onClick={() => { if (canRescind) rescindInvite(ph) }}
                title={
                  blockedByBalance
                    ? 'Settle their balance before rescinding the invite'
                    : canRescind
                      ? 'Rescind invite'
                      : "Invited — hasn't joined yet; tap the pencil to manage"
                }
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 border border-dashed transition-all ${
                  canRescind
                    ? 'bg-danger-bg border-danger-text/20 cursor-pointer hover:bg-danger-bg/80'
                    : 'bg-card border-line cursor-default'
                }`}
              >
                <MemberAvatar member={members[ph.id]} size="sm" />
                <span className={`text-sm ${canRescind ? 'text-danger-text' : 'text-text-secondary'}`}>
                  {ph.email}
                  <span className={`ml-1 ${canRescind ? 'text-danger-text/70' : 'text-text-muted'}`}>(pending)</span>
                </span>
                {canRescind && (
                  <svg className="w-3 h-3 text-danger-text/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </button>
            )
          })}
          {/* Legacy invited emails with no participant row */}
          {(() => {
            const phEmails = new Set((trip.placeholderMembers ?? []).map((p) => p.email))
            return (trip.invitedEmails ?? []).filter((e) => !phEmails.has(e)).map((email) => (
              <div
                key={email}
                className="flex items-center gap-1.5 bg-warn-bg border border-warn-border rounded-full px-2 py-1"
              >
                <div className="w-5 h-5 rounded-full bg-warn-border flex items-center justify-center text-[10px] text-warn-text font-medium">
                  {email[0].toUpperCase()}
                </div>
                <span className="text-sm text-warn-text">
                  {email}
                  <span className="text-warn-text/60 ml-1">(invited)</span>
                </span>
              </div>
            ))
          })()}
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
        <div className="max-w-lg mx-auto">
          {/* Category filter */}
          {expenses.length > 0 && (
            <>
            <div className="flex gap-1.5 flex-wrap pb-2">
              <button
                onClick={() => setCategoryFilter(new Set())}
                className={`text-sm px-2.5 py-1.5 rounded-full border whitespace-nowrap transition-all ${
                  categoryFilter.size === 0
                    ? 'bg-accent-soft border-accent text-accent-text font-medium'
                    : 'bg-card border-line text-text-secondary'
                }`}
              >
                All
              </button>
              {getAllCategories(trip.customCategories).map((cat) => {
                const isActive = categoryFilter.has(cat.value)
                return (
                  <button
                    key={cat.value}
                    onClick={() => {
                      if (isLongPress.current) return
                      // Short press on already-selected pill: deselect it
                      if (isActive) {
                        setCategoryFilter((prev) => {
                          const next = new Set(prev)
                          next.delete(cat.value)
                          return next
                        })
                      } else {
                        // Short press on unselected pill: single select
                        setCategoryFilter(new Set([cat.value]))
                      }
                    }}
                    onPointerDown={() => {
                      isLongPress.current = false
                      longPressTimer.current = setTimeout(() => {
                        isLongPress.current = true
                        // Long press on already-selected pill: deselect it
                        // Long press on unselected pill: add it to selection
                        setCategoryFilter((prev) => {
                          const next = new Set(prev)
                          if (next.has(cat.value)) {
                            next.delete(cat.value)
                          } else {
                            next.add(cat.value)
                          }
                          return next
                        })
                      }, 250)
                    }}
                    onPointerUp={() => {
                      if (longPressTimer.current) {
                        clearTimeout(longPressTimer.current)
                        longPressTimer.current = null
                      }
                    }}
                    onPointerLeave={() => {
                      if (longPressTimer.current) {
                        clearTimeout(longPressTimer.current)
                        longPressTimer.current = null
                      }
                    }}
                    className={`text-sm px-2.5 py-1.5 rounded-full border whitespace-nowrap transition-all select-none ${
                      isActive
                        ? 'bg-accent-soft border-accent text-accent-text font-medium'
                        : 'bg-card border-line text-text-secondary'
                    }`}
                  >
                    {cat.emoji} {cat.label}
                  </button>
                )
              })}
            </div>
            {/* Subtotal for the active filter (header already shows the total) */}
            {categoryFilter.size > 0 && (() => {
              const filtered = expenses.filter((exp) =>
                getExpenseCategories(exp).some((c) => categoryFilter.has(c))
              )
              const sum = filtered.reduce((s, e) => s + e.amountSettled, 0)
              return (
                <p className="text-sm text-text-muted pb-2 mb-1">
                  Subtotal: {formatMoney(sum, sc)} across {filtered.length} expense{filtered.length !== 1 ? 's' : ''}
                </p>
              )
            })()}
            </>
          )}

          {expenses.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-secondary mb-3">No expenses yet</p>
              <Link
                to={`/trip/${id}/expense/new`}
                className="text-accent-text font-medium hover:text-accent-hover"
              >
                Add an expense
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {expenses
                  .filter((exp) => categoryFilter.size === 0 || getExpenseCategories(exp).some((c) => categoryFilter.has(c)))
                  .map((exp) => (
                    <ExpenseCard
                      key={exp.id}
                      expense={exp} settlementCurrency={sc}
                      members={members}
                      customCategories={trip.customCategories}
                      onEdit={() =>
                        navigate(`/trip/${id}/expense/${exp.id}`)
                      }
                    />
                  ))}
              </div>
              {hasMore && (
                <button
                  onClick={loadAllExpenses}
                  className="w-full mt-3 py-2.5 text-sm font-medium text-accent-text border border-line rounded-lg hover:bg-card-hover transition-colors"
                >
                  Show all expenses
                </button>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'settle' && (allExpenses === null ? (
        <div className="text-center py-10 text-text-muted">Loading...</div>
      ) : (
        <div className="min-w-0">
        <SettlementView
          expenses={allExpenses}
          members={members}
          memberUids={participants}
          settlementCurrency={sc}
          customCategories={trip.customCategories}
          tripRates={trip.lastRates}
          tripLastCurrency={trip.lastCurrency}
          currentUserUid={user!.uid}
          isGroup={trip.type === 'group'}
          onClearSettled={() => setShowClearModal(true)}
          onRecordSettlement={async (from, to, amount, method, currency, exchangeRate) => {
            const cur = currency ?? sc
            const rate = exchangeRate ?? 1
            const amountInSC = cur === sc ? amount : Math.round(amount * rate * 100) / 100
            const fromName = getMemberName(from, members)
            const toName = getMemberName(to, members)
            const desc = `${fromName} paid ${toName}${method ? ` via ${method}` : ''}`
            const ref = await addDoc(collection(db, 'trips', id!, 'expenses'), {
              description: desc,
              amount,
              currency: cur,
              exchangeRate: rate,
              amountUSD: amountInSC,
              paidBy: from,
              splitType: 'exact' as const,
              splits: { [to]: amountInSC },
              date: Timestamp.now(),
              isSettlement: true,
              createdBy: user!.uid,
              createdAt: serverTimestamp(),
            })
            // Save rate for future use if it's a foreign currency
            if (cur !== sc) {
              await updateDoc(doc(db, 'trips', id!), {
                [`lastRates.${cur}`]: rate,
                lastCurrency: cur,
              })
            }
            writeActivity(id!, {
              action: 'settlement_recorded',
              actorUid: from,
              targetPayeeUid: to,
              targetDescription: `${fromName} → ${toName}`,
              targetAmount: amountInSC,
              targetExpenseId: ref.id,
              paymentMethod: method,
            })
            setUndoSettlement({ id: ref.id, description: desc })
          }}
        />
        </div>
      ))}

      {tab === 'activity' && (
        <div className="min-w-0">
          <ActivityLog entries={activityLog} members={members} settlementCurrency={sc} tripType={trip.type} tripId={id} currentUserUid={user?.uid} />
        </div>
      )}

      {showDeleteModal && (
        <DeleteModal
          title={`Delete this ${tl} for everyone?`}
          message={`"${trip.name}" and all expenses will be moved to trash for 24 hours, then permanently removed for all members.`}
          onCancel={() => setShowDeleteModal(false)}
          onConfirm={async () => {
            setShowDeleteModal(false)
            await updateDoc(doc(db, 'trips', id!), {
              deletedAt: serverTimestamp(),
            })
            writeActivity(id!, {
              action: 'trip_deleted',
              actorUid: user!.uid,
              targetDescription: trip.name,
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
          message={
            (trip.memberUids?.length ?? 1) <= 1
              ? `You're the last member, so leaving deletes this ${tl}${
                  (trip.invitedEmails?.length ?? 0) > 0
                    ? ` and cancels ${trip.invitedEmails!.length} pending invite${
                        trip.invitedEmails!.length === 1 ? '' : 's'
                      }`
                    : ''
                }.`
              : `You'll no longer see this ${tl} or its expenses.`
          }
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
          message={
            (trip.memberUids?.length ?? 1) <= 1
              ? `This permanently deletes the ${tl} and all its expenses — it can't be undone.`
              : `This cannot be undone. You'll need a new invite to rejoin.`
          }
          onCancel={() => setShowLeaveConfirm(false)}
          onConfirm={async () => {
            setShowLeaveConfirm(false)
            if (user) {
              const remainingCount = (trip.memberUids?.length ?? 1) - 1
              if (remainingCount <= 0) {
                // Last member out: hard-delete while still a member — the
                // rules gate deletes on membership, so a memberless trip
                // could never be purged
                await purgeTrip(id!, trip.inviteCode)
              } else {
                await updateDoc(doc(db, 'trips', id!), {
                  memberUids: arrayRemove(user.uid),
                })
                writeActivity(id!, {
                  action: 'member_left',
                  actorUid: user.uid,
                  targetMemberUid: user.uid,
                })
              }
              navigate('/')
            }
          }}
        />
      )}

      {removeMemberUid && (
        <DeleteModal
          title="Remove member?"
          message={(() => {
            const bal = Math.round((trip.cachedBalances?.[removeMemberUid] ?? 0) * 100) / 100
            const base = `Do you want to remove ${removeMemberName} from the ${tl}?`
            if (Math.abs(bal) <= 0.01) return base
            const direction = bal > 0 ? 'is still owed' : 'still owes'
            return `${base} ${removeMemberName} ${direction} ${formatMoney(Math.abs(bal), sc)} — the balance stays visible until it's settled.`
          })()}
          onCancel={() => setRemoveMemberUid(null)}
          onConfirm={async () => {
            const uid = removeMemberUid
            const member = members[uid]
            setRemoveMemberUid(null)

            const removedEntry: RemovedMember = {
              uid,
              email: member?.email ?? '',
              displayName: member?.displayName ?? removeMemberName,
              removedAt: Timestamp.now(),
            }
            const updatedRemoved = [...(trip.removedMembers ?? []), removedEntry]

            await updateDoc(doc(db, 'trips', id!), {
              memberUids: arrayRemove(uid),
              removedMembers: updatedRemoved,
            })
            writeActivity(id!, {
              action: 'member_removed',
              actorUid: user!.uid,
              targetMemberUid: uid,
              targetDescription: removeMemberName,
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

      {showClearModal && (
        <DeleteModal
          title="Clear settled history?"
          message={`Everyone's settled up, so this removes all expenses from this ${tl} to declutter it (they net to $0, so balances stay settled). They go to Trash, recoverable for 24 hours.`}
          confirmLabel="Yes, clear"
          onCancel={() => setShowClearModal(false)}
          onConfirm={async () => {
            setShowClearModal(false)
            await clearSettledHistory()
          }}
        />
      )}

      {clearUndo && (
        <UndoToast
          message={`Cleared ${clearUndo.count} expense${clearUndo.count !== 1 ? 's' : ''}`}
          onUndo={handleClearUndo}
          onDismiss={() => setClearUndo(null)}
        />
      )}
    </div>
  )
}
