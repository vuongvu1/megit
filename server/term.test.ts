import { describe, expect, it } from 'vitest'
import { pushCapped } from './term.ts'

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
