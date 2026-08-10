import { describe, it, expect } from 'vitest'
import { groupReactions } from '../reactions'

describe('groupReactions', () => {
  it('returns [] for undefined or empty maps', () => {
    expect(groupReactions(undefined)).toEqual([])
    expect(groupReactions({})).toEqual([])
  })

  it('groups users under their emoji with sorted uids', () => {
    const out = groupReactions({ b: '😂', a: '😂', c: '👍' })
    expect(out).toEqual([
      { emoji: '😂', count: 2, uids: ['a', 'b'] },
      { emoji: '👍', count: 1, uids: ['c'] },
    ])
  })

  it('orders by count desc, ties alphabetical (any emoji welcome)', () => {
    const out = groupReactions({ a: '🗿', b: '🦖', c: '🦖', d: '🍕', e: '🀄' })
    expect(out.map((g) => g.emoji)).toEqual(['🦖', '🀄', '🍕', '🗿'])
  })

  it('skips empty-string reactions', () => {
    expect(groupReactions({ a: '', b: '👍' })).toEqual([
      { emoji: '👍', count: 1, uids: ['b'] },
    ])
  })
})
