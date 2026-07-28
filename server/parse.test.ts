import { describe, it, expect } from 'vitest'
import { mergeMatches, parseBranchHeader, parseLog, parseMatches, parseMeta, parseNameStatus, parseStatus, stashIndex } from './parse.ts'

const F = '\x1f'
const R = '\x1e'
// -z output: every record NUL-terminated, so a fixture ends with one too
const z = (...recs: string[]) => recs.map(r => r + '\0').join('')

describe('parseLog', () => {
  it('parses records with refs and parents', () => {
    const raw =
      `aaa${F}bbb ccc${F}Vu${F}vu@example.com${F}1750000000${F}HEAD -> main, origin/main${F}merge stuff${R}\n` +
      `bbb${F}${F}Vu${F}vu@example.com${F}1749999999${F}${F}initial${R}\n`
    expect(parseLog(raw)).toEqual([
      { hash: 'aaa', parents: ['bbb', 'ccc'], author: 'Vu', email: 'vu@example.com', date: 1750000000, refs: ['HEAD -> main', 'origin/main'], subject: 'merge stuff' },
      { hash: 'bbb', parents: [], author: 'Vu', email: 'vu@example.com', date: 1749999999, refs: [], subject: 'initial' },
    ])
  })

  it('handles empty input', () => {
    expect(parseLog('')).toEqual([])
  })
})

describe('parseMeta', () => {
  it('parses author, committer, parents and multi-line message', () => {
    const raw = `Vu${F}vu@example.com${F}1750000000${F}GitHub${F}noreply@github.com${F}1750000100${F}aaa bbb${F}feat: subject\n\nbody line 1\nbody line 2\n`
    expect(parseMeta(raw)).toEqual({
      author: 'Vu',
      authorEmail: 'vu@example.com',
      authorDate: 1750000000,
      committer: 'GitHub',
      committerEmail: 'noreply@github.com',
      commitDate: 1750000100,
      parents: ['aaa', 'bbb'],
      message: 'feat: subject\n\nbody line 1\nbody line 2',
    })
  })

  it('handles root commit (no parents)', () => {
    const raw = `Vu${F}vu@example.com${F}1${F}Vu${F}vu@example.com${F}1${F}${F}initial\n`
    expect(parseMeta(raw).parents).toEqual([])
  })
})

describe('parseStatus', () => {
  it('parses porcelain v2 entries', () => {
    const raw = z(
      '1 .M N... 100644 100644 100644 abc def src/App.tsx',
      '1 A. N... 000000 100644 100644 000 111 new file.ts',
      // rename: under -z the original path is its own record after the entry
      '2 R. N... 100644 100644 100644 abc def R100 new.ts',
      'old.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
      '? untracked.txt',
    )
    expect(parseStatus(raw)).toEqual([
      { path: 'src/App.tsx', status: 'M', x: '.', y: 'M' },
      { path: 'new file.ts', status: 'A', x: 'A', y: '.' },
      { path: 'new.ts', status: 'R', x: 'R', y: '.' },
      { path: 'conflict.ts', status: 'U', x: '.', y: 'U' },
      { path: 'untracked.txt', status: '?', x: '.', y: '?' },
    ])
  })

  // the whole reason for -z: these paths come back raw instead of C-quoted
  // ("\303\274mlaut.txt"), which is what git needs to accept them as a pathspec
  it('keeps paths with non-ASCII bytes, tabs and quotes usable', () => {
    const raw = z(
      '1 .M N... 100644 100644 100644 abc def ümlaut.txt',
      '? tab\tname.txt',
      '? quote"name.txt',
      '2 R. N... 100644 100644 100644 abc def R100 renamed ünder.txt',
      'plain space.txt',
    )
    expect(parseStatus(raw).map(f => f.path)).toEqual([
      'ümlaut.txt', 'tab\tname.txt', 'quote"name.txt', 'renamed ünder.txt',
    ])
  })

  it('does not mistake a rename original for its own entry', () => {
    // "1 file.ts" as an original path would parse as a type-1 entry if not skipped
    const raw = z('2 R. N... 100644 100644 100644 abc def R100 new.ts', '? weird.ts')
    expect(parseStatus(raw)).toEqual([{ path: 'new.ts', status: 'R', x: 'R', y: '.' }])
  })

  it('handles empty input', () => {
    expect(parseStatus('')).toEqual([])
  })

  it('ignores the --branch headers', () => {
    const raw = z('# branch.oid aaa', '# branch.head main', '# branch.ab +1 -2', '? untracked.txt')
    expect(parseStatus(raw)).toEqual([{ path: 'untracked.txt', status: '?', x: '.', y: '?' }])
  })
})

describe('parseNameStatus', () => {
  it('pairs each status with its path, two paths for a rename', () => {
    const raw = z('M', 'src/App.tsx', 'A', 'ümlaut.txt', 'R100', 'old.ts', 'new.ts', 'D', 'gone.ts')
    expect(parseNameStatus(raw)).toEqual([
      { status: 'M', path: 'src/App.tsx' },
      { status: 'A', path: 'ümlaut.txt' },
      { status: 'R', path: 'new.ts' }, // the name it has now, not the one it had
      { status: 'D', path: 'gone.ts' },
    ])
  })

  it('handles empty input and a truncated trailing record', () => {
    expect(parseNameStatus('')).toEqual([])
    expect(parseNameStatus(z('M'))).toEqual([])
  })
})

describe('parseBranchHeader', () => {
  it('reads branch, upstream and ahead/behind', () => {
    const raw = z('# branch.oid aaa', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +3 -2', '1 .M N... 1 1 1 a b src/App.tsx')
    expect(parseBranchHeader(raw)).toEqual({ head: 'main', upstream: 'origin/main', ahead: 3, behind: 2 })
  })

  it('reports no upstream — git omits the upstream and ab lines entirely', () => {
    expect(parseBranchHeader(z('# branch.oid aaa', '# branch.head feature/x'))).toEqual({
      head: 'feature/x', upstream: null, ahead: 0, behind: 0,
    })
  })

  it('reports a detached HEAD', () => {
    expect(parseBranchHeader(z('# branch.oid aaa', '# branch.head (detached)')).head).toBeNull()
  })

  it('handles an empty repo and missing headers', () => {
    // unborn branch: oid is "(initial)", but the branch name is still reported
    expect(parseBranchHeader(z('# branch.oid (initial)', '# branch.head main')).head).toBe('main')
    expect(parseBranchHeader('')).toEqual({ head: null, upstream: null, ahead: 0, behind: 0 })
  })

  // a slash is legal in a branch name and the value runs to the record end
  it('keeps the whole value, not just the first word', () => {
    expect(parseBranchHeader(z('# branch.head feat/some thing')).head).toBe('feat/some thing')
  })
})

describe('stashIndex', () => {
  const raw = 'aaa\nbbb\nccc\n'
  it('maps a sha to its stash@{N} position', () => {
    expect(stashIndex(raw, 'aaa')).toBe(0)
    expect(stashIndex(raw, 'ccc')).toBe(2)
  })
  it('returns -1 when the stash is gone', () => {
    expect(stashIndex(raw, 'ddd')).toBe(-1)
    expect(stashIndex('', 'aaa')).toBe(-1)
  })
})

describe('parseMatches', () => {
  it('reads %H\x1f%ct lines into hash/date pairs', () => {
    expect(parseMatches(`aaa${F}300\nbbb${F}200\n`)).toEqual([['aaa', 300], ['bbb', 200]])
  })

  it('handles empty output', () => {
    expect(parseMatches('')).toEqual([])
    expect(parseMatches('\n')).toEqual([])
  })
})

describe('mergeMatches', () => {
  it('unions the lists and orders by commit date, newest first', () => {
    const byMsg: [string, number][] = [['a', 300], ['c', 100]]
    const byAuthor: [string, number][] = [['b', 200]]
    expect(mergeMatches([byMsg, byAuthor]).matches).toEqual(['a', 'b', 'c'])
  })

  it('dedupes a commit that matched on more than one field', () => {
    const byMsg: [string, number][] = [['a', 300]]
    const byAuthor: [string, number][] = [['a', 300], ['b', 200]]
    expect(mergeMatches([byMsg, byAuthor]).matches).toEqual(['a', 'b'])
  })

  it('caps at 500 and flags the truncation', () => {
    const many: [string, number][] = Array.from({ length: 501 }, (_, i) => [`h${i}`, 1000 - i])
    const res = mergeMatches([many])
    expect(res.matches).toHaveLength(500)
    expect(res.truncated).toBe(true)
    expect(res.matches[0]).toBe('h0')
  })

  it('reports no truncation at exactly the cap, and handles empty input', () => {
    const exact: [string, number][] = Array.from({ length: 500 }, (_, i) => [`h${i}`, 1000 - i])
    expect(mergeMatches([exact]).truncated).toBe(false)
    expect(mergeMatches([])).toEqual({ matches: [], truncated: false })
    expect(mergeMatches([[], []])).toEqual({ matches: [], truncated: false })
  })
})
