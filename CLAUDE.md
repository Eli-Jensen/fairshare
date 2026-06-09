# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # TypeScript check + Vite production build (output: dist/)
npm run dev            # Dev server (port 5174, configured in parent .claude/launch.json)
npm test               # Run Vitest test suite (93 tests, ~150ms)
npm run test:watch     # Vitest in watch mode
npm run lint           # ESLint
npx firebase deploy --only hosting              # Deploy app to Firebase Hosting
npx firebase deploy --only firestore:rules      # Deploy Firestore security rules
npx firebase deploy --only hosting,firestore    # Deploy both + indexes
```

## Architecture

**Stack**: React 19 + TypeScript + Vite + Tailwind CSS v4 + Firebase (Auth, Firestore, Hosting)

**Production**: https://fairshare-split.web.app | **Dev**: https://fairshare-split-dev.web.app | **Repo**: github.com/Eli-Jensen/fairshare

### Firestore Data Model

```
/users/{uid}              — UserProfile (displayName, email, photoURL, googleDisplayName, recentContacts[])
/trips/{tripId}           — Trip (name, type, memberUids[], inviteCode, invitedEmails[], settlementCurrency, lastRates{}, ...)
/trips/{tripId}/expenses  — Expense (amount, currency, exchangeRate, amountUSD, paidBy, paidByAmounts?, splits{}, category?, notes?, comments[], isSettlement?, deletedAt?)
/trips/{tripId}/activity  — ActivityLogEntry (action, actorUid, targetDescription?, editDetails?)
```

The `amountUSD` field stores the amount in the trip's **settlement currency** (not necessarily USD — legacy naming). All balances and settlements are computed in this currency.

Trips and groups use the same Firestore collection. A trip has `type: 'trip'` (or undefined for old data), a group has `type: 'group'`. Use `tripLabel(trip.type)` from `src/lib/types.ts` for user-facing text — never hardcode "trip".

### Key Patterns

**Semantic color system** (`src/index.css`): All UI colors use CSS custom properties (`bg-card`, `text-text`, `border-line`, `text-accent-text`, etc.) that auto-switch in dark mode via the `.dark` class. Never use hardcoded Tailwind colors like `bg-white`, `text-slate-700`, `border-slate-200` — use the semantic tokens instead. Dark mode overrides are defined in `.dark {}` block in index.css.

**Soft delete**: Expenses and trips use a `deletedAt` timestamp field. They're filtered out in queries, shown on the `/trash` page for 24h, then auto-purged client-side. Member removal stores in `removedMembers[]` array.

**Profile cache** (`src/hooks/useProfileCache.tsx`): Wraps the app to deduplicate and cache Firestore user profile reads. Use `const { getProfiles } = useProfileCache()` instead of individual `getDoc` calls. Critical for staying within Spark free tier limits.

**Settlement algorithm** (`src/lib/settlement.ts`): `computeBalances()` credits payers and debits splits. `simplifyDebts()` uses greedy matching to minimize payment count. Settlements are stored as regular expenses with `isSettlement: true` — the algorithm handles them automatically.

**Multi-payer expenses**: `paidByAmounts` is an optional `Record<string, number>` on expenses. When present, it overrides `paidBy` for balance calculations. When absent, `paidBy` is the single payer for the full amount. Never write `paidByAmounts: undefined` to Firestore — omit the field entirely.

**Activity logging** (`src/lib/activity.ts`): `writeActivity()` is fire-and-forget (no `await`) to avoid blocking saves. Edit activities include `editDetails: string[]` showing what changed.

**Exchange rates** (`src/lib/rates.ts`): Fetched from open.er-api.com, cached in localStorage for 6h. Per-trip rates saved in `trip.lastRates`. The trip's `lastCurrency` field auto-sets the default currency for new expenses.

### Branching & Deployment

- `main` — production, auto-deployed to `fairshare-split.web.app` on push (open access)
- `dev` — staging, auto-deployed to `fairshare-split-dev.web.app` on push (email-gated via `VITE_ALLOWED_EMAILS` GitHub secret)
- Feature branches merged via PR (e.g. `feature/groups` → PR #1)

**Access gating** (`src/App.tsx`): When the `VITE_ALLOWED_EMAILS` env var is set (comma-separated emails), only those users can use the app after sign-in. Production builds omit this var — everyone can sign in. Dev builds include it via the GitHub secret.

### Firebase Constraints

The app must stay within the **Spark (free) plan**: 50K reads/day, 20K writes/day, 1GB storage. The profile cache and parallel writes (`Promise.all`) are critical optimizations. No Firebase Storage (Blaze required) — profile photos stored as base64 data URLs in Firestore.

### Testing

Tests are in `src/lib/__tests__/`. They cover pure logic only (settlement math, formatting, name disambiguation). No component or Firebase integration tests. Run `npm test` before committing.
