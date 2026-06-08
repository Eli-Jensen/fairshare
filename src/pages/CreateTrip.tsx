import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { useTrips } from '../hooks/useTrips'
import { CurrencyPicker } from '../components/CurrencyPicker'
import type { TripType } from '../lib/types'

const MAX_TRIPS = 100

const COMMON_SETTLEMENT = ['USD', 'EUR', 'GBP', 'CAD', 'AUD']

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

export function CreateTrip() {
  const { user } = useAuth()
  const { trips } = useTrips()
  const navigate = useNavigate()
  const [tripType, setTripType] = useState<TripType>('trip')
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
      type: tripType,
      createdBy: user.uid,
      memberUids: [user.uid],
      invitedEmails: [],
      inviteCode: generateInviteCode(),
      settlementCurrency: currency,
      createdAt: serverTimestamp(),
    })
    navigate(`/trip/${ref.id}`)
  }

  const inputClasses = 'w-full border border-line rounded-lg px-3 py-2 text-sm bg-input text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500'

  return (
    <div>
      <h1 className="text-2xl font-bold text-text mb-6">Create New</h1>

      {atLimit && (
        <div className="bg-warn-bg border border-warn-border rounded-lg p-3 mb-4 text-sm text-warn-text">
          You've reached the limit of {MAX_TRIPS} trips and groups. Delete an old one to create a new one.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Type selector */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">Type</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setTripType('trip')}
              className={`rounded-xl border-2 p-3 text-left transition-all ${
                tripType === 'trip'
                  ? 'border-accent bg-accent-soft'
                  : 'border-line bg-card hover:border-accent/50'
              }`}
            >
              <div className="text-lg mb-0.5">✈️</div>
              <p className={`text-sm font-medium ${tripType === 'trip' ? 'text-accent-text' : 'text-text'}`}>
                Trip
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                A one-time event like a vacation or reunion
              </p>
            </button>
            <button
              type="button"
              onClick={() => setTripType('group')}
              className={`rounded-xl border-2 p-3 text-left transition-all ${
                tripType === 'group'
                  ? 'border-accent bg-accent-soft'
                  : 'border-line bg-card hover:border-accent/50'
              }`}
            >
              <div className="text-lg mb-0.5">👥</div>
              <p className={`text-sm font-medium ${tripType === 'group' ? 'text-accent-text' : 'text-text'}`}>
                Group
              </p>
              <p className="text-xs text-text-muted mt-0.5">
                Ongoing expenses with the same people
              </p>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            {tripType === 'trip' ? 'Trip name' : 'Group name'}
          </label>
          <input
            type="text"
            className={inputClasses}
            placeholder={tripType === 'trip' ? 'Italy 2026, Family Reunion, etc.' : 'Wednesday Lunch, Roommates, etc.'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Settlement currency
          </label>
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
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Creating
            </span>
          ) : `Create ${tripType === 'trip' ? 'Trip' : 'Group'}`}
        </button>
      </form>
    </div>
  )
}
