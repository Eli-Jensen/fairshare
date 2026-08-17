/**
 * Push notifications: who hears about an activity entry, and what it says.
 *
 * Deliberately PURE — no firebase-admin, no I/O, no `process`. Everything here
 * is a function of data the caller has already fetched, which is what lets the
 * whole decision layer be unit-tested by the repo's normal `npm test` (the
 * Vitest default include picks up `functions/src/audience.test.ts`). The
 * impure orchestration lives in index.ts.
 *
 * This file necessarily restates a few semantics from src/lib/ (money
 * formatting, the `ph_` placeholder prefix, the ActivityAction union) because
 * Cloud Functions compile as a separate Node program and cannot import from
 * the Vite app. Keep them in sync: the union below must match
 * ActivityLogEntry['action'] in src/lib/types.ts.
 */

// ── Kinds ───────────────────────────────────────────────────────────────────
// Mirrors PushKind in src/lib/push.ts. Prefs are stored SPARSE — an absent key
// means ON, so a user who never touched settings gets everything.
export type PushKind = 'expenses' | 'settlements' | 'comments' | 'members'

export type ActivityAction =
  | 'expense_added' | 'expense_edited' | 'expense_deleted' | 'expense_restored'
  | 'settlement_recorded'
  | 'member_joined' | 'member_left' | 'member_removed' | 'member_invited'
  | 'invite_rescinded'
  | 'trip_created' | 'trip_renamed' | 'trip_deleted' | 'trip_restored'
  | 'currency_changed'
  | 'comment_added'
  | 'history_cleared'

/**
 * Which category each action belongs to. `null` means "never push".
 *
 * The five silent actions are silent on purpose: `trip_created` fires once at
 * the moment a trip has exactly one member (you), and again for every
 * sheet-restore — which writes hundreds of expenses under a single
 * `trip_created` entry. The other four are housekeeping the actor already
 * knows about and nobody else needs interrupting for.
 */
export const KIND_BY_ACTION: Record<ActivityAction, PushKind | null> = {
  expense_added: 'expenses',
  expense_edited: 'expenses',
  expense_deleted: 'expenses',
  expense_restored: 'expenses',
  history_cleared: 'expenses',
  settlement_recorded: 'settlements',
  comment_added: 'comments',
  member_joined: 'members',
  member_left: 'members',
  member_removed: 'members',
  member_invited: 'members',
  trip_deleted: 'members',
  trip_created: null,
  trip_renamed: null,
  trip_restored: null,
  currency_changed: null,
  invite_rescinded: null,
}

/** Mirrors PLACEHOLDER_PREFIX in src/lib/placeholders.ts. */
export const isPlaceholderId = (id: string): boolean => id.startsWith('ph_')

// ── The entry, as the trigger sees it ───────────────────────────────────────
export interface ActivityEntry {
  action: ActivityAction
  actorUid: string
  targetDescription?: string
  targetAmount?: number
  targetExpenseId?: string
  targetMemberUid?: string
  targetPayeeUid?: string
  /** Who clicked Record payment — not necessarily the payer. See settlementAudience. */
  recordedBy?: string
  paymentMethod?: string
  editDetails?: string[]
  /** Set by undo paths so a retraction doesn't push a contradiction. */
  suppressPush?: boolean
  /** comment_added only: media-with-no-text comments get truthful copy. */
  commentMedia?: 'gif' | 'photo'
}

export interface TripFacts {
  name?: string
  type?: 'trip' | 'group'
  memberUids?: string[]
  settlementCurrency?: string
  inviteCode?: string
}

/** Mirrors tripLabel() in src/lib/types.ts. */
export const tripLabel = (type?: string): string => (type === 'group' ? 'group' : 'trip')

// ── Money ───────────────────────────────────────────────────────────────────
/** Mirrors formatMoney() in src/lib/types.ts, including its fallback. */
export function formatMoney(amount: number, currencyCode = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).format(amount)
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`
  }
}

// ── Audience ────────────────────────────────────────────────────────────────

/**
 * The one filter every audience passes through.
 *
 * Three exclusions, each load-bearing:
 *  - **placeholders** (`ph_`) are trip-local fictions with no account at all;
 *    resolving one to a real person would be a privacy bug, not a feature.
 *  - **the actor** already knows what they just did.
 *  - **non-members**. This is the subtle one: `involvedParticipantIds` in
 *    src/lib/participants.ts deliberately KEEPS removed members so balances
 *    still net to zero, and their ids therefore linger in old `splits` maps.
 *    They can no longer read the trip, so they must not receive its contents.
 *
 * `extra` opts a specific uid past the membership check — used only by
 * `member_removed`, where the person who needs telling is precisely the one
 * who was just taken off the list.
 */
export function filterAudience(
  ids: readonly string[],
  opts: { actorUid?: string; memberUids?: readonly string[]; extra?: readonly string[] }
): string[] {
  const members = new Set(opts.memberUids ?? [])
  const extra = new Set(opts.extra ?? [])
  const out = new Set<string>()
  for (const id of [...ids, ...extra]) {
    if (!id) continue
    if (isPlaceholderId(id)) continue
    if (id === opts.actorUid) continue
    if (!members.has(id) && !extra.has(id)) continue
    out.add(id)
  }
  return [...out]
}

/** Everyone who paid into or owes on an expense. Shape-only — the caller reads the doc. */
export interface ExpenseFacts {
  paidBy?: string
  paidByAmounts?: Record<string, number>
  splits?: Record<string, number>
  /** LEGACY embedded comments — frozen since the subcollection shipped. */
  comments?: { uid?: string }[]
  /** Append-only denorm written by the comment writeBatch — the live
   *  source of "who's in this conversation". */
  commenterUids?: string[]
}

/**
 * The ids on an expense, from all three places a person can appear. Note that
 * a `splits` entry of 0 still counts — "in this split, owes nothing" is a real
 * state and different from being absent (the same distinction the Sheets
 * backup goes out of its way to preserve).
 */
export function expenseParticipants(e: ExpenseFacts): string[] {
  const ids = new Set<string>()
  if (typeof e.paidBy === 'string' && e.paidBy) ids.add(e.paidBy)
  for (const k of Object.keys(e.paidByAmounts ?? {})) ids.add(k)
  for (const k of Object.keys(e.splits ?? {})) ids.add(k)
  return [...ids]
}

/** Prior commenters on an expense — they're in the conversation. Union of
 *  the commenterUids denorm (new comments) and the frozen legacy embedded
 *  array, deduped — pre-migration commenters must stay in the loop. */
export function commentParticipants(e: ExpenseFacts): string[] {
  const ids = new Set<string>(e.commenterUids ?? [])
  for (const c of e.comments ?? []) {
    if (c.uid) ids.add(c.uid)
  }
  return [...ids]
}

/**
 * Who to tell about a settlement.
 *
 * `actorUid` is the PAYER here, not whoever clicked: TripDashboard records
 * `actorUid: from` so the activity log reads "Bob paid Carol" regardless of
 * who typed it in. Anyone in a trip may record a payment on someone else's
 * behalf, so the usual exclude-the-actor rule would drop the payer — exactly
 * the person who most needs to know money was attributed to them. `recordedBy`
 * disambiguates. Entries written before that field existed fall back to
 * telling the payee only, which is never wrong, just incomplete.
 */
export function settlementAudience(entry: ActivityEntry, memberUids: readonly string[]): string[] {
  const both = [entry.actorUid, entry.targetPayeeUid].filter((u): u is string => Boolean(u))
  if (!entry.recordedBy) {
    return filterAudience(entry.targetPayeeUid ? [entry.targetPayeeUid] : [], { memberUids })
  }
  return filterAudience(both, { actorUid: entry.recordedBy, memberUids })
}

// ── Edit noise ──────────────────────────────────────────────────────────────

/**
 * An edit within this long of the expense being created is silent. The common
 * shape is add → notice the amount is wrong → fix it, all inside a minute; the
 * add notification already told everyone, and the correction is the same news
 * arriving twice.
 *
 * An hour rather than the original half: the correction often waits for the
 * receipt, the card charge, or getting back to the table, and the whole point
 * is that nobody hears about a number the trip never saw.
 */
export const EDIT_GRACE_MS = 60 * 60 * 1000

/**
 * Having pushed one edit, stay quiet about further edits to the same expense
 * for this long. People correct several small things in a row — one "Alex
 * edited Dinner" covers the lot.
 */
export const EDIT_DEBOUNCE_MS = 10 * 60 * 1000

/**
 * Whether an `expense_edited` entry is worth interrupting anyone for.
 *
 * Both windows fail OPEN: an expense with no `createdAt` (pre-dating the
 * field, or restored from a sheet) and an expense with no prior edit both
 * notify, so missing data can never silence a real change.
 *
 * Note the debounce anchors on the previous EDIT, not on the last edit we
 * actually pushed — the function stores no per-expense state, and reading one
 * would cost a write on a path that currently writes nowhere but push docs
 * (see the loop-safety note in index.ts). The visible consequence is that a
 * long chain of edits spaced under EDIT_DEBOUNCE_MS apart produces one
 * notification rather than one per window. That is the direction we want to
 * err in, but it is a real property, not an accident.
 *
 * Suppression is push-only. The activity log still records every edit, so the
 * trip's history stays complete and the undo path is untouched.
 */
export function shouldPushEdit(input: {
  /** When the edit happened. */
  editedAtMs: number
  /** The expense's createdAt, if it has one. */
  expenseCreatedAtMs?: number
  /** The most recent PRIOR expense_edited for this expense, if any. */
  priorEditAtMs?: number
}): boolean {
  const { editedAtMs, expenseCreatedAtMs, priorEditAtMs } = input

  // Clock skew can make an edit look older than the expense; negative age is
  // as "fresh" as it gets, so the comparison holds without a special case.
  if (expenseCreatedAtMs !== undefined && editedAtMs - expenseCreatedAtMs < EDIT_GRACE_MS) {
    return false
  }
  if (priorEditAtMs !== undefined && editedAtMs - priorEditAtMs < EDIT_DEBOUNCE_MS) {
    return false
  }
  return true
}

// ── Preferences ─────────────────────────────────────────────────────────────
export interface PushDoc {
  fcmTokens?: string[]
  prefs?: Partial<Record<PushKind, boolean>>
  mutedTrips?: Record<string, boolean>
}

/**
 * Sparse by design: absent = ON. Only an explicit `false` mutes a kind, so a
 * doc that exists solely to hold tokens still receives everything.
 */
export function allowsPush(doc: PushDoc | undefined, kind: PushKind, tripId: string): boolean {
  if (!doc) return true
  if (doc.prefs?.[kind] === false) return false
  if (doc.mutedTrips?.[tripId]) return false
  return true
}

// ── Copy ────────────────────────────────────────────────────────────────────
export interface Note {
  title: string
  body: string
}

/**
 * Notification text. Deliberately does NOT reproduce getMemberName()'s
 * duplicate-name disambiguation — that needs the whole members map, and one
 * profile read per notification is not worth it. Two members called "Alex"
 * therefore produce identical text; the trip name in the title still tells you
 * where to look.
 */
export function noteFor(
  entry: ActivityEntry,
  ctx: {
    actorName: string
    trip: TripFacts
    recipientUid?: string
    /** For member_invited: the uid the invited email resolved to, if any. */
    inviteeUid?: string
  }
): Note | null {
  const { actorName, trip } = ctx
  const title = trip.name || tripLabel(trip.type)
  const desc = entry.targetDescription ?? ''
  const tl = tripLabel(trip.type)
  const amt =
    entry.targetAmount !== undefined
      ? formatMoney(entry.targetAmount, trip.settlementCurrency || 'USD')
      : ''

  switch (entry.action) {
    case 'expense_added':
      return { title, body: `${actorName} added ${desc}${amt ? ` — ${amt}` : ''}` }
    case 'expense_edited':
      return { title, body: `${actorName} edited ${desc}${amt ? ` — now ${amt}` : ''}` }
    case 'expense_deleted':
      return { title, body: `${actorName} deleted ${desc}${amt ? ` — ${amt}` : ''}` }
    case 'expense_restored':
      return { title, body: `${actorName} restored ${desc}${amt ? ` — ${amt}` : ''}` }
    case 'history_cleared':
      return { title, body: `${actorName} cleared the settled history` }
    case 'settlement_recorded': {
      const method = entry.paymentMethod ? ` via ${entry.paymentMethod}` : ''
      // desc is already "Payer → Payee"
      return { title, body: `💸 ${desc}${amt ? ` — ${amt}` : ''}${method}` }
    }
    case 'comment_added':
      // Media-only comments say what actually happened (gbp precedent).
      return {
        title,
        body:
          entry.commentMedia === 'gif'
            ? `${actorName} sent a GIF on ${desc}`
            : entry.commentMedia === 'photo'
              ? `${actorName} sent a photo on ${desc}`
              : `${actorName} commented on ${desc}`,
      }
    case 'member_joined':
      return { title, body: `${actorName} joined the ${tl}` }
    case 'member_left':
      return { title, body: `${actorName} left the ${tl}` }
    case 'member_removed':
      // The removed person gets told directly; everyone else gets the news.
      return ctx.recipientUid && ctx.recipientUid === entry.targetMemberUid
        ? { title, body: `${actorName} removed you from the ${tl}` }
        : { title, body: `${actorName} removed someone from the ${tl}` }
    case 'member_invited':
      // Only the person actually invited hears "you"; existing members are
      // told who joined the guest list. Identity comes from the email→uid
      // lookup, not from "isn't the actor" — every other member satisfies that.
      return ctx.inviteeUid && ctx.recipientUid === ctx.inviteeUid
        ? { title: `Invited to ${title}`, body: `${actorName} invited you to split expenses` }
        : { title, body: `${actorName} invited ${desc}` }
    case 'trip_deleted':
      return { title, body: `${actorName} deleted the ${tl}` }
    default:
      return null
  }
}

/** Where a tap lands. Paths only — index.ts prefixes the site origin. */
export function linkFor(
  entry: ActivityEntry,
  ctx: { tripId: string; trip: TripFacts; recipientUid?: string; inviteeUid?: string }
): string {
  const { tripId, trip } = ctx
  switch (entry.action) {
    case 'expense_added':
    case 'expense_edited':
    case 'expense_restored':
    case 'comment_added':
      // A deleted expense's detail page would 404; the others deep-link.
      return entry.targetExpenseId
        ? `/trip/${tripId}/expense/${entry.targetExpenseId}`
        : `/trip/${tripId}`
    case 'member_invited':
      // The invitee isn't in memberUids yet, so /trip/:id would be denied by
      // rules — send them through the invite code instead.
      return ctx.inviteeUid && ctx.recipientUid === ctx.inviteeUid && trip.inviteCode
        ? `/join/${trip.inviteCode}`
        : `/trip/${tripId}`
    case 'member_removed':
      return ctx.recipientUid === entry.targetMemberUid ? '/' : `/trip/${tripId}`
    case 'trip_deleted':
      return '/'
    default:
      return `/trip/${tripId}`
  }
}
