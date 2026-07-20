import { describe, it, expect } from 'vitest'
import { isPermutation } from './config.ts'

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
