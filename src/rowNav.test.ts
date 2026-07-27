import { describe, it, expect } from 'vitest'
import { rowOrder, sameRow, step } from './rowNav'

const commits = [{ hash: 'c1' }, { hash: 'c2' }, { hash: 'c3' }]
const noStashes = new Map<number, { s: { hash: string } }[]>()

describe('rowOrder', () => {
  it('lists commits top-down with the WIP row first', () => {
    expect(rowOrder(commits, noStashes, true)).toEqual([
      { kind: 'wip' },
      { kind: 'commit', hash: 'c1' },
      { kind: 'commit', hash: 'c2' },
      { kind: 'commit', hash: 'c3' },
    ])
  })

  it('omits the WIP row when the worktree is clean', () => {
    expect(rowOrder(commits, noStashes, false)[0]).toEqual({ kind: 'commit', hash: 'c1' })
  })

  it('puts stash rows above the commit they were inserted at, in list order', () => {
    const byRow = new Map([[1, [{ s: { hash: 's1' } }, { s: { hash: 's2' } }]]])
    expect(rowOrder(commits, byRow, false).map(r => (r.kind === 'wip' ? 'wip' : r.hash)))
      .toEqual(['c1', 's1', 's2', 'c2', 'c3'])
  })

  it('handles an empty repo', () => {
    expect(rowOrder([], noStashes, false)).toEqual([])
    expect(rowOrder([], noStashes, true)).toEqual([{ kind: 'wip' }])
  })
})

describe('sameRow', () => {
  it('matches on kind and hash', () => {
    expect(sameRow({ kind: 'wip' }, { kind: 'wip' })).toBe(true)
    expect(sameRow({ kind: 'commit', hash: 'a' }, { kind: 'commit', hash: 'a' })).toBe(true)
    expect(sameRow({ kind: 'commit', hash: 'a' }, { kind: 'commit', hash: 'b' })).toBe(false)
    expect(sameRow({ kind: 'wip' }, { kind: 'commit', hash: 'a' })).toBe(false)
  })

  it('never matches a null selection', () => {
    expect(sameRow(null, null)).toBe(false)
    expect(sameRow(null, { kind: 'wip' })).toBe(false)
  })
})

describe('step', () => {
  it('moves one row at a time', () => {
    expect(step(5, 0, 'ArrowDown')).toBe(1)
    expect(step(5, 3, 'ArrowUp')).toBe(2)
  })

  it('enters the list from either end when nothing is selected', () => {
    expect(step(5, -1, 'ArrowDown')).toBe(0)
    expect(step(5, -1, 'ArrowUp')).toBe(4)
  })

  it('clamps at the ends rather than wrapping — a held key has to stop', () => {
    expect(step(5, 4, 'ArrowDown')).toBeNull()
    expect(step(5, 0, 'ArrowUp')).toBeNull()
  })

  it('jumps to either end, and reports no move when already there', () => {
    expect(step(5, 2, 'Home')).toBe(0)
    expect(step(5, 2, 'End')).toBe(4)
    expect(step(5, 0, 'Home')).toBeNull()
    expect(step(5, 4, 'End')).toBeNull()
  })

  it('ignores other keys and an empty list', () => {
    expect(step(5, 2, 'r')).toBeNull()
    expect(step(5, 2, 'PageDown')).toBeNull()
    expect(step(0, -1, 'ArrowDown')).toBeNull()
  })
})
