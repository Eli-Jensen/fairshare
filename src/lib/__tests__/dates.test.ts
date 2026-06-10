import { describe, it, expect } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { todayString, parseDateString, timestampToDateString, formatDateOnly } from '../dates'

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

  it('today round-trips', () => {
    const stored = Timestamp.fromDate(parseDateString(todayString()))
    expect(timestampToDateString(stored)).toBe(todayString())
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
