// A conflicted file, as git wrote it, split into the parts a picker needs.
// Pure and DOM-free on purpose: this is where the correctness lives, and the
// only way to write a corrupted file back is to get it wrong here.
export type Choice = 'ours' | 'theirs' | 'both'
export type Block = { ours: string[]; base: string[] | null; theirs: string[]; oursLabel: string; theirsLabel: string }
export type Segment = { kind: 'context'; lines: string[] } | { kind: 'conflict'; block: Block }

// git writes exactly seven marker characters. A repo with a custom conflict-marker
// size is exotic enough that failing to parse (and saying so) beats guessing.
const START = /^<<<<<<< ?(.*)$/
const BASE = /^\|\|\|\|\|\|\| ?(.*)$/
const SEP = /^=======$/
const END = /^>>>>>>> ?(.*)$/

// Lines keep their own terminators (see split below), so markers are matched
// against the line without one.
const bare = (line: string) => line.replace(/\r?\n$/, '')

export function parseConflict(text: string): Segment[] | null {
  // lookbehind split: every line keeps its own \n or \r\n, so join() is the exact
  // inverse and CRLF, mixed endings and a missing final newline all round-trip
  // without a normalization pass that would rewrite bytes nobody asked to change
  const lines = text.split(/(?<=\n)/)
  const segs: Segment[] = []
  let ctx: string[] = []
  let cur: Block | null = null
  let mode: 'context' | 'ours' | 'base' | 'theirs' = 'context'

  const flush = () => {
    if (ctx.length) segs.push({ kind: 'context', lines: ctx })
    ctx = []
  }

  for (const line of lines) {
    const b = bare(line)
    const start = START.exec(b)
    if (start) {
      if (mode !== 'context') return null // a start inside a block: not git's output
      flush()
      cur = { ours: [], base: null, theirs: [], oursLabel: start[1].trim(), theirsLabel: '' }
      mode = 'ours'
      continue
    }
    if (mode === 'context') {
      ctx.push(line)
      continue
    }
    const base = BASE.exec(b)
    if (base) {
      if (mode !== 'ours') return null
      cur!.base = []
      mode = 'base'
      continue
    }
    if (SEP.test(b)) {
      if (mode !== 'ours' && mode !== 'base') return null
      mode = 'theirs'
      continue
    }
    const end = END.exec(b)
    if (end) {
      if (mode !== 'theirs') return null
      cur!.theirsLabel = end[1].trim()
      segs.push({ kind: 'conflict', block: cur! })
      cur = null
      mode = 'context'
      continue
    }
    if (mode === 'ours') cur!.ours.push(line)
    else if (mode === 'base') cur!.base!.push(line)
    else cur!.theirs.push(line)
  }
  if (mode !== 'context') return null // ran off the end mid-block
  flush()
  // no blocks means nothing to pick — a binary file, a delete/modify conflict, or
  // a file somebody already resolved by hand. The caller shows the whole-file card.
  return segs.some(s => s.kind === 'conflict') ? segs : null
}

export function applyPicks(segs: Segment[], picks: Map<number, Choice>): string {
  const out: string[] = []
  segs.forEach((s, i) => {
    if (s.kind === 'context') {
      out.push(...s.lines)
      return
    }
    const pick = picks.get(i)
    if (!pick) throw new Error(`no pick for conflict at segment ${i}`)
    // `both` is a plain concatenation, ours first. No seam handling is needed:
    // every content line in a block is followed by another line — the ======= or
    // >>>>>>> marker at minimum — so each one carries its own terminator, and a
    // block that runs off the end of the file is rejected as unterminated above.
    if (pick === 'ours' || pick === 'both') out.push(...s.block.ours)
    if (pick === 'theirs' || pick === 'both') out.push(...s.block.theirs)
  })
  return out.join('')
}
