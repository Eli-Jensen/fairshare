# fairshare

**Split trip and group expenses with friends and family, and settle up in as few payments as possible.**

Fairshare is a free, installable web app in the spirit of Splitwise. Log who paid for
what, in any currency, and it keeps a running balance of who owes whom. When it's time
to settle, it works out the smallest set of payments that zeroes everyone out. It runs
on Firebase and is designed to stay within Firebase's free tiers.

**Use it:** [fairshare-split.web.app](https://fairshare-split.web.app). Sign in with Google;
no separate account needed.

## How to use it

1. **Sign in with Google** at [fairshare-split.web.app](https://fairshare-split.web.app).
2. **Create a trip or a group.** A *trip* has an end: you settle up and you're done. A
   *group* (roommates, a couple, a standing dinner club) runs indefinitely. Pick the
   settlement currency, the one balances are shown in, when you create it.
3. **Invite people**, by email or with a shareable link. Invitees count as participants
   right away, so you can split expenses with them before they've even signed up. When
   they join, their history attaches to their account automatically.
4. **Add expenses as you go.** Enter the amount and currency, who paid (one person or
   several), and how to split it: equally, by exact amounts, by percentages, or by
   shares. Add a receipt photo if you like. Foreign-currency amounts convert at live
   rates, or at the rate you actually got.
5. **Check balances and settle up.** The *Settle Up* view shows who owes whom with the
   fewest possible payments. When someone pays, choose **Record a payment** and the
   balances update.

**Install it like an app.** On iPhone, open the site in Safari → Share → *Add to Home
Screen*. On Android or desktop Chrome, use *Install app* in the browser menu. Installing
also enables push notifications on iPhone.

**It works offline.** Expenses added with no signal (plane wifi, a mountain hut) save
instantly and sync when you're back online. Unsynced ones are marked until they land.

## Features

- **Google sign-in**: no passwords; guests without accounts can still be participants
- **Trips & groups**: a trip ends and settles up; a group runs indefinitely with a one-tap "clear settled history"
- **Multi-currency**: 150+ currencies, live exchange rates (cached 6h), per-trip rate memory, and settling up at the rate you actually got (built-in fee-aware rate calculator)
- **Flexible splits**: equal, exact amounts, percentages, or shares; multiple payers per expense; integer-cent math that always sums exactly to the total
- **Fewest payments**: greedy debt simplification minimizes how many transfers it takes to settle
- **Invites that count immediately**: invite by email or link; invitees are participants before they sign up, and their history merges onto their account when they join. Links can be revoked.
- **Receipt photos**: up to 3 compressed photos per expense, plus a per-trip Photos tab
- **Comments, reactions, GIFs**: comment on expenses with photos or GIFs, react with emoji
- **Push notifications**: only for expenses you're actually part of; mute by category or by trip
- **Offline-first PWA**: installable, works without a connection, and updates itself onto new releases
- **Google Sheets backup & restore**: mirror a trip into a spreadsheet in your own Drive and rebuild a trip from one. Uses the `drive.file` scope, so the app can only see files it created, never the rest of your Drive.
- **Activity log with undo**: every change recorded; deletes go to a Trash for 24 hours
- **CSV export**, dark mode, five accent colors, adjustable text size, and an in-app changelog at `/whats-new`

## Privacy

- Only members of a trip can read its expenses, comments, photos and activity. This is
  enforced by [Firestore](firestore.rules) and [Storage](storage.rules) security rules
  on the server, not just by the app, and the rules have their own test suite in
  [`rules-tests/`](rules-tests/).
- Your profile (name, email, Google photo) can only be looked up by its user ID, which
  people see when they share a trip with you. There's no user directory and no way to
  list or search users.
- Invite links work like keys: anyone with the link can join. Resetting a trip's link
  revokes every copy shared before.
- Optional crash reports (Sentry) redact invite codes from URLs.

## Run your own copy

You can host your own instance on a Firebase project of your own.

### Prerequisites

- Node.js 20.19+ (Cloud Functions target Node 22)
- A Firebase project with **Google sign-in**, **Cloud Firestore** and **Storage** enabled.
  Storage (receipt photos) and Cloud Functions (push notifications) need the
  pay-as-you-go **Blaze** plan, but a group of friends stays well inside its free
  allowances. Set a budget alert anyway.
- The [Firebase CLI](https://firebase.google.com/docs/cli) (`npm i -g firebase-tools`)
- Java, only if you run the security-rules tests (the Firestore emulator needs it)

### Local development

```bash
git clone https://github.com/Eli-Jensen/fairshare.git
cd fairshare
npm install
cp .env.example .env.development   # then paste in your Firebase web app config
npm run dev                        # http://localhost:5173
```

Optional features hide themselves when their env var is unset: Google Sheets backup
(`VITE_GOOGLE_OAUTH_CLIENT_ID`), push notifications (`VITE_FIREBASE_VAPID_KEY`), GIF
search (`VITE_KLIPY_API_KEY`), and crash reporting (`VITE_SENTRY_DSN`).
[.env.example](.env.example) explains where to get each one.

### Deploying your own instance

1. Point [`.firebaserc`](.firebaserc) at your own project. The IDs committed here
   belong to the original deployment. Then map the `app` hosting target to your site:
   `firebase target:apply hosting app <your-site-id>`.
2. Deploy the security rules and indexes: `firebase deploy --only firestore,storage`.
3. Build and deploy hosting: `npm run build && firebase deploy --only hosting:app`.
4. For push notifications: `firebase deploy --only functions`.

### Tests

```bash
npm test          # unit tests: app + Cloud Functions in one Vitest run
make test-rules   # security-rules tests against the Firestore emulator (needs Java)
npm run lint
```

## How this deployment ships

The original deployment uses **two separate Firebase projects**, so staging can never
touch production data. A push to `dev` runs CI: a secret scan, tests, deploy to staging,
a Lighthouse check, then a fast-forward of `main` and a deploy to production. Any failing
step stops it before production. `make help` lists the release helpers (rollback, manual
promote, rules/functions deploys, live-version check). These are wired to the original
project IDs in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) and the
[Makefile](Makefile).

## Tech stack

- **Frontend:** React 19 + TypeScript + Vite, Tailwind CSS v4, React Router v7
- **Backend:** Firebase: Auth, Cloud Firestore, Storage, Hosting, and Cloud Functions (push notifications, Node 22)
- **Exchange rates:** [open.er-api.com](https://open.er-api.com) (free, no key)
- **Crash reporting:** Sentry (optional, inert unless configured)
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

The detailed architecture notes (data model, security model, offline conventions,
deployment pipeline) live in [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE)
