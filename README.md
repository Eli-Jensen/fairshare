# fairshare

Split group expenses with friends and family — trips and ongoing groups, multiple currencies, receipts, comments, push notifications, and a settle-up engine that minimizes who pays whom. Think Splitwise, self-hosted on Firebase and designed to run entirely within its free tiers.

**Live:** [fairshare-split.web.app](https://fairshare-split.web.app) · **Staging:** [dev-fairshare-split.web.app](https://dev-fairshare-split.web.app) (email-gated)

## Features

- **Google sign-in** — no account creation; guests without accounts can still be participants
- **Trips & groups** — a trip ends and settles up; a group runs indefinitely with a one-tap "clear settled history"
- **Multi-currency** — 150+ currencies, live exchange rates (cached 6h), per-trip rate memory, and settling up at the rate you actually got (built-in fee-aware rate calculator)
- **Flexible splits** — equal, exact amounts, percentages, or shares; multiple payers per expense; integer-cent math that always sums exactly to the total
- **Settlement engine** — greedy debt simplification minimizes the number of payments needed
- **Invites that count immediately** — invite by email or shareable link; invitees are participants before they've signed up, and their history merges onto their account when they join. Links can be revoked.
- **Receipt photos** — up to 3 compressed photos per expense, plus a per-trip Photos tab
- **Comments, reactions, GIFs** — comments with photo and GIF attachments, emoji reactions on expenses and comments
- **Push notifications** — web push sent by Cloud Functions, scoped to the people actually in the split, mutable per category and per trip
- **Offline-first PWA** — installable; expenses added on plane wifi save instantly and sync later, pending writes are flagged, and open tabs update themselves onto new releases
- **Google Sheets backup & restore** — mirror a trip into a spreadsheet in your own Drive (`drive.file` scope only — the app can't see the rest of your Drive), and rebuild a trip from one
- **Activity log with undo** — every change recorded; soft delete everywhere with a 24-hour Trash
- **CSV export**, dark mode, five accent colors, nine text sizes, and an in-app changelog at `/whats-new`

## Tech stack

- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS v4, React Router v7
- **Backend:** Firebase — Auth, Cloud Firestore, Storage, Hosting, and Cloud Functions (push notifications, Node 22)
- **Exchange rates:** [open.er-api.com](https://open.er-api.com) (free, no key)
- **Crash reporting:** Sentry (optional — inert unless configured)
- **Tests:** Vitest unit tests plus Firestore/Storage security-rules tests against the emulator

## Project structure

```
src/
  components/    # Reusable UI (ExpenseCard, CurrencyPicker, CommentsSection, …)
  pages/         # Route-level pages (Home, TripDashboard, AddExpense, …)
  hooks/         # React hooks (useAuth, useTrip, useProfileCache, …)
  lib/           # Pure logic + Firebase glue (settlement, splits, rates, sheets, …)
  lib/__tests__/ # Unit tests
functions/       # Cloud Functions (push notification sender)
rules-tests/     # Firestore + Storage security-rules tests (run in the emulator)
scripts/         # Ship/watch helpers driven by the Makefile
```

The full architecture notes — data model, security rules, offline conventions, deployment pipeline — live in [CLAUDE.md](CLAUDE.md).

## Setup

### Prerequisites

- Node.js 20.19+ (Cloud Functions target Node 22)
- A Firebase project with Google Auth, Firestore, and Storage enabled — Blaze plan only if you want push notifications; everything else fits the free tier
- Java, only if you run the rules tests (the Firestore emulator needs it)

### Local development

```bash
git clone https://github.com/Eli-Jensen/fairshare.git
cd fairshare
npm install
cp .env.example .env.development   # then fill in your Firebase web config
npm run dev
```

Optional features hide themselves when their env var is unset: Google Sheets backup (`VITE_GOOGLE_OAUTH_CLIENT_ID`), push notifications (`VITE_FIREBASE_VAPID_KEY`), GIF search (`VITE_KLIPY_API_KEY`), crash reporting (`VITE_SENTRY_DSN`). [.env.example](.env.example) documents each one.

### Tests

```bash
npm test          # unit tests — app + functions in one run
make test-rules   # security-rules tests against the Firestore emulator (needs Java)
npm run lint
```

## Deployment

Dev and prod are **separate Firebase projects**, so staging can never touch production data. Shipping is continuous: `make ship` pushes the `dev` branch, and CI tests, deploys to staging, runs Lighthouse, then fast-forwards `main` and deploys prod — all in one run, stopping before prod at any failing step. `make help` lists the rest (rollback, manual promote, rules/functions deploys, live-version check).

## License

Private project.
