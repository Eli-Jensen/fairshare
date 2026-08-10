import { useState } from 'react'
import { notifyError } from '../lib/errorToast'
import { groupReactions, setReaction } from '../lib/reactions'
import { EmojiGrid } from './EmojiGrid'

/**
 * Tapbacks with the full emoji universe: existing reactions render as
 * joinable chips (tap to pile on, tap your own to take it back); the ➕
 * opens the picker for anything else. One reaction per member. Works on the
 * expense itself and on individual comments (pass commentId).
 * (Ported from good-boy-points.)
 */
export function ReactionBar({
  tripId,
  expenseId,
  commentId,
  reactions,
  meUid,
  compact = false,
}: {
  tripId: string
  expenseId: string
  commentId?: string
  reactions?: Record<string, string>
  meUid: string
  /** Comment rows: smaller chips, shorter empty-state label. */
  compact?: boolean
}) {
  const [showPicker, setShowPicker] = useState(false)
  const mine = reactions?.[meUid]
  const groups = groupReactions(reactions)

  function tap(emoji: string) {
    setShowPicker(false)
    // Optimistic-by-listener: the doc snapshot echoes the change; on failure
    // nothing moves and the toast says so.
    setReaction(tripId, expenseId, meUid, mine === emoji ? null : emoji, commentId).catch(
      (err) => {
        console.error('setReaction failed:', err)
        notifyError()
      }
    )
  }

  const chip = compact ? 'px-2 py-0 text-xs' : 'px-2.5 py-0.5 text-sm'

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {groups.map((g) => (
          <button
            key={g.emoji}
            type="button"
            onClick={() => tap(g.emoji)}
            aria-pressed={mine === g.emoji}
            title={mine === g.emoji ? 'Take your reaction back' : `React with ${g.emoji} too`}
            className={`rounded-full border transition-colors ${chip} ${
              mine === g.emoji
                ? 'border-accent bg-accent-soft'
                : 'border-line bg-card hover:bg-card-hover'
            }`}
          >
            {g.emoji} <span className="text-text-secondary">{g.count}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowPicker((s) => !s)}
          aria-expanded={showPicker}
          title="React with any emoji"
          className={`rounded-full border transition-colors ${chip} ${
            showPicker
              ? 'border-accent bg-accent-soft text-accent-text'
              : 'border-line bg-card text-text-secondary hover:bg-card-hover'
          }`}
        >
          {groups.length === 0 ? (compact ? '😀＋' : '😀＋ React') : '＋'}
        </button>
      </div>
      {showPicker && (
        <div className="mt-2">
          <EmojiGrid onPick={tap} />
        </div>
      )}
    </div>
  )
}
