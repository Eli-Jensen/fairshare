import { deleteField, doc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'

/**
 * Emoji reactions — a `uid → emoji` map, ONE reaction per member: tapping
 * your current emoji retracts it, tapping another replaces it. Lives on the
 * expense doc (rides the wholesale member write) and on comment docs (where
 * rules restrict non-authors to exactly their own key). Any emoji goes: the
 * picker is the palette. (Model shared with good-boy-points.)
 *
 * Reactions are deliberately SILENT — no activity entry, no push. A 👍
 * needs to be cheap to give, and nobody's phone should buzz for it.
 */
export async function setReaction(
  tripId: string,
  expenseId: string,
  uid: string,
  emoji: string | null,
  commentId?: string
): Promise<void> {
  const target = commentId
    ? doc(db, 'trips', tripId, 'expenses', expenseId, 'comments', commentId)
    : doc(db, 'trips', tripId, 'expenses', expenseId)
  await updateDoc(target, { [`reactions.${uid}`]: emoji ?? deleteField() })
}

export interface ReactionGroup {
  emoji: string
  count: number
  uids: string[]
}

/** Group a reactions map for display: most-used first, ties alphabetical
 *  (stable across renders). Pure — unit-tested. */
export function groupReactions(
  reactions: Record<string, string> | undefined
): ReactionGroup[] {
  if (!reactions) return []
  const byEmoji = new Map<string, string[]>()
  for (const [uid, emoji] of Object.entries(reactions)) {
    if (!emoji) continue
    const list = byEmoji.get(emoji)
    if (list) list.push(uid)
    else byEmoji.set(emoji, [uid])
  }
  return [...byEmoji.entries()]
    .map(([emoji, uids]) => ({ emoji, count: uids.length, uids: uids.sort() }))
    .sort((a, b) => b.count - a.count || (a.emoji < b.emoji ? -1 : 1))
}
