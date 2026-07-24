export type Commit = {
  hash: string
  parents: string[]
  author: string
  email: string
  date: number
  refs: string[]
  subject: string
}

export type StatusEntry = { path: string; status: string }
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

export function parseStatus(raw: string): StatusEntry[] {
  const out: StatusEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const kind = line[0]
    const parts = line.split(' ')
    if (kind === '1') {
      const xy = parts[1]
      out.push({ path: parts.slice(8).join(' '), status: xy[1] !== '.' ? xy[1] : xy[0] })
    } else if (kind === '2') {
      // rename/copy: extra score field, then "newPath\toldPath"
      const xy = parts[1]
      out.push({ path: parts.slice(9).join(' ').split('\t')[0], status: xy[0] === '.' ? xy[1] : xy[0] })
    } else if (kind === 'u') {
      out.push({ path: parts.slice(10).join(' '), status: 'U' })
    } else if (kind === '?') {
      out.push({ path: line.slice(2), status: '?' })
    }
  }
  return out
}
