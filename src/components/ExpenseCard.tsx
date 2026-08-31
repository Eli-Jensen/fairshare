import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import type { Expense, UserProfile, CustomCategory } from '../lib/types'
import { formatMoney, getMemberName, getCategoryInfo, getExpenseCategories, DEFAULT_CURRENCY } from '../lib/types'
import { formatDateOnly } from '../lib/dates'
import { groupReactions } from '../lib/reactions'
import { MemberAvatar } from './MemberAvatar'

// Hold this long before the context menu opens. 500ms matches the native
// long-press on both platforms; the 250ms pills are toggles, not menus.
const LONG_PRESS_MS = 500
// Finger drift beyond this is a scroll, not a press — some browsers only
// fire pointercancel once the pan actually starts, so check movement too.
const MOVE_CANCEL_PX = 10

export function ExpenseCard({
  expense,
  members,
  onEdit,
  onDelete,
  settlementCurrency,
  customCategories,
  pending,
}: {
  expense: Expense
  members: Record<string, UserProfile>
  onEdit?: () => void
  /** Enables the long-press / right-click menu (Edit + Delete). */
  onDelete?: () => void
  settlementCurrency?: string
  customCategories?: CustomCategory[]
  /** Latest write not yet acked by the server (offline save). */
  pending?: boolean
}) {
  const payer = members[expense.paidBy]
  const sc = settlementCurrency ?? DEFAULT_CURRENCY
  const dateStr = formatDateOnly(expense.date)
  // Live subcollection count + frozen legacy array
  const commentTotal = (expense.commentCount ?? 0) + (expense.comments?.length ?? 0)
  const reactionGroups = groupReactions(expense.reactions)

  const expenseCategories = getExpenseCategories(expense)
    .map((c) => getCategoryInfo(c, customCategories))
    .filter(Boolean) as { label: string; emoji: string }[]

  const isSettlement = expense.isSettlement

  // Long-press / right-click context menu. `menu` holds the press point;
  // the real position is measured and clamped to the viewport (same fixed
  // + clamp approach as HelpTip — absolute popovers clip on phones).
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressStart = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)

  const hasMenu = Boolean(onEdit && onDelete)

  function openMenu(x: number, y: number) {
    // The pointerup that ends the long press must not count as a tap
    suppressClick.current = true
    navigator.vibrate?.(15)
    setMenuPos(null)
    setMenu({ x, y })
  }

  function closeMenu() {
    setMenu(null)
    setMenuPos(null)
  }

  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
    pressStart.current = null
  }

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return
    const margin = 8
    const rect = menuRef.current.getBoundingClientRect()
    let left = menu.x
    let top = menu.y
    if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - margin - rect.width
    if (left < margin) left = margin
    // Low on the screen: open upward from the press point instead
    if (top + rect.height > window.innerHeight - margin) top = menu.y - rect.height
    if (top < margin) top = margin
    setMenuPos({ left, top })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu()
    }
    function onScroll() {
      closeMenu()
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menu])

  useEffect(() => cancelPress, [])

  return (
    <>
      {/* role/tabIndex instead of a <button>: the card nests real buttons
          (member avatars), and buttons can't contain buttons. */}
      <div
        onClick={
          onEdit
            ? () => {
                if (suppressClick.current) {
                  suppressClick.current = false
                  return
                }
                onEdit()
              }
            : undefined
        }
        role={onEdit ? 'button' : undefined}
        tabIndex={onEdit ? 0 : undefined}
        onKeyDown={
          onEdit
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onEdit()
                }
              }
            : undefined
        }
        onPointerDown={
          hasMenu
            ? (e) => {
                if (e.button !== 0) return // right button → contextmenu path
                suppressClick.current = false
                pressStart.current = { x: e.clientX, y: e.clientY }
                const { clientX, clientY } = e
                pressTimer.current = setTimeout(() => openMenu(clientX, clientY), LONG_PRESS_MS)
              }
            : undefined
        }
        onPointerMove={
          hasMenu
            ? (e) => {
                if (!pressStart.current) return
                if (
                  Math.abs(e.clientX - pressStart.current.x) > MOVE_CANCEL_PX ||
                  Math.abs(e.clientY - pressStart.current.y) > MOVE_CANCEL_PX
                ) {
                  cancelPress()
                }
              }
            : undefined
        }
        onPointerUp={hasMenu ? cancelPress : undefined}
        onPointerLeave={hasMenu ? cancelPress : undefined}
        onPointerCancel={hasMenu ? cancelPress : undefined}
        onContextMenu={
          hasMenu
            ? (e) => {
                e.preventDefault()
                cancelPress()
                // Keyboard menu key reports (0,0) — anchor to the card instead
                if (e.clientX <= 0 && e.clientY <= 0) {
                  const rect = e.currentTarget.getBoundingClientRect()
                  openMenu(rect.left + 16, rect.bottom - 8)
                } else {
                  openMenu(e.clientX, e.clientY)
                }
              }
            : undefined
        }
        className={`rounded-lg border p-3 ${
          isSettlement
            ? 'bg-accent-soft border-accent/30'
            : 'bg-card border-line'
        } ${onEdit ? 'cursor-pointer hover:border-accent hover:shadow-sm transition-all' : ''} ${
          hasMenu ? 'select-none' : ''
        }`}
      >
        <div className="flex items-start gap-3">
          {isSettlement ? (
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent-text shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
          ) : (
            <MemberAvatar member={payer} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {isSettlement && (
                  <span className="text-sm font-medium text-accent-text shrink-0">Settlement</span>
                )}
                {expenseCategories.length > 0 && !isSettlement && (
                  <span className="text-sm shrink-0" title={expenseCategories.map((c) => c.label).join(', ')}>
                    {expenseCategories.map((c) => c.emoji).join('')}
                  </span>
                )}
                <p className="font-medium text-text truncate">
                  {expense.description}
                </p>
              </div>
              <p className="font-semibold text-text shrink-0">
                {formatMoney(expense.amountSettled, sc)}
              </p>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <p className="text-sm text-text-secondary">
                {expense.paidByAmounts && Object.keys(expense.paidByAmounts).length > 1
                  ? Object.entries(expense.paidByAmounts)
                      .map(([uid, amt]) => `${getMemberName(uid, members)} ${formatMoney(amt, sc)}`)
                      .join(', ')
                  : `${getMemberName(expense.paidBy, members)} paid`}
                {expense.currency !== sc && (
                  <span className="ml-1 text-sm text-text-muted">
                    ({expense.amount} {expense.currency})
                  </span>
                )}
              </p>
              <p className="text-sm text-text-muted">
                {dateStr}
                {(expense.receiptPaths?.length ?? 0) > 0 && (
                  <span
                    className="ml-1.5"
                    title={`${expense.receiptPaths!.length} receipt photo${expense.receiptPaths!.length === 1 ? '' : 's'}`}
                    aria-label={`${expense.receiptPaths!.length} receipt photo${expense.receiptPaths!.length === 1 ? '' : 's'}`}
                  >
                    📷{expense.receiptPaths!.length > 1 ? expense.receiptPaths!.length : ''}
                  </span>
                )}
                {pending && (
                  <span
                    className="ml-1.5 text-warn-text"
                    title="Saved on this device — will sync when online"
                    aria-label="Waiting to sync"
                  >
                    🕓
                  </span>
                )}
              </p>
            </div>
            {!isSettlement && (
              <p className="text-sm text-text-muted mt-0.5">
                {Object.keys(expense.splits).length} {Object.keys(expense.splits).length === 1 ? 'person' : 'people'} · {expense.splitType}
              </p>
            )}
            {expense.notes && (
              <p className="text-sm text-text-muted mt-1 italic truncate">
                {expense.notes}
              </p>
            )}
            {commentTotal > 0 && (
              <p className="text-sm text-accent-text mt-0.5">
                {commentTotal} comment{commentTotal !== 1 && 's'}
              </p>
            )}
            {reactionGroups.length > 0 && (
              // Read-only pills — the data is already on the listener doc, so
              // this costs nothing; tap the card to react on the detail page.
              <p className="text-sm text-text-muted mt-0.5">
                {reactionGroups
                  .map((g) => `${g.emoji}${g.count > 1 ? g.count : ''}`)
                  .join(' ')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Context menu — a sibling of the card, not a child, so its events
          can't bubble into the card's tap-to-edit handler. */}
      {menu && (
        <>
          {/* Close on the NEXT press, not on click — the pointerup that ends
              a desktop long press would otherwise close it instantly. */}
          <div
            className="fixed inset-0 z-40"
            onPointerDown={closeMenu}
            onContextMenu={(e) => {
              e.preventDefault()
              closeMenu()
            }}
          />
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions for ${expense.description}`}
            style={{
              position: 'fixed',
              left: menuPos?.left ?? menu.x,
              top: menuPos?.top ?? menu.y,
              visibility: menuPos ? 'visible' : 'hidden',
            }}
            className="z-50 min-w-36 bg-card border border-line rounded-xl shadow-xl py-1 overflow-hidden"
          >
            <button
              type="button"
              role="menuitem"
              autoFocus
              onClick={() => {
                closeMenu()
                onEdit!()
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-text hover:bg-card-hover transition-colors"
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
            <div className="border-t border-line my-1" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu()
                onDelete!()
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-danger-text hover:bg-danger-bg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </div>
        </>
      )}
    </>
  )
}
