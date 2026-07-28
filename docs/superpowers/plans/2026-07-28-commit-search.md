# Commit Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `⌘F` find-bar over the commit graph that filters the loaded rows instantly, with a one-shot "search all history" button that escalates the same query to a full-history `git log` search.

**Architecture:** Two scopes over one match list. The default path is `matchLocal()`, a pure filter over the `commits` array RepoView already holds — no network, no debounce, and it recomputes for free when SSE refreshes the list. The opt-in path is a new `GET /api/search` route that runs three `git log` calls and returns up to 500 hashes; reaching a match below the loaded window re-fetches `/api/graph` with a doubling `limit` because `lanes.ts` cannot render row N without rows 0..N-1. The current match is expressed as ordinary `selection` state, so GraphView needs no new props and gets highlight + scroll for free.

**Tech Stack:** Express 5 + `execFile` git (no bundling, Node 24 native type-stripping), React 19 + Vite, vitest for the pure modules.

**Spec:** `docs/superpowers/specs/2026-07-28-commit-search-design.md`

## Global Constraints

- Node ≥ 24. Every Bash call must be prefixed with `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"` — `nvm use` does not persist between calls.
- Package manager is pnpm. Tests: `pnpm test`. Typecheck: `npx tsc --noEmit`.
- **Do not run `git commit` or `git rm`.** The user commits at task boundaries. Each task ends with a verification checkpoint, not a commit.
- Performance is the top priority. The local path must issue **zero** network requests. `/api/graph` stays at 100 commits per page; the server's 5000-row `limit` cap stays.
- Server routes that take a repo go through `repoGuard`. Values from the client reach git as `execFile` argv entries — never a shell string.
- Client CSS uses the `styles.css` variables (`--bg-panel`, `--border`, `--fg-dim`, `--bg-selected`, `--bg-hover`) so it themes under `data-theme` automatically.
- Deliberate simplifications get a `// ponytail:` comment naming the ceiling and the upgrade path, matching the existing style in `src/Toast.tsx:7`.

---

### Task 1: `src/search.ts` — the three pure functions

**Files:**
- Create: `src/search.ts`
- Test: `src/search.test.ts`

**Interfaces:**
- Consumes: `Commit` type from `server/parse.ts` (already imported this way in `src/RepoView.tsx:2`).
- Produces:
  - `matchLocal(commits: SearchRow[], q: string): string[]` — matching hashes in input order
  - `stepMatch(len: number, cur: number, dir: 1 | -1): number` — wrapping index, `-1` when `len === 0`
  - `label(cur: number, len: number, opts?: { truncated?: boolean; deep?: boolean }): string`
  - `type SearchRow = Pick<Commit, 'hash' | 'author' | 'email' | 'refs' | 'subject'>`

- [ ] **Step 1: Write the failing test**

Create `src/search.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchLocal, stepMatch, label, type SearchRow } from './search'

const row = (over: Partial<SearchRow>): SearchRow =>
  ({ hash: 'aaaaaaa1', author: 'Ada', email: 'ada@x.dev', refs: [], subject: 'init', ...over })

const rows: SearchRow[] = [
  row({ hash: 'f1e2d3c', subject: 'Add Toast notifications' }),
  row({ hash: 'a9b8c7d', subject: 'fix lanes', author: 'Grace Hopper', email: 'grace@navy.mil' }),
  row({ hash: 'c0ffee1', subject: 'bump deps', refs: ['HEAD -> main', 'origin/main'] }),
]

describe('matchLocal', () => {
  it('matches the subject, case-insensitively', () => {
    expect(matchLocal(rows, 'toast')).toEqual(['f1e2d3c'])
    expect(matchLocal(rows, 'TOAST')).toEqual(['f1e2d3c'])
  })

  it('matches author name and email', () => {
    expect(matchLocal(rows, 'hopper')).toEqual(['a9b8c7d'])
    expect(matchLocal(rows, 'navy.mil')).toEqual(['a9b8c7d'])
  })

  it('matches ref names — loaded rows already carry them, so they are free', () => {
    expect(matchLocal(rows, 'origin/')).toEqual(['c0ffee1'])
  })

  it('matches a hash by prefix only, not substring', () => {
    expect(matchLocal(rows, 'c0ff')).toEqual(['c0ffee1'])
    expect(matchLocal(rows, '0ffee')).toEqual([])
  })

  it('returns hashes in commits order so "next" always moves down the screen', () => {
    expect(matchLocal(rows, 'a')).toEqual(['f1e2d3c', 'a9b8c7d', 'c0ffee1'])
  })

  it('treats an empty or whitespace query as no search at all', () => {
    expect(matchLocal(rows, '')).toEqual([])
    expect(matchLocal(rows, '   ')).toEqual([])
  })
})

describe('stepMatch', () => {
  it('wraps at both ends — a find-bar loops where the graph arrows clamp', () => {
    expect(stepMatch(4, 3, 1)).toBe(0)
    expect(stepMatch(4, 0, -1)).toBe(3)
  })

  it('steps normally in the middle', () => {
    expect(stepMatch(4, 1, 1)).toBe(2)
    expect(stepMatch(4, 2, -1)).toBe(1)
  })

  it('enters the list from either end when nothing is current yet', () => {
    expect(stepMatch(4, -1, 1)).toBe(0)
    expect(stepMatch(4, -1, -1)).toBe(3)
  })

  it('stays put on a single match and reports -1 on an empty list', () => {
    expect(stepMatch(1, 0, 1)).toBe(0)
    expect(stepMatch(0, -1, 1)).toBe(-1)
  })
})

describe('label', () => {
  it('counts from one', () => {
    expect(label(0, 4)).toBe('1 of 4')
    expect(label(3, 4)).toBe('4 of 4')
  })

  it('says so when there is nothing', () => {
    expect(label(-1, 0)).toBe('No results')
  })

  it('marks a truncated server result and the wider scope', () => {
    expect(label(0, 500, { truncated: true })).toBe('1 of 500+')
    expect(label(0, 37, { deep: true })).toBe('1 of 37 · all')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test -- search
```

Expected: FAIL — `Failed to resolve import "./search"`.

- [ ] **Step 3: Write the implementation**

Create `src/search.ts`:

```ts
import type { Commit } from '../server/parse.ts'

// Only the fields a local match reads. Narrower than Commit so the tests can build
// rows without inventing dates and parents.
export type SearchRow = Pick<Commit, 'hash' | 'author' | 'email' | 'refs' | 'subject'>

// The default search path: a filter over the rows already loaded. Free — no request,
// no debounce, and because it derives from `commits` an SSE refresh recomputes it, so
// a rebased-away hash can never go stale here. Ref names are in because loaded rows
// already carry them; the server route can't match them nearly as cheaply.
//
// Hash is a prefix test, not a substring one: `git log <prefix>` resolves prefixes, and
// a substring hit in the middle of a sha is a coincidence, never something typed on purpose.
export function matchLocal(commits: SearchRow[], q: string): string[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  const out: string[] = []
  for (const c of commits) {
    if (
      c.hash.startsWith(needle)
      || c.subject.toLowerCase().includes(needle)
      || c.author.toLowerCase().includes(needle)
      || c.email.toLowerCase().includes(needle)
      || c.refs.some(r => r.toLowerCase().includes(needle))
    ) out.push(c.hash)
  }
  return out
}

// Wraps, unlike rowNav's `step`, which clamps so a held arrow key stops instead of
// looping. A find-bar is the opposite convention: match 4 of 4 → next → match 1.
export function stepMatch(len: number, cur: number, dir: 1 | -1): number {
  if (len === 0) return -1
  if (cur < 0) return dir === 1 ? 0 : len - 1
  return (cur + dir + len) % len
}

export const label = (cur: number, len: number, opts: { truncated?: boolean; deep?: boolean } = {}) =>
  len === 0
    ? 'No results'
    : `${cur + 1} of ${len}${opts.truncated ? '+' : ''}${opts.deep ? ' · all' : ''}`
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test -- search
npx tsc --noEmit
```

Expected: all `search` tests PASS, typecheck clean.

- [ ] **Step 5: Checkpoint**

Report to the user: files added, test count. Do **not** commit — the user commits at task boundaries.

---

### Task 2: `mergeMatches` + `parseMatches` in `server/parse.ts`

**Files:**
- Modify: `server/parse.ts` (append after `parseLog`, around line 68)
- Test: `server/parse.test.ts` (append)

**Interfaces:**
- Consumes: nothing from Task 1 — these are independent pure functions.
- Produces:
  - `parseMatches(raw: string): [string, number][]` — parses `%H%x1f%ct` lines into `[hash, commitDate]` pairs
  - `mergeMatches(lists: [string, number][][]): { matches: string[]; truncated: boolean }`
  - `SEARCH_CAP = 500`

- [ ] **Step 1: Write the failing test**

Append to `server/parse.test.ts`:

```ts
describe('parseMatches', () => {
  it('reads %H\\x1f%ct lines into hash/date pairs', () => {
    expect(parseMatches('aaa\x1f300\nbbb\x1f200\n')).toEqual([['aaa', 300], ['bbb', 200]])
  })

  it('handles empty output', () => {
    expect(parseMatches('')).toEqual([])
    expect(parseMatches('\n')).toEqual([])
  })
})

describe('mergeMatches', () => {
  it('unions the lists and orders by commit date, newest first', () => {
    const byMsg: [string, number][] = [['a', 300], ['c', 100]]
    const byAuthor: [string, number][] = [['b', 200]]
    expect(mergeMatches([byMsg, byAuthor]).matches).toEqual(['a', 'b', 'c'])
  })

  it('dedupes a commit that matched on more than one field', () => {
    const byMsg: [string, number][] = [['a', 300]]
    const byAuthor: [string, number][] = [['a', 300], ['b', 200]]
    expect(mergeMatches([byMsg, byAuthor]).matches).toEqual(['a', 'b'])
  })

  it('caps at 500 and flags the truncation', () => {
    const many: [string, number][] = Array.from({ length: 501 }, (_, i) => [`h${i}`, 1000 - i])
    const res = mergeMatches([many])
    expect(res.matches).toHaveLength(500)
    expect(res.truncated).toBe(true)
    expect(res.matches[0]).toBe('h0')
  })

  it('reports no truncation at exactly the cap, and handles empty input', () => {
    const exact: [string, number][] = Array.from({ length: 500 }, (_, i) => [`h${i}`, 1000 - i])
    expect(mergeMatches([exact]).truncated).toBe(false)
    expect(mergeMatches([])).toEqual({ matches: [], truncated: false })
    expect(mergeMatches([[], []])).toEqual({ matches: [], truncated: false })
  })
})
```

Also extend the existing import at the top of `server/parse.test.ts` to include `mergeMatches` and `parseMatches`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test -- parse
```

Expected: FAIL — `mergeMatches is not a function` (or an import error).

- [ ] **Step 3: Write the implementation**

Append to `server/parse.ts` after `parseLog`:

```ts
// `/api/search` asks git for `%H%x1f%ct` — the hash to select and the date to order by.
export const parseMatches = (raw: string): [string, number][] =>
  raw.split('\n').filter(Boolean).map(l => {
    const [hash, ct] = l.split('\x1f')
    return [hash, Number(ct)] as [string, number]
  })

// The graph will not render 14k rows, and a one-word query can match most of a
// history, so the route reports a bounded slice.
export const SEARCH_CAP = 500

// git ANDs its commit-limiting options, so "message OR author OR hash" costs one
// `git log` per field and a union here. Date-descending is the ordering the graph's
// --date-order mostly agrees with.
//
// ponytail: ct-desc, not true --date-order — topological tie-breaks can disagree, so
// "next" may occasionally step one row upward. Exact positions would cost a
// full-history `--format=%H` pass per query; local search is already exact.
export function mergeMatches(lists: [string, number][][]): { matches: string[]; truncated: boolean } {
  const byHash = new Map<string, number>()
  for (const list of lists) {
    for (const [hash, ct] of list) if (!byHash.has(hash)) byHash.set(hash, ct)
  }
  const sorted = [...byHash].sort((a, b) => b[1] - a[1]).map(([hash]) => hash)
  return { matches: sorted.slice(0, SEARCH_CAP), truncated: sorted.length > SEARCH_CAP }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test -- parse
npx tsc --noEmit
```

Expected: all `parse` tests PASS, typecheck clean.

- [ ] **Step 5: Checkpoint**

Report to the user. Do not commit.

---

### Task 3: `GET /api/search` route

**Files:**
- Modify: `server/index.ts` — import line 10, plus a new route inserted after the `/api/graph` handler (ends line 178)

**Interfaces:**
- Consumes: `parseMatches`, `mergeMatches` from Task 2; the existing `git()` helper (`server/index.ts:49`), `isSha` (`:31`), `repoGuard` (`:61`).
- Produces: `GET /api/search?repo=<path>&q=<query>` → `{ matches: string[], truncated: boolean }`. Consumed by Task 5.

- [ ] **Step 1: Verify git's `-F` actually applies to `--author`**

`-F` is documented under "Commit Limiting" alongside `--grep` and `--author`, but the plan depends on it, so check rather than assume. In this repo:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
git log -i -F --author='.' --max-count=1 --format=%H | wc -l
git log -i -F --author='Vuong' --max-count=1 --format=%H | wc -l
```

Expected: the literal `.` matches nothing (`0`), the real name matches (`1`). If `.` returns 1, `-F` is not covering `--author` on this git build — in that case escape the author pattern with `q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` and note it in a comment. Record which branch you took.

- [ ] **Step 2: Write the route**

Extend the `parse.ts` import on `server/index.ts:10` with `mergeMatches, parseMatches`, then insert after the `/api/graph` handler:

```ts
// The graph's ref whitelist, shared so a search result is always a commit the graph
// can actually show. Kept next to the route that consumes it rather than exported
// from /api/graph — the two lists must agree, and a comment is cheaper than a seam.
const SEARCH_TIPS = ['HEAD', '--branches', '--tags', '--remotes']

app.get('/api/search', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const q = String(req.query.q ?? '').trim()
  // an empty query is not a search: answer without touching git
  if (!q) {
    res.json({ matches: [], truncated: false })
    return
  }
  // -F: a typed '.', '(' or '*' is a literal. Without it a query holding '(' makes
  //     git exit non-zero, and a pathological pattern becomes the client's to choose.
  // -i: covers --grep and --author alike.
  // --max-count=501: q='a' matches most of a 14k history; 500 is all the route reports
  //     and the 501st row is what proves there were more.
  const scan = (pattern: string) =>
    git(repo, ['log', ...SEARCH_TIPS, '--date-order', '-i', '-F', pattern, '--max-count=501', '--format=%H%x1f%ct'])
      .then(parseMatches)
      .catch(() => [] as [string, number][])
  try {
    const [byMsg, byAuthor, byHash] = await Promise.all([
      scan(`--grep=${q}`),
      scan(`--author=${q}`),
      // `--` terminates revs: without it an abbreviated sha that is also a filename is
      // ambiguous. An unknown or ambiguous prefix exits non-zero → no hash match.
      isSha(q)
        ? git(repo, ['log', '-1', '--format=%H%x1f%ct', q, '--']).then(parseMatches).catch(() => [] as [string, number][])
        : Promise.resolve([] as [string, number][]),
    ])
    res.json(mergeMatches([byMsg, byAuthor, byHash]))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})
```

- [ ] **Step 3: Verify the route by hand**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm dev &
sleep 4
R=$(node -e "console.log(encodeURIComponent(process.cwd()))")
curl -s "http://localhost:4500/api/search?repo=$R&q=Toast" | head -c 300; echo
curl -s "http://localhost:4500/api/search?repo=$R&q=" | head -c 200; echo
curl -s "http://localhost:4500/api/search?repo=$R&q=%28" | head -c 200; echo
curl -s "http://localhost:4500/api/search?repo=$R&q=3a78cb7" | head -c 200; echo
curl -s "http://localhost:4500/api/search?repo=/nope" | head -c 200; echo
```

Expected, in order: a `matches` array containing the `1f87812…` Toast commit's full sha; `{"matches":[],"truncated":false}`; `{"matches":[],"truncated":false}` and **no 500** (this is the `-F` check); the full sha of `3a78cb7`; `{"error":"unknown repo"}` with status 400.

Kill the dev server by PID — **never** `pkill -f "node server/index.ts"`, that kills the user's own `--watch` child.

- [ ] **Step 4: Typecheck and full suite**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx tsc --noEmit && pnpm test
```

Expected: clean, all tests pass.

- [ ] **Step 5: Checkpoint**

Report the curl outputs verbatim. Do not commit.

---

### Task 4: `src/SearchBar.tsx` + styles

**Files:**
- Create: `src/SearchBar.tsx`
- Modify: `src/styles.css` (append near the `.graph-pane` rules, around line 130)

**Interfaces:**
- Consumes: nothing — purely presentational.
- Produces: default export `SearchBar` with props

```ts
{
  seq: number            // bumped on every ⌘F; re-focuses and selects the input
  value: string
  count: string          // already-formatted label() output
  deep: boolean          // deep result active → button reads as active
  onChange: (v: string) => void
  onDeep: () => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}
```

- [ ] **Step 1: Write the component**

Create `src/SearchBar.tsx`:

```tsx
import { useEffect, useRef } from 'react'

// The find-bar from the GitKraken reference: magnifier, input, counter, then the
// deep-search globe and the prev/next/close controls.
//
// Rendered as a SIBLING of .graphview, never a child: GraphView's arrow-key handler
// bails unless the event target is document.body or inside .graphview
// (GraphView.tsx:485), so this placement keeps ↑/↓ as ordinary text-cursor movement
// in the input without adding a second guard there.
export default function SearchBar({
  seq, value, count, deep, onChange, onDeep, onPrev, onNext, onClose,
}: {
  seq: number
  value: string
  count: string
  deep: boolean
  onChange: (v: string) => void
  onDeep: () => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  // seq, not a mount-only effect: ⌘F while the bar is already open must re-focus and
  // select, so the next query replaces the last one instead of appending to it.
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [seq])

  return (
    <div className="searchbar" role="search">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4.5-4.5" />
      </svg>
      <input
        ref={ref}
        value={value}
        placeholder="Search commits"
        aria-label="Search commits"
        onChange={e => onChange(e.target.value)}
        // Enter lives on the input rather than the window listener: it must only step
        // matches while the bar has focus, and it must not fight the commit-message form.
        onKeyDown={e => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          e.shiftKey ? onPrev() : onNext()
        }}
      />
      <span className="count">{count}</span>
      <button className={`deep${deep ? ' active' : ''}`} onClick={onDeep} title="Search all history" aria-label="Search all history">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
        </svg>
      </button>
      <button onClick={onPrev} title="Previous match (⇧⏎)" aria-label="Previous match">↑</button>
      <button onClick={onNext} title="Next match (⏎)" aria-label="Next match">↓</button>
      <button onClick={onClose} title="Close (Esc)" aria-label="Close search">✕</button>
    </div>
  )
}
```

- [ ] **Step 2: Add the styles**

Append to `src/styles.css` after the `.diff-overlay` rules:

```css
/* floating pill over the graph, centred like the GitKraken reference. z-index 3 keeps
   it above .diff-overlay (2) so ⌘F still works with a diff open. */
.searchbar { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 3; display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 8px; background: var(--bg-selected); border: 1px solid var(--border); box-shadow: 0 3px 12px rgba(0,0,0,.35); animation: appear .12s ease-out; }
.searchbar input { width: 220px; padding: 3px 6px; background: var(--bg-panel); color: var(--fg); border: 1px solid var(--border); border-radius: 5px; font: inherit; }
.searchbar .count { min-width: 78px; text-align: center; color: var(--fg-dim); font-size: 12px; }
.searchbar button { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; padding: 3px 5px; background: none; border: none; color: var(--fg-dim); }
.searchbar button:hover { background: var(--bg-hover); color: var(--fg); }
.searchbar button.deep.active { background: var(--bg-hover); color: var(--fg); }
```

- [ ] **Step 3: Typecheck**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx tsc --noEmit
```

Expected: clean. (No unit test here — a presentational component with no logic of its own; Task 6 drives it end-to-end.)

- [ ] **Step 4: Checkpoint**

Report to the user. Do not commit.

---

### Task 5: Wire it into `RepoView`

**Files:**
- Modify: `src/RepoView.tsx` — imports (lines 1-8), new state after line 63, `jumpTo`/`runDeep` after `loadMore` (ends line 236), the key handler effect (lines 178-191), and the render inside `.graph-pane` (after line 289)

**Interfaces:**
- Consumes: `matchLocal`, `stepMatch`, `label` (Task 1); `GET /api/search` (Task 3); `SearchBar` (Task 4); the existing `toastErr` from `src/Toast.tsx`, `api` from `src/api.ts`, and RepoView's own `gen`/`loaded`/`fps` refs, `PAGE`, `graphFp`, `headFp`.
- Produces: the finished feature. Nothing later depends on it.

- [ ] **Step 1: Add imports and state**

Extend the existing imports:

```tsx
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import SearchBar from './SearchBar'
import { label, matchLocal, stepMatch } from './search'
import { toastErr } from './Toast'
```

Add after the `graphColW` state (line 63):

```tsx
  // 0 = closed; every ⌘F bumps it, which re-focuses and selects the input. One number
  // instead of an `open` boolean plus a focus nonce.
  const [searchSeq, setSearchSeq] = useState(0)
  const [query, setQuery] = useState('')
  const [cur, setCur] = useState(-1)
  // null = local scope. Set by the deep button only, cleared by the next keystroke.
  const [deep, setDeep] = useState<{ matches: string[]; truncated: boolean } | null>(null)
```

- [ ] **Step 2: Add the derived match list and the jump**

Insert after `loadMore` (after line 236):

```tsx
  // The default scope. Derived, not stored: an SSE refresh replaces `commits` and this
  // recomputes, so the count can't drift and a rebased-away hash can't go stale.
  const localMatches = useMemo(() => matchLocal(commits, query), [commits, query])
  const matches = deep?.matches ?? localMatches

  // Selecting the match is the whole highlight: GraphView already styles .row.selected
  // and scrolls it into view (GraphView.tsx:496), so there is nothing to add there.
  // `list` is a parameter rather than a read of `matches` because runDeep needs to jump
  // into a result set that hasn't reached state yet.
  const jumpTo = useCallback((list: string[], i: number) => {
    const hash = list[i]
    setCur(hash ? i : -1)
    if (!hash) return
    if (commits.some(c => c.hash === hash)) {
      setSelection({ kind: 'commit', hash })
      return
    }
    // Below the loaded window. lanes.ts lays out top-down, so row N needs rows 0..N-1 —
    // the only way down is to load more. Doubling gets there in a handful of growing
    // requests instead of 42 sequential `loadMore` pages.
    const g = ++gen.current
    ;(async () => {
      let limit = Math.max(loaded.current, PAGE)
      while (limit < 5000) {
        limit = Math.min(5000, limit * 2)
        const res = await api<{ commits: Commit[]; hasMore: boolean }>(`/api/graph?${q}&limit=${limit}`)
        if (g !== gen.current) return // superseded — a newer jump or refresh owns the list
        setCommits(res.commits)
        setHasMore(res.hasMore)
        // both fingerprints, or the next silent refresh re-renders the whole list for nothing
        fps.current.graph = graphFp(res.commits, res.hasMore, stashes)
        fps.current.head = headFp(res.commits, stashes)
        if (res.commits.some(c => c.hash === hash)) {
          setSelection({ kind: 'commit', hash })
          return
        }
      }
      // 5000 is the server's cap and far past where the DOM gives out
      toastErr('Match is too deep in history to display')
    })().catch(e => toastErr(e.message))
  }, [commits, q, stashes])

  const onQuery = useCallback((v: string) => {
    setQuery(v)
    setDeep(null) // a new query is a local query again
    // matchLocal twice per keystroke (here and in the memo) — it's a lowercase+includes
    // over the loaded rows, and this way the jump doesn't need an effect to chase state
    jumpTo(matchLocal(commits, v), 0)
  }, [commits, jumpTo])

  const closeSearch = useCallback(() => {
    setSearchSeq(0)
    setQuery('')
    setDeep(null)
    setCur(-1)
  }, [])

  // One shot, not a mode: this is the only thing in the feature that spends a git
  // process, and it spends it because the user asked.
  const runDeep = useCallback(() => {
    if (!query.trim()) return
    api<{ matches: string[]; truncated: boolean }>(`/api/search?${q}&q=${encodeURIComponent(query)}`)
      .then(r => { setDeep(r); jumpTo(r.matches, 0) })
      .catch(e => toastErr(e.message))
  }, [q, query, jumpTo])
```

- [ ] **Step 3: Add the keys**

Replace the key handler effect (lines 178-191) with:

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // TEXTAREA as well as INPUT: the commit-message editor is a textarea, and
      // typing "r" in it must not trigger a refresh
      const tag = (e.target as HTMLElement).tagName
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && tag !== 'INPUT' && tag !== 'TEXTAREA') refresh()
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyJ') {
        e.preventDefault() // keep Chrome's downloads panel closed
        toggleTerm()
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyF') {
        e.preventDefault() // and keep the browser's own find bar shut
        setSearchSeq(s => s + 1)
      }
      // on the window, not the input: Esc has to close the bar even after focus moved
      // to a row or the commit panel
      if (e.key === 'Escape' && searchSeq > 0) closeSearch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh, toggleTerm, searchSeq, closeSearch])
```

- [ ] **Step 4: Render the bar**

Insert inside `.graph-pane`, immediately after the `<GraphView … />` element (line 289) — a sibling of `.graphview`, which is what keeps arrow keys out of the graph:

```tsx
          {searchSeq > 0 && (
            <SearchBar
              seq={searchSeq}
              value={query}
              count={label(cur, matches.length, { truncated: deep?.truncated, deep: !!deep })}
              deep={!!deep}
              onChange={onQuery}
              onDeep={runDeep}
              onPrev={() => jumpTo(matches, stepMatch(matches.length, cur, -1))}
              onNext={() => jumpTo(matches, stepMatch(matches.length, cur, 1))}
              onClose={closeSearch}
            />
          )}
```

- [ ] **Step 5: Typecheck and full suite**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx tsc --noEmit && pnpm test
```

Expected: clean, all tests pass.

- [ ] **Step 6: Checkpoint**

Report to the user. Do not commit.

---

### Task 6: End-to-end verification and measurement

**Files:** none modified. Uses the `verify` skill (`.claude/skills/verify/SKILL.md`).

**Interfaces:**
- Consumes: the whole feature.
- Produces: evidence. No claim of "working" before this task's output exists.

- [ ] **Step 1: Build and launch**

Invoke the `verify` skill. Confirm `pnpm build` succeeds and report the main-bundle chunk size against the previous build — this feature adds no dependency, so the delta should be under ~1 kB gzip.

- [ ] **Step 2: Drive the local path**

In the browser, on this repo:

1. `⌘F` → the pill appears, input focused.
2. Type `toast` → counter reads `1 of 1`, the "add Toast noti" row is selected and scrolled into view.
3. `⌘F` again while open → the existing text is selected (typing replaces it).
4. Type `a` → counter shows a multi-match count; `Enter` walks down, `Shift+Enter` walks up, and at the last match `Enter` wraps to `1 of N`.
5. With the input focused, press `↑`/`↓` → the text cursor moves; the graph selection does **not** change.
6. `Esc` → the bar closes, the selection stays where it landed.
7. Toggle the theme (`⌘⇧0`) with the bar open → the pill re-themes.

Confirm in the Network panel that steps 1-7 issued **zero** requests. This is the performance claim; do not assert it without the empty panel.

- [ ] **Step 3: Drive the deep path on a large repo**

Register `~/WORKSPACE/BLS/bikeleasing-app` (14k commits) temporarily, then:

1. Search a term that exists only deep in history → local reads `No results`.
2. Click the globe → counter switches to `1 of N · all`, the graph loads down and the match row renders with `.selected`.
3. Report how many `/api/graph` requests the escalation took and the final `limit`.
4. Type another character → the counter drops back to the local scope and the globe de-activates.
5. Search a term with hundreds of matches → confirm the `500+` marker appears.

**Then remove that repo from `~/.config/megit/config.json`** — it is real user state.

- [ ] **Step 4: Measure**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
R=$(node -e "console.log(encodeURIComponent('$HOME/WORKSPACE/BLS/bikeleasing-app'))")
for Q in a toast zzzznotfound; do
  curl -s -o /dev/null -w "$Q: %{time_total}s %{size_download}B\n" "http://localhost:4500/api/search?repo=$R&q=$Q"
done
```

Report the numbers. Two full-history `git log --grep` scans are the cost to watch; if any query exceeds ~1 s, say so rather than shipping it quietly.

- [ ] **Step 5: Final checkpoint**

Report: test count, typecheck status, bundle delta, the request-count evidence for both paths, and the measured timings. Then hand off to the user to commit.

---

## Self-Review

**Spec coverage.** Local `matchLocal` incl. ref names → Task 1. `mergeMatches` + cap/truncated → Task 2. `/api/search` with `-F`/`-i`/`--max-count=501`/`--` and the empty-query short circuit → Task 3. Pill UI, deep button, sibling placement, theming → Task 4. State shape, one-shot deep semantics, `deep=null` on edit, limit-doubling escalation, 5000-cap Toast, `⌘F`/`Esc`/`Enter`/`Shift+Enter`, selection-as-highlight → Task 5. Error handling: deep failure → Toast with `deep` left `null` (Task 5, `runDeep.catch`); 410 inherited via the shared `api` helper; no-match → `No results` with the deep button still live. Testing and measurement → Tasks 1, 2, 3 step 3, 6. Both `ponytail:` ceilings are written into the code (ct-desc ordering in Task 2, and the stale-deep-hash case is what `jumpTo`'s cap Toast surfaces).

**Deviations from the spec, deliberate:** the spec described a 250 ms debounce and a `truncated` flag "when either grep list was cut" — the debounce is gone because the local path is synchronous and the deep path is click-driven, and truncation is decided once in `mergeMatches` rather than per list. The spec's `{ searchOpen, query, cur, deep }` became `{ searchSeq, query, cur, deep }`, folding the open flag and the focus nonce into one number.

**Type consistency.** `SearchRow` is used in Task 1 only. `[string, number][]` is the pair type in Tasks 2 and 3. `{ matches: string[]; truncated: boolean }` is the shape returned by `mergeMatches`, the route, and the `deep` state. `jumpTo(list, i)` is called with an explicit list in all four call sites. `stepMatch(len, cur, dir)` and `label(cur, len, opts)` argument orders match their definitions.

**Placeholders.** None — every code step carries the actual content, and the one genuine unknown (`-F` on `--author`) is a verification step with both branches spelled out.
