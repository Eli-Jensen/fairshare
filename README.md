# fairshare

A web app for splitting group trip expenses among friends and family. Think Splitwise, but self-hosted on Firebase.

**Live:** [fairshare-4c9a2.web.app](https://fairshare-4c9a2.web.app)

## Features

- **Google sign-in** — no account creation needed
- **Trip management** — create trips, invite members by email or shareable link, edit/delete with undo
- **Multi-currency expenses** — 160+ ISO 4217 currencies with searchable picker, auto-populated exchange rates from live API, per-trip rate memory
- **Flexible splitting** — equal, exact amounts, percentages, or shares
- **Settlement engine** — greedy debt simplification algorithm minimizes the number of payments needed
- **Soft delete everywhere** — deleted trips, expenses, and removed members are recoverable for 24 hours
- **Export** — download CSV or open in Google Sheets with full expense breakdown, balances, and settlements
- **Dark mode** — follows system preference with manual light/dark/system toggle
- **Editable profiles** — custom display names and avatars, with original Google identity visible on click
- **Duplicate name handling** — members with the same name are disambiguated with email
- **Mobile-responsive** — works on phones and desktops

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS v4
- **Routing:** React Router v6
- **Backend:** Firebase (Auth, Cloud Firestore, Hosting)
- **Exchange rates:** [open.er-api.com](https://open.er-api.com) (free, no key, cached 6 hours)

## Project Structure

```
src/
  components/    # Reusable UI (TripCard, ExpenseCard, CurrencyPicker, etc.)
  pages/         # Route-level pages (Home, TripDashboard, AddExpense, etc.)
  hooks/         # React hooks (useAuth, useTrip, useTrips, useTheme)
  lib/           # Utilities (firebase, types, settlement, currencies, rates, export)
```

## Setup

### Prerequisites

- Node.js 18+
- A Firebase project with Authentication (Google) and Firestore enabled

### Local Development

```bash
git clone https://github.com/Eli-Jensen/fairshare.git
cd fairshare
npm install
```

Create a `.env` file with your Firebase config:

```
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

```bash
npm run dev
```

### Deploy

```bash
npm run build
npx firebase deploy
```

## Firestore Data Model

```
/users/{uid}
  displayName, email, photoURL, googleDisplayName, googlePhotoURL, recentContacts[]

/trips/{tripId}
  name, createdBy, memberUids[], inviteCode, invitedEmails[],
  removedMembers[], lastRates{}, deletedAt?, createdAt

/trips/{tripId}/expenses/{expenseId}
  description, amount, currency, exchangeRate, amountUSD,
  paidBy, splitType, splits{}, date, deletedAt?, createdAt
```

## License

Private project.
