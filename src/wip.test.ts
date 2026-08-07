import { describe, it, expect } from 'vitest'
import { splitStatus } from './wip'

describe('splitStatus', () => {
  it('sorts each side by its own status code', () => {
    const { staged, unstaged } = splitStatus([
      { path: 'a.ts', status: 'M', x: 'M', y: '.' }, // staged edit
      { path: 'b.ts', status: 'M', x: '.', y: 'M' }, // unstaged edit
      { path: 'new.txt', status: '?', x: '.', y: '?' }, // untracked
    ])
    expect(staged).toEqual([{ path: 'a.ts', status: 'M', x: 'M', y: '.' }])
    expect(unstaged.map(f => [f.path, f.status])).toEqual([['b.ts', 'M'], ['new.txt', '?']])
  })

  it('lists a partially staged file on both sides with the right code each time', () => {
    // added to the index, then edited again in the worktree
    const { staged, unstaged } = splitStatus([{ path: 'a.ts', status: 'M', x: 'A', y: 'M' }])
    expect(staged.map(f => [f.path, f.status])).toEqual([['a.ts', 'A']])
    expect(unstaged.map(f => [f.path, f.status])).toEqual([['a.ts', 'M']])
  })

  it('puts conflicts in their own section, out of both other sides', () => {
    // a conflict is neither staged nor unstaged, and it must not sit next to
    // ordinary edits: those rows carry Stage, and staging a file still full of
    // markers is the mistake this separation exists to prevent
    const { staged, unstaged, conflicts } = splitStatus([
      { path: 'c.ts', status: 'U', x: '.', y: 'U' },
      { path: 'b.ts', status: 'M', x: '.', y: 'M' },
    ])
    expect(staged).toEqual([])
    expect(unstaged.map(f => f.path)).toEqual(['b.ts'])
    expect(conflicts.map(f => [f.path, f.status])).toEqual([['c.ts', 'U']])
  })

  it('ignores entries with no sides (commit file lists)', () => {
    expect(splitStatus([{ path: 'a.ts', status: 'M' }])).toEqual({ staged: [], unstaged: [], conflicts: [] })
  })
})
