import { describe, it, expect } from 'vitest'
import { isPermutation, touchRecent } from './config.ts'

describe('touchRecent', () => {
  it('puts the path first', () => {
    expect(touchRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })
  it('moves an existing path to the front instead of duplicating it', () => {
    expect(touchRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })
  it('caps the list, dropping the least recent', () => {
    const full = Array.from({ length: 12 }, (_, i) => `r${i}`)
    const out = touchRecent(full, 'new')
    expect(out).toHaveLength(12)
    expect(out[0]).toBe('new')
    expect(out).not.toContain('r11')
  })
})

describe('isPermutation', () => {
  it.each<[string[], string[], boolean]>([
    [['a', 'b', 'c'], ['c', 'a', 'b'], true],
    [[], [], true],
    [['a', 'b'], ['a', 'b'], true],
    // wrong length
    [['a'], ['a', 'b'], false],
    [['a', 'b', 'c'], ['a', 'b'], false],
    // same length, different members (path injection attempt)
    [['a', 'x'], ['a', 'b'], false],
    // duplicates must not pass as members
    [['a', 'a'], ['a', 'b'], false],
  ])('%j vs %j → %s', (a, b, expected) => {
    expect(isPermutation(a, b)).toBe(expected)
  })
})
