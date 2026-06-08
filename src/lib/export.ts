import type { Expense, UserProfile, CustomCategory } from './types'
import { formatMoney, getMemberName, getCategoryInfo } from './types'
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
  memberUids: string[],
  settlementCurrency: string = 'USD',
  customCategories?: CustomCategory[]
): string {
  const fmt = (n: number) => formatMoney(n, settlementCurrency)
  const lines: string[] = []

  // Header
  lines.push(`Trip: ${escapeCsv(tripName)}`)
  lines.push('')

  // Expenses table
  const memberNames = memberUids.map((uid) => getMemberName(uid, members))
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
          .map(([uid, amt]) => `${getMemberName(uid, members)} ${fmt(amt)}`)
          .join(' + ')
      : getMemberName(exp.paidBy, members)
    const shares = memberUids.map((uid) =>
      exp.splits[uid] !== undefined ? fmt(exp.splits[uid]) : ''
    )
    const catInfo = exp.category
      ? getCategoryInfo(exp.category, customCategories)
      : null
    lines.push(
      [
        formatDate(exp.date),
        exp.isSettlement ? 'Settlement' : 'Expense',
        catInfo ? catInfo.label : '',
        exp.description,
        exp.notes ?? '',
        fmt(exp.amountUSD),
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
  const total = expensesOnly.reduce((s, e) => s + e.amountUSD, 0)
  const pad = memberUids.map(() => '')
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
  for (const uid of memberUids) {
    let spent = 0
    for (const exp of expensesOnly) {
      if (exp.paidByAmounts && Object.keys(exp.paidByAmounts).length > 0) {
        spent += exp.paidByAmounts[uid] ?? 0
      } else if (exp.paidBy === uid) {
        spent += exp.amountUSD
      }
    }
    lines.push([getMemberName(uid, members), fmt(spent)].map(escapeCsv).join(','))
  }

  lines.push('')

  // Balances
  lines.push('Balances')
  lines.push(['Person', 'Balance'].map(escapeCsv).join(','))
  const balances = computeBalances(expenses, memberUids)
  for (const uid of memberUids) {
    const name = getMemberName(uid, members)
    const bal = balances[uid] ?? 0
    lines.push([name, fmt(bal)].map(escapeCsv).join(','))
  }

  lines.push('')

  // Remaining settlements
  lines.push('Remaining Settlements')
  lines.push(['From', 'To', 'Amount'].map(escapeCsv).join(','))
  const debts = simplifyDebts(balances)
  for (const d of debts) {
    lines.push(
      [
        getMemberName(d.from, members),
        getMemberName(d.to, members),
        fmt(d.amount),
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
