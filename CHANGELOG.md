# Changelog

All notable, user-facing changes to Fairshare. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses
[Semantic Versioning](https://semver.org/) (`major.minor.patch`). The running
version also shows at the bottom of the app's avatar menu.

To cut a release, add entries under **[Unreleased]** as you go, then run
`make release VERSION=x.y.z` (see CLAUDE.md → *Versioning & releases*).

## [Unreleased]

## [1.1.0] - 2026-06-14

### Added
- **Clear settled history** (groups only): once everyone in a group is settled
  up, a button in *Settle Up* clears the whole expense list to Trash
  (recoverable for 24h, with one-tap undo) so ongoing groups don't accumulate an
  endless list.
- **Inline help** (`?`) next to *Paid by* and *How to split* on the expense
  form, with plain-language explanations and examples.
- **Live split feedback**: Exact and % splits show "$X / Y% left to assign" vs
  "adds up", and Shares shows each person's resulting dollar amount as you type.
- **Rescind a pending invite** from the trip screen (× next to an invitee who
  hasn't joined yet).

### Changed
- **Reworked the Add Expense form for first-time clarity**: renamed "Split type"
  → "How to split", added a paid-vs-owed framing (each amount is what that person
  *owes*, separate from who *paid*), reordered to **bill → split → who paid**, and
  grouped the sections visually.
- **Currency**: a compact picker now sits right next to the amount; a custom
  **Paid by** dropdown replaces the native one so it positions correctly at any
  screen size and zoom level.
- Exchange-rate / calculator controls now read as buttons, the date field opens
  the calendar on a full-field tap, and number inputs no longer show up/down
  spin buttons.

### Fixed
- Help popovers and the currency dropdown no longer run off the edge of a phone
  screen, at any text size.
- Refuse joining a **deleted trip** (no more "zombie" trips); leaving as the last
  member now deletes the trip and cancels its pending invites.
- Singular wording ("1 person", "1 member" instead of "1 people"/"1 members").
- Intermittent "Something went wrong" right after a deploy (auto-reloads once on
  a stale code chunk instead of showing the error page).

## [1.0.0]

Initial release — the app as it stood before this changelog began. Split shared
expenses across **trips** and **groups**: multi-currency expenses with live
exchange rates, flexible splits (equal / exact / % / shares), multi-payer
expenses, debt simplification and settle-up, email & link invites with
placeholder members, soft-delete + Trash, an activity log, selectable color
themes, a text-size control, and light/dark mode.
