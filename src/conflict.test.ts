import { describe, expect, it } from 'vitest'
import { applyPicks, parseConflict, type Choice, type Segment } from './conflict'

// The shape git writes for a two-way conflict. Trailing newline on every line.
const TWO_WAY = [
  'top\n',
  '<<<<<<< HEAD\n',
  'ours line\n',
  '=======\n',
  'theirs line\n',
  '>>>>>>> feature/x\n',
  'bottom\n',
].join('')

// merge.conflictStyle=diff3 adds the common ancestor between ||||||| and =======
const DIFF3 = [
  '<<<<<<< HEAD\n',
  'ours line\n',
  '||||||| abc1234\n',
  'base line\n',
  '=======\n',
  'theirs line\n',
  '>>>>>>> feature/x\n',
].join('')

// picks every conflict segment the same way, so tests don't hand-count indexes
const pickAll = (segs: Segment[], choice: Choice) =>
  new Map(segs.flatMap((s, i) => (s.kind === 'conflict' ? [[i, choice] as [number, Choice]] : [])))

describe('parseConflict', () => {
  it('splits context and conflict segments', () => {
    const segs = parseConflict(TWO_WAY)!
    expect(segs.map(s => s.kind)).toEqual(['context', 'conflict', 'context'])
    expect(segs[1]).toMatchObject({
      kind: 'conflict',
      block: { ours: ['ours line\n'], theirs: ['theirs line\n'], base: null, oursLabel: 'HEAD', theirsLabel: 'feature/x' },
    })
  })

  it('captures the diff3 base section', () => {
    const segs = parseConflict(DIFF3)!
    expect(segs[0]).toMatchObject({ kind: 'conflict', block: { base: ['base line\n'] } })
  })

  it('returns null for text with no markers', () => {
    expect(parseConflict('just\nplain\ntext\n')).toBeNull()
  })

  it('returns null for an unterminated conflict', () => {
    expect(parseConflict('<<<<<<< HEAD\nours\n=======\ntheirs\n')).toBeNull()
  })

  it('returns null for a nested start marker', () => {
    expect(parseConflict('<<<<<<< HEAD\n<<<<<<< HEAD\n=======\n>>>>>>> x\n')).toBeNull()
  })

  it('handles multiple blocks in one file', () => {
    const segs = parseConflict(TWO_WAY + TWO_WAY)!
    expect(segs.filter(s => s.kind === 'conflict')).toHaveLength(2)
  })
})

describe('applyPicks', () => {
  it('takes ours', () => {
    const segs = parseConflict(TWO_WAY)!
    expect(applyPicks(segs, pickAll(segs, 'ours'))).toBe('top\nours line\nbottom\n')
  })

  it('takes theirs', () => {
    const segs = parseConflict(TWO_WAY)!
    expect(applyPicks(segs, pickAll(segs, 'theirs'))).toBe('top\ntheirs line\nbottom\n')
  })

  it('takes both, ours first', () => {
    const segs = parseConflict(TWO_WAY)!
    expect(applyPicks(segs, pickAll(segs, 'both'))).toBe('top\nours line\ntheirs line\nbottom\n')
  })

  it('never emits the base section', () => {
    const segs = parseConflict(DIFF3)!
    expect(applyPicks(segs, pickAll(segs, 'both'))).not.toContain('base line')
  })

  it('preserves CRLF line endings byte for byte', () => {
    const crlf = TWO_WAY.replace(/\n/g, '\r\n')
    const segs = parseConflict(crlf)!
    expect(applyPicks(segs, pickAll(segs, 'ours'))).toBe('top\r\nours line\r\nbottom\r\n')
  })

  it('preserves mixed line endings', () => {
    const mixed = 'top\r\n<<<<<<< HEAD\nours\n=======\r\ntheirs\n>>>>>>> x\nbottom\n'
    const segs = parseConflict(mixed)!
    expect(applyPicks(segs, pickAll(segs, 'ours'))).toBe('top\r\nours\nbottom\n')
  })

  it('preserves a missing final newline', () => {
    const segs = parseConflict('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> x\ntail')!
    expect(applyPicks(segs, pickAll(segs, 'ours'))).toBe('ours\ntail')
  })

  it('keeps the halves on separate lines when taking both at end of file', () => {
    // no trailing newline on the file at all — the case where a naive concat
    // would weld "ours" and "theirs" into one line. It can't: every content line
    // is followed by a marker line, so it carries its own terminator.
    const segs = parseConflict('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> x')!
    expect(applyPicks(segs, pickAll(segs, 'both'))).toBe('ours\ntheirs\n')
  })

  it('throws when a conflict segment has no pick', () => {
    const segs = parseConflict(TWO_WAY)!
    expect(() => applyPicks(segs, new Map())).toThrow(/no pick/)
  })
})
