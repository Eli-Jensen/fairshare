import { describe, it, expect } from 'vitest'
import { buildRestorePlan } from '../sheetRestore'
import type { SheetPerson, SheetSnapshot } from '../sheetSnapshot'

const person = (id: string, email: string, isSelf = false): SheetPerson => ({
  id,
  name: id,
  email,
  status: 'member',
  isSelf,
})

// buildRestorePlan only reads tripName and people.
const snapshot = (people: SheetPerson[]) =>
  ({ tripName: 'Tokyo', people }) as unknown as SheetSnapshot

const kinds = (plan: ReturnType<typeof buildRestorePlan>) =>
  Object.fromEntries(plan.participants.map((p) => [p.person.id, p.kind]))

describe('buildRestorePlan', () => {
  it("restores the sheet's own author as you", () => {
    const plan = buildRestorePlan(
      snapshot([person('a', 'a@x.com', true), person('b', 'b@x.com')]),
      'someone-else@x.com'
    )
    expect(plan.tripName).toBe('Tokyo')
    expect(kinds(plan)).toEqual({ a: 'self', b: 'guest' })
  })

  it('matches you by email when the sheet marks nobody', () => {
    const plan = buildRestorePlan(snapshot([person('a', 'a@x.com'), person('b', 'b@x.com')]), 'b@x.com')
    expect(kinds(plan)).toEqual({ a: 'guest', b: 'self' })
  })

  // The parser lowercases sheet emails; Google can hand back capitals
  it('matches your email regardless of case', () => {
    const plan = buildRestorePlan(snapshot([person('a', 'a@x.com')]), 'A@X.com')
    expect(kinds(plan)).toEqual({ a: 'self' })
  })

  it('makes only the first match you, so a trip never gets two of you', () => {
    const plan = buildRestorePlan(
      snapshot([person('a', 'me@x.com', true), person('b', 'me@x.com'), person('c', '', true)]),
      'me@x.com'
    )
    expect(kinds(plan)).toEqual({ a: 'self', b: 'guest', c: 'guest' })
  })

  it('makes everyone a guest when nothing matches, and never matches a blank email', () => {
    const plan = buildRestorePlan(snapshot([person('a', ''), person('b', 'b@x.com')]), null)
    expect(kinds(plan)).toEqual({ a: 'guest', b: 'guest' })
    expect(kinds(buildRestorePlan(snapshot([person('a', '')]), ''))).toEqual({ a: 'guest' })
  })

  it('prefills each guest invite with their sheet email', () => {
    const plan = buildRestorePlan(snapshot([person('a', 'a@x.com')]), null)
    expect(plan.participants[0].email).toBe('a@x.com')
  })
})
