import { Timestamp } from 'firebase/firestore'
import type { Expense, Trip, UserProfile } from '../types'
import { parseDateString } from '../dates'

/**
 * The trip the sheet round-trip test exercises. Deliberately awkward: every
 * split type, a multi-payer expense, a foreign currency with a non-1 rate, a
 * settlement, a guest with no email, a removed member who still owes money, a
 * zero share, and text that could break a CSV or be autocorrected by Sheets.
 */

const ts = (ymd: string) => Timestamp.fromDate(parseDateString(ymd))

export const PARTICIPANTS = ['alice', 'bob', 'ph_guest', 'ph_noemail']

export function membersFixture(): Record<string, UserProfile> {
  return {
    alice: {
      uid: 'alice',
      displayName: 'Alice',
      email: 'alice@test.com',
      photoURL: null,
    },
    bob: { uid: 'bob', displayName: 'Bob', email: 'bob@test.com', photoURL: null },
    ph_guest: {
      uid: 'ph_guest',
      displayName: 'guest@test.com',
      email: 'guest@test.com',
      photoURL: null,
      isPlaceholder: true,
    },
    // A guest restored from an earlier backup: a name, but no email to claim on
    ph_noemail: {
      uid: 'ph_noemail',
      displayName: 'Dana',
      email: '',
      photoURL: null,
      isPlaceholder: true,
    },
    carol: {
      uid: 'carol',
      displayName: 'Carol',
      email: 'carol@test.com',
      photoURL: null,
    },
  }
}

export function tripFixture(): Trip {
  return {
    id: 'trip1',
    name: 'Italy 2026',
    type: 'trip',
    createdBy: 'alice',
    memberUids: ['alice', 'bob'],
    inviteCode: 'ABCD1234',
    invitedEmails: ['guest@test.com'],
    settlementCurrency: 'USD',
    createdAt: ts('2026-06-01'),
    customCategories: [{ id: 'gelato', label: 'Gelato', emoji: '🍨' }],
    placeholderMembers: [
      {
        id: 'ph_guest',
        email: 'guest@test.com',
        createdBy: 'alice',
        createdAt: ts('2026-06-02'),
      },
      {
        id: 'ph_noemail',
        email: '',
        name: 'Dana',
        createdBy: 'alice',
        createdAt: ts('2026-06-02'),
      },
    ],
    removedMembers: [
      {
        uid: 'carol',
        email: 'carol@test.com',
        displayName: 'Carol',
        removedAt: ts('2026-06-20'),
      },
    ],
  }
}

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: 'e0',
    description: 'Something',
    amount: 10,
    currency: 'USD',
    exchangeRate: 1,
    amountSettled: 10,
    paidBy: 'alice',
    splitType: 'exact',
    splits: { alice: 10 },
    createdBy: 'alice',
    createdAt: ts('2026-06-10'),
    date: ts('2026-06-10'),
    ...overrides,
  }
}

export function expensesFixture(): Expense[] {
  return [
    // Equal split, four ways
    expense({
      id: 'e1',
      description: 'Lunch',
      amount: 60,
      amountSettled: 60,
      date: ts('2026-06-10'),
      splitType: 'equal',
      splits: { alice: 15, bob: 15, ph_guest: 15, ph_noemail: 15 },
      categories: ['food'],
    }),
    // Multi-payer
    expense({
      id: 'e2',
      description: 'Hotel',
      amount: 500,
      amountSettled: 500,
      date: ts('2026-06-11'),
      paidBy: 'alice',
      paidByAmounts: { alice: 300, bob: 200 },
      splitType: 'equal',
      splits: { alice: 125, bob: 125, ph_guest: 125, ph_noemail: 125 },
      categories: ['accommodation'],
      notes: 'Two rooms, "sea view", 3 nights\nbreakfast included',
    }),
    // Foreign currency with a non-1 rate, and a share of exactly zero
    expense({
      id: 'e3',
      description: 'Wine',
      amount: 40,
      currency: 'EUR',
      exchangeRate: 1.1,
      amountSettled: 44,
      date: ts('2026-06-12'),
      paidBy: 'bob',
      splitType: 'exact',
      splits: { alice: 22, bob: 22, ph_noemail: 0 },
      categories: ['gelato'],
    }),
    // Percentage split
    expense({
      id: 'e4',
      description: 'Boat tour',
      amount: 200,
      amountSettled: 200,
      date: ts('2026-06-13'),
      paidBy: 'ph_guest',
      splitType: 'percentage',
      splits: { alice: 100, bob: 50, ph_guest: 50 },
    }),
    // Shares split, 2:1:1
    expense({
      id: 'e5',
      description: 'Villa deposit',
      amount: 400,
      amountSettled: 400,
      date: ts('2026-06-14'),
      splitType: 'shares',
      splits: { alice: 200, bob: 100, ph_guest: 100 },
    }),
    // A removed member who still owes — dropping them unbalances the books
    expense({
      id: 'e6',
      description: 'Train tickets',
      amount: 90,
      amountSettled: 90,
      date: ts('2026-06-15'),
      paidBy: 'alice',
      splitType: 'equal',
      splits: { alice: 30, bob: 30, carol: 30 },
      categories: ['transport'],
    }),
    // Odd cents: 100 / 3 forces the largest-remainder path
    expense({
      id: 'e7',
      description: 'Taxi',
      amount: 100,
      amountSettled: 100,
      date: ts('2026-06-16'),
      paidBy: 'bob',
      splitType: 'equal',
      splits: { alice: 33.34, bob: 33.33, ph_guest: 33.33 },
    }),
    // Text that must survive verbatim: a leading '=' would become a formula if
    // the sheet were written with USER_ENTERED
    expense({
      id: 'e8',
      description: '=SUM(A1:A9) souvenir shop',
      amount: 25,
      amountSettled: 25,
      date: ts('2026-06-17'),
      splitType: 'exact',
      splits: { alice: 25 },
      notes: 'Receipt #12, 3/4 off — see photo 🧾',
    }),
    // Multiple categories
    expense({
      id: 'e9',
      description: 'Dinner and show',
      amount: 180,
      amountSettled: 180,
      date: ts('2026-06-18'),
      paidBy: 'alice',
      splitType: 'exact',
      splits: { alice: 60, bob: 60, ph_guest: 60 },
      categories: ['food', 'entertainment'],
    }),
    // A legacy category id that no longer appears in the picker
    expense({
      id: 'e10',
      description: 'Pharmacy',
      amount: 30,
      amountSettled: 30,
      date: ts('2026-06-19'),
      paidBy: 'bob',
      splitType: 'exact',
      splits: { bob: 15, ph_noemail: 15 },
      categories: ['health'],
    }),
    // A negative-looking description that must not be read as a number
    expense({
      id: 'e11',
      description: '-15 refund adjustment',
      amount: 15,
      amountSettled: 15,
      date: ts('2026-06-20'),
      paidBy: 'ph_noemail',
      splitType: 'exact',
      splits: { alice: 15 },
    }),
    // A settlement: stored as an expense, one payer, one payee
    expense({
      id: 'e12',
      description: 'Bob paid Alice via Venmo',
      amount: 50,
      amountSettled: 50,
      date: ts('2026-06-21'),
      paidBy: 'bob',
      splitType: 'exact',
      splits: { alice: 50 },
      isSettlement: true,
    }),
  ]
}
