import type { Selection } from './RepoView'

export type Row = Exclude<Selection, null>

// Every selectable row in render order: the WIP row, then for each commit the stash
// rows sitting above it and the commit itself. Arrow-key navigation is index
// arithmetic over this list, so it has to be built the way GraphView renders —
// same source (`placements.byRow`), same order.
export function rowOrder(
  commits: { hash: string }[],
  stashesByRow: Map<number, { s: { hash: string } }[]>,
  showWip: boolean,
): Row[] {
  const out: Row[] = showWip ? [{ kind: 'wip' }] : []
  commits.forEach((c, i) => {
    for (const p of stashesByRow.get(i) ?? []) out.push({ kind: 'commit', hash: p.s.hash })
    out.push({ kind: 'commit', hash: c.hash })
  })
  return out
}

// A stash row and a commit row are both { kind: 'commit' }, so a hash is the only
// thing that tells two selections apart.
export const sameRow = (a: Selection, b: Selection) =>
  !!a && !!b && (a.kind === 'wip' ? b.kind === 'wip' : b.kind === 'commit' && a.hash === b.hash)

// Where a key moves the cursor, or null when it moves nothing — unknown key, empty
// list, or already at that end. Ends clamp rather than wrap, so a held key stops
// instead of looping, and a null lets the keypress fall through to the browser: at
// the bottom of the list ArrowDown should still scroll.
export function step(len: number, cur: number, key: string): number | null {
  if (len === 0) return null
  const to = (i: number) => (i < 0 || i >= len || i === cur ? null : i)
  switch (key) {
    // nothing selected yet: Down enters at the top, Up at the bottom
    case 'ArrowDown': return cur < 0 ? 0 : to(cur + 1)
    case 'ArrowUp': return cur < 0 ? len - 1 : to(cur - 1)
    case 'Home': return to(0)
    case 'End': return to(len - 1)
    default: return null
  }
}
