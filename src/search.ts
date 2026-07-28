import type { Commit } from '../server/parse.ts'

// Only the fields a local match reads. Narrower than Commit so callers and tests can
// build rows without inventing dates and parents.
export type SearchRow = Pick<Commit, 'hash' | 'author' | 'email' | 'refs' | 'subject'>

/**
 * The default search path: a filter over the rows already loaded in the graph.
 *
 * Free — no request, no debounce. Because RepoView derives it from `commits`, an SSE
 * refresh recomputes it, so a rebased-away hash can never go stale here.
 *
 * Returns the matching hashes in `commits` order, which is the graph's own order, so
 * "next match" always moves down the screen.
 *
 * Fields are OR'd, case-insensitive substring — except the hash, which is a prefix test:
 * `git log <prefix>` resolves prefixes, and a substring hit in the middle of a sha is a
 * coincidence, never something typed on purpose. Ref names are in because loaded rows
 * already carry them; the server route can't match them nearly as cheaply.
 *
 * An empty or whitespace-only query is not a search — it returns nothing rather than
 * everything, or opening the bar would select the top commit before anything is typed.
 */
export function matchLocal(commits: SearchRow[], q: string): string[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  const out: string[] = []
  for (const c of commits) {
    if (
      c.hash.startsWith(needle)
      || c.subject.toLowerCase().includes(needle)
      || c.author.toLowerCase().includes(needle)
      || c.email.toLowerCase().includes(needle)
      || c.refs.some(r => r.toLowerCase().includes(needle))
    ) out.push(c.hash)
  }
  return out
}

// Wraps, unlike rowNav's `step`, which clamps so a held arrow key stops instead of
// looping. A find-bar is the opposite convention: match 4 of 4 → next → match 1.
export function stepMatch(len: number, cur: number, dir: 1 | -1): number {
  if (len === 0) return -1
  if (cur < 0) return dir === 1 ? 0 : len - 1
  return (cur + dir + len) % len
}

export const label = (cur: number, len: number, opts: { truncated?: boolean; deep?: boolean } = {}) =>
  len === 0
    ? 'No results'
    : `${cur + 1} of ${len}${opts.truncated ? '+' : ''}${opts.deep ? ' · all' : ''}`
