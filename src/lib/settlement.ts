import type { Expense, Settlement } from './types'

export function computeBalances(
  expenses: Expense[],
  memberUids: string[]
): Record<string, number> {
  const balances: Record<string, number> = {}
  for (const uid of memberUids) {
    balances[uid] = 0
  }

  for (const expense of expenses) {
    // Credit payers: use paidByAmounts if available, otherwise single payer
    if (expense.paidByAmounts && Object.keys(expense.paidByAmounts).length > 0) {
      for (const [uid, amount] of Object.entries(expense.paidByAmounts)) {
        balances[uid] = (balances[uid] ?? 0) + amount
      }
    } else {
      balances[expense.paidBy] = (balances[expense.paidBy] ?? 0) + expense.amountUSD
    }

    // Debit everyone's share
    for (const [uid, share] of Object.entries(expense.splits)) {
      balances[uid] = (balances[uid] ?? 0) - share
    }
  }

  return balances
}

export function simplifyDebts(balances: Record<string, number>): Settlement[] {
  const creditors: { uid: string; amount: number }[] = []
  const debtors: { uid: string; amount: number }[] = []

  for (const [uid, balance] of Object.entries(balances)) {
    const rounded = Math.round(balance * 100) / 100
    if (rounded > 0.01) {
      creditors.push({ uid, amount: rounded })
    } else if (rounded < -0.01) {
      debtors.push({ uid, amount: -rounded })
    }
  }

  creditors.sort((a, b) => b.amount - a.amount)
  debtors.sort((a, b) => b.amount - a.amount)

  const settlements: Settlement[] = []
  let i = 0
  let j = 0

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount)
    const rounded = Math.round(amount * 100) / 100

    if (rounded > 0) {
      settlements.push({
        from: debtors[i].uid,
        to: creditors[j].uid,
        amount: rounded,
      })
    }

    debtors[i].amount -= amount
    creditors[j].amount -= amount

    if (debtors[i].amount < 0.01) i++
    if (creditors[j].amount < 0.01) j++
  }

  return settlements
}
