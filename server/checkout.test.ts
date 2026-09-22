import { describe, it, expect } from 'vitest'
import { checkoutPlan } from './checkout'

describe('checkoutPlan', () => {
  it('checks out a branch that matches its remote', () => {
    expect(checkoutPlan(0, 0, false)).toBe('plain')
  })

  it('fast-forwards a branch that is strictly behind', () => {
    expect(checkoutPlan(0, 3, false)).toBe('fast-forward')
  })

  it('checks out a branch that is only ahead, without asking', () => {
    // unpushed commits are the normal state — offering a reset here loses them
    expect(checkoutPlan(3, 0, false)).toBe('plain')
  })

  it('never resets a branch that is only ahead, even when reset was requested', () => {
    expect(checkoutPlan(3, 0, true)).toBe('plain')
  })

  it('asks before discarding ahead-only commits when the remote chip was clicked', () => {
    expect(checkoutPlan(3, 0, false, true)).toBe('ask')
    expect(checkoutPlan(3, 0, true, true)).toBe('reset')
  })

  it('just fast-forwards a behind branch clicked from its remote chip', () => {
    expect(checkoutPlan(0, 3, false, true)).toBe('fast-forward')
  })

  it('asks before touching a genuinely diverged branch', () => {
    expect(checkoutPlan(2, 5, false)).toBe('ask')
  })

  it('resets a diverged branch once the user confirmed', () => {
    expect(checkoutPlan(2, 5, true)).toBe('reset')
  })
})
