import type { Expense, UserProfile, CustomCategory, RemovedMember } from './types'
import { formatMoney, getMemberName, getCategoryInfo, DEFAULT_CURRENCY } from './types'
import { formatDateOnly } from './dates'
import { computeBalances, simplifyDebts } from './settlement'

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function tripToCsv(
  tripName: string,
  expenses: Expense[],
  members: Record<string, UserProfile>,
  memberUids: string[],
  settlementCurrency: string = DEFAULT_CURRENCY,
  customCategories?: CustomCategory[],
  removedMembers?: RemovedMember[]
): string {
  const fmt = (n: number) => formatMoney(n, settlementCurrency)
  const lines: string[] = []

  // Removed members who paid or owe still belong in the books — otherwise
  // the exported balances don't sum to zero
  const involved = new Set<string>()
  for (const exp of expenses) {
    involved.add(exp.paidBy)
    for (const uid of Object.keys(exp.splits)) involved.add(uid)
    for (const uid of Object.keys(exp.paidByAmounts ?? {})) involved.add(uid)
  }
  const extraUids = Array.from(involved).filter((u) => !memberUids.includes(u))
  const columnUids = [...memberUids, ...extraUids]

  function nameFor(uid: string): string {
    if (members[uid]) {
      const n = getMemberName(uid, members)
      return memberUids.includes(uid) ? n : `${n} (removed)`
    }
    const rm = removedMembers?.find((r) => r.uid === uid)
    if (rm) return `${rm.displayName || rm.email} (removed)`
    return uid
  }

  // Header
  lines.push(`Trip: ${escapeCsv(tripName)}`)
  lines.push('')

  // Expenses table
  const memberNames = columnUids.map(nameFor)
  lines.push(
    [
      'Date',
      'Type',
      'Category',
      'Description',
      'Notes',
      'Amount (' + settlementCurrency + ')',
      'Currency',
      'Original Amount',
      'Paid By',
      'Split Type',
      ...memberNames.map((n) => `${n}'s share`),
    ]
      .map(escapeCsv)
      .join(',')
  )

  for (const exp of expenses) {
    const payer = exp.paidByAmounts && Object.keys(exp.paidByAmounts).length > 1
      ? Object.entries(exp.paidByAmounts)
          .map(([uid, amt]) => `${nameFor(uid)} ${fmt(amt)}`)
          .join(' + ')
      : nameFor(exp.paidBy)
    const shares = columnUids.map((uid) =>
      exp.splits[uid] !== undefined ? fmt(exp.splits[uid]) : ''
    )
    const cats = (exp.categories && exp.categories.length > 0)
      ? exp.categories
      : exp.category ? [exp.category] : []
    const catLabel = cats
      .map((c) => getCategoryInfo(c, customCategories)?.label)
      .filter(Boolean)
      .join(', ')
    lines.push(
      [
        formatDateOnly(exp.date, 'en-US'),
        exp.isSettlement ? 'Settlement' : 'Expense',
        catLabel,
        exp.description,
        exp.notes ?? '',
        fmt(exp.amountSettled),
        exp.currency,
        exp.currency !== settlementCurrency ? `${exp.amount}` : '',
        payer,
        exp.splitType,
        ...shares,
      ]
        .map(escapeCsv)
        .join(',')
    )
  }

  // Total row (expenses only, exclude settlements)
  const expensesOnly = expenses.filter((e) => !e.isSettlement)
  const total = expensesOnly.reduce((s, e) => s + e.amountSettled, 0)
  const pad = columnUids.map(() => '')
  lines.push(
    ['', '', '', 'TOTAL (expenses)', '', fmt(total), '', '', '', '', ...pad]
      .map(escapeCsv)
      .join(',')
  )

  lines.push('')
  lines.push('')

  // Per-person spending
  lines.push('Per-Person Spending')
  lines.push(['Person', 'Total Paid'].map(escapeCsv).join(','))
  for (const uid of columnUids) {
    let spent = 0
    for (const exp of expensesOnly) {
      if (exp.paidByAmounts && Object.keys(exp.paidByAmounts).length > 0) {
        spent += exp.paidByAmounts[uid] ?? 0
      } else if (exp.paidBy === uid) {
        spent += exp.amountSettled
      }
    }
    lines.push([nameFor(uid), fmt(spent)].map(escapeCsv).join(','))
  }

  lines.push('')

  // Balances
  lines.push('Balances')
  lines.push(['Person', 'Balance'].map(escapeCsv).join(','))
  const balances = computeBalances(expenses, memberUids)
  for (const uid of columnUids) {
    const bal = balances[uid] ?? 0
    lines.push([nameFor(uid), fmt(bal)].map(escapeCsv).join(','))
  }

  lines.push('')

  // Remaining settlements
  lines.push('Remaining Settlements')
  lines.push(['From', 'To', 'Amount'].map(escapeCsv).join(','))
  const debts = simplifyDebts(balances)
  for (const d of debts) {
    lines.push(
      [nameFor(d.from), nameFor(d.to), fmt(d.amount)].map(escapeCsv).join(',')
    )
  }

  return lines.join('\n')
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function openInGoogleSheets(csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'fairshare-export.csv'
  link.click()
  URL.revokeObjectURL(url)

  setTimeout(() => {
    window.open('https://sheets.google.com/create', '_blank')
  }, 500)
}
