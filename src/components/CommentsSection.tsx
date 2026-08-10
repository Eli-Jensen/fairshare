import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Expense, UserProfile } from '../lib/types'
import { getMemberName } from '../lib/types'
import { relativeTime } from '../lib/dates'
import { useComments } from '../hooks/useComments'
import { useOnline } from '../hooks/useOnline'
import { useImageUrl } from '../hooks/useImageUrl'
import {
  addComment,
  editComment,
  deleteComment,
  mergeThread,
  COMMENT_MAX_LENGTH,
} from '../lib/comments'
import { gifConfigured, type GifResult } from '../lib/gif'
import { MemberAvatar } from './MemberAvatar'
import { ReactionBar } from './ReactionBar'
import { EmojiGrid } from './EmojiGrid'
import { Lightbox } from './Lightbox'
import { ConfirmButton } from './ConfirmButton'
import type { Comment } from '../lib/types'

// Only people who tap GIF pay for the picker chunk.
const GifPicker = lazy(() => import('./GifPicker'))

/**
 * The expense's comment thread: frozen legacy rows (read-only) merged above
 * live subcollection docs (reactions, edit/delete-own, GIFs, photos), plus
 * the composer. Ported from good-boy-points, minus its court apparatus.
 */
export function CommentsSection({
  tripId,
  expense,
  members,
  meUid,
}: {
  tripId: string
  expense: Expense
  members: Record<string, UserProfile>
  meUid: string
}) {
  const online = useOnline()
  const { comments } = useComments(tripId, expense.id)
  const thread = mergeThread(expense.comments, comments)
  const count = (expense.comments?.length ?? 0) + comments.length

  // Composer state
  const [text, setText] = useState('')
  const [gif, setGif] = useState<GifResult | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showGifs, setShowGifs] = useState(false)
  const [posting, setPosting] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)

  const canPost = Boolean(text.trim() || gif || (photo && online))

  async function post() {
    if (!canPost || posting) return
    setPosting(true)
    try {
      // addComment awaits only the photo upload; the doc write is
      // fire-and-forget inside. The listener echoes the new doc instantly.
      await addComment(
        tripId,
        expense.id,
        meUid,
        { text: text.trim() || undefined, gif: gif ?? undefined, photoFile: photo ?? undefined },
        expense.description
      )
      setText('')
      setGif(null)
      setPhoto(null)
      setShowEmoji(false)
      setShowGifs(false)
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-line">
      <h3 className="text-sm font-medium text-text-secondary mb-3">
        Comments {count > 0 ? `(${count})` : ''}
      </h3>

      {thread.length > 0 && (
        <div className="space-y-3 mb-4">
          {thread.map((row) =>
            row.kind === 'legacy' ? (
              <div key={row.key} className="flex gap-2">
                <MemberAvatar member={members[row.uid]} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-text-muted">
                    {getMemberName(row.uid, members)}
                    {row.createdAtMs > 0 && <> · {relativeTime(new Date(row.createdAtMs))}</>}
                  </p>
                  <p className="text-sm text-text whitespace-pre-wrap break-words">{row.text}</p>
                </div>
              </div>
            ) : (
              <LiveComment
                key={row.key}
                tripId={tripId}
                expenseId={expense.id}
                comment={row.comment}
                members={members}
                meUid={meUid}
                onLightbox={(src, alt) => setLightbox({ src, alt })}
              />
            )
          )}
        </div>
      )}

      {/* Composer */}
      <div className="space-y-2">
        {gif && (
          <div className="relative inline-block">
            <img
              src={gif.previewUrl}
              alt="Chosen GIF"
              className="h-20 rounded-lg border border-line"
            />
            <button
              type="button"
              aria-label="Remove GIF"
              onClick={() => setGif(null)}
              className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-card border border-line text-xs text-text-secondary shadow hover:text-danger-text"
            >
              ✕
            </button>
          </div>
        )}
        {photo && (
          <StagedPhoto file={photo} onRemove={() => setPhoto(null)} />
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={text}
            maxLength={COMMENT_MAX_LENGTH}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                post()
              }
            }}
            placeholder="Add a comment…"
            className="flex-1 min-w-0 border border-line rounded-lg px-3 py-2 text-sm bg-input text-text focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <button
            type="button"
            onClick={() => {
              setShowEmoji((s) => !s)
              setShowGifs(false)
            }}
            aria-expanded={showEmoji}
            aria-label="Add emoji"
            className="rounded-lg border border-line bg-card px-2.5 text-sm text-text-secondary hover:bg-card-hover transition-colors"
          >
            🙂
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f && f.type.startsWith('image/')) setPhoto(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            disabled={!online}
            onClick={() => photoInputRef.current?.click()}
            aria-label="Attach photo"
            title={online ? 'Attach photo' : 'Photos need a connection'}
            className="rounded-lg border border-line bg-card px-2.5 text-sm text-text-secondary hover:bg-card-hover disabled:opacity-50 transition-colors"
          >
            📷
          </button>
          {gifConfigured() && (
            <button
              type="button"
              onClick={() => {
                setShowGifs((s) => !s)
                setShowEmoji(false)
              }}
              aria-expanded={showGifs}
              className="rounded-lg border border-line bg-card px-2.5 text-xs font-semibold text-text-secondary hover:bg-card-hover transition-colors"
            >
              GIF
            </button>
          )}
          <button
            type="button"
            onClick={post}
            disabled={!canPost || posting}
            className="bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            Post
          </button>
        </div>
        {showEmoji && <EmojiGrid onPick={(e) => setText((t) => t + e)} />}
        {showGifs && (
          <Suspense
            fallback={<p className="py-4 text-center text-sm text-text-muted">Loading…</p>}
          >
            <GifPicker
              onPick={(g) => {
                setGif(g)
                setShowGifs(false)
              }}
              onClose={() => setShowGifs(false)}
            />
          </Suspense>
        )}
      </div>

      {lightbox && (
        <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}

function StagedPhoto({ file, onRemove }: { file: File; onRemove: () => void }) {
  // Object URL lifecycle == component lifecycle (same pattern as receipts).
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return (
    <div className="relative inline-block">
      {url && <img src={url} alt="Attached" className="h-20 rounded-lg border border-line" />}
      <button
        type="button"
        aria-label="Remove photo"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-card border border-line text-xs text-text-secondary shadow hover:text-danger-text"
      >
        ✕
      </button>
    </div>
  )
}

function LiveComment({
  tripId,
  expenseId,
  comment,
  members,
  meUid,
  onLightbox,
}: {
  tripId: string
  expenseId: string
  comment: Comment
  members: Record<string, UserProfile>
  meUid: string
  onLightbox: (src: string, alt: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.text ?? '')
  const photoUrl = useImageUrl(comment.photoPath)
  const mine = comment.authorUid === meUid
  const created = comment.createdAt?.toDate?.()

  return (
    <div className="flex gap-2">
      <MemberAvatar member={members[comment.authorUid]} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text-muted">
          {getMemberName(comment.authorUid, members)}
          {created && <> · {relativeTime(created)}</>}
          {comment.editedAt && <> · edited</>}
        </p>

        {editing ? (
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={draft}
              maxLength={COMMENT_MAX_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 min-w-0 border border-line rounded-lg px-2 py-1 text-sm bg-input text-text"
            />
            <button
              type="button"
              onClick={() => {
                editComment(tripId, expenseId, comment.id, draft).catch(() => {})
                setEditing(false)
              }}
              className="text-xs font-medium text-accent-text"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(comment.text ?? '')
                setEditing(false)
              }}
              className="text-xs text-text-muted"
            >
              Cancel
            </button>
          </div>
        ) : (
          comment.text && (
            <p className="text-sm text-text whitespace-pre-wrap break-words">{comment.text}</p>
          )
        )}

        {comment.gifUrl && (
          <button
            type="button"
            className="mt-1 block"
            onClick={() => onLightbox(comment.gifUrl!, 'GIF')}
          >
            <img
              src={comment.gifUrl}
              alt="GIF"
              width={comment.gifWidth || undefined}
              height={comment.gifHeight || undefined}
              loading="lazy"
              className="max-h-48 w-auto rounded-lg border border-line"
              onError={(e) => {
                // CDN content can vanish — a broken-image icon is uglier
                // than nothing.
                e.currentTarget.style.display = 'none'
              }}
            />
          </button>
        )}
        {comment.photoPath &&
          (photoUrl ? (
            <button
              type="button"
              className="mt-1 block"
              onClick={() => onLightbox(photoUrl, 'Attached photo')}
            >
              <img
                src={photoUrl}
                alt="Attached"
                loading="lazy"
                className="max-h-48 w-auto rounded-lg border border-line"
              />
            </button>
          ) : (
            <div aria-hidden className="mt-1 h-24 w-32 animate-pulse rounded-lg bg-muted" />
          ))}

        <div className="mt-1.5 flex items-center gap-3">
          <ReactionBar
            tripId={tripId}
            expenseId={expenseId}
            commentId={comment.id}
            reactions={comment.reactions}
            meUid={meUid}
            compact
          />
          {mine && !editing && (
            <>
              {comment.text && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-xs text-text-muted hover:text-text"
                >
                  Edit
                </button>
              )}
              <ConfirmButton
                label="Delete"
                confirmLabel="Really delete?"
                onConfirm={() =>
                  deleteComment(tripId, expenseId, comment.id, comment.photoPath)
                }
                className="text-xs text-text-muted hover:text-danger-text"
                confirmClassName="text-xs font-medium text-danger-text"
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
