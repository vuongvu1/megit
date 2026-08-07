import type { StatusEntry } from '../server/parse.ts'

export type DiffSide = 'staged' | 'worktree'

const changed = (code?: string) => !!code && code !== '.'

// One porcelain entry carries both sides, so a file staged *and* edited again
// afterwards belongs in both lists — each showing that side's own status code,
// not the merged one the graph uses.
//
// Conflicts come out as a third list rather than joining the unstaged one. They
// are neither staged nor unstaged as far as git is concerned, and the rows in
// Changes carry a Stage button — staging a file that still has conflict markers
// in it commits `<<<<<<<` to history, which is the whole reason they're split.
export function splitStatus(files: StatusEntry[]): { staged: StatusEntry[]; unstaged: StatusEntry[]; conflicts: StatusEntry[] } {
  const rest = files.filter(f => f.status !== 'U')
  return {
    staged: rest.filter(f => changed(f.x)).map(f => ({ ...f, status: f.x! })),
    unstaged: rest.filter(f => changed(f.y)).map(f => ({ ...f, status: f.y! })),
    conflicts: files.filter(f => f.status === 'U'),
  }
}
