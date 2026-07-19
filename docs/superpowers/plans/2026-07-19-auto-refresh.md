# megit v2a Auto-refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server watches each open repo's filesystem and pushes a `changed` signal over SSE; the browser refetches what it shows, so the graph and WIP row stay fresh without pressing `r`.

**Architecture:** New `server/watch.ts` module (path filter + debouncer + subscriber registry around `fs.watch` recursive), one new SSE endpoint `GET /api/events?repo=` in `server/index.ts`, plus an additive `limit` param on `/api/graph`. Client side: `RepoView` opens an `EventSource` for the active tab and refetches through a fingerprint gate (skip identical updates), with visibility gating and selection preservation. WIP diffs refetch via a `wipTick` counter threaded to `DiffView`; commit diffs never refetch (immutable by hash).

**Tech Stack:** Node 24 (native TS type-stripping), Express 5, `node:fs` `watch` (no chokidar), Server-Sent Events (no library), React 19, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-07-19-auto-refresh-design.md`

## Global Constraints

- Node ≥ 24 required. Every shell command that runs `node`/`pnpm` needs: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"` (system node is 22.x, lacks TS type-stripping).
- No new dependencies. `node:fs` watch + plain `res.write` SSE + browser-native `EventSource`.
- Server binds `127.0.0.1` only; every repo-scoped endpoint goes through the existing `repoGuard` middleware — `/api/events` included.
- Debounce: 400 ms trailing, 2 s max-wait. Values from the spec; don't change.
- Test command: `pnpm test` (runs `vitest run`). Type check: `pnpm exec tsc --noEmit`.
- Existing v1 behavior stays: `r` key / toolbar refresh button, `skip`-based "Load more" paging.
- Package manager is pnpm. Run everything from repo root `/Users/vuhoangvuong/WORKSPACE/personal/megit`.

---

### Task 1: Watch primitives — path filter + debouncer

**Files:**
- Create: `server/watch.ts`
- Test: `server/watch.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces (used by Task 2 and Task 3):
  - `isRelevant(rel: string): boolean` — `rel` is a `/`-separated path relative to the repo root, as `fs.watch` recursive reports on macOS.
  - `createDebouncer(fire: () => void, delay?: number, maxWait?: number): Debouncer` where `type Debouncer = { hit: () => void; dispose: () => void }`. Defaults: `delay = 400`, `maxWait = 2000`.

- [ ] **Step 1: Commit the pending spec doc**

```bash
git add docs/superpowers/specs/2026-07-19-auto-refresh-design.md docs/superpowers/plans/2026-07-19-auto-refresh.md
git commit -m "docs: add auto-refresh (v2a) design spec and implementation plan"
```

- [ ] **Step 2: Write the failing tests**

Create `server/watch.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { isRelevant, createDebouncer } from './watch.ts'

describe('isRelevant', () => {
  it.each<[string, boolean]>([
    // working tree: everything counts, including git-ignored dirs (over-notify by design)
    ['src/App.tsx', true],
    ['README.md', true],
    ['node_modules/x/index.js', true],
    ['.gitignore', true],
    // .git internals: only the ref/index surface counts
    ['.git/HEAD', true],
    ['.git/index', true],
    ['.git/packed-refs', true],
    ['.git/refs/heads/main', true],
    ['.git/refs/tags/v1', true],
    ['.git', false],
    ['.git/objects/ab/cdef0123', false],
    ['.git/index.lock', false],
    ['.git/logs/HEAD', false],
    ['.git/FETCH_HEAD', false],
    ['.git/COMMIT_EDITMSG', false],
  ])('%s → %s', (path, expected) => {
    expect(isRelevant(path)).toBe(expected)
  })
})

describe('createDebouncer', () => {
  it('coalesces a burst into one trailing flush', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const d = createDebouncer(fire, 400, 2000)
    d.hit()
    vi.advanceTimersByTime(100)
    d.hit()
    vi.advanceTimersByTime(100)
    d.hit()
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(fire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(fire).toHaveBeenCalledTimes(1) // no stray max-wait flush after quiet
    vi.useRealTimers()
  })

  it('spaced events flush separately', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const d = createDebouncer(fire, 400, 2000)
    d.hit()
    vi.advanceTimersByTime(500)
    expect(fire).toHaveBeenCalledTimes(1)
    d.hit()
    vi.advanceTimersByTime(500)
    expect(fire).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('continuous churn still flushes at maxWait', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const d = createDebouncer(fire, 400, 2000)
    // hits every 300 ms — trailing timer never gets 400 ms of quiet
    for (let i = 0; i < 10; i++) {
      d.hit()
      vi.advanceTimersByTime(300)
    }
    // t = 3000 now; the 2 s cap fired exactly once during the churn
    expect(fire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(400) // trailing flush for the tail of the burst
    expect(fire).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('dispose cancels pending flushes', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const d = createDebouncer(fire, 400, 2000)
    d.hit()
    d.dispose()
    vi.advanceTimersByTime(5000)
    expect(fire).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test
```

Expected: FAIL — `server/watch.test.ts` cannot resolve `./watch.ts` (module does not exist). The existing `parse.test.ts` suite must still pass.

- [ ] **Step 4: Implement `server/watch.ts` (filter + debouncer only)**

```ts
// Filesystem watching for auto-refresh: which paths matter, and event debouncing.

// rel is '/'-separated relative to the repo root (fs.watch recursive on macOS).
// Working-tree paths all count — including git-ignored dirs; over-notifying is
// fine because the client refetch is cheap and fingerprint-gated.
// Inside .git only the ref/index surface counts; objects/lock/log churn is noise.
export function isRelevant(rel: string): boolean {
  if (rel === '.git') return false
  if (!rel.startsWith('.git/')) return true
  const inner = rel.slice('.git/'.length)
  return inner === 'HEAD' || inner === 'index' || inner === 'packed-refs' || inner.startsWith('refs/')
}

export type Debouncer = { hit: () => void; dispose: () => void }

// Trailing debounce with a max-wait cap: quiet bursts flush once after `delay`;
// sustained churn (long install, big rebase) still flushes every `maxWait`.
export function createDebouncer(fire: () => void, delay = 400, maxWait = 2000): Debouncer {
  let trailing: NodeJS.Timeout | null = null
  let cap: NodeJS.Timeout | null = null
  const clear = () => {
    if (trailing) clearTimeout(trailing)
    if (cap) clearTimeout(cap)
    trailing = cap = null
  }
  const flush = () => {
    clear()
    fire()
  }
  return {
    hit() {
      if (trailing) clearTimeout(trailing)
      trailing = setTimeout(flush, delay)
      if (!cap) cap = setTimeout(flush, maxWait)
    },
    dispose: clear,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test && pnpm exec tsc --noEmit
```

Expected: all tests PASS (previous 9 + new ones), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add server/watch.ts server/watch.test.ts
git commit -m "feat: add fs-event filter and debouncer for auto-refresh"
```

---

### Task 2: Watcher subscriber registry

**Files:**
- Modify: `server/watch.ts` (append)
- Test: `server/watch.test.ts` (append)

**Interfaces:**
- Consumes: `isRelevant`, `createDebouncer` from Task 1.
- Produces (used by Task 3):
  - `subscribe(repo: string, onChange: () => void, onError: () => void): () => void` — starts one shared `fs.watch(repo, { recursive: true })` per repo on first subscriber; returns an unsubscribe function; the last unsubscribe closes the watcher. Throws synchronously if `fs.watch` throws (missing path, EMFILE). On watcher error every subscriber's `onError` fires once and the entry is torn down.

- [ ] **Step 1: Write the failing integration test**

Append to `server/watch.test.ts` (add the new imports to the existing import lines at the top):

```ts
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { subscribe } from './watch.ts'
```

```ts
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await sleep(50)
  }
}

describe('subscribe (integration, real fs + timers)', () => {
  it('fires on working-tree change and on commit; unsubscribe stops events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'megit-watch-'))
    try {
      execFileSync('git', ['-C', dir, 'init'])
      let events = 0
      const unsub = subscribe(dir, () => { events++ }, () => {})
      await sleep(300) // FSEvents warm-up

      writeFileSync(join(dir, 'a.txt'), 'hello')
      await waitFor(() => events >= 1, 5000) // ~400 ms debounce + fs latency

      const before = events
      execFileSync('git', ['-C', dir, 'add', '.'])
      execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'x'])
      await waitFor(() => events > before, 5000)

      unsub()
      const after = events
      writeFileSync(join(dir, 'b.txt'), 'bye')
      await sleep(800) // > debounce window
      expect(events).toBe(after)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15000)

  it('throws synchronously for a missing path', () => {
    expect(() => subscribe('/nonexistent/megit-test-path', () => {}, () => {})).toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test
```

Expected: FAIL — `subscribe` is not exported from `./watch.ts`.

- [ ] **Step 3: Implement the registry**

Append to `server/watch.ts` (add the fs import at the top of the file):

```ts
import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
```

```ts
type Sub = { onChange: () => void; onError: () => void }
type Entry = { watcher: FSWatcher; debouncer: Debouncer; subs: Set<Sub> }

const entries = new Map<string, Entry>()

// One shared recursive watcher per repo, alive only while subscribed.
export function subscribe(repo: string, onChange: () => void, onError: () => void): () => void {
  let entry = entries.get(repo)
  if (!entry) {
    const subs = new Set<Sub>()
    const debouncer = createDebouncer(() => {
      for (const s of subs) s.onChange()
    })
    const watcher = watch(repo, { recursive: true }, (_event, filename) => {
      // null filename: platform couldn't tell — refresh conservatively
      if (filename === null || isRelevant(filename.toString())) debouncer.hit()
    })
    const fresh: Entry = { watcher, debouncer, subs }
    watcher.on('error', () => {
      entries.delete(repo)
      debouncer.dispose()
      watcher.close()
      for (const s of [...subs]) s.onError()
    })
    entries.set(repo, fresh)
    entry = fresh
  }
  const sub: Sub = { onChange, onError }
  entry.subs.add(sub)
  return () => {
    entry.subs.delete(sub)
    if (entry.subs.size === 0) {
      entry.watcher.close()
      entry.debouncer.dispose()
      entries.delete(repo)
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test && pnpm exec tsc --noEmit
```

Expected: all PASS, tsc clean. The integration test takes a few seconds (real timers) — that's expected.

- [ ] **Step 5: Commit**

```bash
git add server/watch.ts server/watch.test.ts
git commit -m "feat: add per-repo watcher registry with lazy lifecycle"
```

---

### Task 3: Server — SSE endpoint + graph `limit` param

**Files:**
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `subscribe` from Task 2; existing `repoGuard`, `git`, `parseLog`, `LOG_FORMAT`.
- Produces (used by Task 4):
  - `GET /api/events?repo=` — SSE stream (`Content-Type: text/event-stream`). Emits `data: changed\n\n` per debounce flush and `: ping\n\n` every 30 s. Repo validated by `repoGuard`.
  - `GET /api/graph?repo=&skip=&limit=` — `limit` (default 500) controls page size; response shape unchanged: `{ commits: Commit[], hasMore: boolean }`.

- [ ] **Step 1: Add the import**

In `server/index.ts`, extend the imports (after the `parse.ts` import on line 8):

```ts
import { subscribe } from './watch.ts'
```

- [ ] **Step 2: Add `limit` to `/api/graph`**

Replace the existing handler (lines 89–104):

```ts
app.get('/api/graph', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const skip = Number(req.query.skip) || 0
  const limit = Math.max(1, Number(req.query.limit) || 500)
  try {
    const raw = await git(repo, ['log', '--all', '--topo-order', `--skip=${skip}`, `--max-count=${limit + 1}`, `--format=${LOG_FORMAT}`])
    const commits = parseLog(raw)
    res.json({ commits: commits.slice(0, limit), hasMore: commits.length > limit })
  } catch (e) {
    const msg = (e as Error).message
    if (/does not have any commits yet/.test(msg)) {
      res.json({ commits: [], hasMore: false })
      return
    }
    res.status(500).json({ error: msg })
  }
})
```

(Only the `limit` const and the two `501`/`500` literals change; error handling is identical to v1.)

- [ ] **Step 3: Add the SSE endpoint**

Insert after the `/api/status` handler (after line 112):

```ts
app.get('/api/events', repoGuard, (req, res) => {
  const repo = String(req.query.repo)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write(': connected\n\n')
  const ping = setInterval(() => res.write(': ping\n\n'), 30_000)
  let unsub: (() => void) | null = null
  const cleanup = () => {
    clearInterval(ping)
    unsub?.()
    unsub = null
  }
  try {
    unsub = subscribe(
      repo,
      () => res.write('data: changed\n\n'),
      () => {
        cleanup()
        res.end()
      },
    )
  } catch {
    // watcher couldn't start (EMFILE, permissions) — client degrades to manual refresh
    cleanup()
    res.end()
    return
  }
  req.on('close', cleanup)
})
```

- [ ] **Step 4: Verify by hand with curl**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
node server/index.ts &
sleep 1
# limit param: this repo has 5+ commits by now
curl -s 'http://127.0.0.1:3411/api/graph?repo=/Users/vuhoangvuong/WORKSPACE/personal/megit&limit=3' \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.commits.length, j.hasMore)})'
```

Expected output: `3 true`

```bash
# unknown repo rejected by repoGuard
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3411/api/events?repo=/etc'
```

Expected output: `400`

```bash
# SSE stream: connect, then touch a file in the repo from another shell
curl -N 'http://127.0.0.1:3411/api/events?repo=/Users/vuhoangvuong/WORKSPACE/personal/megit' &
sleep 1
touch /Users/vuhoangvuong/WORKSPACE/personal/megit/.sse-probe
sleep 1
rm /Users/vuhoangvuong/WORKSPACE/personal/megit/.sse-probe
```

Expected: curl prints `: connected` immediately, then `data: changed` within ~1 s of the touch (and again after the rm). Kill the curl and the server (`kill %1 %2` or by PID) when done.

- [ ] **Step 5: Run tests + tsc**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test && pnpm exec tsc --noEmit
```

Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add server/index.ts
git commit -m "feat: add SSE change-events endpoint and graph limit param"
```

---

### Task 4: Client — EventSource, fingerprint gate, visibility gating, WIP tick

**Files:**
- Modify: `src/RepoView.tsx` (full rewrite below)
- Modify: `src/CommitPanel.tsx` (prop pass-through)
- Modify: `src/DiffView.tsx` (silent WIP reload)

**Interfaces:**
- Consumes: `GET /api/events?repo=` SSE and `GET /api/graph?…&limit=` from Task 3.
- Produces: `CommitPanel` gains prop `wipTick: number`; `DiffView` gains prop `wipTick: number`. `Selection` type unchanged.

Behavior being implemented (from the spec's Client + Performance sections):
- `changed` event → refetch status + the whole loaded graph range in **one** graph call (`limit = max(loaded, 500)`).
- Fingerprint gate: graph state only updates when the commit-hash/ref list actually changed; status only when status entries changed. Identical refetch → zero re-render.
- Hidden tab → set dirty flag only; refetch once on becoming visible.
- Selected commit disappeared → selection resets to `null` (initial-load state). WIP selection untouched.
- Reconnect (`onopen` after the first) → refetch once.
- WIP diff refetches (silently, no "Loading…" flash) when status changed; commit diffs never refetch.
- Manual refresh (`r` / button) now goes through the same range+fingerprint path — no more collapse to page 0.

- [ ] **Step 1: Rewrite `src/RepoView.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Commit, StatusEntry } from '../server/parse.ts'
import { api } from './api'
import GraphView from './GraphView'
import CommitPanel from './CommitPanel'

export type Selection = { kind: 'commit'; hash: string } | { kind: 'wip' } | null

// Cheap change detection: hashes + ref positions cover every visible graph change
// (amend/rebase rewrite hashes; branch moves show up in refs). Status compares
// path+code pairs. Identical fingerprint → skip setState → no 500-row re-render.
const graphFp = (commits: Commit[], hasMore: boolean) =>
  commits.map(c => `${c.hash}\x1f${c.refs.join(',')}`).join('\n') + (hasMore ? '+' : '')
const statusFp = (files: StatusEntry[]) => files.map(f => f.status + f.path).join('\n')

export default function RepoView({ repo, onRemove }: { repo: string; onRemove: () => void }) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [status, setStatus] = useState<StatusEntry[]>([])
  const [selection, setSelection] = useState<Selection>(null)
  const [error, setError] = useState<{ msg: string; gone: boolean } | null>(null)
  const [wipTick, setWipTick] = useState(0)

  const fps = useRef({ graph: '', status: '' })
  const loaded = useRef(0)
  loaded.current = commits.length

  const q = `repo=${encodeURIComponent(repo)}`

  const refresh = useCallback(() => {
    setError(null)
    const limit = Math.max(loaded.current, 500)
    Promise.all([
      api<{ commits: Commit[]; hasMore: boolean }>(`/api/graph?${q}&limit=${limit}`),
      api<{ files: StatusEntry[] }>(`/api/status?${q}`),
    ]).then(([g, s]) => {
      const gf = graphFp(g.commits, g.hasMore)
      if (fps.current.graph !== gf) {
        fps.current.graph = gf
        setCommits(g.commits)
        setHasMore(g.hasMore)
        // commit rewritten away (rebase/amend) → back to initial-load selection
        setSelection(sel =>
          sel?.kind === 'commit' && !g.commits.some(c => c.hash === sel.hash) ? null : sel)
      }
      const sf = statusFp(s.files)
      if (fps.current.status !== sf) {
        fps.current.status = sf
        setStatus(s.files)
        setWipTick(t => t + 1)
      }
    }).catch(e => setError({ msg: e.message, gone: e.status === 410 }))
  }, [q])

  useEffect(() => { refresh() }, [refresh])

  // auto-refresh: SSE signal → refetch; hidden tab defers to one refetch on return
  useEffect(() => {
    const es = new EventSource(`/api/events?${q}`)
    let dirty = false
    let firstOpen = true
    const kick = () => {
      if (document.visibilityState === 'hidden') { dirty = true; return }
      refresh()
    }
    es.onmessage = kick
    es.onopen = () => {
      // initial open: mount effect already fetched; reconnect: catch up on missed events
      if (firstOpen) { firstOpen = false; return }
      kick()
    }
    const onVis = () => {
      if (document.visibilityState === 'visible' && dirty) { dirty = false; refresh() }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { es.close(); document.removeEventListener('visibilitychange', onVis) }
  }, [q, refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && (e.target as HTMLElement).tagName !== 'INPUT') refresh()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh])

  const loadMore = () =>
    api<{ commits: Commit[]; hasMore: boolean }>(`/api/graph?${q}&skip=${commits.length}`)
      .then(g => {
        const next = [...commits, ...g.commits]
        fps.current.graph = graphFp(next, g.hasMore)
        setCommits(next)
        setHasMore(g.hasMore)
      })
      .catch(e => setError({ msg: e.message, gone: false }))

  if (error) {
    return (
      <div className="empty">
        <div>
          <div className="error">{error.msg}</div>
          {error.gone ? <button onClick={onRemove}>Remove tab</button> : <button onClick={refresh}>Retry</button>}
        </div>
      </div>
    )
  }

  return (
    <div className="repoview">
      <div className="toolbar">
        <span className="repo-path">{repo}</span>
        <button onClick={refresh} title="Refresh (r)">⟳ Refresh</button>
      </div>
      <div className="panes">
        <GraphView commits={commits} status={status} selection={selection} onSelect={setSelection} onLoadMore={loadMore} hasMore={hasMore} />
        <CommitPanel repo={repo} selection={selection} status={status} wipTick={wipTick} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Thread `wipTick` through `src/CommitPanel.tsx`**

Two changes. The signature (line 9):

```tsx
export default function CommitPanel({ repo, selection, status, wipTick }: { repo: string; selection: Selection; status: StatusEntry[]; wipTick: number }) {
```

And the `DiffView` render (line 39):

```tsx
      {file && <DiffView repo={repo} hash={selection.kind === 'commit' ? selection.hash : null} file={file} wipTick={wipTick} />}
```

Nothing else changes — the commit file list already skips refetching on refresh because `selection` keeps its object identity, and the WIP file list is the `status` prop, which updates automatically.

- [ ] **Step 3: Silent WIP reload in `src/DiffView.tsx`**

Change the component signature (line 9):

```tsx
export default function DiffView({ repo, hash, file, wipTick }: { repo: string; hash: string | null; file: string; wipTick: number }) {
```

Replace `load` and the first `useEffect` (lines 15–21):

```tsx
  const load = (force = false, silent = false) => {
    setError('')
    if (!silent) setResp(null)
    const params = new URLSearchParams({ repo, file, ...(hash ? { hash } : {}), ...(force ? { force: '1' } : {}) })
    api<DiffResp>(`/api/diff?${params}`).then(setResp).catch(e => setError(e.message))
  }
  // seenTick: a wipTick that was already current when this file was opened
  // must not trigger a reload; only later increments do. Commit diffs (hash
  // set) never reload — same hash, same content.
  const seenTick = useRef(wipTick)
  useEffect(() => { seenTick.current = wipTick; load() }, [repo, hash, file])
  useEffect(() => {
    if (wipTick === seenTick.current) return
    seenTick.current = wipTick
    if (!hash) load(false, true)
  }, [wipTick])
```

(`useRef` is already imported on line 1.)

- [ ] **Step 4: Type check + tests**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm exec tsc --noEmit && pnpm test
```

Expected: tsc clean, all tests PASS.

- [ ] **Step 5: Manual smoke via dev server**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm dev
```

In the browser (http://localhost:5173), with the megit repo open as a tab:
1. `touch /Users/vuhoangvuong/WORKSPACE/personal/megit/.probe` in a terminal → WIP row appears within ~1 s, no `r` pressed.
2. `rm .probe` → WIP row disappears (or WIP entry drops).
3. Select a commit, touch an unrelated file → selection and diff stay put, no flicker.
4. Note: SSE must survive the Vite proxy (`vite.config.ts` proxies `/api` to 3411). If events don't arrive in dev but the curl test in Task 3 worked, the proxy is buffering — fix by extending the proxy entry to `{ target: 'http://127.0.0.1:3411', changeOrigin: false }` and confirming; do not skip this check.

Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add src/RepoView.tsx src/CommitPanel.tsx src/DiffView.tsx
git commit -m "feat: auto-refresh client — SSE, fingerprint gate, visibility gating"
```

---

### Task 5: End-to-end verification + README

**Files:**
- Modify: `README.md` (feature list)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: verified feature, updated docs.

- [ ] **Step 1: Run the repo's verify skill**

Invoke the `verify` skill (`.claude/skills/verify/SKILL.md`) — it builds, launches, and drives megit with Playwright. Auto-refresh checks to perform on top of the standard flow:
1. Open megit with this repo as the active tab.
2. From a shell, `touch .e2e-probe` in the repo → assert the WIP row appears without any UI interaction (wait up to 3 s).
3. `rm .e2e-probe` → assert the WIP row disappears (repo is otherwise clean).
4. `git commit --allow-empty -m "e2e probe"` → assert a new top graph row appears; then `git reset --hard HEAD~1` to clean up → assert it disappears again.

Expected: all assertions pass. If the WIP row never appears, check the SSE proxy note in Task 4 Step 5 first.

- [ ] **Step 2: Update README feature list**

In `README.md`, add one bullet to the features section (match its existing style):

```markdown
- **Auto-refresh** — the server watches each open repo (`fs.watch` + SSE); the graph and WIP row update within ~1 s of any change. Manual refresh (`r`) still works.
```

- [ ] **Step 3: Final full check**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test && pnpm exec tsc --noEmit && pnpm build
```

Expected: tests PASS, tsc clean, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document auto-refresh in README"
```
