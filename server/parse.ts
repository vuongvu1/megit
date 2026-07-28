export type Commit = {
  hash: string
  parents: string[]
  author: string
  email: string
  date: number
  refs: string[]
  subject: string
}

// x/y are porcelain-v2's index and worktree codes ('.' = unchanged on that side).
// They're what splits the WIP panel into staged and unstaged; a partially staged
// file has both set and belongs in both lists. Absent on commit file lists, which
// have no sides. `status` stays the single code the graph and tree render.
export type StatusEntry = { path: string; status: string; x?: string; y?: string }
export type StashEntry = { hash: string; parent: string; date: number; subject: string }

export type CommitMeta = {
  author: string
  authorEmail: string
  authorDate: number
  committer: string
  committerEmail: string
  commitDate: number
  parents: string[]
  message: string
}

// %B (full message) contains arbitrary newlines, so it must be the last field
export const META_FORMAT = '%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%P%x1f%B'

export function parseMeta(raw: string): CommitMeta {
  const [author, authorEmail, authorDate, committer, committerEmail, commitDate, parents, ...rest] = raw.split('\x1f')
  return {
    author,
    authorEmail,
    authorDate: Number(authorDate),
    committer,
    committerEmail,
    commitDate: Number(commitDate),
    parents: parents ? parents.split(' ') : [],
    message: rest.join('\x1f').replace(/\n+$/, ''),
  }
}

// \x1f field sep, \x1e record sep — never appear in git metadata
// %ct (committer date), not %at: --date-order sorts by committer date, and stash
// placement bisects on commit.date — author dates go non-monotonic after rebase/revert
export const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%D%x1f%s%x1e'

export function parseLog(raw: string): Commit[] {
  return raw
    .split('\x1e')
    .map(r => r.replace(/^\n/, ''))
    .filter(r => r.length > 0)
    .map(rec => {
      const [hash, parents, author, email, date, refs, subject] = rec.split('\x1f')
      return {
        hash,
        parents: parents ? parents.split(' ') : [],
        author,
        email,
        date: Number(date),
        refs: refs ? refs.split(', ') : [],
        subject,
      }
    })
}

// `/api/search` asks git for `%H%x1f%ct` — the hash to select and the date to order by.
export const parseMatches = (raw: string): [string, number][] =>
  raw.split('\n').filter(Boolean).map(l => {
    const [hash, ct] = l.split('\x1f')
    return [hash, Number(ct)] as [string, number]
  })

// The graph will not render 14k rows, and a one-word query can match most of a
// history, so the route reports a bounded slice.
export const SEARCH_CAP = 500

// git ANDs its commit-limiting options, so "message OR author OR hash" costs one
// `git log` per field and a union here. Date-descending is the ordering the graph's
// --date-order mostly agrees with.
//
// ponytail: ct-desc, not true --date-order — topological tie-breaks can disagree, so
// "next" may occasionally step one row upward. Exact positions would cost a
// full-history `--format=%H` pass per query; local search is already exact.
export function mergeMatches(lists: [string, number][][]): { matches: string[]; truncated: boolean } {
  const byHash = new Map<string, number>()
  for (const list of lists) {
    for (const [hash, ct] of list) if (!byHash.has(hash)) byHash.set(hash, ct)
  }
  const sorted = [...byHash].sort((a, b) => b[1] - a[1]).map(([hash]) => hash)
  return { matches: sorted.slice(0, SEARCH_CAP), truncated: sorted.length > SEARCH_CAP }
}

// `stash@{N}` is positional and renumbers on every stash push/drop, so a stash
// action must map its sha to an index against a list read at action time — an
// index captured when the graph loaded can address a different stash by now.
// Exact match: a prefix could collide, and every caller has the full %H.
export const stashIndex = (raw: string, hash: string) =>
  raw.split('\n').filter(Boolean).indexOf(hash)

export type BranchHeader = { head: string | null; upstream: string | null; ahead: number; behind: number }

// Everything below reads `-z` output: one NUL-terminated record per entry, headers
// included. Without it git C-quotes any path holding a non-ASCII byte, a tab or a
// `"` ("\303\274mlaut.txt"), and that literal can't go back to git as a pathspec —
// staging, discarding and diffing such a file all failed with "did not match any
// files". `-z` paths are raw, so they survive the round trip.
const records = (raw: string) => raw.split('\0')

// The `# branch.*` headers `git status --porcelain=v2 --branch` prepends to the same
// output parseStatus already reads — so the toolbar's ahead/behind badges cost no
// extra git process. git omits branch.upstream and branch.ab when there's no upstream.
export function parseBranchHeader(raw: string): BranchHeader {
  const fields = new Map<string, string>()
  for (const r of records(raw)) {
    if (!r.startsWith('# branch.')) continue
    const sp = r.indexOf(' ', 9)
    if (sp > 0) fields.set(r.slice(9, sp), r.slice(sp + 1))
  }
  const head = fields.get('head') ?? null
  const ab = fields.get('ab')?.match(/^\+(\d+) -(\d+)$/)
  return {
    head: head === '(detached)' ? null : head,
    upstream: fields.get('upstream') ?? null,
    ahead: Number(ab?.[1] ?? 0),
    behind: Number(ab?.[2] ?? 0),
  }
}

export function parseStatus(raw: string): StatusEntry[] {
  const recs = records(raw)
  const out: StatusEntry[] = []
  for (let i = 0; i < recs.length; i++) {
    const line = recs[i]
    if (!line) continue
    const kind = line[0]
    const parts = line.split(' ')
    if (kind === '1') {
      const xy = parts[1]
      out.push({ path: parts.slice(8).join(' '), status: xy[1] !== '.' ? xy[1] : xy[0], x: xy[0], y: xy[1] })
    } else if (kind === '2') {
      // rename/copy: extra score field, and under -z the original path is its own
      // record rather than a \t-joined suffix — skip it, nothing here reads it
      const xy = parts[1]
      out.push({ path: parts.slice(9).join(' '), status: xy[0] === '.' ? xy[1] : xy[0], x: xy[0], y: xy[1] })
      i++
    } else if (kind === 'u') {
      // conflicts are neither staged nor unstaged — they sit on the worktree side
      // until resolved, so they show up under Changes and can't be committed as-is
      out.push({ path: parts.slice(10).join(' '), status: 'U', x: '.', y: 'U' })
    } else if (kind === '?') {
      out.push({ path: line.slice(2), status: '?', x: '.', y: '?' })
    }
  }
  return out
}

// `git diff --name-status -z`: a status record then its path record, except
// rename/copy, which spends two paths (old, then new — the new one is what the
// commit's file list shows).
export function parseNameStatus(raw: string): { status: string; path: string }[] {
  const recs = records(raw)
  const out: { status: string; path: string }[] = []
  for (let i = 0; i < recs.length; i++) {
    const st = recs[i]
    if (!st) continue
    const paths = st[0] === 'R' || st[0] === 'C' ? 2 : 1
    // no path record (truncated output): a status with no file is nothing to show
    if (!recs[i + paths]) break
    out.push({ status: st[0], path: recs[i + paths] })
    i += paths
  }
  return out
}
