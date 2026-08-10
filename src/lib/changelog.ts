/**
 * User-facing release notes, newest first — rendered at /whats-new.
 *
 * This ships INSIDE the bundle, so the list always describes the build you're
 * actually running: there's nothing to keep in sync and nothing to publish.
 * That's the difference between this and the CHANGELOG.md + `make release`
 * ceremony removed in a250643, which duplicated build metadata the version
 * line already derives automatically. Version/SHA/date stay automatic; this is
 * prose about what changed for the people using the app.
 *
 * Ship ritual: prepend an entry with every promoted batch that changes
 * something a user can see or do. Internal work (CI, refactors, test
 * coverage) doesn't belong here.
 */
export interface ChangelogEntry {
  date: string // YYYY-MM-DD — also part of the "seen" tracking key
  emoji: string
  title: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-08-10',
    emoji: '🔕',
    title: 'Fewer notifications about people fixing typos',
    items: [
      'Correcting an expense in the first half hour after adding it no longer notifies anyone. The “added” notification already went out, and everyone got told twice for one dinner.',
      'Fixing several things in a row now sends one notification instead of one per save.',
      'Notification settings also moved somewhere you might actually find them: there’s a Notifications row in the menu under your picture.',
      'None of this changes the trip’s history — every edit is still listed in Activity.',
    ],
  },
  {
    date: '2026-08-07',
    emoji: '✨',
    title: 'No more quietly running last week’s app',
    items: [
      'When a new version goes out, a tab you already had open refreshes itself onto it, instead of carrying on with old code until you happened to reload.',
      'Opening the app also picks up a new version straight away, rather than up to an hour later.',
    ],
  },
  {
    date: '2026-08-07',
    emoji: '🔒',
    title: 'Invite links you can actually take back',
    items: [
      'Regenerating a trip’s invite link now genuinely retires the old one. Before, the new link worked but the old one kept letting people in — so a link sent to the wrong person couldn’t really be un-sent.',
      'Removing someone from a trip sticks. Regenerate the invite link afterwards and they can’t add themselves back.',
      'Fixed: if your Google address has capital letters in it, invitations sent to it never appeared on your home screen. They do now.',
    ],
  },
  {
    date: '2026-08-06',
    emoji: '🔔',
    title: 'Notifications',
    items: [
      'Get a notification when someone adds an expense, settles up with you, comments, or invites you to a trip — on your phone, even with the app closed.',
      'Expense notifications only go to the people actually in that split. A dinner you weren’t at doesn’t buzz your pocket.',
      'Turn the whole thing on per device, then mute by category or by trip from Edit Profile. Everything is on by default once you enable it, and last year’s finished trip can be silenced without touching the rest.',
      'A “Send test notification” button reports back how many of your devices actually got it — so “my notifications aren’t working” is a ten-second question, not a mystery.',
      'On iPhone, add fairshare to your Home Screen first; iOS only delivers notifications to an installed app.',
    ],
  },
  {
    date: '2026-08-06',
    emoji: '⏳',
    title: 'Joining a trip tells you it’s working',
    items: [
      'Opening an invite link used to sit on a motionless “Joining trip…” while it set several things up behind the scenes — long enough that people reasonably assumed it had frozen. Now it shows a spinner and says what it’s doing.',
    ],
  },
  {
    date: '2026-08-05',
    emoji: '💱',
    title: 'Pay someone back at the rate you actually got',
    items: [
      'Settling up in a different currency now lets you set the exchange rate instead of being stuck with today’s published one.',
      'There’s a calculator built in: put in what you handed over and what you got back, and it works out the real rate — fees and all. That’s the rate that actually happened, which the mid-market number never is.',
      'Or type a rate straight in, or leave it alone and keep the automatic one. Reset returns you to the live rate any time.',
      'Fixed: the exchange calculator’s two fields were stacking on top of each other instead of sitting side by side.',
    ],
  },
  {
    date: '2026-07-30',
    emoji: '📊',
    title: 'Back up a trip to Google Sheets — and restore from one',
    items: [
      'Mirror any trip into a spreadsheet in your own Google Drive: every expense, who paid, who owes, and the running balances. It’s yours, readable, and it outlives the app.',
      'Connect once and it keeps itself up to date while you’re using the app. The backup page tells you when it last synced and warns you if the sheet has been moved to your Drive trash.',
      'Restore rebuilds a whole trip from one of those sheets — useful if a trip got deleted and the 24-hour window in Trash has passed. Everyone else comes back as a guest linked by email, so their history reattaches when they rejoin.',
      'fairshare only ever sees the files it created. It cannot read the rest of your Drive.',
    ],
  },
  {
    date: '2026-06-13',
    emoji: '🧾',
    title: 'A clearer expense form',
    items: [
      'The form now goes amount → how to split → who paid, which is the order you actually think in: the bill, then who owes, then who covered it.',
      'Splitting by exact amounts, percentages or shares shows you what’s left to allocate as you type, so you find out about the missing $3 before you save.',
      'Groups that are fully settled get a “Clear settled history” button — one tap files every expense in Trash with balances still at zero, and one tap undoes it.',
      'The “Paid by” picker no longer jumps to the corner of the screen when your browser isn’t at 100% zoom.',
    ],
  },
  {
    date: '2026-06-11',
    emoji: '👥',
    title: 'Guests, and invites that count immediately',
    items: [
      'Invite someone by email and they’re a participant right away — you can split with them before they’ve signed up for anything.',
      'When they do join, their whole history merges onto their account automatically. No duplicate person, no re-entering anything.',
      'You can also add a guest with no email at all, for the friend who is never going to make an account.',
    ],
  },
  {
    date: '2026-06-10',
    emoji: '🎨',
    title: 'Make it yours',
    items: [
      'Light, dark, or follow your system.',
      'Five accent colors, and nine text sizes for when the default is too small.',
      'Invite links can now be reset, so an old link stops working the moment you want it to.',
    ],
  },
  {
    date: '2026-06-09',
    emoji: '🎉',
    title: 'The beginning',
    items: [
      'Trips and groups: split expenses with friends, settle up, and see who owes what.',
      'Equal, exact, percentage, or share-based splits — with the leftover cents distributed so the math always adds up exactly.',
      'Multi-currency with automatic exchange rates, and expenses that can have more than one payer.',
      'Settle-up suggestions that minimize the number of payments, a full activity log with undo, a 24-hour Trash, and CSV export.',
    ],
  },
]

// Entry count plus newest date — stays unique even when two entries share a
// day, so the ✨ dot re-arms on every appended entry.
export const LATEST_CHANGELOG_KEY = `${CHANGELOG.length}-${CHANGELOG[0]?.date ?? ''}`

const SEEN_KEY = 'fairshare-changelog-seen'

/** True when this device hasn't opened /whats-new since the newest entry.
 *  Read it from a lazy useState initializer, not during render. */
export function hasUnseenChangelog(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== LATEST_CHANGELOG_KEY
  } catch {
    return false
  }
}

export function markChangelogSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, LATEST_CHANGELOG_KEY)
  } catch {
    /* ignore */
  }
}
