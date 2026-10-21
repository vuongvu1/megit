# Worktree support

Date: 2026-10-19

## Why

The user runs coding agents (T3 Code, Claude Code, plain terminal) that each work in their own
`git worktree`. megit should let them **watch that work**: which worktrees exist, which ones have
uncommitted changes right now, and what those changes are. Today megit has no idea worktrees exist.

megit is mostly a viewer here. Worktrees are created by other tools; megit can delete one from the strip
(added 2026-10-21 at the user's request — see Decided).

## What exists today

- A linked worktree folder can already be added as a tab. `gitDir()` (`server/index.ts:246`) resolves
  the real git dir, and every git command works from inside the folder.
- **Auto-refresh is probably broken in such a tab** (from reading the code, not yet confirmed).
  `watch.ts` watches `<folder>` recursively and treats `.git/HEAD`, `.git/index`, `.git/refs/` as
  relevant. In a linked worktree, `.git` is a file; HEAD and index live in
  `<main>/.git/worktrees/<name>/`, refs in `<main>/.git/refs/` + `packed-refs`. File edits refresh;
  commits, checkouts, stashes made from a terminal or agent do not.
- Checking out a branch held by another worktree surfaces git's raw
  `fatal: '<branch>' is already checked out at '<path>'` (newer git: `is already used by worktree at`).
- Only the active tab's `RepoView` is mounted (`src/App.tsx:75`). A tab whose path is gone already gets
  a 410 from `repoGuard` and RepoView's "gone" state.

## Goals

1. **Auto-refresh works in worktree tabs** — commits, checkouts, stashes, staging done by an agent show
   up without a manual refresh.
2. **Worktree strip.** In any repo tab whose repo has more than one worktree, a narrow strip on the left
   of the graph lists every worktree of that repo — the main checkout included, the current one
   highlighted. Each entry shows its branch (or `detached @ <sha7>`) and a **live count of changed
   files**, hidden when clean. Full path in a tooltip. Clicking an entry opens that worktree as a tab
   (registering it if needed) or focuses its tab if already open.
3. **Worktree tabs.** A tab whose folder is a linked worktree is labelled `⎇ <folder name>` in purple, and is
   placed right after the tab it was opened from (the strip's own tab). Its contents are the normal
   RepoView: graph, WIP row, diffs, commit panel — unchanged.
4. **Branch badges.** In the graph's ref pills, a branch checked out in a *different* worktree carries a
   `⎇` marker; clicking it does what clicking that worktree in the strip does.
5. **Readable checkout refusal.** When git refuses a checkout because another worktree holds the branch,
   show "`<branch>` is open in `<path>`" with an **Open** button instead of the raw git message.
6. **Removed worktrees don't break anything.** When an agent deletes its worktree, the strip drops the
   entry on the next refresh; an open tab for it falls into the 410 "gone" state, worded "worktree
   removed", and stays until the user closes it. megit never closes a tab by itself.

## Non-goals

- Creating, pruning, locking or moving worktrees.
- Showing other worktrees' WIP inside one graph (mockup option "B"). Rejected for cost and clutter; the
  strip + tabs cover it.
- Live counts for repos in background tabs. Only the active tab is mounted, and that stays true.

## Anti-goals

- megit getting slower because agents are busy. Busy agents must cost debounced, bounded work.
- The strip appearing — or any per-worktree work happening — in a repo with no linked worktrees.
- megit touching a worktree's files or state in any way the user didn't click for.

## Performance (measured 2026-10-19)

| Command | megit (120 files) | bikeleasing-app (1.3k files) |
|---|---|---|
| `git status --porcelain=v2 -uall` | ~10 ms | ~10 ms |
| `git worktree list --porcelain` | <1 ms | <1 ms |

Budget: one `git worktree list` per active-tab refresh, plus one `git status` per worktree per strip
refresh (run in parallel), through the existing debouncer (400 ms trailing, 2 s max-wait). Measured on
bikeleasing-app: a linked worktree's `status` settles at 11–14 ms; a freshly created one costs 75–98 ms
for its first ~8 calls (cold filesystem cache), then drops. A per-worktree count cache is the upgrade if
steady-state cost ever shows up. Re-measure on a large repo before shipping; if `status` gets expensive, counting with
`--untracked-files=normal` instead of `-uall` is the first lever (identical on the repos above).

Keep the RepoView fingerprint pattern: a refresh that yields the same worktree list and counts must not
re-render.

## Decided

- Strip, always visible, left of the graph — chosen over a toolbar dropdown because the user wants to
  watch counts change live without clicking. Absent entirely when the repo has one worktree.
- Live counts, with the cost above.
- Worktree tabs are ordinary registered repos (same config list, same `repoGuard`), so every existing
  feature works in them for free.
- Delete from the strip (user's call, 2026-10-21): a trash icon on hover of each linked, non-current row,
  behind a `confirm`. It names the branch that stays and the uncommitted file count that would be lost;
  `--force` is sent only when that count was non-zero, so a stale zero count lets git refuse instead of
  silently discarding work. The main worktree has no trash icon and the server allow-lists the path.
- Strip is resizable (splitter, 100–480 px) and collapsible to a 24 px rail; both persist globally.
- Removed worktree → its tab stays, showing "worktree removed", until the user closes it (user's call,
  2026-10-19). Worktree tabs persist across restarts like any other tab.

## Calls made without the user (check these)

- **Refusal is detected before any mutation.** `/api/checkout` stashes a dirty tree (`stashIfDirty`)
  *before* running `git checkout`, so translating git's error afterwards would leave the user's WIP
  stashed for a checkout that never happened. The route checks `git worktree list --porcelain` for the
  target branch first and returns `{ heldBy: <path> }` without touching anything. No fallback on git's message: the window
  between the check and the checkout is milliseconds.
- **Readable refusal covers** checkout, the reset-to-remote checkout (`checkout -B`), and branch delete
  ("used by worktree"). Rename, rebase and merge keep git's raw text.
- **Tab label is `⎇ <folder name>`**, not the branch. The folder name never changes, so background tabs
  need no git per refresh. "Is this a linked worktree" is read from the folder's `.git` file
  (`gitdir: …/worktrees/<name>`), no git process. This applies to any linked worktree tab, however it was
  added. The live branch is visible in the strip and graph.
- **Worktree tabs opened from the strip don't enter `recent`.** Short-lived agent folders would push
  real repos out of the 12-entry list.
- **Nested-worktree exclusion uses every path git knows** (`git worktree list`), not only the ones open
  as tabs. That means the parent watcher's filter gets a per-repo exclusion list that changes over time.

## Left to the builder

- Wire shape: a new `/api/worktrees` route vs. folding the list into `/api/status`; how live counts reach
  the client (a new SSE event type on the existing `/api/events` stream, or a separate stream).
- How the watcher covers a linked worktree's git dir and the shared refs (goal 1), and how worktree
  folders are watched for counts — `subscribe()` already accepts any path and dedupes per path.
- **Nested worktrees.** Some tools put worktrees *inside* the repo (Claude Code uses `.claude/worktrees/`).
  The main checkout's recursive watcher sees every agent edit there as its own working-tree change and
  refetches. Check this; if so, exclude registered worktree paths from the parent's watcher — they are
  counted by their own.
- How a tab knows it's a linked worktree (e.g. `--git-dir` ≠ `--git-common-dir`, cached like `gitDirs`)
  and where its parent lives, for the label and tab placement.
- Strip width/collapse, colours, and behaviour for prunable entries (`git worktree list` marks
  worktrees whose folder is gone `prunable`; hide them).
- Detecting the checkout refusal: match both git message variants, extract the path, return it
  structured so the client doesn't parse English.
- Tests: pure parsing of `git worktree list --porcelain` in `parse.ts`; watcher relevance for worktree
  git dirs in `watch.test.ts`; a real two-worktree fixture for the refresh path. `scripts/make-test-repo.sh`
  could add one linked worktree so screenshots show the strip.
