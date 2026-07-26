import type { MenuItem } from './ContextMenu'

export type CommitAction =
  | 'checkout' | 'cherry-pick' | 'revert'
  | 'branch' | 'tag'
  | 'reset-soft' | 'reset-mixed' | 'reset-hard'
  | 'copySha' | 'copyLink'

export type CommitCtx = {
  isHead: boolean // the commit HEAD already points at
  current: string | null // checked-out branch, null when detached
  canLink: boolean
  run: (action: CommitAction) => void
}

// Branch-level actions live on the ref chips, so this stays commit-only — no
// second copy of rename/delete the way GitKraken's commit menu carries them.
export function commitMenu({ isHead, current, canLink, run }: CommitCtx): MenuItem[] {
  const items: MenuItem[] = []
  const add = (label: string, action: CommitAction, extra?: Partial<MenuItem>) =>
    items.push({ label, onClick: () => run(action), ...extra })

  if (!isHead) add('Checkout this commit', 'checkout')
  if (current) {
    // cherry-picking a commit onto itself is meaningless, but reverting HEAD is
    // the ordinary "undo the commit I just made" — it belongs on that row too
    if (!isHead) add(`Cherry-pick onto ${current}`, 'cherry-pick', { sep: items.length > 0 })
    add('Revert commit', 'revert')
  }

  add('Create branch here…', 'branch', { sep: items.length > 0 })
  add('Create tag here…', 'tag')

  // three flat entries rather than a submenu; the wording says what happens to the
  // working tree, which is the only part of --soft/--mixed/--hard anyone misremembers
  if (current && !isHead) {
    add(`Reset ${current} here, keep changes`, 'reset-soft', { sep: true })
    add(`Reset ${current} here, unstage changes`, 'reset-mixed')
    add(`Reset ${current} here, discard changes`, 'reset-hard', { danger: true })
  }

  add('Copy commit sha', 'copySha', { sep: true })
  if (canLink) add('Copy GitHub link', 'copyLink')
  return items
}
