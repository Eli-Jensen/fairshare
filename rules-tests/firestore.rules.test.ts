/**
 * Firestore security-rules tests. Run via `npm run test:rules` — the
 * firestore emulator hosts the rules engine (firebase emulators:exec), so
 * these never run in plain `npm test` (vite.config.ts scopes that include).
 *
 * These lock in the invariants the app's security model hangs on:
 *  - the FCM-token boundary (/users/x/private/* is owner-only)
 *  - no profile or invite-code enumeration (list denied everywhere)
 *  - the self-join contract — adding yourself requires echoing the CURRENT
 *    invite code, which is what makes "Regenerate invite link" a revocation
 *  - the both-trips check on invite-code repointing (code capture)
 *  - membership gating on expenses/activity, including "email invitee can
 *    read the trip doc but NOT its expenses"
 *  - the purge-order property: subcollection deletes stop working the moment
 *    the trip doc is gone, which is why purgeTrip deletes it last
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteField,
} from 'firebase/firestore'

const PROJECT = 'demo-fairshare'
const ALICE = 'alice-uid'
const BOB = 'bob-uid'
const CAROL = 'carol-uid' // member of trip2 only — the "member of ANOTHER trip" persona
const STRANGER = 'stranger-uid'
const INVITEE_EMAIL = 'invitee@example.com'

const TRIP = 'trip1'
const TRIP2 = 'trip2'
const CODE = 'CODE123'
const CODE2 = 'CODE456'

let env: RulesTestEnvironment

const as = (uid: string, claims?: Record<string, unknown>) =>
  env.authenticatedContext(uid, claims).firestore()
const alice = () => as(ALICE)
const bob = () => as(BOB)
const carol = () => as(CAROL)
const stranger = () => as(STRANGER)
// Google hands back token emails verbatim, capitals included — the rules
// lower() both sides, and this persona is what proves it.
const inviteeMixedCase = () => as('invitee-uid', { email: 'InViTee@Example.COM' })
const unauthed = () => env.unauthenticatedContext().firestore()

const tripPath = `trips/${TRIP}`

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

afterAll(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, tripPath), {
      name: 'Tokyo',
      createdBy: ALICE,
      memberUids: [ALICE, BOB],
      invitedEmails: [INVITEE_EMAIL],
      inviteCode: CODE,
    })
    await setDoc(doc(db, `trips/${TRIP2}`), {
      name: 'Lisbon',
      createdBy: CAROL,
      memberUids: [CAROL],
      inviteCode: CODE2,
    })
    await setDoc(doc(db, `inviteCodes/${CODE}`), { tripId: TRIP, type: 'trip' })
    await setDoc(doc(db, `inviteCodes/${CODE2}`), { tripId: TRIP2, type: 'trip' })
    await setDoc(doc(db, `users/${ALICE}`), { displayName: 'Alice', email: 'alice@x.dev' })
    await setDoc(doc(db, `users/${ALICE}/private/push`), { fcmTokens: ['tok-a'] })
    await setDoc(doc(db, `${tripPath}/expenses/e1`), {
      description: 'Dinner',
      amount: 40,
      paidBy: ALICE,
      splits: { [ALICE]: 20, [BOB]: 20 },
    })
    await setDoc(doc(db, `${tripPath}/activity/a1`), {
      action: 'expense_added',
      actorUid: ALICE,
    })
  })
})

// ── /users ──────────────────────────────────────────────────────────────────

describe('user profiles', () => {
  it('any signed-in user may fetch a profile by uid', async () => {
    await assertSucceeds(getDoc(doc(bob(), `users/${ALICE}`)))
    await assertSucceeds(getDoc(doc(stranger(), `users/${ALICE}`)))
  })

  it('unauthenticated read is denied', async () => {
    await assertFails(getDoc(doc(unauthed(), `users/${ALICE}`)))
  })

  it('list is denied — no dumping every user email', async () => {
    await assertFails(getDocs(collection(stranger(), 'users')))
  })

  it('only the owner writes their profile', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), `users/${ALICE}`), { displayName: 'A!' }, { merge: true })
    )
    await assertFails(
      setDoc(doc(bob(), `users/${ALICE}`), { displayName: 'gotcha' }, { merge: true })
    )
  })
})

describe('private subcollection (the FCM-token boundary)', () => {
  it('owner reads and writes', async () => {
    await assertSucceeds(getDoc(doc(alice(), `users/${ALICE}/private/push`)))
    await assertSucceeds(
      setDoc(doc(alice(), `users/${ALICE}/private/push`), { prefs: {} }, { merge: true })
    )
  })

  it('any OTHER signed-in user is denied — tokens must never leak', async () => {
    await assertFails(getDoc(doc(bob(), `users/${ALICE}/private/push`)))
    await assertFails(getDoc(doc(stranger(), `users/${ALICE}/private/push`)))
    await assertFails(
      setDoc(doc(bob(), `users/${ALICE}/private/push`), { fcmTokens: ['evil'] })
    )
  })
})

// ── /inviteCodes ────────────────────────────────────────────────────────────

describe('invite codes', () => {
  it('any signed-in user may resolve a code they hold', async () => {
    await assertSucceeds(getDoc(doc(stranger(), `inviteCodes/${CODE}`)))
  })

  it('unauthenticated resolution and enumeration are denied', async () => {
    await assertFails(getDoc(doc(unauthed(), `inviteCodes/${CODE}`)))
    await assertFails(getDocs(collection(stranger(), 'inviteCodes')))
  })

  it('create requires membership of the referenced trip', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'inviteCodes/NEW1'), { tripId: TRIP, type: 'trip' })
    )
    await assertFails(
      setDoc(doc(stranger(), 'inviteCodes/NEW2'), { tripId: TRIP, type: 'trip' })
    )
  })

  it('repointing a code requires membership of BOTH trips (code capture)', async () => {
    // Carol is a member of trip2 but not trip1 — repointing trip1's code at
    // her own trip would capture Alice's invitees.
    await assertFails(updateDoc(doc(carol(), `inviteCodes/${CODE}`), { tripId: TRIP2 }))
    // And a trip1 member can't steal trip2's code either.
    await assertFails(updateDoc(doc(alice(), `inviteCodes/${CODE2}`), { tripId: TRIP }))
  })

  it('delete is gated on membership of the referenced trip', async () => {
    await assertSucceeds(deleteDoc(doc(alice(), `inviteCodes/${CODE}`)))
  })

  it('non-member cannot delete a code', async () => {
    await assertFails(deleteDoc(doc(stranger(), `inviteCodes/${CODE}`)))
  })
})

// ── /trips: create + read ───────────────────────────────────────────────────

describe('trip create', () => {
  it('allowed only as yourself, alone', async () => {
    await assertSucceeds(
      setDoc(doc(stranger(), 'trips/new1'), {
        name: 'Solo',
        createdBy: STRANGER,
        memberUids: [STRANGER],
      })
    )
  })

  it('cannot pre-add someone else to memberUids', async () => {
    await assertFails(
      setDoc(doc(stranger(), 'trips/new2'), {
        name: 'Sneaky',
        createdBy: STRANGER,
        memberUids: [STRANGER, ALICE],
      })
    )
  })

  it('cannot claim someone else created it', async () => {
    await assertFails(
      setDoc(doc(stranger(), 'trips/new3'), {
        name: 'Forged',
        createdBy: ALICE,
        memberUids: [STRANGER],
      })
    )
  })
})

describe('trip read', () => {
  it('member reads; stranger does not', async () => {
    await assertSucceeds(getDoc(doc(alice(), tripPath)))
    await assertFails(getDoc(doc(stranger(), tripPath)))
  })

  it('email invitee reads — even with a mixed-case token email', async () => {
    await assertSucceeds(getDoc(doc(inviteeMixedCase(), tripPath)))
  })

  it('a signed-in user with a different email is not an invitee', async () => {
    const other = as('other-uid', { email: 'other@example.com' })
    await assertFails(getDoc(doc(other, tripPath)))
  })
})

// ── Self-join: the invite-link security core ────────────────────────────────

describe('self-join via invite link', () => {
  const joiner = () => as('joiner-uid')

  it('adding exactly yourself + echoing the live code succeeds', async () => {
    await assertSucceeds(
      updateDoc(doc(joiner(), tripPath), {
        memberUids: [ALICE, BOB, 'joiner-uid'],
        joinedWith: CODE,
      })
    )
  })

  it('a stale code is refused — regenerating the link is a real revocation', async () => {
    await assertFails(
      updateDoc(doc(joiner(), tripPath), {
        memberUids: [ALICE, BOB, 'joiner-uid'],
        joinedWith: 'OLD_CODE',
      })
    )
  })

  it('no code echo, no join', async () => {
    await assertFails(
      updateDoc(doc(joiner(), tripPath), {
        memberUids: [ALICE, BOB, 'joiner-uid'],
      })
    )
  })

  it('cannot smuggle someone else in', async () => {
    await assertFails(
      updateDoc(doc(joiner(), tripPath), {
        memberUids: [ALICE, BOB, 'joiner-uid', 'friend-uid'],
        joinedWith: CODE,
      })
    )
  })

  it('cannot remove an existing member on the way in', async () => {
    await assertFails(
      updateDoc(doc(joiner(), tripPath), {
        memberUids: [ALICE, 'joiner-uid'], // BOB dropped
        joinedWith: CODE,
      })
    )
  })

  it('cannot touch other fields in the same update', async () => {
    await assertFails(
      updateDoc(doc(joiner(), tripPath), {
        memberUids: [ALICE, BOB, 'joiner-uid'],
        joinedWith: CODE,
        name: 'Hijacked',
      })
    )
  })
})

describe('email invitee join-or-decline', () => {
  it('invitee may join, clearing their invite', async () => {
    await assertSucceeds(
      updateDoc(doc(inviteeMixedCase(), tripPath), {
        memberUids: [ALICE, BOB, 'invitee-uid'],
        invitedEmails: [],
      })
    )
  })

  it('invitee may decline (email removal only)', async () => {
    await assertSucceeds(
      updateDoc(doc(inviteeMixedCase(), tripPath), { invitedEmails: [] })
    )
  })

  it('invitee cannot touch anything else', async () => {
    await assertFails(
      updateDoc(doc(inviteeMixedCase(), tripPath), {
        memberUids: [ALICE, BOB, 'invitee-uid'],
        invitedEmails: [],
        name: 'Mine now',
      })
    )
  })
})

describe('trip update/delete by members', () => {
  it('member updates ordinary fields', async () => {
    await assertSucceeds(updateDoc(doc(alice(), tripPath), { name: 'Tokyo 2026' }))
  })

  it('non-member cannot update or delete', async () => {
    await assertFails(updateDoc(doc(stranger(), tripPath), { name: 'nope' }))
    await assertFails(deleteDoc(doc(stranger(), tripPath)))
  })

  it('member may delete the trip doc', async () => {
    await assertSucceeds(deleteDoc(doc(alice(), tripPath)))
  })
})

// ── Expenses + activity: membership is the boundary ─────────────────────────

describe('expenses', () => {
  it('members read and write', async () => {
    await assertSucceeds(getDoc(doc(bob(), `${tripPath}/expenses/e1`)))
    await assertSucceeds(
      updateDoc(doc(bob(), `${tripPath}/expenses/e1`), { notes: 'yum' })
    )
    await assertSucceeds(
      setDoc(doc(alice(), `${tripPath}/expenses/e2`), {
        description: 'Taxi',
        amount: 12,
        paidBy: ALICE,
        splits: { [ALICE]: 12 },
      })
    )
  })

  it('soft delete and restore are member writes', async () => {
    await assertSucceeds(
      updateDoc(doc(alice(), `${tripPath}/expenses/e1`), { deletedAt: new Date() })
    )
    await assertSucceeds(
      updateDoc(doc(alice(), `${tripPath}/expenses/e1`), { deletedAt: deleteField() })
    )
  })

  it('strangers get nothing', async () => {
    await assertFails(getDoc(doc(stranger(), `${tripPath}/expenses/e1`)))
    await assertFails(
      updateDoc(doc(stranger(), `${tripPath}/expenses/e1`), { amount: 0 })
    )
    await assertFails(getDocs(collection(stranger(), `${tripPath}/expenses`)))
  })

  it('an email invitee can read the trip doc but NOT its expenses', async () => {
    // Locked in deliberately: invitees see the invitation, not the money.
    await assertSucceeds(getDoc(doc(inviteeMixedCase(), tripPath)))
    await assertFails(getDoc(doc(inviteeMixedCase(), `${tripPath}/expenses/e1`)))
    await assertFails(getDocs(collection(inviteeMixedCase(), `${tripPath}/expenses`)))
  })
})

describe('activity log', () => {
  it('members read and write; strangers denied', async () => {
    await assertSucceeds(getDoc(doc(bob(), `${tripPath}/activity/a1`)))
    await assertSucceeds(
      setDoc(doc(bob(), `${tripPath}/activity/a2`), {
        action: 'expense_edited',
        actorUid: BOB,
      })
    )
    await assertFails(getDoc(doc(stranger(), `${tripPath}/activity/a1`)))
    await assertFails(
      setDoc(doc(stranger(), `${tripPath}/activity/a3`), {
        action: 'expense_added',
        actorUid: STRANGER,
      })
    )
  })
})

// ── Comments subcollection (the social layer) ───────────────────────────────

describe('comments', () => {
  const cPath = (cid: string) => `${tripPath}/expenses/e1/comments/${cid}`

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), cPath('c-alice')), {
        authorUid: ALICE,
        text: 'great dinner',
        createdAt: new Date(),
      })
    })
  })

  it('member creates a comment as themselves', async () => {
    await assertSucceeds(
      setDoc(doc(bob(), cPath('c-bob')), {
        authorUid: BOB,
        text: 'agreed!',
        createdAt: new Date(),
      })
    )
  })

  it('cannot forge someone else as the author', async () => {
    await assertFails(
      setDoc(doc(bob(), cPath('c-forged')), {
        authorUid: ALICE,
        text: 'I said this',
        createdAt: new Date(),
      })
    )
  })

  it('strangers cannot create or read', async () => {
    await assertFails(
      setDoc(doc(stranger(), cPath('c-x')), {
        authorUid: STRANGER,
        text: 'hi',
        createdAt: new Date(),
      })
    )
    await assertFails(getDoc(doc(stranger(), cPath('c-alice'))))
    await assertFails(getDocs(collection(stranger(), `${tripPath}/expenses/e1/comments`)))
  })

  it('member reads and lists', async () => {
    await assertSucceeds(getDoc(doc(bob(), cPath('c-alice'))))
    await assertSucceeds(getDocs(collection(bob(), `${tripPath}/expenses/e1/comments`)))
  })

  it('text bounds: 501 chars and empty string both refused', async () => {
    await assertFails(
      setDoc(doc(bob(), cPath('c-long')), {
        authorUid: BOB,
        text: 'x'.repeat(501),
        createdAt: new Date(),
      })
    )
    await assertFails(
      setDoc(doc(bob(), cPath('c-empty')), {
        authorUid: BOB,
        text: '',
        createdAt: new Date(),
      })
    )
  })

  it('content required — but a GIF alone is content', async () => {
    await assertFails(
      setDoc(doc(bob(), cPath('c-nothing')), { authorUid: BOB, createdAt: new Date() })
    )
    await assertSucceeds(
      setDoc(doc(bob(), cPath('c-gif')), {
        authorUid: BOB,
        gifUrl: 'https://cdn.example/g.gif',
        gifWidth: 200,
        gifHeight: 150,
        createdAt: new Date(),
      })
    )
  })

  it('author edits their own text', async () => {
    await assertSucceeds(
      updateDoc(doc(alice(), cPath('c-alice')), { text: 'GREAT dinner', editedAt: new Date() })
    )
  })

  it('non-author cannot edit the text', async () => {
    await assertFails(updateDoc(doc(bob(), cPath('c-alice')), { text: 'terrible dinner' }))
  })

  it('authorUid is immutable — no laundering', async () => {
    await assertFails(updateDoc(doc(alice(), cPath('c-alice')), { authorUid: BOB }))
  })

  it('non-author may toggle exactly their own reaction key', async () => {
    await assertSucceeds(
      updateDoc(doc(bob(), cPath('c-alice')), { [`reactions.${BOB}`]: '😂' })
    )
    await assertFails(
      updateDoc(doc(bob(), cPath('c-alice')), { [`reactions.${ALICE}`]: '💀' })
    )
    // …and cannot smuggle a text edit into the reaction patch
    await assertFails(
      updateDoc(doc(bob(), cPath('c-alice')), { [`reactions.${BOB}`]: '😂', text: 'sneaky' })
    )
  })

  it('any member may delete (Trash/trip purge run as whoever triggers them)', async () => {
    await assertSucceeds(deleteDoc(doc(bob(), cPath('c-alice'))))
  })

  it('strangers cannot delete', async () => {
    await assertFails(deleteDoc(doc(stranger(), cPath('c-alice'))))
  })
})

describe('expense social fields ride the wholesale member rule', () => {
  it('member patches own reaction key on the expense doc', async () => {
    await assertSucceeds(
      updateDoc(doc(bob(), `${tripPath}/expenses/e1`), { [`reactions.${BOB}`]: '👍' })
    )
  })

  it('member moves the comment denorms (the writeBatch shape)', async () => {
    await assertSucceeds(
      updateDoc(doc(bob(), `${tripPath}/expenses/e1`), {
        commentCount: 1,
        commenterUids: [BOB],
      })
    )
  })

  it('stranger gets nothing, reactions included', async () => {
    await assertFails(
      updateDoc(doc(stranger(), `${tripPath}/expenses/e1`), {
        [`reactions.${STRANGER}`]: '🔥',
      })
    )
  })
})

// ── Purge order ─────────────────────────────────────────────────────────────

describe('purge order', () => {
  it('once the trip doc is gone, even ex-members lose the subcollections', async () => {
    // purgeTrip deletes expenses → activity → invite code → trip doc LAST,
    // because every subcollection rule does a get() on the trip doc. This
    // test is the reason that ordering must never change.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), tripPath))
    })
    await assertFails(deleteDoc(doc(alice(), `${tripPath}/expenses/e1`)))
    await assertFails(getDoc(doc(alice(), `${tripPath}/expenses/e1`)))
  })
})
