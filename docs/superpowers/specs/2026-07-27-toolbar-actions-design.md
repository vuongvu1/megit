# Toolbar actions

GitKraken puts Pull / Push / Branch / Stash / Pop / Terminal in a top bar. megit
already has all six actions — they are hidden behind right-click on a ref chip, the
WIP row, or a stash row. This surfaces them as buttons, and adds a narrow Undo.

Scope: the six existing actions plus Undo-last-commit. No Redo, no general reflog
history, no Pull dropdown (megit's pull is `--ff-only`, so there is nothing to
choose). Buttons go in the existing `.toolbar` row — no new layout, no vertical
space cost.

## Ahead/behind counts cost nothing

`git status --porcelain=v2 -uall --branch` emits four extra header lines:

```
# branch.oid 6a5ba72e2d57b86e25138d19ee41b0d0c24389a7
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0
```

`/api/status` already runs that command, and `parseStatus` ignores `#` lines (they
match no `kind` branch). So the counts are one added flag and one new parser
function — zero extra git processes on a path that runs on every SSE tick.

`parseBranchHeader(raw)` returns `{ head, upstream, ahead, behind }`:

- `head`: branch name, or `null` on detached HEAD (`# branch.head (detached)`)
- `upstream`: e.g. `origin/main`, `null` when the branch has no upstream
- `ahead` / `behind`: from `# branch.ab +N -M`, both `0` when the header is absent

`/api/status` responds `{ files, branch }`. `parseStatus` is untouched.

The status fingerprint in `RepoView.tsx` extends to cover `upstream|ahead|behind`,
otherwise a push leaves a stale badge. Nothing else re-renders.

## `src/toolbar.ts` — the rules, pure and tested

Same shape as `branchMenu.ts` / `commitMenu.ts`: a pure function over context,
unit-tested, so the enable/disable rules are asserted instead of clicked through.

```ts
export type ToolbarAction = 'pull' | 'push' | 'branch' | 'stash' | 'pop' | 'undo'
export type ToolbarBtn = { action: ToolbarAction; label: string; badge?: number; disabled?: string }
export function toolbar(ctx: ToolbarCtx): ToolbarBtn[]
```

`disabled` holds the *reason*, which the renderer uses as the `title` while setting
the `disabled` attribute. Buttons are never hidden — the bar must not reflow as
repository state changes.

| Button | Badge | Disabled when |
|---|---|---|
| Pull | `behind` | no remote; no upstream |
| Push | `ahead` | detached HEAD; no remote; `ahead === 0` and an upstream exists |
| Branch | — | no commits yet |
| Stash | — | clean worktree |
| Pop | stash count | no stashes |
| Undo | — | no commits; detached HEAD; HEAD has ≠ 1 parent (merge or root); HEAD carries a remote ref |

Push stays enabled with no upstream when the repo has exactly one remote — the
server's `push -u` path handles that first push.

## Wiring — no new endpoints

| Button | Call |
|---|---|
| Pull | `POST /api/branch {action:'pull'}` |
| Push | `POST /api/branch {action:'push'}` |
| Branch | `prompt` → `{action:'create', name, at: head.hash}` |
| Stash | `prompt` → `POST /api/stash {action:'push', message}` |
| Pop | `POST /api/stash {action:'pop', hash: stashes[0].hash}` |
| Undo | `POST /api/commit {action:'reset', mode:'soft', hash: head.parents[0]}` |

Undo is a soft reset to HEAD's parent. It destroys nothing: the changes land staged
and the reflog keeps the commit, so there is no confirmation dialog — the tooltip
says what will happen. The pushed-commit guard is client-side: if an `origin/*` ref
sits on the HEAD row, the commit is pushed and Undo is disabled. No extra git call.

## `src/ActionBar.tsx`

Named `ActionBar`, not `Toolbar`: macOS's case-insensitive filesystem makes
`Toolbar.tsx` collide with the `toolbar.ts` rules module, and TypeScript rejects the
pair outright.

Rendered inside the existing `.toolbar` row, left of the repo path. Icon plus text
label — a bare down-arrow could mean pull, fetch, or stash. Takes `spinWhile` as
`onBusy`, the same contract `GraphView` uses, and carries its own four-line
`alert()`-on-reject runner.

`// ponytail: action runner duplicated from GraphView. Two copies beat hoisting a
shared post-and-alert abstraction; extract when a third appears.`

## Tests

- `src/toolbar.test.ts` — the disable/badge matrix above.
- `server/parse.test.ts` — `parseBranchHeader`: normal, no upstream, detached, empty repo.

## Performance

No new git processes. Verify with `curl -w '%{time_total}'` on `/api/status`
before and after against `~/WORKSPACE/BLS/bikeleasing-app` (14k commits).
Expectation: unchanged — same process, roughly 120 extra bytes of output.
