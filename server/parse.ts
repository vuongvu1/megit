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

// `stash@{N}` is positional and renumbers on every stash push/drop, so a stash
// action must map its sha to an index against a list read at action time — an
// index captured when the graph loaded can address a different stash by now.
// Exact match: a prefix could collide, and every caller has the full %H.
export const stashIndex = (raw: string, hash: string) =>
  raw.split('\n').filter(Boolean).indexOf(hash)

export type BranchHeader = { head: string | null; upstream: string | null; ahead: number; behind: number }

// The `# branch.*` headers `git status --porcelain=v2 --branch` prepends to the same
// output parseStatus already reads — so the toolbar's ahead/behind badges cost no
// extra git process. git omits branch.upstream and branch.ab when there's no upstream.
export function parseBranchHeader(raw: string): BranchHeader {
  const field = (name: string) => raw.match(new RegExp(`^# branch\\.${name} (.*)$`, 'm'))?.[1] ?? null
  const head = field('head')
  const ab = field('ab')?.match(/^\+(\d+) -(\d+)$/)
  return {
    head: head === '(detached)' ? null : head,
    upstream: field('upstream'),
    ahead: Number(ab?.[1] ?? 0),
    behind: Number(ab?.[2] ?? 0),
  }
}

export function parseStatus(raw: string): StatusEntry[] {
  const out: StatusEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const kind = line[0]
    const parts = line.split(' ')
    if (kind === '1') {
      const xy = parts[1]
      out.push({ path: parts.slice(8).join(' '), status: xy[1] !== '.' ? xy[1] : xy[0], x: xy[0], y: xy[1] })
    } else if (kind === '2') {
      // rename/copy: extra score field, then "newPath\toldPath"
      const xy = parts[1]
      out.push({ path: parts.slice(9).join(' ').split('\t')[0], status: xy[0] === '.' ? xy[1] : xy[0], x: xy[0], y: xy[1] })
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
