// GitHub-style hunk-gap expansion for the diff view: each gap between hunks gets
// arrows that reveal 20 more lines. The client fetches the file's full-context
// diff once (`?context=`), then every expansion is pure slicing of that line
// list — no further round trips, no server state.

export const STEP = 20

export type Hunk = { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: string[] }
export type Parsed = { head: string[]; hunks: Hunk[] }
/** A hidden range of new-file lines. `hunk` is the hunk rendered below it, -1 at EOF. */
export type Gap = { from: number; to: number; hunk: number }
export type Dir = 'up' | 'down' | 'all'
/** Full-context diff plus which of its lines are currently rendered. */
export type Model = { head: string[]; lines: string[]; oldNo: number[]; newNo: number[]; visible: boolean[] }

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const kind = (l: string): ' ' | '+' | '-' | '\\' =>
  l[0] === '+' ? '+' : l[0] === '-' ? '-' : l[0] === '\\' ? '\\' : ' '

export function parse(diff: string): Parsed {
  const raw = diff.split('\n')
  if (raw[raw.length - 1] === '') raw.pop() // trailing newline, not an empty context line
  const head: string[] = []
  const hunks: Hunk[] = []
  for (const line of raw) {
    const m = HEADER.exec(line)
    if (m) hunks.push({ oldStart: +m[1], oldCount: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newCount: m[4] === undefined ? 1 : +m[4], lines: [] })
    else if (hunks.length) hunks[hunks.length - 1].lines.push(line)
    else head.push(line)
  }
  return { head, hunks }
}

/** Gaps of a rendered diff. `total` (new-file line count) suppresses a phantom EOF gap. */
export function gaps(p: Parsed, total = Infinity): Gap[] {
  const out: Gap[] = []
  p.hunks.forEach((h, i) => {
    const prev = p.hunks[i - 1]
    const from = prev ? prev.newStart + prev.newCount : 1
    if (h.newStart > from) out.push({ from, to: h.newStart - 1, hunk: i })
  })
  const last = p.hunks[p.hunks.length - 1]
  if (last) {
    const from = last.newStart + last.newCount
    if (from <= total) out.push({ from, to: total, hunk: -1 })
  }
  return out
}

// '\ No newline at end of file' has no line number of its own; it rides along
// with the line above it.
function pinMarkers(lines: string[], visible: boolean[]): boolean[] {
  lines.forEach((l, i) => { if (kind(l) === '\\' && i > 0) visible[i] = visible[i - 1] })
  return visible
}

/**
 * Combine a full-context diff with the narrow one currently on screen. Returns
 * null when the full diff isn't a single hunk (then expansion is unavailable
 * rather than mis-rendered).
 */
export function build(full: string, narrow: string): Model | null {
  const f = parse(full)
  if (f.hunks.length !== 1) return null
  const { lines } = f.hunks[0]
  const oldNo: number[] = []
  const newNo: number[] = []
  let o = f.hunks[0].oldStart
  let n = f.hunks[0].newStart
  for (const l of lines) {
    const k = kind(l)
    oldNo.push(k === '+' || k === '\\' ? 0 : o++)
    newNo.push(k === '-' || k === '\\' ? 0 : n++)
  }
  // seed visibility from the narrow diff's ranges instead of re-deriving git's
  // context rules, so what's on screen doesn't shift when expansion starts
  const inRange = (no: number, start: number, count: number) => no > 0 && no >= start && no < start + count
  const hunks = parse(narrow).hunks
  const visible = lines.map((_, i) => hunks.some(h => inRange(oldNo[i], h.oldStart, h.oldCount) || inRange(newNo[i], h.newStart, h.newCount)))
  return { head: f.head, lines, oldNo, newNo, visible: pinMarkers(lines, visible) }
}

export function reveal(m: Model, gap: Gap, dir: Dir): Model {
  const hidden = m.lines.map((_, i) => i).filter(i => !m.visible[i] && m.newNo[i] >= gap.from && m.newNo[i] <= gap.to)
  const pick = dir === 'all' ? hidden : dir === 'down' ? hidden.slice(0, STEP) : hidden.slice(-STEP)
  const visible = m.visible.slice()
  for (const i of pick) visible[i] = true
  return { ...m, visible: pinMarkers(m.lines, visible) }
}

export const totalLines = (m: Model): number => m.newNo.reduce((a, b) => (b > a ? b : a), 0)

/** Render the visible runs back into a unified diff for diff2html. */
export function emit(m: Model): string {
  const out = [...m.head]
  const count = (seg: string[], side: '+' | '-') => seg.filter(l => kind(l) === ' ' || kind(l) === side).length
  const before = (no: number[], i: number) => { for (let k = i - 1; k >= 0; k--) if (no[k] > 0) return no[k]; return 0 }
  for (let i = 0; i < m.lines.length; i++) {
    if (!m.visible[i]) continue
    let j = i
    while (j < m.lines.length && m.visible[j]) j++
    const seg = m.lines.slice(i, j)
    const oldCount = count(seg, '-')
    const newCount = count(seg, '+')
    // a zero-length side starts at the line it follows, per unified-diff convention
    const oldStart = oldCount ? seg.reduce((a, _, k) => a || m.oldNo[i + k], 0) : before(m.oldNo, i)
    const newStart = newCount ? seg.reduce((a, _, k) => a || m.newNo[i + k], 0) : before(m.newNo, i)
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...seg)
    i = j - 1
  }
  return out.join('\n') + '\n'
}
