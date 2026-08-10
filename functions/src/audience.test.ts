import { describe, it, expect } from 'vitest'
import {
  KIND_BY_ACTION,
  isPlaceholderId,
  formatMoney,
  filterAudience,
  expenseParticipants,
  commentParticipants,
  settlementAudience,
  allowsPush,
  noteFor,
  linkFor,
  shouldPushEdit,
  EDIT_GRACE_MS,
  EDIT_DEBOUNCE_MS,
  type ActivityAction,
  type ActivityEntry,
  type TripFacts,
} from './audience'

const TRIP: TripFacts = {
  name: 'Tokyo',
  type: 'trip',
  memberUids: ['alice', 'bob', 'carol'],
  settlementCurrency: 'USD',
  inviteCode: 'abc123',
}

const entry = (over: Partial<ActivityEntry> & Pick<ActivityEntry, 'action'>): ActivityEntry => ({
  actorUid: 'alice',
  ...over,
})

describe('KIND_BY_ACTION', () => {
  // Locked to the union in src/lib/types.ts — a new action added there without
  // a decision here should fail this, not silently default to silence.
  const ALL_ACTIONS: ActivityAction[] = [
    'expense_added', 'expense_edited', 'expense_deleted', 'expense_restored',
    'settlement_recorded',
    'member_joined', 'member_left', 'member_removed', 'member_invited',
    'invite_rescinded',
    'trip_created', 'trip_renamed', 'trip_deleted', 'trip_restored',
    'currency_changed',
    'comment_added',
    'history_cleared',
  ]

  it('covers all 17 actions', () => {
    expect(Object.keys(KIND_BY_ACTION).sort()).toEqual([...ALL_ACTIONS].sort())
  })

  it('maps each action to a kind or explicit null', () => {
    for (const a of ALL_ACTIONS) {
      expect(KIND_BY_ACTION[a] === null || typeof KIND_BY_ACTION[a] === 'string').toBe(true)
    }
  })

  it('keeps exactly the five housekeeping actions silent', () => {
    const silent = ALL_ACTIONS.filter((a) => KIND_BY_ACTION[a] === null)
    expect(silent.sort()).toEqual(
      ['currency_changed', 'invite_rescinded', 'trip_created', 'trip_renamed', 'trip_restored'].sort()
    )
  })

  it('routes an N-expense history_cleared to the expenses kind', () => {
    // One entry is written for the whole wipe, so this is one push, not N.
    expect(KIND_BY_ACTION.history_cleared).toBe('expenses')
  })
})

describe('isPlaceholderId', () => {
  it('recognizes the ph_ prefix and nothing else', () => {
    expect(isPlaceholderId('ph_abc')).toBe(true)
    expect(isPlaceholderId('alice')).toBe(false)
    expect(isPlaceholderId('')).toBe(false)
    expect(isPlaceholderId('xph_abc')).toBe(false)
  })
})

describe('formatMoney', () => {
  it('formats known currencies', () => {
    expect(formatMoney(12.5, 'USD')).toBe('$12.50')
    expect(formatMoney(1234.5, 'JPY')).toBe('¥1,235')
  })

  it('formats an unknown-but-well-formed code via Intl (NBSP separator)', () => {
    // Intl accepts any 3-letter code and prefixes it; it does NOT throw here.
    // Same behavior as formatMoney in src/lib/types.ts, which this mirrors.
    expect(formatMoney(10, 'XYZ')).toBe('XYZ 10.00')
  })

  it('falls back rather than throwing on a malformed code', () => {
    expect(formatMoney(10, 'XY')).toBe('XY 10.00')
    expect(formatMoney(10, '')).toBe(' 10.00')
  })
})

describe('filterAudience', () => {
  const memberUids = ['alice', 'bob', 'carol']

  it('drops the actor', () => {
    expect(filterAudience(['alice', 'bob'], { actorUid: 'alice', memberUids })).toEqual(['bob'])
  })

  it('drops placeholders — they have no account to notify', () => {
    expect(filterAudience(['bob', 'ph_x1'], { memberUids })).toEqual(['bob'])
  })

  it('drops removed members who still appear in old splits', () => {
    // participants.ts keeps them for balance math; they can't read the trip.
    expect(filterAudience(['bob', 'dave'], { memberUids })).toEqual(['bob'])
  })

  it('lets `extra` past the membership check', () => {
    // member_removed: the person to tell is the one no longer in memberUids.
    expect(filterAudience([], { memberUids, extra: ['dave'] })).toEqual(['dave'])
  })

  it('still drops the actor even when listed in extra', () => {
    expect(filterAudience([], { actorUid: 'dave', memberUids, extra: ['dave'] })).toEqual([])
  })

  it('dedupes and skips empty ids', () => {
    expect(filterAudience(['bob', 'bob', ''], { memberUids })).toEqual(['bob'])
  })

  it('returns nothing when memberUids is absent', () => {
    expect(filterAudience(['bob'], {})).toEqual([])
  })
})

describe('expenseParticipants', () => {
  it('reads a single payer plus splits', () => {
    expect(
      expenseParticipants({ paidBy: 'alice', splits: { alice: 25, bob: 25 } }).sort()
    ).toEqual(['alice', 'bob'])
  })

  it('reads every payer of a multi-payer expense', () => {
    expect(
      expenseParticipants({
        paidBy: 'alice',
        paidByAmounts: { alice: 350, bob: 175.5, carol: 74.5 },
        splits: { alice: 200, bob: 200, carol: 200 },
      }).sort()
    ).toEqual(['alice', 'bob', 'carol'])
  })

  it('keeps a zero-value split — "in it, owes nothing" is not the same as absent', () => {
    expect(expenseParticipants({ paidBy: 'alice', splits: { bob: 0 } }).sort()).toEqual([
      'alice',
      'bob',
    ])
  })

  it('handles a missing paidBy and empty maps', () => {
    expect(expenseParticipants({})).toEqual([])
    expect(expenseParticipants({ paidBy: '' })).toEqual([])
  })
})

describe('commentParticipants', () => {
  it('collects prior commenters and ignores malformed entries', () => {
    expect(
      commentParticipants({ comments: [{ uid: 'bob' }, {}, { uid: 'carol' }] })
    ).toEqual(['bob', 'carol'])
    expect(commentParticipants({})).toEqual([])
  })

  it('reads the commenterUids denorm (subcollection comments)', () => {
    expect(commentParticipants({ commenterUids: ['dave', 'erin'] })).toEqual(['dave', 'erin'])
  })

  it('unions denorm with legacy embedded commenters, deduped', () => {
    expect(
      commentParticipants({
        commenterUids: ['bob', 'dave'],
        comments: [{ uid: 'bob' }, { uid: 'carol' }],
      }).sort()
    ).toEqual(['bob', 'carol', 'dave'])
  })
})

describe('settlementAudience', () => {
  const memberUids = ['alice', 'bob', 'carol']

  it('notifies both parties when a third person records the payment', () => {
    // actorUid is the PAYER, not the clicker.
    const e = entry({
      action: 'settlement_recorded',
      actorUid: 'alice',
      targetPayeeUid: 'bob',
      recordedBy: 'carol',
    })
    expect(settlementAudience(e, memberUids).sort()).toEqual(['alice', 'bob'])
  })

  it('excludes the payer when the payer recorded it', () => {
    const e = entry({
      action: 'settlement_recorded',
      actorUid: 'alice',
      targetPayeeUid: 'bob',
      recordedBy: 'alice',
    })
    expect(settlementAudience(e, memberUids)).toEqual(['bob'])
  })

  it('excludes the payee when the payee recorded it', () => {
    const e = entry({
      action: 'settlement_recorded',
      actorUid: 'alice',
      targetPayeeUid: 'bob',
      recordedBy: 'bob',
    })
    expect(settlementAudience(e, memberUids)).toEqual(['alice'])
  })

  it('falls back to the payee alone on legacy entries with no recordedBy', () => {
    const e = entry({ action: 'settlement_recorded', actorUid: 'alice', targetPayeeUid: 'bob' })
    expect(settlementAudience(e, memberUids)).toEqual(['bob'])
  })

  it('drops a placeholder payee', () => {
    const e = entry({
      action: 'settlement_recorded',
      actorUid: 'alice',
      targetPayeeUid: 'ph_x1',
      recordedBy: 'alice',
    })
    expect(settlementAudience(e, memberUids)).toEqual([])
  })
})

describe('shouldPushEdit', () => {
  const T0 = 1_800_000_000_000 // fixed clock; Date.now() would make these flaky

  it('stays quiet while the expense is still fresh', () => {
    // The case this exists for: add it, spot the wrong amount, fix it.
    expect(
      shouldPushEdit({ editedAtMs: T0 + 40_000, expenseCreatedAtMs: T0 })
    ).toBe(false)
    expect(
      shouldPushEdit({ editedAtMs: T0 + EDIT_GRACE_MS - 1, expenseCreatedAtMs: T0 })
    ).toBe(false)
  })

  it('notifies once the expense has settled down', () => {
    expect(shouldPushEdit({ editedAtMs: T0 + EDIT_GRACE_MS, expenseCreatedAtMs: T0 })).toBe(true)
    expect(shouldPushEdit({ editedAtMs: T0 + 86_400_000, expenseCreatedAtMs: T0 })).toBe(true)
  })

  it('collapses a burst of edits into the first one', () => {
    const old = T0 - 86_400_000 // yesterday's expense, so grace is irrelevant
    // First edit of the day: nothing prior, so it goes out.
    expect(shouldPushEdit({ editedAtMs: T0, expenseCreatedAtMs: old })).toBe(true)
    // Three more corrections over the next few minutes: all silent.
    for (const gap of [30_000, 120_000, EDIT_DEBOUNCE_MS - 1]) {
      expect(
        shouldPushEdit({ editedAtMs: T0 + gap, expenseCreatedAtMs: old, priorEditAtMs: T0 })
      ).toBe(false)
    }
  })

  it('speaks up again once the burst is over', () => {
    const old = T0 - 86_400_000
    expect(
      shouldPushEdit({
        editedAtMs: T0 + EDIT_DEBOUNCE_MS,
        expenseCreatedAtMs: old,
        priorEditAtMs: T0,
      })
    ).toBe(true)
  })

  it('fails open on missing data', () => {
    // No createdAt (legacy or sheet-restored) and no prior edit: notify.
    expect(shouldPushEdit({ editedAtMs: T0 })).toBe(true)
    expect(shouldPushEdit({ editedAtMs: T0, priorEditAtMs: T0 - 86_400_000 })).toBe(true)
  })

  it('treats a backwards clock as fresh rather than ancient', () => {
    // Skew must not turn into "this expense is from the future, so notify".
    expect(shouldPushEdit({ editedAtMs: T0 - 5_000, expenseCreatedAtMs: T0 })).toBe(false)
  })

  it('applies grace even when a prior edit is long past', () => {
    // Both windows are checked; neither shadows the other.
    expect(
      shouldPushEdit({
        editedAtMs: T0 + 60_000,
        expenseCreatedAtMs: T0,
        priorEditAtMs: T0 - 86_400_000,
      })
    ).toBe(false)
  })
})

describe('allowsPush', () => {
  it('treats an absent doc and absent prefs as ON', () => {
    expect(allowsPush(undefined, 'expenses', 't1')).toBe(true)
    expect(allowsPush({}, 'expenses', 't1')).toBe(true)
    expect(allowsPush({ fcmTokens: ['t'] }, 'expenses', 't1')).toBe(true)
  })

  it('mutes only on an explicit false', () => {
    expect(allowsPush({ prefs: { expenses: false } }, 'expenses', 't1')).toBe(false)
    expect(allowsPush({ prefs: { expenses: true } }, 'expenses', 't1')).toBe(true)
    // Another kind being off must not affect this one.
    expect(allowsPush({ prefs: { comments: false } }, 'expenses', 't1')).toBe(true)
  })

  it('honors a per-trip mute', () => {
    expect(allowsPush({ mutedTrips: { t1: true } }, 'expenses', 't1')).toBe(false)
    expect(allowsPush({ mutedTrips: { t2: true } }, 'expenses', 't1')).toBe(true)
  })
})

describe('noteFor', () => {
  const ctx = { actorName: 'Alice', trip: TRIP }

  it('comment copy: text, GIF-only, and photo-only each say what happened', () => {
    const base = { action: 'comment_added' as const, targetDescription: 'Dinner' }
    expect(noteFor(entry(base), ctx)?.body).toBe('Alice commented on Dinner')
    expect(noteFor(entry({ ...base, commentMedia: 'gif' }), ctx)?.body).toBe(
      'Alice sent a GIF on Dinner'
    )
    expect(noteFor(entry({ ...base, commentMedia: 'photo' }), ctx)?.body).toBe(
      'Alice sent a photo on Dinner'
    )
  })

  it('titles with the trip name', () => {
    const n = noteFor(entry({ action: 'expense_added', targetDescription: 'Dinner', targetAmount: 40 }), ctx)
    expect(n).toEqual({ title: 'Tokyo', body: 'Alice added Dinner — $40.00' })
  })

  it('formats in the trip settlement currency, not USD', () => {
    const n = noteFor(
      entry({ action: 'expense_added', targetDescription: 'Ramen', targetAmount: 1200 }),
      { actorName: 'Alice', trip: { ...TRIP, settlementCurrency: 'JPY' } }
    )
    expect(n?.body).toBe('Alice added Ramen — ¥1,200')
  })

  it('omits the amount when absent rather than printing NaN', () => {
    const n = noteFor(entry({ action: 'expense_added', targetDescription: 'Dinner' }), ctx)
    expect(n?.body).toBe('Alice added Dinner')
  })

  it('includes the payment method on settlements when present', () => {
    const base = { action: 'settlement_recorded' as const, targetDescription: 'Alice → Bob', targetAmount: 50 }
    expect(noteFor(entry({ ...base, paymentMethod: 'Venmo' }), ctx)?.body).toBe(
      '💸 Alice → Bob — $50.00 via Venmo'
    )
    expect(noteFor(entry(base), ctx)?.body).toBe('💸 Alice → Bob — $50.00')
  })

  it('says "you" to the person actually removed', () => {
    const e = entry({ action: 'member_removed', targetMemberUid: 'dave' })
    expect(noteFor(e, { ...ctx, recipientUid: 'dave' })?.body).toBe('Alice removed you from the trip')
    expect(noteFor(e, { ...ctx, recipientUid: 'bob' })?.body).toBe(
      'Alice removed someone from the trip'
    )
  })

  it('uses group wording for a group', () => {
    const n = noteFor(entry({ action: 'member_joined' }), {
      actorName: 'Alice',
      trip: { ...TRIP, type: 'group' },
    })
    expect(n?.body).toBe('Alice joined the group')
  })

  it('addresses the invitee personally but tells members who was invited', () => {
    const e = entry({ action: 'member_invited', targetDescription: 'dave@example.com' })
    expect(noteFor(e, { ...ctx, recipientUid: 'dave', inviteeUid: 'dave' })).toEqual({
      title: 'Invited to Tokyo',
      body: 'Alice invited you to split expenses',
    })
    // Every existing member also "isn't the actor" — identity must come from
    // the resolved invitee uid, not from that.
    expect(noteFor(e, { ...ctx, recipientUid: 'bob', inviteeUid: 'dave' })?.body).toBe(
      'Alice invited dave@example.com'
    )
  })

  it('tells members plainly when the invited email has no account', () => {
    const e = entry({ action: 'member_invited', targetDescription: 'nobody@example.com' })
    expect(noteFor(e, { ...ctx, recipientUid: 'bob' })?.body).toBe(
      'Alice invited nobody@example.com'
    )
  })

  it('returns null for the silent actions', () => {
    for (const action of ['trip_created', 'trip_renamed', 'trip_restored', 'currency_changed', 'invite_rescinded'] as const) {
      expect(noteFor(entry({ action }), ctx)).toBeNull()
    }
  })

  it('produces copy for every action that has a kind', () => {
    // The two tables have to agree. An action routed to a kind but missing
    // from noteFor would compute an audience, resolve names, and then deliver
    // nothing — silent, and invisible in the logs.
    for (const [action, kind] of Object.entries(KIND_BY_ACTION)) {
      if (!kind) continue
      const note = noteFor(entry({ action: action as ActivityAction }), ctx)
      expect(note, `no copy for ${action}`).not.toBeNull()
      expect(note!.title.length, `empty title for ${action}`).toBeGreaterThan(0)
      expect(note!.body.length, `empty body for ${action}`).toBeGreaterThan(0)
    }
  })
})

describe('linkFor', () => {
  const ctx = { tripId: 't1', trip: TRIP }

  it('deep-links to the expense when there is one', () => {
    expect(linkFor(entry({ action: 'expense_added', targetExpenseId: 'e9' }), ctx)).toBe(
      '/trip/t1/expense/e9'
    )
    expect(linkFor(entry({ action: 'comment_added', targetExpenseId: 'e9' }), ctx)).toBe(
      '/trip/t1/expense/e9'
    )
  })

  it('sends a deleted expense to the trip, not a 404 detail page', () => {
    expect(linkFor(entry({ action: 'expense_deleted', targetExpenseId: 'e9' }), ctx)).toBe('/trip/t1')
  })

  it('falls back to the trip when the expense id is missing', () => {
    expect(linkFor(entry({ action: 'expense_added' }), ctx)).toBe('/trip/t1')
  })

  it('sends an invitee to the join link — they cannot read the trip yet', () => {
    const e = entry({ action: 'member_invited' })
    expect(linkFor(e, { ...ctx, recipientUid: 'dave', inviteeUid: 'dave' })).toBe('/join/abc123')
    expect(linkFor(e, { ...ctx, recipientUid: 'bob', inviteeUid: 'dave' })).toBe('/trip/t1')
  })

  it('sends members to the trip when the trip has no invite code', () => {
    const e = entry({ action: 'member_invited' })
    expect(
      linkFor(e, { tripId: 't1', trip: { ...TRIP, inviteCode: undefined }, recipientUid: 'dave', inviteeUid: 'dave' })
    ).toBe('/trip/t1')
  })

  it('sends a removed member home, and everyone else to the trip', () => {
    const e = entry({ action: 'member_removed', targetMemberUid: 'dave' })
    expect(linkFor(e, { ...ctx, recipientUid: 'dave' })).toBe('/')
    expect(linkFor(e, { ...ctx, recipientUid: 'bob' })).toBe('/trip/t1')
  })

  it('sends a deleted trip home', () => {
    expect(linkFor(entry({ action: 'trip_deleted' }), ctx)).toBe('/')
  })
})
