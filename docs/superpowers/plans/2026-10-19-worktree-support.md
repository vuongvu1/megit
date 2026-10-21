# Worktree Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** megit sees the git worktrees other tools create: live-refreshing worktree tabs, a strip listing every worktree with its changed-file count, `⎇` branch badges, and a checkout refusal that touches nothing.

**Architecture:** One new server module, `server/worktrees.ts`, owns listing, counting, branch-holder lookup and the per-repo watch set. `/api/events` delegates to it and emits two message kinds: `changed` (this checkout) and `worktrees` (a sibling's folder). The client adds a `WorktreeStrip` component, and threads a `linked` path list and an `onOpen(path)` callback from `App` down.

**Tech Stack:** Node 24 + TypeScript (type-stripped), `node:http` routes in `server/index.ts`, React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-worktree-support-design.md`

## Global Constraints

- **No commit steps.** CLAUDE.md forbids `git commit` and `git rm` for the agent, so each task ends with a check-in and the user commits.
- Work on branch `feat/worktree-support`.
- Prefix every Node/pnpm command with `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`.
- Don't add runtime dependencies. Client deps go in `devDependencies`.
- megit never runs `git worktree add|remove|prune|lock|move`. The only exception is test fixtures and verification scratch repos.
- **No per-worktree git work in a repo with a single worktree.** `/api/worktrees` returns `[]` without running `status`, and `/api/events` adds no sibling watchers.
- Keep fingerprint gating. A worktree refresh that yields the same list and counts calls no `setState`.
- Tab label is `⎇ <folder name>` (from `base(path)`), coloured purple.
- Strip-opened tabs skip `recent` and are inserted right after the tab they were opened from.
- When a worktree disappears, its tab stays open and shows `Worktree removed`. megit never closes a tab by itself.
- Don't touch the user's real `~/.config/megit/config.json`. For probes, run the server with `HOME=$(mktemp -d)`.
- `git worktree list --porcelain -z` needs git ≥ 2.36. The dev machine has 2.54.

## Review Focus

1. **Worktree folder paths with spaces or unicode.** Expected: they parse, count and open like any other path. Pinned by the `parseWorktrees` test that uses `/tmp/a b/ü`.
2. **A worktree folder deleted by hand** (`rm -rf`, not `git worktree remove`) while megit is showing it. Expected: git marks it `prunable`, it drops out of the strip, and its open tab shows `Worktree removed`. Pinned by the prunable parse test and Task 6, step 3.
3. **Nested worktrees** (`.claude/worktrees/x` inside the main checkout). Expected: edits there update that entry's count only, and never trigger the main tab's graph refetch. Pinned by the `watchRepo` nested test.
4. **A detached-HEAD worktree.** Expected: the strip shows `detached @ <sha7>`, and the branch badge logic ignores it, since it holds no branch. Pinned by the `parseWorktrees` detached case and the `heldBy` test.
5. **Checkout of a held branch with a dirty tree.** Expected: no stash entry is created and the working tree is unchanged. Pinned by the `heldBy` integration test plus the curl probe in Task 3.

---

### Task 1: Watcher relevance for git dirs, pluggable filter, ignore list

**Files:**
- Modify: `server/watch.ts`
- Test: `server/watch.test.ts`

**Interfaces:**
- Produces:
  - `isGitDirRelevant(rel: string): boolean`. `rel` is relative to a git *common* dir. Returns true for `HEAD`, `index`, `packed-refs`, `refs/**`, `worktrees/<n>/HEAD`, `worktrees/<n>/index`.
  - `isRelevant(rel)` keeps its signature. For paths under `.git/` it now returns `isGitDirRelevant(inner)`.
  - `subscribe(path, onChange, onError, relevant: (rel: string) => boolean = isRelevant): () => void`. The first subscriber's filter wins for a path. Callers always pass the same filter for the same kind of path.
  - `setIgnored(path: string, prefixes: string[]): void`. This sets the subscription's ignore list for `path` (live entry only; it does nothing when no entry exists). A `rel` that equals a prefix, or starts with `prefix + '/'`, is dropped before `relevant` runs.

- [ ] **Step 1: Write the failing tests.** Extend the `isRelevant` table with:

```ts
['.git/worktrees/feat/HEAD', true],
['.git/worktrees/feat/index', true],
['.git/worktrees/feat/index.lock', false],
['.git/worktrees/feat/logs/HEAD', false],
```

Add a `describe('isGitDirRelevant')` table: `['HEAD', true]`, `['refs/heads/x', true]`, `['packed-refs', true]`, `['worktrees/a/HEAD', true]`, `['worktrees/a/ORIG_HEAD', false]`, `['objects/ab/cd', false]`, `['worktrees/a/b/HEAD', false]`.

Add integration tests in the existing `integration` describe:
- `'linked worktree: commit fires a subscription on the common git dir'`: `git worktree add ../wt -b wt` in the fixture, `subscribe(commonDir, spy, noop, isGitDirRelevant)`, commit inside `wt`, wait for `spy` (same polling helper as the existing test).
- `'setIgnored drops events under an ignored prefix'`: subscribe to the repo, `setIgnored(repo, ['nested'])`, write `nested/x.txt` and wait 2.5 s (past max-wait), then expect `spy` not called. Then write `top.txt` and expect `spy` called.

- [ ] **Step 2: Run and see it fail.**
Run: `pnpm test -- watch`
Expected: FAIL. `isGitDirRelevant` and `setIgnored` are not exported.

- [ ] **Step 3: Implement in `server/watch.ts`.**
`Entry` gets `ignored: string[]`. The watcher callback checks ignored prefixes, then the stored filter.

- [ ] **Step 4: Run.**
Run: `pnpm test -- watch && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Check in.** Hand back for the user to commit.

---

### Task 2: Worktree listing, counts, branch holder, watch set

**Files:**
- Modify: `server/parse.ts` (adds `parseWorktrees`)
- Create: `server/worktrees.ts`
- Test: `server/parse.test.ts`, `server/worktrees.test.ts` (new; the integration describe skips on win32, as in `watch.test.ts`)

**Interfaces:**
- Consumes: `subscribe`, `setIgnored`, `isRelevant`, `isGitDirRelevant` from Task 1. `parseStatus` from `parse.ts`.
- Produces:
  - `parse.ts`: `export type WorktreeEntry = { path: string; head: string; branch: string | null; prunable: boolean; bare: boolean }` and `export function parseWorktrees(raw: string): WorktreeEntry[]`. Input is `git worktree list --porcelain -z`: NUL-terminated `key value` fields, with records separated by an empty field. `branch` is stripped of `refs/heads/`. A `detached` line means `branch: null`.
  - `worktrees.ts`:
    - `export type Git = (repo: string, args: string[], okCodes?: number[]) => Promise<string>`. This is index.ts's `git`, passed in the same way `resolveAvatar` takes it.
    - `export type Worktree = { path: string; branch: string | null; head: string; changed: number; current: boolean }`.
    - `isLinkedWorktree(dir: string): boolean`. Reads `<dir>/.git` synchronously. True only if it is a file whose `gitdir:` line contains `/worktrees/`. Submodules (`/modules/`) and missing paths return false.
    - `listWorktrees(repo: string, git: Git): Promise<WorktreeEntry[]>`. Excludes prunable and bare entries.
    - `worktreesWithCounts(repo: string, git: Git): Promise<Worktree[]>`. Returns `[]` when there is ≤ 1 entry, without running `status`. Otherwise it runs `status --porcelain=v2 -uall -z` in every entry in parallel, with `changed = parseStatus(raw).length`; a failing status gives `0`. `current` compares against `await realpath(repo)`.
    - `heldBy(repo: string, branch: string, git: Git): Promise<string | null>`. Returns the path of a *different* worktree whose `branch === branch`, else null.
    - `watchRepo(repo: string, git: Git, send: (kind: 'changed' | 'worktrees') => void, onError: () => void): Promise<() => void>`. Subscribes as follows:
      - `repo` with `isRelevant`, which sends `changed`.
      - If `isLinkedWorktree(repo)`: also the common dir from `git rev-parse --path-format=absolute --git-common-dir` with `isGitDirRelevant`, which sends `changed`.
      - Every *other* listed worktree path with `isRelevant`, which sends `worktrees`.

      After every `changed` fire, it re-runs `listWorktrees` and reconciles: adds and removes sibling subscriptions, and calls `setIgnored(repo, <sibling paths inside repo, relative>)`. Reconcile errors are swallowed. The returned function unsubscribes everything.

- [ ] **Step 1: Write the failing parse tests** (`parse.test.ts`, `describe('parseWorktrees')`):
  - Main plus a linked worktree, plus a detached one at `/tmp/a b/ü`:

    ```ts
    const raw = 'worktree /r\0HEAD aaa\0branch refs/heads/main\0\0worktree /r-wt\0HEAD bbb\0branch refs/heads/feat/x\0\0worktree /tmp/a b/ü\0HEAD ccc\0detached\0\0'
    expect(parseWorktrees(raw)).toEqual([
      { path: '/r', head: 'aaa', branch: 'main', prunable: false, bare: false },
      { path: '/r-wt', head: 'bbb', branch: 'feat/x', prunable: false, bare: false },
      { path: '/tmp/a b/ü', head: 'ccc', branch: null, prunable: false, bare: false },
    ])
    ```

  - `'prunable gitdir file points to non-existent location'` on a record sets `prunable: true`.
  - A `bare` record sets `bare: true`.
  - `parseWorktrees('')` is `[]`.

- [ ] **Step 2: Write the failing integration tests** (`worktrees.test.ts`). The fixture is a tmp repo with one commit, plus `git worktree add <tmp>/wt -b feat`.
  - `isLinkedWorktree(wt)` is true. `isLinkedWorktree(repo)` is false. `isLinkedWorktree(<tmp>/nope)` is false.
  - `worktreesWithCounts(repo, git)` returns two entries. After writing one file in `wt`, the `wt` entry has `changed: 1` and the `repo` entry has `current: true`.
  - On a fresh single-worktree repo, `worktreesWithCounts` resolves to `[]`, and the spy `git` was called once (`worktree list` only).
  - `heldBy(repo, 'feat', git)` is the `wt` path. `heldBy(repo, 'main', git)` is null (main is current). `heldBy(wt, 'main', git)` is the repo path.
  - `watchRepo(wt, …)`: a commit made *inside wt* sends `changed`. This is goal 1, the auto-refresh fix.
  - `watchRepo(repo, …)`: editing `wt/file` sends `worktrees` and not `changed`.
  - Nested: `git worktree add <repo>/.claude/worktrees/n -b n`, then `watchRepo(repo, …)`. Editing `.claude/worktrees/n/f` sends `worktrees` only.
  - After `git worktree remove wt` (run in the test), `listWorktrees(repo)` no longer contains `wt`.

  Here `git` is a minimal `execFile('git', ['-C', repo, ...args])` wrapper defined in the test file.

- [ ] **Step 3: Run and see it fail.**
Run: `pnpm test -- worktrees parse`
Expected: FAIL. The module and function don't exist.

- [ ] **Step 4: Implement `parseWorktrees` and `server/worktrees.ts` to the interfaces above.** Put a ponytail comment on `worktreesWithCounts` saying all worktrees are counted on every call, and that a per-path dirty cache is the upgrade if it ever shows up in a measurement.

- [ ] **Step 5: Run.**
Run: `pnpm test && npx tsc --noEmit`
Expected: everything passes.

- [ ] **Step 6: Check in.**

---

### Task 3: Server wiring: routes, events, config, refusals

**Files:**
- Modify: `server/index.ts`. The relevant spots are `withCaps` (~line 82), `POST /api/repos` (86), `/api/status` neighbourhood (new route), `/api/checkout` (308), `/api/branch` delete case (~485), and `/api/events` (699).

**Interfaces:**
- Consumes: `worktreesWithCounts`, `heldBy`, `watchRepo`, `isLinkedWorktree` from Task 2.
- Produces (wire):
  - `GET /api/worktrees?repo=` returns `{ worktrees: Worktree[] }` and goes through `repoGuard`.
  - `GET /api/config` and every `withCaps` response gain `linked: string[]`, which is `cfg.repos.filter(isLinkedWorktree)`.
  - `POST /api/repos` accepts an optional `after: string`. When it is present and is in `repos`, the new path is inserted right after it and `recent` is left alone. Without it, behaviour is unchanged.
  - `POST /api/checkout`: before any `status` or stash, if `heldBy(repo, branch)` is set, respond `200 { heldBy: <path> }`. This mirrors the `diverged` response shape.
  - `POST /api/branch` delete: if the branch is held, throw `httpError(409, \`'${branch}' is checked out in ${path}\`)` before running `git branch -d`.
  - `/api/events`: `data: changed` and `data: worktrees` messages. The handler awaits `watchRepo`. If the request closed before it resolved, it unsubscribes at once.

- [ ] **Step 1: Implement the route and config changes listed above.**

- [ ] **Step 2: Typecheck and test.**
Run: `npx tsc --noEmit && pnpm test`
Expected: clean.

- [ ] **Step 3: Probe with curl** (isolated HOME, `PORT=4600 node server/index.ts &`, PID saved to a file; never `pkill`):
  - Fixture: a tmp repo plus `git worktree add ../wt -b feat`, with a dirty file in the main checkout. Register the repo.
  - `curl -s localhost:4600/api/worktrees?repo=…` shows 2 entries and the counts.
  - `curl -s -X POST …/api/checkout?repo=<main> -d '{"branch":"feat"}'` returns `{"heldBy":"…/wt"}`, `git -C <main> stash list` is empty, and the dirty file is still dirty.
  - Branch delete of `feat` returns 409 with the readable message.
  - `POST /api/repos` with `{path: wt, after: main}`: `repos` has `wt` right after `main`, `recent` doesn't contain `wt`, and `linked` contains `wt`.
  - Run `curl -w '%{time_total}'` on `/api/worktrees` against `~/WORKSPACE/BLS/bikeleasing-app` with 3 scratch worktrees, then remove the worktrees and the registration. Record the number in the check-in.

- [ ] **Step 4: Check in.**

---

### Task 4: Tabs: purple label, open-from-strip, "Worktree removed"

**Files:**
- Modify: `src/App.tsx`, `src/TabBar.tsx`, `src/RepoView.tsx` (props and the `error.gone` render only), `src/index.css` (or wherever `.tab` is styled; find it with `grep -rn "\.tab\b" src/*.css`)

**Interfaces:**
- Consumes: `linked`, `after` from Task 3.
- Produces:
  - `Config` (client) gains `linked: string[]`.
  - In `App`: `open(path: string): void`. If `cfg.repos` includes the path, it calls `select`. Otherwise it calls `POST /api/repos {path, after: cfg.activeRepo}` and then `setCfg`, with failures going to `toastErr`.
  - `TabBar` gains the prop `linked: string[]`. A linked tab renders `⎇ {base(r)}` with class `tab wt`.
  - `RepoView` gains the props `linked: boolean` and `onOpen: (path: string) => void`. When `error.gone && linked`, the message reads `Worktree removed` with the path below it (`tilde`), and the "Remove tab" button stays.

- [ ] **Step 1: Implement the props and the purple `.tab.wt` style.** Colour `#a371f7` for the active state, `#c8a6ff` for inactive, matching the mockup. Add a light-theme variant if the stylesheet has theme blocks.
- [ ] **Step 2:** `npx tsc --noEmit && pnpm test`. Expected: clean.
- [ ] **Step 3: Check in.**

---

### Task 5: Worktree strip, live events, branch badges, checkout refusal UI

**Files:**
- Create: `src/WorktreeStrip.tsx`
- Modify: `src/RepoView.tsx`, `src/GraphView.tsx`, stylesheet

**Interfaces:**
- Consumes: `Worktree` type (import from `../server/worktrees.ts`, the same way RepoView imports parse types), `onOpen` from Task 4, and the `heldBy` checkout response from Task 3.
- Produces:
  - `WorktreeStrip({ worktrees, home, onOpen }: { worktrees: Worktree[]; home: string; onOpen: (path: string) => void })`. One row per worktree. The label is `branch ?? \`detached @ ${head.slice(0, 7)}\``, and the current row is highlighted. A count badge shows only when `changed > 0`. `title` is `tilde(path, home)`. Clicking calls `onOpen(path)` unless the row is current. The component renders nothing when `worktrees.length === 0`.
  - In RepoView:
    - `worktrees` state, behind a fingerprint (`fps.current.wt`, a `JSON.stringify` of the list).
    - `loadWorktrees()`, which fetches `/api/worktrees` and swallows errors.
    - Calls to it on mount, inside every `kick` (the `changed` message), and on a `worktrees` message, which does *not* call `refresh`.
    - `es.onmessage = e => e.data === 'worktrees' ? loadWorktrees() : kick()`.
  - Layout: the strip is the first child of a new flex row that wraps `.panes`, so the graph's existing column math is untouched. Width is fixed at `160px`, with no splitter.
  - GraphView gains the prop `held: Map<string, string>` (branch → path) for worktrees other than the current one. RepoView builds it with `useMemo`. A local chip whose name is in `held` gets a `⎇` button after its name, titled `open in <tilde path>`. Clicking it calls `onOpen(path)` and `stopPropagation`.
  - GraphView's `checkout`: `CheckoutRes` gains `heldBy?: string`. When it is set, show `confirm(\`'${branch}' is open in another worktree:\n${path}\n\nOpen its tab?\`)`, and on OK call `onOpen(heldBy)`. GraphView therefore also takes `onOpen`.

  Ponytail note on the refusal: use native `confirm` as the Open button, the same pattern as the diverged prompt next to it.

- [ ] **Step 1: Implement.**
- [ ] **Step 2:** `npx tsc --noEmit && pnpm test && pnpm build`. Record the main chunk size against `main` (the strip should add well under 2 kB gz).
- [ ] **Step 3: Check in.**

---

### Task 6: End-to-end verification, perf, docs

**Files:**
- Modify: `docs/architecture.md` (watcher section and routes list: two SSE message kinds, `/api/worktrees`, `linked`), and `README.md` feature list (one line).

- [ ] **Step 1: Run the `verify` skill** with an isolated HOME, a scratch repo, and 2 linked worktrees, one of them nested under `.claude/worktrees/`. Check in Playwright:
  - The strip shows 3 rows with counts.
  - Editing a file in a worktree updates its badge within about 2.5 s, without a graph refetch. Check this in `performance.getEntriesByType('resource')`: no new `/api/graph` entry.
  - Clicking a row opens a purple `⎇ <folder>` tab right after the parent tab.
  - A commit made in the worktree from a shell shows up in that worktree tab's graph without pressing `r` (goal 1).
  - Double-clicking a held branch chip shows the "open in another worktree" prompt, and `git stash list` stays unchanged.
- [ ] **Step 2: Check the single-worktree repo:** no strip, and `/api/worktrees` is called but the server runs exactly one git process for it. Check with a temporary `console.count` or by timing; remove the instrumentation afterwards.
- [ ] **Step 3: Removal.** `git worktree remove` one worktree and `rm -rf` the other. Expected: both drop out of the strip, and an open tab for one shows `Worktree removed` and stays put.
- [ ] **Step 4: Update the docs.** Delete scratch repos with `node -e "fs.rmSync(p,{recursive:true,force:true})"`, and make sure no `.playwright-mcp/` artifacts are staged.
- [ ] **Step 5: Check in.** Report the measured `/api/worktrees` time on bikeleasing-app and the bundle delta.
