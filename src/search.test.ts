import { describe, it, expect } from 'vitest'
import { matchLocal, stepMatch, label, type SearchRow } from './search'

const row = (over: Partial<SearchRow>): SearchRow =>
  ({ hash: 'aaaaaaa1', author: 'Ada', email: 'ada@x.dev', refs: [], subject: 'init', ...over })

const rows: SearchRow[] = [
  row({ hash: 'f1e2d3c', subject: 'Add Toast notifications' }),
  row({ hash: 'a9b8c7d', subject: 'fix lanes', author: 'Grace Hopper', email: 'grace@navy.mil' }),
  row({ hash: 'c0ffee1', subject: 'bump deps', refs: ['HEAD -> main', 'origin/main'] }),
]

describe('matchLocal', () => {
  it('matches the subject, case-insensitively', () => {
    expect(matchLocal(rows, 'toast')).toEqual(['f1e2d3c'])
    expect(matchLocal(rows, 'TOAST')).toEqual(['f1e2d3c'])
  })

  it('matches author name and email', () => {
    expect(matchLocal(rows, 'hopper')).toEqual(['a9b8c7d'])
    expect(matchLocal(rows, 'navy.mil')).toEqual(['a9b8c7d'])
  })

  it('matches ref names — loaded rows already carry them, so they are free', () => {
    expect(matchLocal(rows, 'origin/')).toEqual(['c0ffee1'])
  })

  it('matches a hash by prefix only, not substring', () => {
    expect(matchLocal(rows, 'c0ff')).toEqual(['c0ffee1'])
    expect(matchLocal(rows, '0ffee')).toEqual([])
  })

  it('returns hashes in commits order so "next" always moves down the screen', () => {
    expect(matchLocal(rows, 'a')).toEqual(['f1e2d3c', 'a9b8c7d', 'c0ffee1'])
  })

  it('treats an empty or whitespace query as no search at all', () => {
    expect(matchLocal(rows, '')).toEqual([])
    expect(matchLocal(rows, '   ')).toEqual([])
  })
})

describe('stepMatch', () => {
  it('wraps at both ends — a find-bar loops where the graph arrows clamp', () => {
    expect(stepMatch(4, 3, 1)).toBe(0)
    expect(stepMatch(4, 0, -1)).toBe(3)
  })

  it('steps normally in the middle', () => {
    expect(stepMatch(4, 1, 1)).toBe(2)
    expect(stepMatch(4, 2, -1)).toBe(1)
  })

  it('enters the list from either end when nothing is current yet', () => {
    expect(stepMatch(4, -1, 1)).toBe(0)
    expect(stepMatch(4, -1, -1)).toBe(3)
  })

  it('stays put on a single match and reports -1 on an empty list', () => {
    expect(stepMatch(1, 0, 1)).toBe(0)
    expect(stepMatch(0, -1, 1)).toBe(-1)
  })
})

describe('label', () => {
  it('counts from one', () => {
    expect(label(0, 4)).toBe('1 of 4')
    expect(label(3, 4)).toBe('4 of 4')
  })

  it('says so when there is nothing', () => {
    expect(label(-1, 0)).toBe('No results')
  })

  it('marks a truncated server result and the wider scope', () => {
    expect(label(0, 500, { truncated: true })).toBe('1 of 500+')
    expect(label(0, 37, { deep: true })).toBe('1 of 37 · all')
  })
})
