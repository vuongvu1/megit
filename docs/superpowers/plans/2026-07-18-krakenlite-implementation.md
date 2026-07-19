# krakenlite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only GitKraken-style git viewer: commit graph, repo tabs, diff view. Local web app.

**Architecture:** Single pnpm package. Express server (`server/`) shells out to `git` via `execFile`, serves JSON API on `127.0.0.1:3411`. React + Vite frontend (`src/`) with plain `useState`/`fetch`. Pure parsers and the lane-layout algorithm are the only unit-tested code (Vitest). Frontend imports *types only* from `server/parse.ts` (erased at build, no runtime coupling).

**Tech Stack:** Node 24 (native TS type-stripping — no tsx/ts-node), Express 5, React 19, Vite, Vitest, diff2html (+ highlight.js), pnpm.

## Global Constraints

- Read-only: only `log`, `status`, `show`, `diff`, `diff-tree`, `rev-parse`, `rev-list` git commands. The app never writes to a repository.
- All git invocations via `execFile('git', ['-C', repo, ...args])` — never shell interpolation.
- Server binds `127.0.0.1` only.
- Every repo-scoped endpoint validates `repo` against the config list before running git.
- Config at `~/.config/krakenlite/config.json`, written only by the server.
- Graph pages: 500 commits per page.
- File diff cap ~1 MB; `?force=1` bypasses.
- No state library, no react-query. No component tests in v1.
- TS must be erasable-syntax-only (no enums/namespaces/param properties); imports between server files use explicit `.ts` extensions (Node type-stripping requirement).
- Node 24 via nvm (`.nvmrc` = `24`). Dev shells must have node ≥ 24 active (`nvm use`).

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.nvmrc`, `.gitignore`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `server/index.ts`

**Interfaces:**
- Produces: Express app in `server/index.ts` listening on `127.0.0.1:3411` with `express.json()` middleware; later tasks append routes to it. Vite dev server proxies `/api` → `:3411`.

- [ ] **Step 1: Init package + deps**

```bash
echo 24 > .nvmrc
printf 'node_modules\ndist\n' > .gitignore
pnpm init
pnpm add express react react-dom diff2html highlight.js
pnpm add -D typescript vite @vitejs/plugin-react vitest concurrently @types/express @types/node @types/react @types/react-dom
```

Then edit `package.json`: `"type": "module"`, `"engines": {"node": ">=24"}`, scripts:

```json
{
  "dev": "concurrently -k \"node --watch server/index.ts\" \"vite\"",
  "build": "vite build",
  "start": "node server/index.ts",
  "test": "vitest run"
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["server", "src", "vite.config.ts"]
}
```

- [ ] **Step 3: vite.config.ts**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:3411' } },
})
```

- [ ] **Step 4: index.html + src/main.tsx + src/App.tsx (placeholder) + src/styles.css (empty for now)**

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>krakenlite</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
```

`src/App.tsx` placeholder: `export default function App() { return <h1>krakenlite</h1> }`

- [ ] **Step 5: server/index.ts skeleton**

```ts
import express from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const app = express()
app.use(express.json())

// API routes appended here by later tasks

const dist = join(import.meta.dirname, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
}

app.listen(3411, '127.0.0.1', () => console.log('krakenlite API on http://127.0.0.1:3411'))
```

- [ ] **Step 6: Verify**

Run: `node server/index.ts &` → expect startup log; `curl -s http://127.0.0.1:3411/ -o /dev/null -w '%{http_code}'` → 404 (no dist yet, fine). Kill it. `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: scaffold server + vite react frontend"`

---

### Task 2: Parsers (TDD)

**Files:**
- Create: `server/parse.ts`, `server/parse.test.ts`

**Interfaces:**
- Produces:
  - `type Commit = { hash: string; parents: string[]; author: string; date: number; refs: string[]; subject: string }` (`date` = unix seconds)
  - `type StatusEntry = { path: string; status: string }` (`status` = one char: M/A/D/R/C/U/?)
  - `const LOG_FORMAT: string` — passed to `git log --format=`
  - `parseLog(raw: string): Commit[]`
  - `parseStatus(raw: string): StatusEntry[]`

- [ ] **Step 1: Write failing tests** (`server/parse.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { parseLog, parseStatus } from './parse.ts'

const F = '\x1f', R = '\x1e'

describe('parseLog', () => {
  it('parses records with refs and parents', () => {
    const raw =
      `aaa${F}bbb ccc${F}Vu${F}1750000000${F}HEAD -> main, origin/main${F}merge stuff${R}\n` +
      `bbb${F}${F}Vu${F}1749999999${F}${F}initial${R}\n`
    expect(parseLog(raw)).toEqual([
      { hash: 'aaa', parents: ['bbb', 'ccc'], author: 'Vu', date: 1750000000, refs: ['HEAD -> main', 'origin/main'], subject: 'merge stuff' },
      { hash: 'bbb', parents: [], author: 'Vu', date: 1749999999, refs: [], subject: 'initial' },
    ])
  })
  it('handles empty input', () => expect(parseLog('')).toEqual([]))
})

describe('parseStatus', () => {
  it('parses porcelain v2 entries', () => {
    const raw = [
      '1 .M N... 100644 100644 100644 abc def src/App.tsx',
      '1 A. N... 000000 100644 100644 000 111 new file.ts',
      '2 R. N... 100644 100644 100644 abc def R100 new.ts\told.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
      '? untracked.txt',
    ].join('\n')
    expect(parseStatus(raw)).toEqual([
      { path: 'src/App.tsx', status: 'M' },
      { path: 'new file.ts', status: 'A' },
      { path: 'new.ts', status: 'R' },
      { path: 'conflict.ts', status: 'U' },
      { path: 'untracked.txt', status: '?' },
    ])
  })
  it('handles empty input', () => expect(parseStatus('')).toEqual([]))
})
```

- [ ] **Step 2: Run** `pnpm vitest run server/parse.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement** (`server/parse.ts`)

```ts
export type Commit = {
  hash: string
  parents: string[]
  author: string
  date: number
  refs: string[]
  subject: string
}

export type StatusEntry = { path: string; status: string }

// \x1f field sep, \x1e record sep — never appear in git metadata
export const LOG_FORMAT = '%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e'

export function parseLog(raw: string): Commit[] {
  return raw
    .split('\x1e')
    .map(r => r.replace(/^\n/, ''))
    .filter(r => r.length > 0)
    .map(rec => {
      const [hash, parents, author, date, refs, subject] = rec.split('\x1f')
      return {
        hash,
        parents: parents ? parents.split(' ') : [],
        author,
        date: Number(date),
        refs: refs ? refs.split(', ') : [],
        subject,
      }
    })
}

export function parseStatus(raw: string): StatusEntry[] {
  const out: StatusEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const kind = line[0]
    const parts = line.split(' ')
    if (kind === '1') {
      const xy = parts[1]
      out.push({ path: parts.slice(8).join(' '), status: xy[1] !== '.' ? xy[1] : xy[0] })
    } else if (kind === '2') {
      // rename/copy: extra score field, then "newPath\toldPath"
      out.push({ path: parts.slice(9).join(' ').split('\t')[0], status: parts[1][0] === '.' ? parts[1][1] : parts[1][0] })
    } else if (kind === 'u') {
      out.push({ path: parts.slice(10).join(' '), status: 'U' })
    } else if (kind === '?') {
      out.push({ path: line.slice(2), status: '?' })
    }
  }
  return out
}
```

- [ ] **Step 4: Run** `pnpm vitest run server/parse.test.ts` — expect PASS.

- [ ] **Step 5: Commit** — `git add server/parse.ts server/parse.test.ts && git commit -m "feat: git log and porcelain v2 parsers"`

---

### Task 3: Lane layout (TDD)

**Files:**
- Create: `src/lanes.ts`, `src/lanes.test.ts`

**Interfaces:**
- Consumes: nothing (pure; input shape matches `Commit`'s `hash`/`parents`).
- Produces:
  - `type LaneRow = { lane: number; incoming: number[]; outgoing: number[]; through: number[] }`
    - `lane` — column of this commit's dot
    - `incoming` — lanes converging into the dot from the row above (children)
    - `outgoing` — lanes leaving the dot toward the row below (parents; index 0 continues in `lane`)
    - `through` — lanes passing straight through this row
  - `layout(commits: { hash: string; parents: string[] }[]): { rows: LaneRow[]; maxLanes: number }`

- [ ] **Step 1: Write failing tests** (`src/lanes.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { layout } from './lanes.ts'

const c = (hash: string, ...parents: string[]) => ({ hash, parents })

describe('layout', () => {
  it('linear history stays in lane 0', () => {
    const { rows, maxLanes } = layout([c('c', 'b'), c('b', 'a'), c('a')])
    expect(rows.map(r => r.lane)).toEqual([0, 0, 0])
    expect(maxLanes).toBe(1)
    expect(rows[2]).toEqual({ lane: 0, incoming: [0], outgoing: [], through: [] })
  })

  it('branch opens a second lane and converges at the fork point', () => {
    // main: a-b-d   feature: a-c   topo order: d c b a
    const { rows, maxLanes } = layout([c('d', 'b'), c('c', 'a'), c('b', 'a'), c('a')])
    expect(rows.map(r => r.lane)).toEqual([0, 1, 0, 0])
    expect(rows[1].through).toEqual([0])
    expect(rows[3].incoming).toEqual([0, 1]) // both lines converge into 'a'
    expect(maxLanes).toBe(2)
  })

  it('merge commit opens a lane for its second parent', () => {
    // m merges b and c; both branch from a
    const { rows } = layout([c('m', 'b', 'c'), c('b', 'a'), c('c', 'a'), c('a')])
    expect(rows[0]).toEqual({ lane: 0, incoming: [], outgoing: [0, 1], through: [] })
    expect(rows[2].lane).toBe(1)
    expect(rows[3].incoming).toEqual([0, 1])
  })

  it('octopus merge opens a lane per extra parent', () => {
    const { rows, maxLanes } = layout([c('m', 'a', 'b', 'x'), c('a'), c('b'), c('x')])
    expect(rows[0].outgoing).toEqual([0, 1, 2])
    expect(maxLanes).toBe(3)
    expect(rows[1].through).toEqual([1, 2])
  })

  it('frees lanes for reuse after a root commit', () => {
    // two independent roots: second root reuses lane 0
    const { rows } = layout([c('b'), c('a')])
    expect(rows.map(r => r.lane)).toEqual([0, 0])
  })
})
```

- [ ] **Step 2: Run** `pnpm vitest run src/lanes.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** (`src/lanes.ts`)

```ts
export type LaneRow = {
  lane: number
  incoming: number[]
  outgoing: number[]
  through: number[]
}

// Greedy top-down lane assignment over topo-ordered commits.
// `expect[i]` = the commit hash lane i is waiting to reach (a parent of
// something above), or null if the lane is free.
export function layout(commits: { hash: string; parents: string[] }[]): { rows: LaneRow[]; maxLanes: number } {
  const expect: (string | null)[] = []
  let maxLanes = 0
  const rows = commits.map(c => {
    const incoming: number[] = []
    expect.forEach((h, i) => { if (h === c.hash) incoming.push(i) })

    let lane = incoming.length ? incoming[0] : expect.indexOf(null)
    if (lane === -1) lane = expect.length

    const through: number[] = []
    expect.forEach((h, i) => { if (h !== null && h !== c.hash && i !== lane) through.push(i) })

    for (const i of incoming) expect[i] = null
    const outgoing: number[] = []
    if (c.parents.length) {
      expect[lane] = c.parents[0]
      outgoing.push(lane)
      for (const p of c.parents.slice(1)) {
        let t = expect.indexOf(p)
        if (t === -1) {
          t = expect.indexOf(null)
          if (t === -1) t = expect.length
          expect[t] = p
        }
        outgoing.push(t)
      }
    } else {
      expect[lane] = null
    }

    maxLanes = Math.max(maxLanes, expect.length, lane + 1)
    while (expect.length && expect[expect.length - 1] === null) expect.pop()
    return { lane, incoming, outgoing, through }
  })
  return { rows, maxLanes }
}
```

- [ ] **Step 4: Run** `pnpm vitest run src/lanes.test.ts` — expect PASS.

- [ ] **Step 5: Commit** — `git add src/lanes.ts src/lanes.test.ts && git commit -m "feat: greedy lane layout for commit graph"`

---

### Task 4: Config store + repo/fs routes

**Files:**
- Create: `server/config.ts`
- Modify: `server/index.ts` (append routes)

**Interfaces:**
- Produces (server/config.ts):
  - `type Config = { repos: string[]; activeRepo: string | null }`
  - `loadConfig(): Config` / `saveConfig(c: Config): void`
- Produces (HTTP):
  - `GET /api/config` → `Config`
  - `POST /api/repos {path}` → validates via `rev-parse --git-dir`, adds, sets active → `Config`; 400 `{error}` if not a repo
  - `DELETE /api/repos?repo=` → removes → `Config`
  - `PUT /api/active {repo}` → persists active tab → `Config` (spec stores "last active tab" in config; this is the write path)
  - `GET /api/fs?path=` → `{ path, parent: string|null, dirs: {name, path, isRepo}[] }`
- Produces (server/index.ts): `git(repo, args, okCodes?): Promise<string>` helper and `repoGuard` middleware used by Task 5.

- [ ] **Step 1: server/config.ts**

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), '.config', 'krakenlite')
const file = join(dir, 'config.json')

export type Config = { repos: string[]; activeRepo: string | null }

export function loadConfig(): Config {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { repos: [], activeRepo: null }
  }
}

export function saveConfig(c: Config): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(c, null, 2))
}
```

- [ ] **Step 2: Append to server/index.ts** (above the `dist` block), plus new imports

```ts
import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { RequestHandler } from 'express'
import { loadConfig, saveConfig } from './config.ts'
```

```ts
function git(repo: string, args: string[], okCodes: number[] = [0]): Promise<string> {
  return new Promise((res, rej) => {
    execFile('git', ['-C', repo, ...args], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !okCodes.includes(typeof err.code === 'number' ? err.code : 1)) {
        rej(new Error(stderr.trim() || err.message))
      } else res(stdout)
    })
  })
}

const repoGuard: RequestHandler = (req, res, next) => {
  const repo = String(req.query.repo ?? '')
  if (!loadConfig().repos.includes(repo)) { res.status(400).json({ error: 'unknown repo' }); return }
  if (!existsSync(repo)) { res.status(410).json({ error: 'repository path no longer exists' }); return }
  next()
}

app.get('/api/config', (_req, res) => res.json(loadConfig()))

app.post('/api/repos', async (req, res) => {
  const path = resolve(String(req.body.path ?? ''))
  try {
    await git(path, ['rev-parse', '--git-dir'])
  } catch {
    res.status(400).json({ error: `not a git repository: ${path}` })
    return
  }
  const cfg = loadConfig()
  if (!cfg.repos.includes(path)) cfg.repos.push(path)
  cfg.activeRepo = path
  saveConfig(cfg)
  res.json(cfg)
})

app.delete('/api/repos', (req, res) => {
  const path = String(req.query.repo ?? '')
  const cfg = loadConfig()
  cfg.repos = cfg.repos.filter(r => r !== path)
  if (cfg.activeRepo === path) cfg.activeRepo = cfg.repos[0] ?? null
  saveConfig(cfg)
  res.json(cfg)
})

app.put('/api/active', (req, res) => {
  const cfg = loadConfig()
  const repo = String(req.body.repo ?? '')
  if (cfg.repos.includes(repo)) { cfg.activeRepo = repo; saveConfig(cfg) }
  res.json(cfg)
})

app.get('/api/fs', (req, res) => {
  const path = resolve(String(req.query.path ?? homedir()))
  let entries
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
    return
  }
  const dirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => ({ name: e.name, path: join(path, e.name), isRepo: existsSync(join(path, e.name, '.git')) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const parent = dirname(path)
  res.json({ path, parent: parent === path ? null : parent, dirs })
})
```

- [ ] **Step 3: Verify with curl**

```bash
node server/index.ts &
curl -s localhost:3411/api/config                     # {"repos":[],"activeRepo":null}
curl -s -X POST localhost:3411/api/repos -H 'Content-Type: application/json' -d '{"path":"/tmp"}'          # 400 not a git repository
curl -s -X POST localhost:3411/api/repos -H 'Content-Type: application/json' -d "{\"path\":\"$PWD\"}"      # config with this repo
curl -s "localhost:3411/api/fs?path=$HOME/WORKSPACE"  # dirs listed, repos flagged
kill %1
```

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: config store, repo management and fs browser routes"`

---

### Task 5: Git data routes

**Files:**
- Modify: `server/index.ts` (append routes)

**Interfaces:**
- Consumes: `git()`, `repoGuard` from Task 4; `parseLog`, `parseStatus`, `LOG_FORMAT` from Task 2.
- Produces (HTTP):
  - `GET /api/graph?repo=&skip=` → `{ commits: Commit[], hasMore: boolean }` (≤500)
  - `GET /api/status?repo=` → `{ files: StatusEntry[] }`
  - `GET /api/commit?repo=&hash=` → `{ files: StatusEntry[] }` (merge commits diff vs first parent)
  - `GET /api/diff?repo=&file=&hash=&force=` → `{ diff }` | `{ tooLarge: true, size }`; no `hash` = WIP diff

- [ ] **Step 1: Append imports + routes**

```ts
import { parseLog, parseStatus, LOG_FORMAT } from './parse.ts'
```

```ts
app.get('/api/graph', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const skip = Number(req.query.skip ?? 0)
  try {
    const raw = await git(repo, ['log', '--all', '--topo-order', `--skip=${skip}`, '--max-count=501', `--format=${LOG_FORMAT}`])
    const commits = parseLog(raw)
    res.json({ commits: commits.slice(0, 500), hasMore: commits.length > 500 })
  } catch (e) {
    const msg = (e as Error).message
    if (/does not have any commits yet/.test(msg)) { res.json({ commits: [], hasMore: false }); return }
    res.status(500).json({ error: msg })
  }
})

app.get('/api/status', repoGuard, async (req, res) => {
  try {
    res.json({ files: parseStatus(await git(String(req.query.repo), ['status', '--porcelain=v2'])) })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

async function firstParent(repo: string, hash: string): Promise<string | null> {
  const out = await git(repo, ['rev-list', '--parents', '-n1', hash])
  return out.trim().split(' ')[1] ?? null
}

app.get('/api/commit', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const hash = String(req.query.hash ?? '')
  try {
    const parent = await firstParent(repo, hash)
    const raw = parent
      ? await git(repo, ['diff', '--name-status', parent, hash])
      : await git(repo, ['diff-tree', '-r', '--root', '--no-commit-id', '--name-status', hash])
    const files = raw.split('\n').filter(Boolean).map(l => {
      const cols = l.split('\t')
      return { status: cols[0][0], path: cols[cols.length - 1] }
    })
    res.json({ files })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

const DIFF_CAP = 1024 * 1024

app.get('/api/diff', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const hash = req.query.hash ? String(req.query.hash) : null
  const file = String(req.query.file ?? '')
  try {
    let diff: string
    if (hash) {
      const parent = await firstParent(repo, hash)
      diff = parent
        ? await git(repo, ['diff', parent, hash, '--', file])
        : await git(repo, ['show', '--format=', hash, '--', file])
    } else {
      diff = await git(repo, ['diff', 'HEAD', '--', file])
      // untracked file: not in HEAD diff; --no-index exits 1 when files differ
      if (!diff.trim()) diff = await git(repo, ['diff', '--no-index', '--', '/dev/null', join(repo, file)], [0, 1])
    }
    if (req.query.force !== '1' && diff.length > DIFF_CAP) { res.json({ tooLarge: true, size: diff.length }); return }
    res.json({ diff })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})
```

- [ ] **Step 2: Verify with curl against this repo** (added in Task 4 verify)

```bash
node server/index.ts &
R="repo=$(python3 -c 'import urllib.parse,os;print(urllib.parse.quote(os.getcwd()))')"
curl -s "localhost:3411/api/graph?$R" | head -c 400          # commits json
curl -s "localhost:3411/api/status?$R"                       # {"files":[...]}
H=$(git rev-parse HEAD)
curl -s "localhost:3411/api/commit?$R&hash=$H"               # files changed in HEAD
F=$(git show --name-only --format= HEAD | head -1)
curl -s "localhost:3411/api/diff?$R&hash=$H&file=$F" | head -c 400   # raw diff
touch scratch.txt
curl -s "localhost:3411/api/diff?$R&file=scratch.txt"        # untracked WIP diff via --no-index
rm scratch.txt
kill %1
```

Also verify merge-commit and root-commit cases: `curl "…/api/commit?…&hash=<merge>"` shows files vs first parent; `hash=<root>` shows the initial files.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: graph, status, commit and diff routes"`

---

### Task 6: Frontend shell — App, TabBar, DirBrowser

**Files:**
- Create: `src/api.ts`, `src/TabBar.tsx`, `src/DirBrowser.tsx`
- Modify: `src/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: HTTP API from Tasks 4–5.
- Produces:
  - `src/api.ts`: `api<T>(path, init?): Promise<T>` (throws `Error & {status}` on non-2xx), `jsonInit(method, body): RequestInit`
  - `<TabBar repos active onSelect onAdd onClose />`
  - `<DirBrowser onPicked(cfg) onClose />` — POSTs `/api/repos` itself, inline error on 400
  - `App` renders `<RepoView key={repo} repo={repo} onRemove={fn} />` for the active tab — Task 7 must export that component signature from `src/RepoView.tsx`.

- [ ] **Step 1: src/api.ts**

```ts
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status })
  return body as T
}

export const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
```

- [ ] **Step 2: src/App.tsx**

```tsx
import { useEffect, useState } from 'react'
import { api, jsonInit } from './api'
import TabBar from './TabBar'
import DirBrowser from './DirBrowser'
import RepoView from './RepoView'

export type Config = { repos: string[]; activeRepo: string | null }

export default function App() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [browsing, setBrowsing] = useState(false)

  useEffect(() => { api<Config>('/api/config').then(setCfg) }, [])
  if (!cfg) return null

  const select = (repo: string) => {
    setCfg({ ...cfg, activeRepo: repo })
    api<Config>('/api/active', jsonInit('PUT', { repo }))
  }
  const close = (repo: string) =>
    api<Config>(`/api/repos?repo=${encodeURIComponent(repo)}`, { method: 'DELETE' }).then(setCfg)

  return (
    <div className="app">
      <TabBar repos={cfg.repos} active={cfg.activeRepo} onSelect={select} onAdd={() => setBrowsing(true)} onClose={close} />
      {browsing && <DirBrowser onPicked={c => { setCfg(c); setBrowsing(false) }} onClose={() => setBrowsing(false)} />}
      {cfg.activeRepo
        ? <RepoView key={cfg.activeRepo} repo={cfg.activeRepo} onRemove={() => close(cfg.activeRepo!)} />
        : <div className="empty">No repository open — add one with “+”</div>}
    </div>
  )
}
```

(Until Task 7 exists, stub `src/RepoView.tsx` with `export default function RepoView({ repo }: { repo: string; onRemove: () => void }) { return <div className="empty">{repo}</div> }`.)

- [ ] **Step 3: src/TabBar.tsx**

```tsx
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

export default function TabBar({ repos, active, onSelect, onAdd, onClose }: {
  repos: string[]
  active: string | null
  onSelect: (r: string) => void
  onAdd: () => void
  onClose: (r: string) => void
}) {
  return (
    <div className="tabbar">
      {repos.map(r => (
        <div key={r} className={`tab${r === active ? ' active' : ''}`} title={r} onClick={() => onSelect(r)}>
          {base(r)}
          <button className="tab-close" onClick={e => { e.stopPropagation(); onClose(r) }}>×</button>
        </div>
      ))}
      <button className="tab-add" onClick={onAdd}>+</button>
    </div>
  )
}
```

- [ ] **Step 4: src/DirBrowser.tsx**

```tsx
import { useEffect, useState } from 'react'
import { api, jsonInit } from './api'
import type { Config } from './App'

type FsDir = { path: string; parent: string | null; dirs: { name: string; path: string; isRepo: boolean }[] }

export default function DirBrowser({ onPicked, onClose }: { onPicked: (c: Config) => void; onClose: () => void }) {
  const [dir, setDir] = useState<FsDir | null>(null)
  const [error, setError] = useState('')

  const load = (path?: string) => {
    setError('')
    api<FsDir>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`).then(setDir).catch(e => setError(e.message))
  }
  useEffect(() => { load() }, [])

  const pick = (path: string) =>
    api<Config>('/api/repos', jsonInit('POST', { path })).then(onPicked).catch(e => setError(e.message))

  if (!dir) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <button disabled={!dir.parent} onClick={() => dir.parent && load(dir.parent)}>↑</button>
          <span className="modal-path">{dir.path}</span>
          <button onClick={onClose}>×</button>
        </div>
        {error && <div className="error">{error}</div>}
        <ul className="dirlist">
          {dir.dirs.map(d => (
            <li key={d.path}>
              <span className="dirname" onClick={() => load(d.path)}>{d.isRepo ? '● ' : ''}{d.name}</span>
              {d.isRepo && <button onClick={() => pick(d.path)}>Open</button>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: src/styles.css** — dark theme, flex app shell, tabs, modal. Complete file:

```css
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #1e2228; color: #d4d8de;
}
button { background: #2c313a; color: inherit; border: 1px solid #3a404b; border-radius: 4px; cursor: pointer; }
button:hover { background: #3a404b; }

.app { display: flex; flex-direction: column; height: 100%; }
.empty { flex: 1; display: flex; align-items: center; justify-content: center; color: #6b7280; }
.error { color: #e06c75; padding: 8px; white-space: pre-wrap; }

.tabbar { display: flex; gap: 2px; background: #14171c; padding: 6px 6px 0; flex-shrink: 0; }
.tab { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px 6px 0 0; background: #1a1e24; cursor: pointer; }
.tab.active { background: #2c313a; }
.tab-close { border: none; background: none; padding: 0 2px; }
.tab-add { border: none; padding: 6px 12px; background: none; font-size: 15px; }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 10; }
.modal { background: #23272e; border: 1px solid #3a404b; border-radius: 8px; width: 480px; max-height: 70vh; display: flex; flex-direction: column; }
.modal-head { display: flex; gap: 8px; align-items: center; padding: 10px; border-bottom: 1px solid #3a404b; }
.modal-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9aa4b2; }
.dirlist { list-style: none; margin: 0; padding: 4px; overflow-y: auto; }
.dirlist li { display: flex; align-items: center; padding: 4px 8px; border-radius: 4px; }
.dirlist li:hover { background: #2c313a; }
.dirname { flex: 1; cursor: pointer; }
```

- [ ] **Step 6: Verify** — `pnpm dev`, open http://localhost:5173: tab for repo added in Task 4 shows; “+” opens browser; navigating and adding a repo works; non-repo dirs show no Open button. `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: app shell with repo tabs and directory browser"`

---

### Task 7: RepoView + GraphView

**Files:**
- Create: `src/GraphView.tsx`
- Modify: `src/RepoView.tsx` (replace stub), `src/styles.css` (append)

**Interfaces:**
- Consumes: `layout`/`LaneRow` from Task 3, `api` from Task 6, `Commit`/`StatusEntry` types from `server/parse.ts` (type-only import).
- Produces:
  - `type Selection = { kind: 'commit'; hash: string } | { kind: 'wip' } | null`
  - `<RepoView repo onRemove />` — owns graph/status/selection state, `r` + button refresh
  - `<GraphView commits status selection onSelect onLoadMore hasMore />`
  - Renders `<CommitPanel repo selection status />` on the right — Task 8 must export that signature from `src/CommitPanel.tsx`. (Until Task 8, stub it: `export default function CommitPanel(_: {repo: string; selection: Selection; status: StatusEntry[]}) { return <div className="panel" /> }` — with `import type { StatusEntry } from '../server/parse.ts'` and `import type { Selection } from './RepoView'`.)

- [ ] **Step 1: src/RepoView.tsx**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { Commit, StatusEntry } from '../server/parse.ts'
import { api } from './api'
import GraphView from './GraphView'
import CommitPanel from './CommitPanel'

export type Selection = { kind: 'commit'; hash: string } | { kind: 'wip' } | null

export default function RepoView({ repo, onRemove }: { repo: string; onRemove: () => void }) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [status, setStatus] = useState<StatusEntry[]>([])
  const [selection, setSelection] = useState<Selection>(null)
  const [error, setError] = useState<{ msg: string; gone: boolean } | null>(null)

  const q = `repo=${encodeURIComponent(repo)}`

  const refresh = useCallback(() => {
    setError(null)
    Promise.all([
      api<{ commits: Commit[]; hasMore: boolean }>(`/api/graph?${q}`),
      api<{ files: StatusEntry[] }>(`/api/status?${q}`),
    ]).then(([g, s]) => {
      setCommits(g.commits)
      setHasMore(g.hasMore)
      setStatus(s.files)
    }).catch(e => setError({ msg: e.message, gone: e.status === 410 }))
  }, [q])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && (e.target as HTMLElement).tagName !== 'INPUT') refresh()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh])

  const loadMore = () =>
    api<{ commits: Commit[]; hasMore: boolean }>(`/api/graph?${q}&skip=${commits.length}`)
      .then(g => { setCommits([...commits, ...g.commits]); setHasMore(g.hasMore) })
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
        <CommitPanel repo={repo} selection={selection} status={status} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: src/GraphView.tsx**

```tsx
import { useMemo } from 'react'
import type { Commit, StatusEntry } from '../server/parse.ts'
import { layout, type LaneRow } from './lanes'
import type { Selection } from './RepoView'

const ROW = 28
const COL = 14
const COLORS = ['#61afef', '#98c379', '#e06c75', '#c678dd', '#e5c07b', '#56b6c2', '#d19a66', '#f47067']
const color = (l: number) => COLORS[l % COLORS.length]

function GraphCell({ row, width }: { row: LaneRow; width: number }) {
  const x = (l: number) => l * COL + COL / 2
  const mid = ROW / 2
  return (
    <svg width={width} height={ROW} className="graph-cell">
      {row.through.map(l => <line key={`t${l}`} x1={x(l)} y1={0} x2={x(l)} y2={ROW} stroke={color(l)} strokeWidth="2" />)}
      {row.incoming.map(l => (
        <path key={`i${l}`} d={`M ${x(l)} 0 C ${x(l)} ${mid}, ${x(row.lane)} 0, ${x(row.lane)} ${mid}`} stroke={color(l)} strokeWidth="2" fill="none" />
      ))}
      {row.outgoing.map(l => (
        <path key={`o${l}`} d={`M ${x(row.lane)} ${mid} C ${x(l)} ${ROW}, ${x(l)} ${mid}, ${x(l)} ${ROW}`} stroke={color(l)} strokeWidth="2" fill="none" />
      ))}
      <circle cx={x(row.lane)} cy={mid} r="4" fill={color(row.lane)} />
    </svg>
  )
}

const fmtDate = (unix: number) => new Date(unix * 1000).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })

export default function GraphView({ commits, status, selection, onSelect, onLoadMore, hasMore }: {
  commits: Commit[]
  status: StatusEntry[]
  selection: Selection
  onSelect: (s: Selection) => void
  onLoadMore: () => void
  hasMore: boolean
}) {
  const { rows, maxLanes } = useMemo(() => layout(commits), [commits])
  const width = Math.max(maxLanes, 1) * COL

  return (
    <div className="graphview">
      {status.length > 0 && (
        <div className={`row wip${selection?.kind === 'wip' ? ' selected' : ''}`} onClick={() => onSelect({ kind: 'wip' })}>
          <svg width={width} height={ROW} className="graph-cell">
            <circle cx={COL / 2} cy={ROW / 2} r="4" fill="none" stroke="#e5c07b" strokeWidth="2" />
          </svg>
          <span className="subject">{status.length} uncommitted change{status.length > 1 ? 's' : ''}</span>
        </div>
      )}
      {commits.map((c, i) => (
        <div
          key={c.hash}
          className={`row${selection?.kind === 'commit' && selection.hash === c.hash ? ' selected' : ''}`}
          onClick={() => onSelect({ kind: 'commit', hash: c.hash })}
        >
          <GraphCell row={rows[i]} width={width} />
          <span className="refs">
            {c.refs.map(r => <span key={r} className="ref-chip" style={{ borderColor: color(rows[i].lane) }}>{r}</span>)}
          </span>
          <span className="subject" title={c.subject}>{c.subject}</span>
          <span className="author">{c.author}</span>
          <span className="date">{fmtDate(c.date)}</span>
          <span className="hash">{c.hash.slice(0, 7)}</span>
        </div>
      ))}
      {hasMore && <button className="load-more" onClick={onLoadMore}>Load more</button>}
    </div>
  )
}
```

- [ ] **Step 3: Append to src/styles.css**

```css
.repoview { flex: 1; display: flex; flex-direction: column; min-height: 0; background: #23272e; }
.toolbar { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid #3a404b; flex-shrink: 0; }
.toolbar button { padding: 3px 10px; }
.repo-path { flex: 1; color: #9aa4b2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panes { flex: 1; display: flex; min-height: 0; }

.graphview { width: 55%; overflow: auto; border-right: 1px solid #3a404b; padding-bottom: 8px; }
.row { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; cursor: pointer; white-space: nowrap; }
.row:hover { background: #2c313a; }
.row.selected { background: #354254; }
.row.wip { position: sticky; top: 0; background: #2a2e25; z-index: 1; font-style: italic; }
.row.wip.selected { background: #354254; }
.graph-cell { flex-shrink: 0; }
.refs { display: flex; gap: 4px; }
.ref-chip { border: 1px solid; border-radius: 8px; padding: 0 6px; font-size: 11px; color: #d4d8de; }
.subject { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.author, .date { color: #9aa4b2; font-size: 12px; }
.hash { color: #6b7280; font-family: ui-monospace, monospace; font-size: 12px; }
.load-more { margin: 8px; padding: 4px 14px; }
```

- [ ] **Step 4: Verify** — `pnpm dev`: graph renders with lanes/merges for a real repo; WIP row appears when the repo is dirty and stays pinned; `r` and ⟳ refresh; Load more appends (test on a repo with >500 commits if available). `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: commit graph view with lanes, refs and WIP row"`

---

### Task 8: CommitPanel + DiffView

**Files:**
- Create: `src/CommitPanel.tsx` (replace stub), `src/DiffView.tsx`
- Modify: `src/styles.css` (append)

**Interfaces:**
- Consumes: `Selection` from Task 7, `api` from Task 6, `/api/commit` + `/api/diff` from Task 5, diff2html + highlight.js packages.
- Produces: `<CommitPanel repo selection status />`, `<DiffView repo hash file />` (`hash: string | null`, null = WIP).

- [ ] **Step 1: src/CommitPanel.tsx**

```tsx
import { useEffect, useState } from 'react'
import type { StatusEntry } from '../server/parse.ts'
import { api } from './api'
import type { Selection } from './RepoView'
import DiffView from './DiffView'

const STATUS_COLOR: Record<string, string> = { M: '#e5c07b', A: '#98c379', D: '#e06c75', R: '#61afef', '?': '#98c379', U: '#e06c75' }

export default function CommitPanel({ repo, selection, status }: { repo: string; selection: Selection; status: StatusEntry[] }) {
  const [files, setFiles] = useState<StatusEntry[]>([])
  const [file, setFile] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setFile(null)
    setError('')
    if (!selection) { setFiles([]); return }
    if (selection.kind === 'wip') { setFiles(status); return }
    api<{ files: StatusEntry[] }>(`/api/commit?repo=${encodeURIComponent(repo)}&hash=${selection.hash}`)
      .then(r => setFiles(r.files))
      .catch(e => { setFiles([]); setError(e.message) })
  }, [repo, selection, status])

  if (!selection) return <div className="panel empty">Select a commit</div>
  return (
    <div className="panel">
      <div className="filelist">
        {error && <div className="error">{error}</div>}
        {files.map(f => (
          <div key={f.path} className={`file-row${file === f.path ? ' selected' : ''}`} onClick={() => setFile(f.path)}>
            <span className="file-status" style={{ color: STATUS_COLOR[f.status] ?? '#d4d8de' }}>{f.status}</span>
            <span className="file-path">{f.path}</span>
          </div>
        ))}
        {!error && files.length === 0 && <div className="empty">No changes</div>}
      </div>
      {file && <DiffView repo={repo} hash={selection.kind === 'commit' ? selection.hash : null} file={file} />}
    </div>
  )
}
```

- [ ] **Step 2: src/DiffView.tsx**

```tsx
import { useEffect, useRef, useState } from 'react'
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui.js'
import 'diff2html/bundles/css/diff2html.min.css'
import 'highlight.js/styles/github-dark.css'
import { api } from './api'

type DiffResp = { diff?: string; tooLarge?: boolean; size?: number }

export default function DiffView({ repo, hash, file }: { repo: string; hash: string | null; file: string }) {
  const [resp, setResp] = useState<DiffResp | null>(null)
  const [error, setError] = useState('')
  const [split, setSplit] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = (force = false) => {
    setError('')
    setResp(null)
    const params = new URLSearchParams({ repo, file, ...(hash ? { hash } : {}), ...(force ? { force: '1' } : {}) })
    api<DiffResp>(`/api/diff?${params}`).then(setResp).catch(e => setError(e.message))
  }
  useEffect(load, [repo, hash, file])

  useEffect(() => {
    if (!ref.current || !resp?.diff) return
    if (!resp.diff.trim() || /^Binary files/m.test(resp.diff)) {
      ref.current.innerHTML = ''
      return
    }
    const ui = new Diff2HtmlUI(ref.current, resp.diff, {
      drawFileList: false,
      matching: 'lines',
      highlight: true,
      outputFormat: split ? 'side-by-side' : 'line-by-line',
    })
    ui.draw()
    ui.highlightCode()
  }, [resp, split])

  if (error) return <div className="diffview error">{error}</div>
  if (!resp) return <div className="diffview empty">Loading…</div>
  if (resp.tooLarge) {
    return (
      <div className="diffview empty">
        <div>
          <div>Diff too large ({Math.round((resp.size ?? 0) / 1024)} KB)</div>
          <button onClick={() => load(true)}>Show anyway</button>
        </div>
      </div>
    )
  }
  const plain = !resp.diff?.trim() || /^Binary files/m.test(resp.diff ?? '')
  return (
    <div className="diffview">
      <div className="diff-toolbar">
        <button onClick={() => setSplit(!split)}>{split ? 'Unified' : 'Side-by-side'}</button>
      </div>
      {plain
        ? <pre className="diff-plain">{resp.diff?.trim() || 'No changes'}</pre>
        : <div ref={ref} className="diff-html" />}
    </div>
  )
}
```

- [ ] **Step 3: Append to src/styles.css**

```css
.panel { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.filelist { max-height: 40%; overflow-y: auto; border-bottom: 1px solid #3a404b; padding: 4px; flex-shrink: 0; }
.file-row { display: flex; gap: 8px; padding: 3px 8px; cursor: pointer; border-radius: 4px; }
.file-row:hover { background: #2c313a; }
.file-row.selected { background: #354254; }
.file-status { font-family: ui-monospace, monospace; width: 14px; flex-shrink: 0; }
.file-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }

.diffview { flex: 1; overflow: auto; min-height: 0; display: flex; flex-direction: column; }
.diffview.empty { align-items: center; justify-content: center; text-align: center; }
.diff-toolbar { padding: 6px 10px; border-bottom: 1px solid #3a404b; flex-shrink: 0; }
.diff-toolbar button { padding: 3px 10px; }
.diff-html { flex: 1; overflow: auto; }
.diff-plain { padding: 10px; color: #9aa4b2; }
.d2h-wrapper { --d2h-bg-color: #23272e; }
```

- [ ] **Step 4: Verify end-to-end** — `pnpm dev`: click commit → file list; click file → diff with syntax highlighting; toggle unified/side-by-side; WIP row → uncommitted diffs incl. untracked file; binary file shows "Binary files … differ"; large diff (>1 MB) shows "Show anyway" and force-loads.

- [ ] **Step 5: Production build check**

```bash
pnpm build          # vite build → dist/
node server/index.ts &
curl -s http://127.0.0.1:3411/ | head -c 200   # serves index.html
kill %1
```

- [ ] **Step 6: Run full test suite** — `pnpm test` → all pass. `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: commit panel with diff2html diff view"`

---

## Self-Review Notes

- Spec coverage: graph ✓ (T2/T3/T5/T7), tabs ✓ (T4/T6), changes view ✓ (T5/T8), dir browser ✓ (T4/T6), WIP ✓ (T5/T7/T8), refresh ✓ (T7), paging ✓ (T5/T7), diff cap + force ✓ (T5/T8), binary ✓ (T8), error states incl. deleted repo path (410) ✓ (T4/T7), localhost bind ✓ (T1), execFile-only ✓ (T4), repo validation ✓ (T4), config ownership ✓ (T4), tests parsers+lanes ✓ (T2/T3).
- Deviation from spec API table: added `PUT /api/active` — the spec requires config to store the last active tab and be written only by the server, so a write path is needed.
- Merge-commit diffs use `git diff <firstParent> <hash>` (via `rev-list --parents`) instead of bare `diff-tree`, which shows nothing useful for merges; root commits fall back to `diff-tree --root`.
