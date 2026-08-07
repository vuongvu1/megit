// Which multi-step git operation is stopped part-way, read from the state files
// git leaves in the git dir. Pure so it can be tested without a filesystem —
// the caller does the existsSync sweep and hands over the names it found.
export type OpKind = 'rebase' | 'merge' | 'cherry-pick' | 'revert'

// Order is the whole point: a rebase applying a commit also writes
// CHERRY_PICK_HEAD, and the user is rebasing, not cherry-picking.
const ORDER: [OpKind, string[]][] = [
  ['rebase', ['rebase-merge', 'rebase-apply']],
  ['merge', ['MERGE_HEAD']],
  ['cherry-pick', ['CHERRY_PICK_HEAD']],
  ['revert', ['REVERT_HEAD']],
]

export const STATE_FILES = ORDER.flatMap(([, names]) => names)

export function pickOperation(present: string[]): OpKind | null {
  const set = new Set(present)
  for (const [kind, names] of ORDER) if (names.some(n => set.has(n))) return kind
  return null
}
