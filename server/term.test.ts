import { describe, expect, it } from 'vitest'
import { MAX_PANES, pushCapped, termKey } from './term.ts'

describe('termKey', () => {
  it('scopes the session to repo and pane', () => {
    expect(termKey('/r', '0')).toBe('/r\x000')
    expect(termKey('/r', '1')).not.toBe(termKey('/r', '0'))
  })

  it('defaults a missing pane to 0', () => {
    expect(termKey('/r', null)).toBe(termKey('/r', '0'))
  })

  it('rejects panes past the cap', () => {
    expect(termKey('/r', String(MAX_PANES))).toBeNull()
    expect(termKey('/r', '9')).toBeNull()
  })

  it('rejects anything that is not a single digit', () => {
    for (const bad of ['', ' 1', '1 ', '01', '-1', '1e0', '0x1', 'a', '1/../2'])
      expect(termKey('/r', bad)).toBeNull()
  })
})

describe('pushCapped', () => {
  it('accumulates below the cap', () => {
    const buf: string[] = []
    let size = 0
    size = pushCapped(buf, size, 'aaa', 10)
    size = pushCapped(buf, size, 'bbb', 10)
    expect(buf.join('')).toBe('aaabbb')
    expect(size).toBe(6)
  })

  it('evicts oldest chunks past the cap', () => {
    const buf: string[] = []
    let size = 0
    for (const c of ['aaaa', 'bbbb', 'cccc']) size = pushCapped(buf, size, c, 8)
    expect(buf.join('')).toBe('bbbbcccc')
    expect(size).toBe(8)
  })

  it('always keeps the newest chunk, even oversized', () => {
    const buf: string[] = []
    let size = 0
    size = pushCapped(buf, size, 'aa', 4)
    size = pushCapped(buf, size, 'xxxxxxxx', 4)
    expect(buf).toEqual(['xxxxxxxx'])
    expect(size).toBe(8)
  })
})
