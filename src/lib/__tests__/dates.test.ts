import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { parseDateString, timestampToDateString, formatDateOnly, relativeTime } from '../dates'

describe('parseDateString', () => {
  it('parses as local midnight, not UTC', () => {
    const d = parseDateString('2026-06-10')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(5)
    expect(d.getDate()).toBe(10)
    expect(d.getHours()).toBe(0)
  })
})

describe('round trips', () => {
  it('date picked → stored → shown in the form stays the same day', () => {
    const stored = Timestamp.fromDate(parseDateString('2026-06-10'))
    expect(timestampToDateString(stored)).toBe('2026-06-10')
  })
})

describe('legacy UTC-midnight expenses', () => {
  it('shows the originally picked date regardless of local timezone', () => {
    // Old versions stored new Date('2026-06-10') = UTC midnight
    const legacy = Timestamp.fromDate(new Date('2026-06-10'))
    expect(timestampToDateString(legacy)).toBe('2026-06-10')
    expect(formatDateOnly(legacy, 'en-US')).toBe('6/10/2026')
  })
})

describe('formatDateOnly', () => {
  it('formats local-midnight dates', () => {
    const ts = Timestamp.fromDate(parseDateString('2026-01-05'))
    expect(formatDateOnly(ts, 'en-US')).toBe('1/5/2026')
  })

  it('returns empty for missing timestamps', () => {
    expect(formatDateOnly(undefined)).toBe('')
  })
})

describe('relativeTime', () => {
  const now = new Date(2026, 9, 3, 12, 0, 0)
  const ago = (ms: number) => new Date(now.getTime() - ms)
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    [0, 'just now'],
    [59_999, 'just now'],
    [MIN, '1m ago'],
    [59 * MIN, '59m ago'],
    [HOUR, '1h ago'],
    [23 * HOUR + 59 * MIN, '23h ago'],
    [DAY, 'yesterday'],
    [2 * DAY - 1, 'yesterday'],
    [2 * DAY, '2d ago'],
    [6 * DAY, '6d ago'],
  ])('%i ms ago → %s', (ms, label) => {
    expect(relativeTime(ago(ms))).toBe(label)
  })

  it('switches to a calendar date from a week out', () => {
    const date = ago(7 * DAY)
    expect(relativeTime(date)).toBe(date.toLocaleDateString())
  })
})
