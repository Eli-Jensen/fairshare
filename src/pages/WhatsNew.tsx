import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { CHANGELOG, markChangelogSeen } from '../lib/changelog'

function formatEntryDate(date: string): string {
  // Noon keeps the label timezone-stable — the same reason dates.ts parses
  // expense dates at local midnight instead of letting UTC shift the day.
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/** ✨ The release notes — what shipped, in plain terms. */
export function WhatsNew() {
  // Visiting clears the ✨ dot in the menu (per device).
  useEffect(() => {
    markChangelogSeen()
  }, [])

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-text mb-1">✨ What's new</h1>
      <p className="text-sm text-text-muted mb-6">
        Everything new and improved in fairshare, newest first.
      </p>

      <div className="space-y-4">
        {CHANGELOG.map((entry, i) => (
          <section key={`${entry.date}-${i}`} className="bg-card border border-line rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl" aria-hidden>
                {entry.emoji}
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold text-text">{entry.title}</h2>
                <p className="text-xs text-text-muted">{formatEntryDate(entry.date)}</p>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5">
              {entry.items.map((item, j) => (
                <li key={j} className="flex gap-2 text-sm text-text-secondary">
                  <span aria-hidden className="text-text-muted">
                    ·
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-6 text-center text-sm">
        <Link to="/" className="text-accent-text hover:text-accent-hover">
          Back to your trips
        </Link>
      </p>
    </div>
  )
}
