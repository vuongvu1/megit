import type { MenuItem } from './ContextMenu'

// %D chips as GraphView builds them: local and remote refs of the same name are
// one chip carrying both flags, so a menu has to read the flags, not the name
export type RefChip = { name: string; local: boolean; remote: boolean; tag: boolean; head: boolean; remoteRef?: string }

// What git is handed for a chip. `name` is the display name with the remote prefix
// stripped, so a remote-only chip has to fall back to the full `origin/x` ref —
// otherwise a diverged `origin/main` would resolve to the local `main`.
export const chipRef = (chip: RefChip) => (chip.local ? chip.name : chip.remoteRef ?? chip.name)

export type BranchAction =
  | 'checkout' | 'pull' | 'push' | 'upstream'
  | 'merge' | 'rebase'
  | 'create' | 'rename' | 'delete' | 'deleteTag'
  | 'copyName' | 'copyLink'

export type BranchCtx = {
  current: string | null // checked-out branch, null when detached
  hasRemote: boolean
  canLink: boolean // repo has a GitHub origin
  run: (action: BranchAction) => void
}

// Which actions a chip offers. Pure and separate from GraphView so the rules that
// matter — no Delete on the checked-out branch, no Rename on a remote-only chip —
// are asserted in tests instead of clicked through in a browser.
export function branchMenu(chip: RefChip, { current, hasRemote, canLink, run }: BranchCtx): MenuItem[] {
  const items: MenuItem[] = []
  const add = (label: string, action: BranchAction, extra?: Partial<MenuItem>) =>
    items.push({ label, onClick: () => run(action), ...extra })

  if (chip.tag) {
    add('Delete tag', 'deleteTag', { danger: true })
    add('Copy tag name', 'copyName', { sep: true })
    if (canLink) add('Copy GitHub link', 'copyLink')
    return items
  }

  if (chip.head) {
    // pull/push only from the branch you're on: pushing another branch means
    // refspec plumbing for an action nobody reaches for from a graph row
    if (hasRemote) {
      add('Pull (fast-forward only)', 'pull')
      add('Push', 'push')
      add('Set upstream…', 'upstream')
    }
  } else {
    add('Checkout', 'checkout')
    if (current) {
      // remote chips too: a remote-tracking ref is exactly what you merge or rebase
      // onto once the local branch has diverged from it
      const ref = chipRef(chip)
      add(`Merge ${ref} into ${current}`, 'merge')
      add(`Rebase ${current} onto ${ref}`, 'rebase')
    }
  }

  if (chip.local) {
    add('Create branch here…', 'create', { sep: items.length > 0 })
    add('Rename…', 'rename')
    if (!chip.head) add('Delete branch', 'delete', { danger: true })
  }

  add(chip.local ? 'Copy branch name' : 'Copy remote branch name', 'copyName', { sep: items.length > 0 })
  if (canLink) add('Copy GitHub link', 'copyLink')
  return items
}
