import { describe, expect, it } from 'vitest'
import { build, emit, gaps, parse, reveal, STEP, totalLines } from './diffExpand'

// 60-line file, line 30 changed; narrow = what git -U3 emits, full = git -U<all>
const head = ['diff --git a/a.txt b/a.txt', 'index 111..222 100644', '--- a/a.txt', '+++ b/a.txt']
const body = (from: number, to: number) => {
  const out: string[] = []
  for (let n = from; n <= to; n++) out.push(n === 30 ? '-30\n+thirty' : ` ${n}`)
  return out.join('\n').split('\n')
}
const full = [...head, '@@ -1,60 +1,60 @@', ...body(1, 60)].join('\n') + '\n'
const narrow = [...head, '@@ -27,7 +27,7 @@', ...body(27, 33)].join('\n') + '\n'

describe('parse', () => {
  it('splits head from hunks and keeps line counts', () => {
    const p = parse(narrow)
    expect(p.head).toEqual(head)
    expect(p.hunks).toHaveLength(1)
    expect(p.hunks[0]).toMatchObject({ oldStart: 27, oldCount: 7, newStart: 27, newCount: 7 })
    expect(p.hunks[0].lines).toHaveLength(8) // 6 context + 1 del + 1 add
  })

  it('defaults an omitted count to 1', () => {
    expect(parse('@@ -5 +5 @@\n x\n').hunks[0]).toMatchObject({ oldCount: 1, newCount: 1 })
  })
})

describe('gaps', () => {
  it('finds the gaps around a single hunk', () => {
    expect(gaps(parse(narrow), 60)).toEqual([
      { from: 1, to: 26, hunk: 0 },
      { from: 34, to: 60, hunk: -1 },
    ])
  })

  it('drops the EOF gap when the last hunk reaches the end', () => {
    expect(gaps(parse(narrow), 33)).toEqual([{ from: 1, to: 26, hunk: 0 }])
  })

  it('reports no leading gap when the first hunk starts at line 1', () => {
    expect(gaps(parse([...head, '@@ -1,2 +1,2 @@', ' 1', ' 2'].join('\n')), 2)).toEqual([])
  })
})

describe('build', () => {
  it('shows exactly the narrow diff and nothing else', () => {
    const m = build(full, narrow)!
    expect(totalLines(m)).toBe(60)
    const shown = m.lines.filter((_, i) => m.visible[i])
    expect(shown).toEqual(parse(narrow).hunks[0].lines)
  })

  it('round-trips through emit', () => {
    expect(emit(build(full, narrow)!)).toBe(narrow)
  })

  it('bails out when the full diff is not one hunk', () => {
    expect(build(narrow, narrow)).not.toBeNull()
    expect(build([...head, '@@ -1,1 +1,1 @@', ' 1', '@@ -9,1 +9,1 @@', ' 9'].join('\n'), narrow)).toBeNull()
  })
})

describe('reveal', () => {
  const m = build(full, narrow)!
  const g = gaps(parse(narrow), 60)

  it('expands up by one step, ending against the hunk below', () => {
    const p = parse(emit(reveal(m, g[0], 'up')))
    expect(p.hunks).toHaveLength(1)
    expect(p.hunks[0].newStart).toBe(27 - STEP)
  })

  it('expands down by one step, starting at the top of the gap', () => {
    const p = parse(emit(reveal(m, g[0], 'down')))
    expect(p.hunks).toHaveLength(2)
    expect(p.hunks[0]).toMatchObject({ newStart: 1, newCount: STEP })
    expect(p.hunks[1].newStart).toBe(27)
  })

  it('expands the whole gap at once', () => {
    const p = parse(emit(reveal(m, g[0], 'all')))
    expect(p.hunks).toHaveLength(1)
    expect(p.hunks[0]).toMatchObject({ newStart: 1, newCount: 33 })
  })

  it('expands the EOF gap downward', () => {
    const p = parse(emit(reveal(m, g[1], 'down')))
    expect(p.hunks).toHaveLength(1)
    expect(p.hunks[0]).toMatchObject({ newStart: 27, newCount: 7 + STEP })
  })

  it('merges hunks when a gap is closed from both sides', () => {
    const closed = reveal(reveal(m, g[0], 'all'), g[1], 'all')
    const p = parse(emit(closed))
    expect(p.hunks).toHaveLength(1)
    expect(p.hunks[0]).toMatchObject({ oldStart: 1, oldCount: 60, newStart: 1, newCount: 60 })
    expect(emit(closed)).toBe(full)
  })

  it('keeps a no-newline marker with its line', () => {
    const f = [...head, '@@ -1,3 +1,3 @@', ' 1', ' 2', '-3', '\\ No newline at end of file', '+three'].join('\n')
    const n = [...head, '@@ -3,1 +3,1 @@', '-3', '\\ No newline at end of file', '+three'].join('\n')
    const mm = build(f, n)!
    expect(emit(mm).split('\n')).toContain('\\ No newline at end of file')
    expect(emit(reveal(mm, gaps(parse(n), 3)[0], 'all'))).toBe(f + '\n')
  })
})
