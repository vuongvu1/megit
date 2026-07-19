import { describe, it, expect } from 'vitest'
import { parseLog, parseStatus } from './parse.ts'

const F = '\x1f'
const R = '\x1e'

describe('parseLog', () => {
  it('parses records with refs and parents', () => {
    const raw =
      `aaa${F}bbb ccc${F}Vu${F}1750000000${F}HEAD -> main, origin/main${F}merge stuff${R}\n` +
      `bbb${F}${F}Vu${F}1749999999${F}${F}initial${R}\n`
    expect(parseLog(raw)).toEqual([
      { hash: 'aaa', parents: ['bbb', 'ccc'], author: 'Vu', date: 1750000000, refs: ['HEAD -> main', 'origin/main'], subject: 'merge stuff' },
      { hash: 'bbb', parents: [], author: 'Vu', date: 1749999999, refs: [], subject: 'initial' },
    ])
  })

  it('handles empty input', () => {
    expect(parseLog('')).toEqual([])
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
