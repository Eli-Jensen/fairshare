import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTrip } from '../hooks/useTrip'
import { useSheetLink } from '../hooks/useSheetLink'
import { DeleteModal } from '../components/DeleteModal'
import { tripLabel } from '../lib/types'

/**
 * Google Sheets backup for one trip.
 *
 * A page rather than an item in the Export menu: there are six error states,
 * a create-vs-sync distinction, and an unlink confirmation, none of which fit
 * in a dropdown. It also keeps the OAuth and Sheets code out of the main bundle
 * — this route is lazy-loaded, and most people will never open it.
 */

function relativeTime(ms: number): string {
  const seconds = Math.round((Date.now() - ms) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function TripBackup() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { trip, members, participants, loadAllExpenses, loading } = useTrip(id)
  const [showUnlink, setShowUnlink] = useState(false)

  const backup = useSheetLink(id, {
    trip,
    members,
    participants,
    currentUid: user?.uid,
    loadAllExpenses,
  })

  if (loading || !trip) {
    return <div className="text-center py-10 text-text-muted">Loading...</div>
  }

  const tl = tripLabel(trip.type)
  const busy = backup.status === 'working'
  const { link, error } = backup

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/trip/${id}`} className="text-text-muted hover:text-text-secondary">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-text">Back up {trip.name}</h1>
      </div>

      {backup.status === 'unconfigured' ? (
        <p className="text-sm text-text-muted">
          Google Sheets backup isn't available in this version of the app.
        </p>
      ) : !backup.loaded ? (
        <div className="text-center py-6 text-text-muted text-sm">Loading...</div>
      ) : !link ? (
        <div className="mb-6">
          <p className="text-sm text-text-secondary mb-3">
            Create a spreadsheet in your own Google Drive with every expense, who paid, and
            what each person owes. You own the file — FairShare can only ever see sheets it
            created itself, never anything else in your Drive.
          </p>
          <button
            onClick={backup.connectAndCreate}
            disabled={busy}
            className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {busy ? 'Creating…' : 'Create backup sheet'}
          </button>
          <p className="text-xs text-text-muted mt-2">
            Google will ask you to allow this once.
          </p>
        </div>
      ) : (
        <div className="mb-6">
          <div className="bg-card border border-line rounded-lg px-3 py-3">
            <a
              href={link.spreadsheetUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-accent-text hover:text-accent-hover font-medium"
            >
              {link.title}
            </a>
            <p className="text-xs text-text-muted mt-0.5">
              {backup.isStale ? (
                <span className="text-warn-text">
                  Out of date — there are changes since the last backup
                </span>
              ) : (
                `Backed up ${relativeTime(link.lastSyncedAt)}`
              )}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={backup.syncNow}
                disabled={busy}
                className="bg-accent text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
              >
                {busy ? 'Syncing…' : backup.needsGesture ? 'Reconnect & sync' : 'Sync now'}
              </button>
              <button
                onClick={() => setShowUnlink(true)}
                disabled={busy}
                className="text-sm text-text-muted hover:text-danger-text px-2 py-1 rounded hover:bg-danger-bg disabled:opacity-50 transition-colors"
              >
                Unlink
              </button>
            </div>
          </div>

          {backup.isTrashed && (
            // Not an error — the sync worked. But Drive will purge the file and
            // the backup will stop existing, so saying nothing would be a lie.
            <div className="bg-warn-bg border border-warn-border rounded-lg px-3 py-2 mt-3">
              <p className="text-sm text-warn-text">
                This sheet is in your Google Drive trash. Backups still work for now,
                but Drive deletes trashed files after 30 days — and then this backup is
                gone. Restore it in Drive, or unlink and create a new one.
              </p>
            </div>
          )}

          <label className="flex items-start gap-2 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={link.autoSync}
              onChange={(e) => backup.setAutoSync(e.target.checked)}
              className="mt-0.5 accent-current text-accent"
            />
            <span className="text-xs text-text-muted">
              Keep the sheet up to date automatically while I'm using this {tl}. Google
              connections last about an hour, so after that you'll need to press Sync
              yourself — it will never interrupt you with a popup.
            </span>
          </label>
        </div>
      )}

      {error && (
        <div className="mb-6">
          <p className="text-sm text-danger-text bg-danger-bg rounded-lg px-3 py-2">
            {error.message}
          </p>
          {error.canRecreate && (
            <button
              onClick={async () => {
                await backup.unlink()
                backup.dismissError()
              }}
              className="text-sm text-accent-text hover:text-accent-hover font-medium mt-2"
            >
              Set up a new backup sheet
            </button>
          )}
        </div>
      )}

      {link && (
        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-medium text-text-secondary mb-2">
            What's in the sheet
          </h3>
          <p className="text-xs text-text-muted">
            Every expense with its date, description, currency and amount, plus a column
            per person showing what they paid and what they owe — so the numbers add up in
            the sheet the same way they do here. Comments and the activity log aren't
            included.
          </p>
          <p className="text-xs text-text-muted mt-2">
            FairShare overwrites these tabs each time it syncs, so edits you make in the
            sheet won't come back here and will be replaced on the next backup.
          </p>
          <p className="text-xs text-text-muted mt-2">
            The sheet lists the names and email addresses of everyone in this {tl} — worth
            knowing before you share it with anyone else.
          </p>
        </div>
      )}

      {showUnlink && (
        <DeleteModal
          title="Unlink this sheet?"
          message="FairShare will stop backing up to it. The spreadsheet stays in your Google Drive — nothing is deleted."
          confirmLabel="Yes, unlink"
          onConfirm={() => {
            setShowUnlink(false)
            void backup.unlink()
          }}
          onCancel={() => setShowUnlink(false)}
        />
      )}
    </div>
  )
}
