import { describe, it, expect } from 'vitest'
import { base, tilde } from './paths'

describe('base', () => {
  it('takes the last segment, trailing slash or not', () => {
    expect(base('/Users/me/code/megit')).toBe('megit')
    expect(base('/Users/me/code/megit/')).toBe('megit')
    expect(base('C:\\Users\\me\\megit')).toBe('megit')
  })

  it('falls back to the input when there is no segment', () => {
    expect(base('/')).toBe('/')
    expect(base('')).toBe('')
  })
})

describe('tilde', () => {
  it('replaces the home prefix', () => {
    expect(tilde('/Users/me/code/megit', '/Users/me')).toBe('~/code/megit')
    expect(tilde('C:\\Users\\me\\megit', 'C:\\Users\\me')).toBe('~\\megit')
  })

  it('shortens home itself', () => {
    expect(tilde('/Users/me', '/Users/me')).toBe('~')
  })

  it('leaves a path that only shares a prefix of the last segment', () => {
    expect(tilde('/Users/meredith/code', '/Users/me')).toBe('/Users/meredith/code')
  })

  it('leaves a path outside home, and copes with no home reported', () => {
    expect(tilde('/opt/src/megit', '/Users/me')).toBe('/opt/src/megit')
    expect(tilde('/Users/me/code', '')).toBe('/Users/me/code')
  })
})
