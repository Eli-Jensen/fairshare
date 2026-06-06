import type { Expense, UserProfile } from './types'
import { formatUSD, getMemberName } from './types'
import { computeBalances, simplifyDebts } from './settlement'

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function formatDate(ts: import('firebase/firestore').Timestamp): string {
  if (!ts?.toDate) return ''
  return ts.toDate().toLocaleDateString('en-US')
}

export function tripToCsv(
  tripName: string,
  expenses: Expense[],
  members: Record<string, UserProfile>,
  memberUids: string[]
): string {
  const lines: string[] = []

  // Header
  lines.push(`Trip: ${escapeCsv(tripName)}`)
  lines.push('')

  // Expenses table
  const memberNames = memberUids.map(
    (uid) => getMemberName(uid, members)
  )
  lines.push(
    [
      'Date',
      'Description',
      'Amount (USD)',
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
          .map(([uid, amt]) => `${getMemberName(uid, members)} ${formatUSD(amt)}`)
          .join(' + ')
      : getMemberName(exp.paidBy, members)
    const shares = memberUids.map((uid) =>
      exp.splits[uid] !== undefined ? formatUSD(exp.splits[uid]) : ''
    )
    lines.push(
      [
        formatDate(exp.date),
        exp.description,
        formatUSD(exp.amountUSD),
        exp.currency,
        exp.currency !== 'USD' ? `${exp.amount}` : '',
        payer,
        exp.splitType,
        ...shares,
      ]
        .map(escapeCsv)
        .join(',')
    )
  }

  // Total row
  const total = expenses.reduce((s, e) => s + e.amountUSD, 0)
  lines.push(
    ['', 'TOTAL', formatUSD(total), '', '', '', '', ...memberUids.map(() => '')]
      .map(escapeCsv)
      .join(',')
  )

  lines.push('')
  lines.push('')

  // Balances
  lines.push('Balances')
  lines.push(['Person', 'Balance'].map(escapeCsv).join(','))
  const balances = computeBalances(expenses, memberUids)
  for (const uid of memberUids) {
    const name = getMemberName(uid, members)
    const bal = balances[uid] ?? 0
    lines.push([name, formatUSD(bal)].map(escapeCsv).join(','))
  }

  lines.push('')

  // Settlements
  lines.push('Settlements')
  lines.push(['From', 'To', 'Amount'].map(escapeCsv).join(','))
  const debts = simplifyDebts(balances)
  for (const d of debts) {
    lines.push(
      [
        getMemberName(d.from, members),
        getMemberName(d.to, members),
        formatUSD(d.amount),
      ]
        .map(escapeCsv)
        .join(',')
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
  // Google Sheets can import CSV via a data URI passed through the import URL
  // The simplest cross-browser approach: download CSV, then open Sheets import
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'fairshare-export.csv'
  link.click()
  URL.revokeObjectURL(url)

  // Open Google Sheets (user can import the downloaded CSV)
  setTimeout(() => {
    window.open('https://sheets.google.com/create', '_blank')
  }, 500)
}
