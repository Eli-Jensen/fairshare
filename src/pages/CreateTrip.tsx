import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrips } from '../hooks/useTrips'
import { CurrencyPicker } from '../components/CurrencyPicker'

const MAX_TRIPS = 100

const COMMON_SETTLEMENT = ['USD', 'EUR', 'GBP', 'CAD', 'AUD']

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

export function CreateTrip() {
  const { user } = useAuth()
  const { trips } = useTrips()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [submitting, setSubmitting] = useState(false)

  const atLimit = trips.length >= MAX_TRIPS

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !user || atLimit) return

    setSubmitting(true)
    const ref = await addDoc(collection(db, 'trips'), {
      name: name.trim(),
      createdBy: user.uid,
      memberUids: [user.uid],
      invitedEmails: [],
      inviteCode: generateInviteCode(),
      settlementCurrency: currency,
      createdAt: serverTimestamp(),
    })
    navigate(`/trip/${ref.id}`)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text mb-6">New Trip</h1>

      {atLimit && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
          You've reached the limit of {MAX_TRIPS} trips. Delete an old trip to create a new one.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Trip name
          </label>
          <input
            type="text"
            className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-input text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            placeholder="Italy 2026, Family Reunion, etc."
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Settlement currency
          </label>
          <p className="text-xs text-text-muted mb-2">
            Balances and settlements will be shown in this currency.
          </p>
          <div className="flex gap-1.5 flex-wrap mb-2">
            {COMMON_SETTLEMENT.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setCurrency(code)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all ${
                  currency === code
                    ? 'bg-accent-soft border-accent text-accent-text'
                    : 'bg-card border-line text-text-secondary hover:border-accent'
                }`}
              >
                {code}
              </button>
            ))}
          </div>
          {!COMMON_SETTLEMENT.includes(currency) && (
            <p className="text-xs text-accent-text mb-2">Selected: {currency}</p>
          )}
          <CurrencyPicker value={currency} onChange={setCurrency} />
        </div>

        <button
          type="submit"
          disabled={!name.trim() || submitting || atLimit}
          className="w-full bg-accent text-white rounded-lg py-2.5 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Creating...' : 'Create Trip'}
        </button>
      </form>
    </div>
  )
}
