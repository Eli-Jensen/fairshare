/**
 * Comments on expenses — docs at
 * /trips/{tripId}/expenses/{expenseId}/comments/{commentId}.
 *
 * The embedded `comments[]` array on the expense doc is LEGACY: frozen (its
 * only writer was deleted when this shipped), rendered read-only at the top
 * of the thread via mergeThread. No data migration — author-pinned create
 * rules rightly forbid writing docs under other people's uids.
 *
 * Every comment create moves two denorms on the expense doc, atomically in
 * the same writeBatch: commentCount (the card badge) and commenterUids
 * (append-only — the push function computes the conversation audience from
 * the expense doc it already reads, so a comment never costs it extra
 * reads). Deleting a comment decrements the count but deliberately does NOT
 * arrayRemove the uid: the author may have other comments, and
 * over-notifying an ex-commenter beats under-notifying a current one.
 */
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  increment,
  arrayUnion,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { deleteReceiptObjects } from './image'
import { writeActivity } from './activity'
import { notifyError } from './errorToast'
import type { Comment, Expense } from './types'
import type { GifResult } from './gif'

export const COMMENT_MAX_LENGTH = 500 // keep in sync with firestore.rules textOk()

export const commentImagePath = (tripId: string, commentId: string) =>
  `trips/${tripId}/comments/${commentId}.jpg`

export interface CommentInput {
  text?: string
  photoFile?: File
  gif?: GifResult
}

/**
 * Add a comment. Doc-ref-first so the photo uploads under the comment's own
 * id; a failed photo upload degrades to a photoless comment rather than a
 * lost one. Returns the new comment id.
 *
 * The batch commit is NOT awaited (offline-friendly, like every user-facing
 * write) — but the photo upload IS, since uploads have no offline queue.
 */
export async function addComment(
  tripId: string,
  expenseId: string,
  authorUid: string,
  input: CommentInput,
  expenseDescription: string
): Promise<string> {
  const ref = doc(collection(db, 'trips', tripId, 'expenses', expenseId, 'comments'))

  let photoPath: string | undefined
  if (input.photoFile) {
    try {
      const { uploadImage } = await import('./image')
      photoPath = await uploadImage(commentImagePath(tripId, ref.id), input.photoFile)
    } catch (err) {
      console.error('comment photo upload failed (saving without):', err)
    }
  }

  const text = input.text?.trim()
  const data: Record<string, unknown> = {
    authorUid,
    createdAt: serverTimestamp(),
  }
  if (text) data.text = text.slice(0, COMMENT_MAX_LENGTH)
  if (photoPath) data.photoPath = photoPath
  if (input.gif) {
    data.gifUrl = input.gif.url
    data.gifWidth = input.gif.width
    data.gifHeight = input.gif.height
  }

  const batch = writeBatch(db)
  batch.set(ref, data)
  batch.update(doc(db, 'trips', tripId, 'expenses', expenseId), {
    commentCount: increment(1),
    commenterUids: arrayUnion(authorUid),
  })
  batch.commit().catch((err) => {
    console.error('add comment failed:', err)
    notifyError("The comment didn't post. Check your connection and try again.")
  })

  // The push trigger. Media-only comments get truthful copy.
  const media: 'gif' | 'photo' | undefined = !text
    ? input.gif
      ? 'gif'
      : photoPath
        ? 'photo'
        : undefined
    : undefined
  writeActivity(tripId, {
    action: 'comment_added',
    actorUid: authorUid,
    targetDescription: expenseDescription,
    targetExpenseId: expenseId,
    ...(media ? { commentMedia: media } : {}),
  })

  return ref.id
}

/** Author-only (rules-enforced). Clearing the text on a media comment
 *  removes the field rather than storing ''. */
export function editComment(
  tripId: string,
  expenseId: string,
  commentId: string,
  text: string
): Promise<void> {
  const trimmed = text.trim().slice(0, COMMENT_MAX_LENGTH)
  return updateDoc(doc(db, 'trips', tripId, 'expenses', expenseId, 'comments', commentId), {
    text: trimmed || deleteField(),
    editedAt: serverTimestamp(),
  })
}

/** Any member (rules allow it; the UI offers it on your own comments). */
export function deleteComment(
  tripId: string,
  expenseId: string,
  commentId: string,
  photoPath?: string
): void {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'trips', tripId, 'expenses', expenseId, 'comments', commentId))
  batch.update(doc(db, 'trips', tripId, 'expenses', expenseId), {
    commentCount: increment(-1),
  })
  batch.commit().catch((err) => {
    console.error('delete comment failed:', err)
    notifyError()
  })
  if (photoPath) deleteReceiptObjects([photoPath])
}

/** Purge every comment doc (and comment photo) under an expense — called by
 *  the Trash purge and purgeTrip WHILE the trip doc still exists (rules).
 *  No count decrement: the parent doc is on its way out too. */
export async function purgeExpenseComments(tripId: string, expenseId: string): Promise<void> {
  try {
    const snap = await getDocs(collection(db, 'trips', tripId, 'expenses', expenseId, 'comments'))
    for (const d of snap.docs) {
      const p = (d.data() as { photoPath?: string }).photoPath
      if (p) deleteReceiptObjects([p])
    }
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
  } catch {
    // Best-effort — leftovers are swept when the trip is purged.
  }
}

// ── Thread merging (pure, unit-tested) ──────────────────────────────────────

export type ThreadRow =
  | { kind: 'legacy'; key: string; uid: string; text: string; createdAtMs: number }
  | { kind: 'live'; key: string; comment: Comment }

/**
 * Merge the frozen legacy array with live subcollection docs into one
 * chronological thread. Pending serverTimestamps (createdAt still null on
 * the optimistic snapshot) sort LAST — they are, in fact, the newest.
 * Legacy index keys are stable because the array is frozen.
 */
export function mergeThread(
  legacy: Expense['comments'],
  live: Comment[]
): ThreadRow[] {
  const rows: ThreadRow[] = []
  for (const [i, c] of (legacy ?? []).entries()) {
    rows.push({
      kind: 'legacy',
      key: `legacy-${i}`,
      uid: c.uid,
      text: c.text,
      createdAtMs: c.createdAt?.toMillis?.() ?? 0,
    })
  }
  for (const c of live) {
    rows.push({ kind: 'live', key: c.id, comment: c })
  }
  const ms = (r: ThreadRow) =>
    r.kind === 'legacy'
      ? r.createdAtMs
      : (r.comment.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER)
  return rows.sort((a, b) => ms(a) - ms(b))
}
