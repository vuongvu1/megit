import { describe, it, expect } from 'vitest'
import { parseLog, parseMeta, parseStatus } from './parse.ts'

const F = '\x1f'
const R = '\x1e'

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
    const raw = [
      '1 .M N... 100644 100644 100644 abc def src/App.tsx',
      '1 A. N... 000000 100644 100644 000 111 new file.ts',
      '2 R. N... 100644 100644 100644 abc def R100 new.ts\told.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
      '? untracked.txt',
    ].join('\n')
    expect(parseStatus(raw)).toEqual([
      { path: 'src/App.tsx', status: 'M' },
      { path: 'new file.ts', status: 'A' },
      { path: 'new.ts', status: 'R' },
      { path: 'conflict.ts', status: 'U' },
      { path: 'untracked.txt', status: '?' },
    ])
  })

  it('handles empty input', () => {
    expect(parseStatus('')).toEqual([])
  })
})
