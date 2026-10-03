import { describe, expect, it } from 'vitest'
import { classifySignInError } from '../signInError'

const fbErr = (code: string) => Object.assign(new Error(code), { code })

describe('classifySignInError', () => {
  it.each(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'])(
    'stays silent when the person backed out or a retry superseded the popup (%s)',
    (code) => {
      expect(classifySignInError(fbErr(code))).toEqual({ kind: 'ignore' })
    }
  )

  it('tells the person about a blocked popup without reporting it', () => {
    const action = classifySignInError(fbErr('auth/popup-blocked'))
    expect(action).toMatchObject({ kind: 'tell', report: false })
    if (action.kind === 'tell') expect(action.message).toMatch(/pop-ups/)
  })

  it('tells the person about a network failure without reporting it', () => {
    expect(classifySignInError(fbErr('auth/network-request-failed'))).toMatchObject({
      kind: 'tell',
      report: false,
    })
  })

  it('tells and reports anything unexpected', () => {
    expect(classifySignInError(fbErr('auth/internal-error'))).toMatchObject({ kind: 'tell', report: true })
  })

  it('tells and reports errors with no Firebase code at all', () => {
    expect(classifySignInError(new Error('boom'))).toMatchObject({ kind: 'tell', report: true })
    expect(classifySignInError(undefined)).toMatchObject({ kind: 'tell', report: true })
    expect(classifySignInError(null)).toMatchObject({ kind: 'tell', report: true })
  })
})
