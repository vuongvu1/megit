import type { StatusEntry } from '../server/parse.ts'

export type DiffSide = 'staged' | 'worktree'

const changed = (code?: string) => !!code && code !== '.'

// One porcelain entry carries both sides, so a file staged *and* edited again
// afterwards belongs in both lists — each showing that side's own status code,
// not the merged one the graph uses.
export function splitStatus(files: StatusEntry[]): { staged: StatusEntry[]; unstaged: StatusEntry[] } {
  return {
    staged: files.filter(f => changed(f.x)).map(f => ({ ...f, status: f.x! })),
    unstaged: files.filter(f => changed(f.y)).map(f => ({ ...f, status: f.y! })),
  }
}
