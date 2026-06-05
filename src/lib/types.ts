import type { Timestamp } from 'firebase/firestore'

export interface UserProfile {
  uid: string
  displayName: string
  email: string
  photoURL: string | null
}

export interface Trip {
  id: string
  name: string
  createdBy: string
  memberUids: string[]
  inviteCode: string
  lastRates?: Record<string, number>
  createdAt: Timestamp
}

export interface Expense {
  id: string
  description: string
  amount: number
  currency: string
  exchangeRate: number
  amountUSD: number
  paidBy: string
  splitType: 'equal' | 'exact' | 'percentage' | 'shares'
  splits: Record<string, number>
  date: Timestamp
  createdBy: string
  createdAt: Timestamp
}

export interface Settlement {
  from: string
  to: string
  amount: number
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}
