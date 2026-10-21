// type-only: server/worktrees.ts imports node:fs, which must not reach the bundle
import type { Worktree } from '../server/worktrees.ts'
import { tilde } from './paths'

// One row per worktree of this repo; the current one is highlighted and inert.
// Empty list (a repo with a single worktree) → nothing rendered, no column taken.
export default function WorktreeStrip({ worktrees, home, onOpen }: { worktrees: Worktree[]; home: string; onOpen: (path: string) => void }) {
  if (worktrees.length === 0) return null
  return (
    <div className="wt-strip">
      {worktrees.map(w => (
        <button
          key={w.path}
          className={`wt-row${w.current ? ' current' : ''}`}
          title={tilde(w.path, home)}
          aria-current={w.current || undefined}
          disabled={w.current}
          onClick={() => onOpen(w.path)}
        >
          <span className="wt-name">{w.branch ?? `detached @ ${w.head.slice(0, 7)}`}</span>
          {w.changed > 0 && <span className="wt-count">{w.changed}</span>}
        </button>
      ))}
    </div>
  )
}
