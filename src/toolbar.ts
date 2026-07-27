export type ToolbarAction = 'pull' | 'push' | 'branch' | 'stash' | 'pop' | 'undo'

export type ToolbarCtx = {
  branch: string | null // checked-out branch, null when detached
  remotes: string[]
  upstream: string | null
  ahead: number
  behind: number
  dirty: boolean // the WIP row has files
  stashCount: number
  head: { parents: string[]; refs: string[] } | null // HEAD commit, null in an empty repo
}

// `disabled` carries the reason, which the renderer shows as the button's title.
// Buttons are never dropped from the list: the bar must not reflow as repo state moves.
export type ToolbarBtn = { action: ToolbarAction; label: string; badge?: number; disabled?: string }

// Same shape as branchMenu/commitMenu: the rules live here, asserted in tests, so
// Toolbar.tsx stays a renderer. Every action maps to an endpoint that already exists.
export function toolbar(ctx: ToolbarCtx): ToolbarBtn[] {
  const { branch, remotes, upstream, ahead, behind, dirty, stashCount, head } = ctx
  const noRemote = remotes.length === 0 ? 'no remote' : null

  return [
    {
      action: 'pull',
      label: 'Pull',
      // a fast-forward pull with behind === 0 is a no-op, but a fetch can still bring
      // new commits in — the counts are only as fresh as the last fetch
      badge: behind || undefined,
      disabled: noRemote ?? (upstream ? undefined : 'no upstream — set one from the branch chip'),
    },
    {
      action: 'push',
      label: 'Push',
      badge: ahead || undefined,
      disabled: noRemote
        ?? (branch ? undefined : 'detached HEAD — check out a branch first')
        // no upstream and exactly one remote is the first push: the server's `push -u`
        // sets the upstream. More than one remote and it can't pick.
        ?? (upstream ? (ahead ? undefined : 'nothing to push') : remotes.length === 1 ? undefined : 'no upstream — set one from the branch chip'),
    },
    { action: 'branch', label: 'Branch', disabled: head ? undefined : 'no commits yet' },
    { action: 'stash', label: 'Stash', disabled: dirty ? undefined : 'nothing to stash' },
    { action: 'pop', label: 'Pop', badge: stashCount || undefined, disabled: stashCount ? undefined : 'no stash to pop' },
    {
      action: 'undo',
      label: 'Undo',
      disabled: undoReason(branch, remotes, head),
    },
  ]
}

// Undo is a soft reset to HEAD's parent, so it can only mean one thing: drop the last
// commit and keep its changes staged. Anything else is a different operation.
function undoReason(branch: string | null, remotes: string[], head: ToolbarCtx['head']): string | undefined {
  if (!head) return 'nothing to undo'
  if (!branch) return 'detached HEAD — check out a branch first'
  if (head.parents.length > 1) return 'last commit is a merge'
  if (head.parents.length === 0) return 'last commit is the first commit'
  // a remote ref on the tip means it's pushed, and dropping it would need a force
  // push — which megit never does. Same check as %D chips: "origin/" prefix against
  // the real remote names, so a local branch called "origin-fix" isn't mistaken for one.
  if (head.refs.some(r => remotes.some(rm => r.startsWith(rm + '/')))) return 'already pushed'
  return undefined
}
