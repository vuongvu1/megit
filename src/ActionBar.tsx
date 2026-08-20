import { useMemo } from 'react'
import type { BranchHeader, Commit, StashEntry } from '../server/parse.ts'
import { api, jsonInit } from './api'
import { toolbar, type ToolbarAction } from './toolbar'
import { toastErr } from './Toast'

// same 16-grid, 1.5-stroke glyphs as the commit panel's icons
const icon = (d: string) => () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map(p => <path key={p} d={p} />)}
  </svg>
)

// arrow to a bare baseline, no tray: the tray belongs to Stash/Pop, and a boxed
// down-arrow for Pull was indistinguishable from a boxed down-arrow for Stash
const PullIcon = icon('M8 2v7.5|M4.5 6.5L8 10l3.5-3.5|M3 13.5h10')
const PushIcon = icon('M8 10V2.5|M4.5 6L8 2.5l3.5 3.5|M3 13.5h10')
// the notched inbox tray the stash rows draw in the graph, so the pair reads against
// the rows it acts on. Stash and Pop differ only by arrow direction — they're adjacent.
const TRAY = 'M2.5 8.5v4.5h11V8.5|M2.5 8.5h3l1.2 1.7h2.6l1.2-1.7h3'
const StashIcon = icon(`${TRAY}|M8 2v4.2|M6.2 4.4L8 6.2l1.8-1.8`)
const PopIcon = icon(`${TRAY}|M8 6.2V2|M6.2 3.8L8 2l1.8 1.8`)
// a curved back-arrow, not the refresh button's circular one — Undo must not read as reload
const UndoIcon = icon('M5.5 3.5L2.5 6.5l3 3|M2.5 6.5h6.5a3.5 3.5 0 0 1 0 7H6')

const BranchIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="4.5" cy="3" r="1.75" />
    <circle cx="4.5" cy="13" r="1.75" />
    <circle cx="11.5" cy="3" r="1.75" />
    <path d="M4.5 4.75v6.5" />
    <path d="M11.5 4.75v1.25a3 3 0 0 1-3 3H4.5" />
  </svg>
)

const ICONS: Record<ToolbarAction, () => React.JSX.Element> = {
  pull: PullIcon, push: PushIcon, branch: BranchIcon, stash: StashIcon, pop: PopIcon, undo: UndoIcon,
}

// what each button does once clicked, beyond the endpoint call itself
const TITLES: Record<ToolbarAction, string> = {
  pull: 'Pull (fast-forward only)',
  push: 'Push',
  branch: 'Create a branch at HEAD',
  stash: 'Stash all changes',
  pop: 'Pop the latest stash',
  undo: 'Undo last commit — keeps its changes staged',
}

export default function ActionBar({ repo, commits, branch, remotes, stashes, dirty, busy, onBusy }: {
  repo: string
  commits: Commit[]
  branch: BranchHeader
  remotes: string[]
  stashes: StashEntry[]
  dirty: boolean
  busy: boolean
  onBusy: (p: Promise<unknown>) => void
}) {
  // HEAD's own row, detached included ("HEAD" without an arrow) — a branch can be
  // created there even though push and undo can't run. HEAD sits near the top of a
  // --date-order log, so this scan is short whatever the repo's size.
  const head = useMemo(
    () => commits.find(c => c.refs.some(r => r === 'HEAD' || r.startsWith('HEAD -> '))) ?? null,
    [commits],
  )

  // ponytail: post-and-toast runner duplicated from GraphView. Two copies beat
  // hoisting a shared abstraction; extract when a third appears.
  const post = (path: string, body: object, label: string) =>
    onBusy(api(`/api/${path}?repo=${encodeURIComponent(repo)}`, jsonInit('POST', body))
      .catch(err => toastErr(`${label} failed:\n${(err as Error).message}`)))

  const run = (action: ToolbarAction) => {
    switch (action) {
      case 'pull': return void post('branch', { action: 'pull' }, 'Pull')
      case 'push': return void post('branch', { action: 'push' }, 'Push')
      case 'branch': {
        // ponytail: native prompt as the naming dialog, as the chip menu does
        const name = prompt(`New branch at ${head!.hash.slice(0, 7)}`, '')
        if (name) post('branch', { action: 'create', name, at: head!.hash }, 'Create branch')
        return
      }
      case 'stash': {
        const message = prompt('Stash message', `WIP on ${branch.head ?? 'HEAD'}`)
        if (message === null) return
        return void post('stash', { action: 'push', message }, 'Stash save')
      }
      case 'pop':
        // stashes arrive in `git stash list` order, so [0] is stash@{0}
        return void post('stash', { action: 'pop', hash: stashes[0].hash }, 'Stash pop')
      case 'undo':
        // nothing is destroyed: the changes land staged and the reflog keeps the
        // commit, so this doesn't confirm — the title says what happens
        return void post('commit', { action: 'reset', mode: 'soft', hash: head!.parents[0] }, 'Undo')
    }
  }

  const btns = toolbar({
    branch: branch.head,
    remotes,
    upstream: branch.upstream,
    ahead: branch.ahead,
    behind: branch.behind,
    dirty,
    stashCount: stashes.length,
    head,
  })

  return (
    <div className="tb-actions">
      {btns.map(b => {
        const Icon = ICONS[b.action]
        return (
          <button
            key={b.action}
            className="tb-btn"
            disabled={busy || !!b.disabled}
            title={b.disabled ?? TITLES[b.action]}
            onClick={() => run(b.action)}
          >
            <Icon />
            {b.label}
            {b.badge !== undefined && <span className="tb-badge">{b.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
