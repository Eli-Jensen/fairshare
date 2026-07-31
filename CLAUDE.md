# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # TypeScript check + Vite production build (output: dist/)
npm run dev            # Dev server (port 5174, configured in parent .claude/launch.json)
npm test               # Run Vitest test suite (~120 tests)
npm run test:watch     # Vitest in watch mode
npm run lint           # ESLint
```

Deployment and release operations live in the **Makefile** (`make help` lists everything):

```bash
make ship              # Fast path: push dev → wait for green CI → auto-promote to prod.
                       #   MSG="..." commits pending changes first. Stops if dev CI fails.
                       #   Skips the manual dev-site smoke test — for low-risk changes only.
make versions          # What's running on prod / dev (via /version.json) vs local HEAD
make promote           # Fast-forward main to dev (CI deploys prod hosting) + deploy prod rules.
                       #   Fast-forward (not a merge commit) so prod reports the SAME sha as dev.
make reconcile-main    # One-time: force main == dev so promotes can fast-forward (CONFIRM=1)
make rollback-prod     # Rebuild + redeploy prod hosting from a previous commit (REF=...)
make deploy-rules-dev  # Deploy Firestore rules + indexes to the dev project (CI uses this too)
make deploy-rules-prod # Deploy Firestore rules + indexes to prod
make watch             # Watch the latest CI run, then report what it deployed + live versions
```

Two release paths: **`make ship`** (fast, low-risk changes — auto-promotes if dev CI is green) and the **manual** path (push to `dev` → smoke-test the dev site → `make promote`) for anything where the dev-site check matters.

## Architecture

**Stack**: React 19 + TypeScript + Vite + Tailwind CSS v4 + Firebase (Auth, Firestore, Hosting)

**Production**: https://fairshare-split.web.app (project `fairshare-4c9a2`) | **Dev**: https://dev-fairshare-split.web.app (separate project `fairshare-split-dev`) | **Repo**: github.com/Eli-Jensen/fairshare

### Firestore Data Model

```
/users/{uid}                  — UserProfile (displayName, email, photoURL, googleDisplayName)
/users/{uid}/private/contacts — owner-only data ({ contacts: RecentContact[] })
/users/{uid}/private/sheetSync — owner-only Google Sheets backup links ({ links: { [tripId]: SheetLink } })
/inviteCodes/{code}           — invite-link lookup ({ tripId, type }); get-only for authed users, no list
/trips/{tripId}               — Trip (name, type, memberUids[], inviteCode, invitedEmails[], settlementCurrency, lastRates{}, lastActivityAt, lastActivityBy, cached* fields, ...)
/trips/{tripId}/expenses      — Expense (amount, currency, exchangeRate, amountUSD, paidBy, paidByAmounts?, splits{}, categories?, notes?, comments[], isSettlement?, deletedAt?)
/trips/{tripId}/activity      — ActivityLogEntry (action, actorUid, targetDescription?, editDetails?)
```

The `amountUSD` field stores the amount in the trip's **settlement currency** (not necessarily USD — legacy naming). All balances and settlements are computed in this currency. The settlement currency is **locked once a trip has expenses** (stored amounts are never converted).

Trip reads are restricted to members and email invitees, so invite links resolve through `/inviteCodes/{code}` and join via a rules-validated "self-join" update (only change = adding your own uid to `memberUids`). `TripDashboard` lazily backfills code docs for pre-existing trips. **Rules changes require `npx firebase deploy --only firestore` — CI only deploys hosting.**

Trips and groups use the same Firestore collection. A trip has `type: 'trip'` (or undefined for old data), a group has `type: 'group'`. Use `tripLabel(trip.type)` from `src/lib/types.ts` for user-facing text — never hardcode "trip".

### Key Patterns

**Semantic color system** (`src/index.css`): All UI colors use CSS custom properties (`bg-card`, `text-text`, `border-line`, `text-accent-text`, etc.) that auto-switch in dark mode via the `.dark` class. Never use hardcoded Tailwind colors like `bg-white`, `text-slate-700`, `border-slate-200` — use the semantic tokens instead. Dark mode overrides are defined in `.dark {}` block in index.css.

**Popovers & dropdowns** (`src/components/HelpTip.tsx`, `CurrencyPicker.tsx`, `MemberDropdown.tsx`): custom dropdowns/tooltips are **fixed-positioned and clamped to the viewport** (flip above the trigger when low on screen, pull in horizontally so they never run off the edge) — not `position: absolute` relative to the trigger. Two reasons: native `<select>`/`<input type=date>` popups mis-place (jump to the top-left corner) when the page isn't at 100% zoom, and `absolute` popovers clip off-screen on phones. That's why the *Paid by* picker is a custom `MemberDropdown`, not a native `<select>`. Reuse this pattern for any new in-form dropdown or popover instead of a native control.

**Soft delete**: Expenses and trips use a `deletedAt` timestamp field. They're filtered out in queries, shown on the `/trash` page for 24h, then auto-purged client-side. Member removal stores in `removedMembers[]` array. **Groups** also get a *Clear settled history* action (`SettlementView` button → `TripDashboard.clearSettledHistory`): when a group is fully settled (`simplifyDebts` empty), it soft-deletes every expense to Trash at once, with one-tap undo — balances stay $0 since the cleared expenses net out.

**Invited participants / placeholders** (`src/lib/placeholders.ts`, `src/lib/claim.ts`): inviting an email creates a `ph_`-id entry in `trip.placeholderMembers[]` **and** adds the email to `invitedEmails` (linked by email). Placeholders are participants immediately — their ids flow through `paidBy`/`splits`/balances like uids and display as the invited email — but they're **never in `memberUids`** (the security boundary). `useTrip` returns `participants` (memberUids + placeholder ids) and synthesizes their profiles into the `members` map. Use `participants`, not `trip.memberUids`, anywhere a person can pay or owe.

**Claim/merge on join**: when a user joins (link or pending-invite), after they're a member, `claimPlaceholdersOnJoin` runs a transaction detaching any placeholder matching their email and recording `trip.placeholderClaims[ph_id] = uid`. The TripDashboard reconcile effect then runs `reconcilePlaceholderClaims`, which rewrites every expense + activity reference `ph_→uid` (pure `remapExpenseRefs`, idempotent, batched, merges on collision) and clears the claim. No Firestore rules changes — all runs member-gated. Rescinding an invite (× on the Invite page, balance-guarded) removes both the placeholder and the `invitedEmails` entry.

**Google Sheets backup** (`src/lib/sheet*.ts`, `src/hooks/useSheetLink.ts`, `/trip/:id/backup`, `/restore`): mirrors a trip into a spreadsheet in the user's own Drive, and rebuilds a trip from one. Hidden entirely when `VITE_GOOGLE_OAUTH_CLIENT_ID` is unset, so an environment without an OAuth client behaves exactly as before.

- **Auth** (`googleAuth.ts`): Google Identity Services token model, *not* Firebase Auth — the `drive.file` scope is deliberately kept off the sign-in provider so ordinary login shows no Drive consent. There are **no refresh tokens in the browser**: a token lasts ~1h and a new one costs a user gesture. Hence `getCachedToken()` (silent, safe from effects/timers) and `requestToken()` (needs a click) are separate functions — anything automatic must use the former and give up when it returns null. `requestToken()` must be the first statement in a click handler; an `await` before it drops user activation and the popup is blocked. Pass `prompt: ''` or Google shows an account chooser on *every* token request. The token lives in a module variable only — never storage, never logged.
- **Sheet format** (`sheetSnapshot.ts` → `sheetParse.ts`): cells hold raw numbers and date serials, never `formatMoney` strings, so the sheet round-trips. Row 1 of each tab is a hidden machine-key header keyed by **participant id** (a rename or duplicate display name must not orphan a column); row 2 is the human header. Paired `paid`/`share` columns per participant make `paidByAmounts`/`splits` lossless — including blank (not in this split) vs `0` (in it, owes nothing), which are different and must stay different. Writes use `valueInputOption: 'RAW'` so a description of `=SUM(A1)` can't become a live formula in someone's Drive.
- **Sync sequencing** (`sheetFormat.ts`, `sheetSync.ts`): `values.update` fails when the range exceeds the sheet's grid and will *not* grow it (only `values.append` does), so every structural change lands before any value write. Shrinking the grid doubles as stale-row cleanup, which saves a `batchClear` call. Steady state is 2 API calls. Decisions are made on `sheetId`, never tab title — only the final A1 range uses the title.
- **A successful sync is not proof the backup exists**: the Sheets API writes to a spreadsheet in the Drive *trash* perfectly happily, so `useSheetLink` asks Drive separately and warns. Trashed ≠ deleted; only Drive knows.
- **Restore** (`sheetRestore.ts`) always creates a **new** trip — rules only allow `memberUids == [you]` on create. Everyone else returns as a `ph_` placeholder so the existing claim-on-join flow reattaches their history. The trip doc must be created and **awaited before any expense write**: the expense rule does `get(/trips/$(tripId))`, and inside a `writeBatch` that `get()` sees pre-commit state. Guest emails are editable in the preview because `claimPlaceholdersOnJoin` matches on email alone — a guest with no email can never auto-merge.

**Profile cache** (`src/hooks/useProfileCache.tsx`): Wraps the app to deduplicate and cache Firestore user profile reads. Use `const { getProfiles } = useProfileCache()` instead of individual `getDoc` calls. Critical for staying within Spark free tier limits.

**Settlement algorithm** (`src/lib/settlement.ts`): `computeBalances()` credits payers and debits splits. `simplifyDebts()` uses greedy matching to minimize payment count. Settlements are stored as regular expenses with `isSettlement: true` — the algorithm handles them automatically.

**Split math** (`src/lib/splits.ts`): all split computation goes through this module — it works in integer cents and distributes leftover cents by largest remainder so splits always sum exactly to the total. Never round per-member shares independently.

**Dates** (`src/lib/dates.ts`): expense dates are date-only values stored at local midnight. Always use `parseDateString`/`timestampToDateString`/`formatDateOnly` — naive `new Date('YYYY-MM-DD')` parses as UTC and shifts a day in US timezones.

**Multi-payer expenses**: `paidByAmounts` is an optional `Record<string, number>` on expenses. When present, it overrides `paidBy` for balance calculations. When absent, `paidBy` is the single payer for the full amount. Never write `paidByAmounts: undefined` to Firestore — omit the field entirely.

**Activity logging** (`src/lib/activity.ts`): `writeActivity()` is fire-and-forget (no `await`) to avoid blocking saves. Edit activities include `editDetails: string[]` showing what changed. It also stamps `lastActivityAt`/`lastActivityBy` on the trip doc, which powers the unseen-activity dot in the header and lets the global Activity page refetch only trips whose stamp moved.

**Exchange rates** (`src/lib/rates.ts`): Fetched from open.er-api.com, cached in localStorage for 6h. Per-trip rates saved in `trip.lastRates`. The trip's `lastCurrency` field auto-sets the default currency for new expenses.

### Branching & Deployment

Dev and prod are **separate Firebase projects** — separate Firestore data, separate Auth users, separate rules. Dev is a safe sandbox; nothing done there can touch production data.

- `main` — production, CI deploys **hosting only** to `fairshare-split.web.app` (project `fairshare-4c9a2`, open access). **Prod rules/indexes are deployed manually** (`npx firebase deploy --only firestore --project prod`) — do this whenever `firestore.rules`/`firestore.indexes.json` change.
- `dev` — staging, CI deploys **hosting + Firestore rules + indexes** to `dev-fairshare-split.web.app` (project `fairshare-split-dev`, email-gated via `VITE_ALLOWED_EMAILS`, marked with a DEV badge). Rules changes rehearse here before prod.
- Feature branches merged via PR into `dev`, then `dev` → `main` once verified.
- The old default site `fairshare-4c9a2.web.app` is disabled — don't re-enable it.

**Local env files** (gitignored, Vite mode-based — CI doesn't use them, it injects the `VITE_FIREBASE_*(_DEV)` secrets directly): `.env.development` points at the dev project and is loaded by `npm run dev`, so local development hits the dev sandbox, never prod. `.env.production` points at prod and is loaded by `vite build` (e.g. `make rollback-prod`). See `.env.example`.

**Google OAuth client** (`VITE_GOOGLE_OAUTH_CLIENT_ID`, per project): powers the Sheets backup. Each Firebase project needs its own — Sheets API + Drive API enabled, the `drive.file` scope declared (Google classifies it **non-sensitive**, so publishing needs no verification review), and the app's origins registered as *Authorized JavaScript origins* (redirect URIs stay empty; the token flow is popup-based). Use a **separate** client from the Firebase-managed sign-in one, so a mistake here can't break login. `drive.file` grants are per-client, so dev can never see prod's backup sheets. Unset = the feature hides itself.

**Access gating** (`src/App.tsx`): When the `VITE_ALLOWED_EMAILS` env var is set (comma-separated emails), only those users can use the app after sign-in. Production builds omit this var — everyone can sign in. Dev builds include it via the GitHub secret.

**Versioning**: `package.json` version + git SHA + build date are injected at build time (`vite.config.ts` `define`), served at `/version.json`, and shown at the bottom of the avatar menu; `make versions` reports what's live on prod/dev vs local HEAD. This is fully automatic — there is **no changelog and no release ceremony**. The git SHA identifies each build; bump the `package.json` version by hand only if you ever want the displayed number to change.

### Firebase Constraints

The app must stay within the **Spark (free) plan**: 50K reads/day, 20K writes/day, 1GB storage. The profile cache and parallel writes (`Promise.all`) are critical optimizations. No Firebase Storage (Blaze required) — profile photos stored as base64 data URLs in Firestore.

### Testing

Tests are in `src/lib/__tests__/`. They cover pure logic only (settlement math, formatting, name disambiguation). No component or Firebase integration tests. Run `npm test` before committing.
