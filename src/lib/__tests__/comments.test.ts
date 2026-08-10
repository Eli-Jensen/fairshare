import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { mergeThread } from '../comments'
import type { Comment } from '../types'

const ts = (ms: number) => Timestamp.fromMillis(ms)
const legacy = (uid: string, text: string, ms: number) => ({ uid, text, createdAt: ts(ms) })
const live = (id: string, ms: number | null): Comment => ({
  id,
  authorUid: 'u1',
  text: id,
  // null = pending serverTimestamp on the optimistic local snapshot
  createdAt: (ms === null ? null : ts(ms)) as unknown as Timestamp,
})

describe('mergeThread', () => {
  it('handles empty inputs', () => {
    expect(mergeThread(undefined, [])).toEqual([])
    expect(mergeThread([], [])).toEqual([])
  })

  it('interleaves legacy and live chronologically', () => {
    const rows = mergeThread(
      [legacy('a', 'old', 1000), legacy('b', 'older still', 3000)],
      [live('mid', 2000), live('new', 4000)]
    )
    expect(rows.map((r) => (r.kind === 'legacy' ? r.text : r.comment.id))).toEqual([
      'old',
      'mid',
      'older still',
      'new',
    ])
  })

  it('pending serverTimestamps sort LAST — they are the newest', () => {
    const rows = mergeThread([legacy('a', 'old', 1000)], [live('acked', 2000), live('pending', null)])
    expect(rows.map((r) => (r.kind === 'legacy' ? r.text : r.comment.id))).toEqual([
      'old',
      'acked',
      'pending',
    ])
  })

  it('legacy keys are index-stable (the array is frozen)', () => {
    const rows = mergeThread([legacy('a', 'one', 1), legacy('b', 'two', 2)], [])
    expect(rows.map((r) => r.key)).toEqual(['legacy-0', 'legacy-1'])
  })

  it('live keys are the doc ids', () => {
    const rows = mergeThread(undefined, [live('c9', 5)])
    expect(rows[0].key).toBe('c9')
  })
})
