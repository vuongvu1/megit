# Merge Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user finish a conflicted merge, rebase, cherry-pick or revert inside megit — see which operation is stuck, pick ours/theirs/both per conflict block, and abort or continue — instead of being sent to the terminal.

**Architecture:** A pure marker parser (`src/conflict.ts`) turns a conflicted file into segments; the client picks per block, reassembles the text, and POSTs it. The server owns two new routes (`GET`/`POST /api/conflict`), gates every file action on git's own unmerged-path list, and reports which operation is in progress as a new field on the existing `/api/status` response, so the banner rides the SSE refresh that already exists.

**Tech Stack:** TypeScript, Express 5, React 19, Vite, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-06-merge-conflicts-design.md`

## Global Constraints

- Node ≥ 24. `nvm use` does not persist across Bash tool calls — prefix every command with `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`.
- Package manager is pnpm.
- **Do not run `git commit` or `git rm` in the repo working tree.** The user commits at task boundaries. Each task ends with a checkpoint step that names the suggested message; stop there and report.
- Runtime `dependencies` stays express + ws (+ optional node-pty). No new dependency of any kind, dev or runtime.
- Work happens on branch `feat/merge-conflicts`, already created off `main`.
- Pure, DOM-free logic goes in its own module with its own test file. That is where this repo's test suite lives.
- Client-visible strings use sentence case, matching the existing UI ("Nothing staged", "Discard changes").
- Typecheck with `npx tsc --noEmit` — it covers both halves via `tsconfig.json`.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/conflict.ts` | Pure. Parse conflict markers into segments; reassemble text from picks. No React, no fetch, no git. |
| `src/conflict.test.ts` | Tests for the above. |
| `server/operation.ts` | Pure. Map a list of present git state-file names to an operation kind. |
| `server/operation.test.ts` | Tests for the above. |
| `src/ConflictBanner.tsx` | The mid-operation strip: verb, remaining count, Abort, Continue. Presentational. |
| `src/ConflictView.tsx` | The resolver pane: fetch, render blocks, hold picks, submit on full resolve. |

**Modify:**

| File | Change |
|---|---|
| `server/index.ts:15` | `express.json()` limit → `10mb`. |
| `server/index.ts:5` | Add `writeFile` to the `node:fs/promises` import. |
| `server/index.ts:234-243` | `/api/status` also returns `operation`. |
| `server/index.ts` (after `/api/diff`) | New `GET` and `POST /api/conflict`, plus the `unmergedPaths` and `readOperation` helpers. |
| `src/RepoView.tsx` | Hold `operation`, add it to `statusFp`, render `ConflictBanner`, route the overlay to `ConflictView` for `U` files. |
| `src/styles.css` | Style blocks for `.conflict-banner` and `.cf-*`. |

---

### Task 1: Conflict marker parser

Pure module, no dependencies on anything else in this plan. Everything downstream consumes its types.

**Files:**
- Create: `src/conflict.ts`
- Create: `src/conflict.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type Choice = 'ours' | 'theirs' | 'both'
  export type Block = { ours: string[]; base: string[] | null; theirs: string[]; oursLabel: string; theirsLabel: string }
  export type Segment = { kind: 'context'; lines: string[] } | { kind: 'conflict'; block: Block }
  export function parseConflict(text: string): Segment[] | null
  export function applyPicks(segs: Segment[], picks: Map<number, Choice>): string
  ```
  `parseConflict` returns `null` for text with no conflict blocks and for malformed markers. `applyPicks` throws if a conflict segment has no pick. `picks` is keyed by index into `segs`, not by a conflict-only ordinal.

- [ ] **Step 1: Write the failing tests**

Create `src/conflict.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyPicks, parseConflict, type Choice, type Segment } from './conflict'

// The shape git writes for a two-way conflict. Trailing newline on every line.
const TWO_WAY = [
  'top\n',
  '<<<<<<< HEAD\n',
  'ours line\n',
  '=======\n',
  'theirs line\n',
  '>>>>>>> feature/x\n',
  'bottom\n',
].join('')

// merge.conflictStyle=diff3 adds the common ancestor between ||||||| and =======
const DIFF3 = [
  '<<<<<<< HEAD\n',
  'ours line\n',
  '||||||| abc1234\n',
  'base line\n',
  '=======\n',
  'theirs line\n',
  '>>>>>>> feature/x\n',
].join('')

// picks every conflict segment the same way, so tests don't hand-count indexes
const pickAll = (segs: Segment[], choice: Choice) =>
  new Map(segs.flatMap((s, i) => (s.kind === 'conflict' ? [[i, choice] as [number, Choice]] : [])))

describe('parseConflict', () => {
  it('splits context and conflict segments', () => {
    const segs = parseConflict(TWO_WAY)!
    expect(segs.map(s => s.kind)).toEqual(['context', 'conflict', 'context'])
    expect(segs[1]).toMatchObject({
      kind: 'conflict',
      block: { ours: ['ours line\n'], theirs: ['theirs line\n'], base: null, oursLabel: 'HEAD', theirsLabel: 'feature/x' },
    })
  })

  it('captures the diff3 base section', () => {
    const segs = parseConflict(DIFF3)!
    expect(segs[0]).toMatchObject({ kind: 'conflict', block: { base: ['base line\n'] } })
  })

  it('returns null for text with no markers', () => {
    expect(parseConflict('just\nplain\ntext\n')).toBeNull()
  })

  it('returns null for an unterminated conflict', () => {
    expect(parseConflict('<<<<<<< HEAD\nours\n=======\ntheirs\n')).toBeNull()
  })

  it('returns null for a nested start marker', () => {
    expect(parseConflict('<<<<<<< HEAD\n<<<<<<< HEAD\n=======\n>>>>>>> x\n')).toBeNull()
  })

  it('handles multiple blocks in one file', () => {
    const segs = parseConflict(TWO_WAY + TWO_WAY)!
    expect(segs.filter(s => s.kind === 'conflict')).toHaveLength(2)
  })
})

describe('applyPicks', () => {
  it('takes ours', () => {
    const segs = parseConflict(TWO_WAY)!
    expect(applyPicks(segs, pickAll(segs, 'ours'))).toBe('top\nours line\nbottom\n')
  })

  it('takes theirs', () => {
    const segs = parseConflict(TWO_WAY)!
    expect(applyPicks(segs, pickAll(segs, 'theirs'))).toBe('top\ntheirs line\nbottom\n')
  })

  it('takes both, ours first', () => {
    const segs = parseConflict(TWO_WAY)!
    expect(applyPicks(segs, pickAll(segs, 'both'))).toBe('top\nours line\ntheirs line\nbottom\n')
  })

  it('never emits the base section', () => {
    const segs = parseConflict(DIFF3)!
    expect(applyPicks(segs, pickAll(segs, 'both'))).not.toContain('base line')
  })

  it('preserves CRLF line endings byte for byte', () => {
    const crlf = TWO_WAY.replace(/\n/g, '\r\n')
    const segs = parseConflict(crlf)!
    expect(applyPicks(segs, pickAll(segs, 'ours'))).toBe('top\r\nours line\r\nbottom\r\n')
  })

  it('preserves mixed line endings', () => {
    const mixed = 'top\r\n<<<<<<< HEAD\nours\n=======\r\ntheirs\n>>>>>>> x\nbottom\n'
    const segs = parseConflict(mixed)!
    expect(applyPicks(segs, pickAll(segs, 'ours'))).toBe('top\r\nours\nbottom\n')
  })

  it('preserves a missing final newline', () => {
    const segs = parseConflict('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> x\ntail')!
    expect(applyPicks(segs, pickAll(segs, 'ours'))).toBe('ours\ntail')
  })

  it('separates the halves when taking both at end of file', () => {
    const segs = parseConflict('<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> x\n')!
    // ours has a trailing newline here, so this is really asserting no lines merge
    expect(applyPicks(segs, pickAll(segs, 'both'))).toBe('ours\ntheirs\n')
  })

  it('throws when a conflict segment has no pick', () => {
    const segs = parseConflict(TWO_WAY)!
    expect(() => applyPicks(segs, new Map())).toThrow(/no pick/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test -- conflict
```

Expected: FAIL — `Failed to resolve import "./conflict"`.

- [ ] **Step 3: Write the parser**

Create `src/conflict.ts`:

```ts
// A conflicted file, as git wrote it, split into the parts a picker needs.
// Pure and DOM-free on purpose: this is where the correctness lives, and the
// only way to write a corrupted file back is to get it wrong here.
export type Choice = 'ours' | 'theirs' | 'both'
export type Block = { ours: string[]; base: string[] | null; theirs: string[]; oursLabel: string; theirsLabel: string }
export type Segment = { kind: 'context'; lines: string[] } | { kind: 'conflict'; block: Block }

// git writes exactly seven marker characters. A repo with a custom conflict-marker
// size is exotic enough that failing to parse (and saying so) beats guessing.
const START = /^<<<<<<< ?(.*)$/
const BASE = /^\|\|\|\|\|\|\| ?(.*)$/
const SEP = /^=======$/
const END = /^>>>>>>> ?(.*)$/

// Lines keep their own terminators (see split below), so markers are matched
// against the line without one.
const bare = (line: string) => line.replace(/\r?\n$/, '')

export function parseConflict(text: string): Segment[] | null {
  // lookbehind split: every line keeps its own \n or \r\n, so join() is the exact
  // inverse and CRLF, mixed endings and a missing final newline all round-trip
  // without a normalization pass that would rewrite bytes nobody asked to change
  const lines = text.split(/(?<=\n)/)
  const segs: Segment[] = []
  let ctx: string[] = []
  let cur: Block | null = null
  let mode: 'context' | 'ours' | 'base' | 'theirs' = 'context'

  const flush = () => {
    if (ctx.length) segs.push({ kind: 'context', lines: ctx })
    ctx = []
  }

  for (const line of lines) {
    const b = bare(line)
    const start = START.exec(b)
    if (start) {
      if (mode !== 'context') return null // a start inside a block: not git's output
      flush()
      cur = { ours: [], base: null, theirs: [], oursLabel: start[1].trim(), theirsLabel: '' }
      mode = 'ours'
      continue
    }
    if (mode === 'context') {
      ctx.push(line)
      continue
    }
    const base = BASE.exec(b)
    if (base) {
      if (mode !== 'ours') return null
      cur!.base = []
      mode = 'base'
      continue
    }
    if (SEP.test(b)) {
      if (mode !== 'ours' && mode !== 'base') return null
      mode = 'theirs'
      continue
    }
    const end = END.exec(b)
    if (end) {
      if (mode !== 'theirs') return null
      cur!.theirsLabel = end[1].trim()
      segs.push({ kind: 'conflict', block: cur! })
      cur = null
      mode = 'context'
      continue
    }
    if (mode === 'ours') cur!.ours.push(line)
    else if (mode === 'base') cur!.base!.push(line)
    else cur!.theirs.push(line)
  }
  if (mode !== 'context') return null // ran off the end mid-block
  flush()
  // no blocks means nothing to pick — a binary file, a delete/modify conflict, or
  // a file somebody already resolved by hand. The caller shows the whole-file card.
  return segs.some(s => s.kind === 'conflict') ? segs : null
}

export function applyPicks(segs: Segment[], picks: Map<number, Choice>): string {
  const out: string[] = []
  segs.forEach((s, i) => {
    if (s.kind === 'context') {
      out.push(...s.lines)
      return
    }
    const pick = picks.get(i)
    if (!pick) throw new Error(`no pick for conflict at segment ${i}`)
    if (pick === 'ours' || pick === 'both') out.push(...s.block.ours)
    if (pick === 'both') endLine(out)
    if (pick === 'theirs' || pick === 'both') out.push(...s.block.theirs)
  })
  return out.join('')
}

// TODO(user): see Step 5 — keeping "both" from welding two lines together.
function endLine(_out: string[]) {}
```

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test -- conflict
```

Expected: all pass except possibly the end-of-file "both" case, which Step 5 settles.

- [x] ~~**Step 5: USER CONTRIBUTION — the `both` seam**~~ — **dropped during execution.** The weld cannot occur: every content line in a block is followed by another line (`=======` or `>>>>>>>` at minimum), so it carries its own terminator, and `parseConflict` rejects the unterminated block that would break the invariant. `endLine` was deleted and the end-of-file test rewritten to pin the invariant. Original text kept below for the record.

<details><summary>Original Step 5</summary>

`endLine` is the one judgment call in this module, and it is five lines.

The problem: `both` emits the ours lines then the theirs lines. If the ours half's last line has no trailing newline — which happens when the conflict block runs to the end of a file that does not end in a newline — those two halves weld into one line, and the user gets `ours lineheirs line` in their source file.

The narrow fix is to append a newline to the last ours line when it lacks one. But there is a real choice here about what "use both" should produce:

- **Just prevent the weld.** Ours, then theirs, nothing between. Minimal and predictable.
- **Prevent the weld and separate the halves with a blank line.** Reads better for prose or config blocks, wrong for a function body where the halves are meant to be adjacent.
- **Leave the weld alone in the no-newline case and let the user fix it in the editor.** Least code, produces a file that is almost certainly wrong.

Implement `endLine` in `src/conflict.ts` — it receives the output array with the ours lines already pushed, and runs just before the theirs lines go on. Add a test for the behavior you chose.

Your call, because it is a taste question about what people mean when they click a button, not a correctness question with one right answer.

</details>

- [ ] **Step 6: Run the full suite and typecheck**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test && npx tsc --noEmit
```

Expected: all tests pass, no type errors.

- [ ] **Step 7: Checkpoint**

Report to the user. Suggested message: `feat: add conflict marker parser`.

---

### Task 2: Operation detection on /api/status

**Files:**
- Create: `server/operation.ts`
- Create: `server/operation.test.ts`
- Modify: `server/index.ts` — import, `readOperation` helper, `/api/status` response at lines 234-243

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  ```ts
  // server/operation.ts
  export type OpKind = 'rebase' | 'merge' | 'cherry-pick' | 'revert'
  export const STATE_FILES: string[]
  export function pickOperation(present: string[]): OpKind | null

  // server/index.ts
  type Operation = { kind: OpKind; label: string }
  async function readOperation(repo: string): Promise<Operation | null>
  ```
  `/api/status` response becomes `{ files, branch, operation: Operation | null }`. Task 5 consumes that field.

- [ ] **Step 1: Write the failing test**

Create `server/operation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pickOperation } from './operation.ts'

describe('pickOperation', () => {
  it('returns null when no state file is present', () => {
    expect(pickOperation([])).toBeNull()
  })

  it('detects each operation from its own state file', () => {
    expect(pickOperation(['MERGE_HEAD'])).toBe('merge')
    expect(pickOperation(['CHERRY_PICK_HEAD'])).toBe('cherry-pick')
    expect(pickOperation(['REVERT_HEAD'])).toBe('revert')
    expect(pickOperation(['rebase-merge'])).toBe('rebase')
  })

  it('detects the am-backend rebase directory too', () => {
    expect(pickOperation(['rebase-apply'])).toBe('rebase')
  })

  it('prefers rebase when a rebase also left CHERRY_PICK_HEAD behind', () => {
    // a rebase applying a commit writes CHERRY_PICK_HEAD; the user is rebasing
    expect(pickOperation(['CHERRY_PICK_HEAD', 'rebase-merge'])).toBe('rebase')
  })

  it('ignores unrelated entries', () => {
    expect(pickOperation(['HEAD', 'index', 'config'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test -- operation
```

Expected: FAIL — cannot resolve `./operation.ts`.

- [ ] **Step 3: Write the module**

Create `server/operation.ts`:

```ts
// Which multi-step git operation is stopped part-way, read from the state files
// git leaves in the git dir. Pure so it can be tested without a filesystem —
// the caller does the existsSync sweep and hands over the names it found.
export type OpKind = 'rebase' | 'merge' | 'cherry-pick' | 'revert'

// Order is the whole point: a rebase applying a commit also writes
// CHERRY_PICK_HEAD, and the user is rebasing, not cherry-picking.
const ORDER: [OpKind, string[]][] = [
  ['rebase', ['rebase-merge', 'rebase-apply']],
  ['merge', ['MERGE_HEAD']],
  ['cherry-pick', ['CHERRY_PICK_HEAD']],
  ['revert', ['REVERT_HEAD']],
]

export const STATE_FILES = ORDER.flatMap(([, names]) => names)

export function pickOperation(present: string[]): OpKind | null {
  const set = new Set(present)
  for (const [kind, names] of ORDER) if (names.some(n => set.has(n))) return kind
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test -- operation
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into the server**

In `server/index.ts`, add to the imports near line 12:

```ts
import { pickOperation, STATE_FILES, type OpKind } from './operation.ts'
```

Then add, immediately above the `/api/status` route (currently line 234):

```ts
type Operation = { kind: OpKind; label: string }

// `git rev-parse` once per repo: .git is a file, not a directory, in linked
// worktrees and submodules, so the path can't be assumed. Repos are registered
// and long-lived, so caching keeps steady-state detection at zero git processes.
const gitDirs = new Map<string, string>()
async function gitDir(repo: string): Promise<string> {
  let dir = gitDirs.get(repo)
  if (!dir) {
    dir = (await git(repo, ['rev-parse', '--absolute-git-dir'])).trim()
    gitDirs.set(repo, dir)
  }
  return dir
}

// A short label for the banner, from files git already wrote — no extra process.
async function opLabel(dir: string, kind: OpKind): Promise<string> {
  const read = async (name: string) => (await readFile(join(dir, name), 'utf8').catch(() => '')).trim()
  if (kind === 'merge') return (await read('MERGE_MSG')).split('\n')[0]
  if (kind === 'cherry-pick') return (await read('CHERRY_PICK_HEAD')).slice(0, 7)
  if (kind === 'revert') return (await read('REVERT_HEAD')).slice(0, 7)
  return '' // rebase: the banner says "Rebasing" and stops there
}

async function readOperation(repo: string): Promise<Operation | null> {
  const dir = await gitDir(repo)
  const kind = pickOperation(STATE_FILES.filter(n => existsSync(join(dir, n))))
  return kind ? { kind, label: await opLabel(dir, kind) } : null
}
```

Then change the `/api/status` handler body (line 236-240) to:

```ts
    const raw = await git(String(req.query.repo), ['status', '--porcelain=v2', '-uall', '--branch', '-z'])
    res.json({
      files: parseStatus(raw),
      branch: parseBranchHeader(raw),
      operation: await readOperation(String(req.query.repo)),
    })
```

- [ ] **Step 6: Verify by hand against a real conflicted repo**

Build a throwaway repo with a guaranteed conflict, and drive the API against it with an isolated `HOME` so the user's real `~/.config/megit/config.json` is untouched.

Shell state does not persist between Bash tool calls, so this is one block and it writes the paths it made to fixed locations later tasks can read back:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
R=$(mktemp -d)/conflict-repo && mkdir -p "$R" && cd "$R" && git init -q .
printf 'one\ntwo\nthree\n' > f.txt && git add . && git commit -qm base
git checkout -qb feature && printf 'one\nTHEIRS\nthree\n' > f.txt && git commit -qam theirs
git checkout -q -   # back to the default branch, whatever git named it
printf 'one\nOURS\nthree\n' > f.txt && git commit -qam ours
git merge feature; echo "merge exit: $? (expect non-zero)"
git status --short

# isolated HOME so the real ~/.config/megit/config.json is never touched
H=$(mktemp -d) && mkdir -p "$H/.config/megit"
printf '{"repos":["%s"],"recent":[]}' "$R" > "$H/.config/megit/config.json"
echo "$R" > /tmp/megit-conflict-repo && echo "$H" > /tmp/megit-conflict-home

cd /Users/vuhoangvuong/WORKSPACE/personal/megit
HOME=$H PORT=4599 node --experimental-strip-types server/index.ts & echo $! > /tmp/megit-conflict.pid
sleep 1
Q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$R")
curl -s "http://localhost:4599/api/status?repo=$Q" | python3 -m json.tool
kill $(cat /tmp/megit-conflict.pid)
```

Expected: `git status --short` shows `UU f.txt`; the JSON carries `"operation": {"kind": "merge", "label": "Merge branch 'feature'"}` and one `f.txt` entry with `"status": "U"`.

Later tasks re-read the paths with `R=$(cat /tmp/megit-conflict-repo)` and `H=$(cat /tmp/megit-conflict-home)`. Never `pkill node` to clean up — it would kill the user's own `--watch` child; use the PID file.

- [ ] **Step 7: Run the full suite and typecheck**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test && npx tsc --noEmit
```

Expected: all pass, no type errors.

- [ ] **Step 8: Checkpoint**

Report to the user. Suggested message: `feat: report in-progress git operation from /api/status`.

---

### Task 3: GET /api/conflict

**Files:**
- Modify: `server/index.ts:5` (import), and after the `/api/diff` route (currently ends line 725)

**Interfaces:**
- Consumes: `DIFF_CAP` (`server/index.ts:688`), `httpError`, `repoGuard`, `git` — all already in the file.
- Produces:
  ```ts
  async function unmergedPaths(repo: string): Promise<string[]>
  // GET /api/conflict?repo&file
  //   → { content: string } | { binary: true } | { missing: true } | { tooLarge: true, size: number }
  ```
  Task 4 reuses `unmergedPaths`. Task 6 consumes the response shape.

- [ ] **Step 1: Add the helper and the route**

In `server/index.ts`, change the import on line 5 to include `writeFile` (Task 4 needs it; adding it now keeps the import untouched later):

```ts
import { readFile, realpath, writeFile } from 'node:fs/promises'
```

Add after the `/api/diff` route:

```ts
// git's own list of unmerged paths. Every conflict action checks against it
// BEFORE touching the filesystem: `file` arrives from the client, and without
// this check POST /api/conflict is an arbitrary-file-write primitive bounded
// only by repoGuard. Paths from git can't traverse out of the repo; paths from
// the client can. Do not reorder this behind a join() or a read.
async function unmergedPaths(repo: string): Promise<string[]> {
  const out = await git(repo, ['diff', '--name-only', '--diff-filter=U', '-z'])
  return out.split('\0').filter(Boolean)
}

app.get('/api/conflict', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const file = String(req.query.file ?? '')
  try {
    if (!(await unmergedPaths(repo)).includes(file)) throw httpError(409, 'file is not conflicted')
    // delete/modify where our side deleted it: nothing on disk, and nothing to
    // pick — the client shows the whole-file card instead of a block list
    const buf = await readFile(join(repo, file)).catch(() => null)
    if (!buf) res.json({ missing: true })
    else if (buf.length > DIFF_CAP) res.json({ tooLarge: true, size: buf.length })
    else if (buf.includes(0)) res.json({ binary: true })
    else res.json({ content: buf.toString('utf8') })
  } catch (e) {
    const err = e as Error
    res.status((err as { status?: number }).status ?? 500).json({ error: err.message })
  }
})
```

- [ ] **Step 2: Verify against the conflicted repo**

Reuse the repo from Task 2 Step 6 — it is still conflicted, since Task 3 only reads.

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
R=$(cat /tmp/megit-conflict-repo) && H=$(cat /tmp/megit-conflict-home)
cd /Users/vuhoangvuong/WORKSPACE/personal/megit
HOME=$H PORT=4599 node --experimental-strip-types server/index.ts & echo $! > /tmp/megit-conflict.pid
sleep 1
Q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$R")
echo '--- conflicted file:'
curl -s "http://localhost:4599/api/conflict?repo=$Q&file=f.txt" | python3 -m json.tool
echo '--- a file that is not conflicted:'
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:4599/api/conflict?repo=$Q&file=nope.txt"
echo '--- traversal attempt:'
curl -s "http://localhost:4599/api/conflict?repo=$Q&file=../../../../etc/passwd"
kill $(cat /tmp/megit-conflict.pid)
```

Expected: the first returns `content` containing `<<<<<<<`; the second returns `409`; the third returns `{"error": "file is not conflicted"}` and reads nothing.

- [ ] **Step 3: Typecheck**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Checkpoint**

Report to the user. Suggested message: `feat: serve conflicted file contents from /api/conflict`.

---

### Task 4: POST /api/conflict

**Files:**
- Modify: `server/index.ts:15` (json limit), and after the `GET /api/conflict` route from Task 3

**Interfaces:**
- Consumes: `unmergedPaths` and `readOperation` from Tasks 2-3.
- Produces:
  ```
  POST /api/conflict?repo
    { action: 'resolve',  file: string, content: string }
    { action: 'ours' | 'theirs' | 'delete', file: string }
    { action: 'abort' | 'continue' }
    → { ok: true }  |  4xx { error: string }
  ```
  Tasks 5 and 6 call these.

- [ ] **Step 1: Raise the JSON body limit**

`server/index.ts:15`:

```ts
// 10mb, not the 100kb default: a resolved file goes back as a JSON string, and a
// few thousand lines of source blows past the default. The GET side refuses
// anything over DIFF_CAP, so the client can't assemble a body larger than 1 MB.
app.use(express.json({ limit: '10mb' }))
```

- [ ] **Step 2: Add the route**

After the `GET /api/conflict` route:

```ts
app.post('/api/conflict', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const action = String(req.body.action ?? '')
  try {
    if (action === 'abort' || action === 'continue') {
      const op = await readOperation(repo)
      if (!op) throw httpError(409, 'no operation in progress')
      // GIT_EDITOR=true: GIT_ENV deliberately sets no editor, and `--continue`
      // opens one for the commit message — without this the request never
      // returns. `--no-edit` won't do instead: `git rebase --continue` rejects it.
      await git(repo, [op.kind, `--${action}`], [0], NET_TIMEOUT, { GIT_EDITOR: 'true' })
      res.json({ ok: true })
      return
    }
    const file = String(req.body.file ?? '')
    // the security boundary — see unmergedPaths. Runs before any path is joined.
    if (!(await unmergedPaths(repo)).includes(file)) throw httpError(409, 'file is not conflicted')
    switch (action) {
      case 'resolve': {
        const content = req.body.content
        if (typeof content !== 'string') throw httpError(400, 'content must be a string')
        await writeFile(join(repo, file), content)
        await git(repo, ['add', '--', file])
        break
      }
      case 'ours':
      case 'theirs':
        // fails on a delete/modify conflict where that side has no version —
        // the error reaches the toast, and Delete is the answer there
        await git(repo, ['checkout', `--${action}`, '--', file])
        await git(repo, ['add', '--', file])
        break
      case 'delete':
        // -f: git rm refuses an unmerged path without it
        await git(repo, ['rm', '-f', '--', file])
        break
      default:
        throw httpError(400, `unknown action: ${action}`)
    }
    res.json({ ok: true })
  } catch (e) {
    const err = e as Error
    res.status((err as { status?: number }).status ?? 409).json({ error: err.message })
  }
})
```

`--` before every path: a file named `-n` is legal, and git would read it as an option.

- [ ] **Step 3: Verify the whole server-side cycle**

The repo is still conflicted from Task 2. Reset it to that state first so the run is repeatable, then drive the full cycle:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
R=$(cat /tmp/megit-conflict-repo) && H=$(cat /tmp/megit-conflict-home)
git -C "$R" merge --abort 2>/dev/null; git -C "$R" merge feature >/dev/null 2>&1
git -C "$R" status --short   # expect: UU f.txt
cd /Users/vuhoangvuong/WORKSPACE/personal/megit
HOME=$H PORT=4599 node --experimental-strip-types server/index.ts & echo $! > /tmp/megit-conflict.pid
sleep 1
Q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$R")
echo '--- resolve f.txt by taking ours:'
curl -s -X POST -H 'Content-Type: application/json' -d '{"action":"ours","file":"f.txt"}' "http://localhost:4599/api/conflict?repo=$Q"
echo; echo '--- status now:'
curl -s "http://localhost:4599/api/status?repo=$Q" | python3 -m json.tool | head -20
echo '--- continue the merge:'
curl -s -X POST -H 'Content-Type: application/json' -d '{"action":"continue"}' "http://localhost:4599/api/conflict?repo=$Q"
echo; echo '--- operation should now be null:'
curl -s "http://localhost:4599/api/status?repo=$Q" | python3 -c 'import json,sys;print(json.load(sys.stdin)["operation"])'
kill $(cat /tmp/megit-conflict.pid)
git -C "$R" log --oneline -1
```

Expected: `{"ok":true}` twice; after the first, `f.txt` has status `M` and is staged; after the continue, `operation` is `null` and the log shows a merge commit. If the continue hangs, `GIT_EDITOR` did not take — that is the failure this step exists to catch.

- [ ] **Step 4: Verify abort separately**

Task 4 Step 3 left the merge committed, so re-conflict the repo and restart the server:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
R=$(cat /tmp/megit-conflict-repo) && H=$(cat /tmp/megit-conflict-home)
git -C "$R" reset -q --hard HEAD~1 && git -C "$R" merge feature >/dev/null 2>&1
git -C "$R" status --short   # expect: UU f.txt
cd /Users/vuhoangvuong/WORKSPACE/personal/megit
HOME=$H PORT=4599 node --experimental-strip-types server/index.ts & echo $! > /tmp/megit-conflict.pid
sleep 1
Q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$R")
curl -s -X POST -H 'Content-Type: application/json' -d '{"action":"abort"}' "http://localhost:4599/api/conflict?repo=$Q"
kill $(cat /tmp/megit-conflict.pid)
git -C "$R" status --short && git -C "$R" log --oneline -1
```

Expected: `{"ok":true}`, a clean status, and the pre-merge commit at HEAD.

- [ ] **Step 5: Typecheck**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Checkpoint**

Report to the user. Suggested message: `feat: resolve, abort and continue conflicts via /api/conflict`.

---

### Task 5: Operation banner

**Files:**
- Create: `src/ConflictBanner.tsx`
- Modify: `src/RepoView.tsx` — `statusFp` (line 40), `operation` state, the status handler (line 146-152), render above `.panes` (line 390)
- Modify: `src/styles.css` — append a `.conflict-banner` block

**Interfaces:**
- Consumes: `OpKind` from `server/operation.ts`; the `operation` field from Task 2.
- Produces:
  ```tsx
  export default function ConflictBanner(props: {
    op: { kind: OpKind; label: string }
    conflicts: number
    busy: boolean
    onAbort: () => void
    onContinue: () => void
  }): React.ReactElement
  ```

- [ ] **Step 1: Write the banner component**

Create `src/ConflictBanner.tsx`:

```tsx
import type { OpKind } from '../server/operation.ts'

const VERB: Record<OpKind, string> = {
  merge: 'Merging',
  rebase: 'Rebasing',
  'cherry-pick': 'Cherry-picking',
  revert: 'Reverting',
}

export default function ConflictBanner({ op, conflicts, busy, onAbort, onContinue }: {
  op: { kind: OpKind; label: string }
  conflicts: number
  busy: boolean
  onAbort: () => void
  onContinue: () => void
}) {
  return (
    <div className="conflict-banner">
      <span className="cb-verb">{VERB[op.kind]}</span>
      {op.label && <span className="cb-label">{op.label}</span>}
      <span className="cb-count">
        {conflicts === 0
          ? 'all conflicts resolved'
          : `${conflicts} conflict${conflicts > 1 ? 's' : ''} remaining`}
      </span>
      <button className="danger" disabled={busy} onClick={onAbort}>Abort</button>
      <button className="primary" disabled={busy || conflicts > 0} onClick={onContinue}>Continue</button>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into RepoView**

In `src/RepoView.tsx`:

Add the imports next to the others (line 8-11 area):

```tsx
import ConflictBanner from './ConflictBanner'
import type { OpKind } from '../server/operation.ts'
```

Change `statusFp` (line 40-42) to fold in the operation. Without this, an operation ending without changing the file list never reaches `setState` and the banner goes stale:

```tsx
const statusFp = (files: StatusEntry[], b: BranchHeader, op: Operation | null) =>
  `${b.head}\x1f${b.upstream}\x1f${b.ahead}\x1f${b.behind}\x1f${op?.kind ?? ''}\n`
  + files.map(f => `${f.x ?? ''}${f.y ?? ''}${f.status}${f.path}`).join('\n')
```

Add the type next to `NO_BRANCH` (line 44):

```tsx
type Operation = { kind: OpKind; label: string }
```

Add state next to `branch` (line 53):

```tsx
const [operation, setOperation] = useState<Operation | null>(null)
```

Widen the status fetch type (line 119):

```tsx
api<{ files: StatusEntry[]; branch: BranchHeader; operation: Operation | null }>(`/api/status?${q}`),
```

And the status handling block (lines 146-152):

```tsx
      const sb = s.branch ?? NO_BRANCH
      const sf = statusFp(s.files, sb, s.operation ?? null)
      if (fps.current.status !== sf) {
        fps.current.status = sf
        setStatus(s.files)
        setBranch(sb)
        setOperation(s.operation ?? null)
      }
```

Add the handlers next to `spinWhile` (after line 180):

```tsx
  const conflicts = useMemo(() => status.filter(f => f.status === 'U').length, [status])
  const conflictPost = useCallback((action: 'abort' | 'continue') => {
    spinWhile(api(`/api/conflict?${q}`, jsonInit('POST', { action })).catch(e => toastErr(e.message)))
  }, [q, spinWhile])
  const onAbort = useCallback(() => {
    // destructive: everything picked so far goes with it
    if (confirm('Abort the operation in progress?\n\nAll conflict resolutions are discarded and the repo goes back to where it was.')) conflictPost('abort')
  }, [conflictPost])
```

Render it directly above `<div className="panes">` (line 390):

```tsx
      {operation && (
        <ConflictBanner op={operation} conflicts={conflicts} busy={busy} onAbort={onAbort} onContinue={() => conflictPost('continue')} />
      )}
```

- [ ] **Step 3: Style it**

Append to `src/styles.css`:

```css
/* mid-operation strip: sits between the toolbar and the panes so it can't be
   scrolled away — being stuck in a rebase is not a detail you hunt for */
.conflict-banner { display: flex; align-items: center; gap: 10px; padding: 6px 10px; flex-shrink: 0; background: var(--bg-wip); border-bottom: 1px solid var(--border); font-size: 12px; }
.conflict-banner .cb-verb { font-weight: 600; }
.conflict-banner .cb-label { color: var(--fg-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40ch; }
.conflict-banner .cb-count { margin-left: auto; color: var(--fg-dim); }
.conflict-banner button { padding: 3px 10px; font-size: 12px; }
.conflict-banner button.danger { border-color: #e06c75; color: #e06c75; }
.conflict-banner button.primary:not(:disabled) { background: var(--head-bg); color: var(--head-fg); border-color: var(--head-bg-hover); }
.conflict-banner button:disabled { opacity: .5; cursor: default; }
```

- [ ] **Step 4: Typecheck and build**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx tsc --noEmit && pnpm build
```

Expected: no type errors; build succeeds. Note the main chunk size — it must not have moved meaningfully.

- [ ] **Step 5: Verify in the browser**

Use the `verify` skill (`.claude/skills/verify/SKILL.md`), pointing it at a freshly conflicted `$R` from Task 2 Step 6 with an isolated `HOME`.

Check: the banner appears with "Merging" and the merge message; the count reads `1 conflict remaining`; Continue is disabled; Abort prompts, and on confirm the banner disappears and the graph returns to the pre-merge state.

- [ ] **Step 6: Checkpoint**

Report to the user. Suggested message: `feat: show in-progress operation banner with abort and continue`.

---

### Task 6: Conflict resolver pane

**Files:**
- Create: `src/ConflictView.tsx`
- Modify: `src/RepoView.tsx` — lazy import, overlay routing (lines 408-419)
- Modify: `src/styles.css` — append a `.cf-*` block

**Interfaces:**
- Consumes: `parseConflict`, `applyPicks`, `Choice`, `Segment` from Task 1; `GET`/`POST /api/conflict` from Tasks 3-4.
- Produces:
  ```tsx
  export default function ConflictView(props: {
    repo: string
    file: string
    onResolved: () => void
  }): React.ReactElement
  ```

- [ ] **Step 1: Write the resolver**

Create `src/ConflictView.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { api, jsonInit } from './api'
import { applyPicks, parseConflict, type Choice, type Segment } from './conflict'

type Resp = { content?: string; binary?: true; missing?: true; tooLarge?: true; size?: number }

const CHOICES: [Choice, string][] = [['ours', 'Use ours'], ['theirs', 'Use theirs'], ['both', 'Use both']]

// Files with nothing to pick — binary, submodule, or a delete/modify conflict
// where one side has no version at all. Whole-file decision, no block list.
function WholeFile({ note, busy, onPick }: { note: string; busy: boolean; onPick: (a: 'ours' | 'theirs' | 'delete') => void }) {
  return (
    <div className="cf-card">
      <div className="cf-card-note">{note}</div>
      <div className="cf-card-actions">
        <button disabled={busy} onClick={() => onPick('ours')}>Keep ours</button>
        <button disabled={busy} onClick={() => onPick('theirs')}>Keep theirs</button>
        <button className="danger" disabled={busy} onClick={() => onPick('delete')}>Delete file</button>
      </div>
    </div>
  )
}

export default function ConflictView({ repo, file, onResolved }: { repo: string; file: string; onResolved: () => void }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [picks, setPicks] = useState<Map<number, Choice>>(new Map())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const q = `repo=${encodeURIComponent(repo)}`

  // No wipTick prop, unlike DiffView: reloading on every SSE refresh would wipe
  // the picks mid-edit. Nothing but megit writes this file while it's open, and
  // once it stops being unmerged RepoView stops rendering this component.
  useEffect(() => {
    setResp(null)
    setPicks(new Map())
    setError('')
    api<Resp>(`/api/conflict?${q}&file=${encodeURIComponent(file)}`)
      .then(setResp)
      .catch(e => setError(e.message))
  }, [repo, file])

  const segs = useMemo(() => (resp?.content ? parseConflict(resp.content) : null), [resp])
  const total = useMemo(() => segs?.filter(s => s.kind === 'conflict').length ?? 0, [segs])

  // every block decided → write the file and stage it. The banner's Continue is
  // the only thing that finishes the operation; this only finishes the file.
  useEffect(() => {
    if (!segs || !total || picks.size < total) return
    setBusy(true)
    api(`/api/conflict?${q}`, jsonInit('POST', { action: 'resolve', file, content: applyPicks(segs, picks) }))
      .then(onResolved)
      .catch(e => { setError(e.message); setBusy(false) })
  }, [picks, segs, total])

  const wholeFile = (action: 'ours' | 'theirs' | 'delete') => {
    setBusy(true)
    api(`/api/conflict?${q}`, jsonInit('POST', { action, file }))
      .then(onResolved)
      .catch(e => { setError(e.message); setBusy(false) })
  }

  const pick = (i: number, choice: Choice) => setPicks(p => new Map(p).set(i, choice))
  const reset = (i: number) => setPicks(p => { const n = new Map(p); n.delete(i); return n })

  if (error) return <div className="diffview error">{error}</div>
  if (!resp) return <div className="diffview empty">Loading…</div>
  if (resp.tooLarge) return <div className="diffview empty">File too large to resolve here ({Math.round((resp.size ?? 0) / 1024)} KB) — use the terminal</div>
  if (resp.binary) return <div className="cf-view"><WholeFile note="Binary file — there is nothing to merge line by line." busy={busy} onPick={wholeFile} /></div>
  if (resp.missing) return <div className="cf-view"><WholeFile note="Deleted on one side and modified on the other." busy={busy} onPick={wholeFile} /></div>
  if (!segs) return <div className="cf-view"><WholeFile note="No conflict markers found — the file may already be resolved, or use a marker style megit can't read." busy={busy} onPick={wholeFile} /></div>

  return (
    <div className="cf-view">
      <div className="cf-progress">{picks.size} of {total} resolved</div>
      {segs.map((s, i) => {
        if (s.kind === 'context') return <pre key={i} className="cf-context">{s.lines.join('')}</pre>
        const chosen = picks.get(i)
        return (
          <div key={i} className={`cf-block${chosen ? ' picked' : ''}`}>
            <div className="cf-bar">
              <span className="cf-side-name">{s.block.oursLabel || 'ours'}</span>
              {chosen ? (
                <>
                  <span className="cf-chosen">took {chosen}</span>
                  <button disabled={busy} onClick={() => reset(i)}>Reset</button>
                </>
              ) : (
                CHOICES.map(([c, label]) => (
                  <button key={c} disabled={busy} onClick={() => pick(i, c)}>{label}</button>
                ))
              )}
            </div>
            {(!chosen || chosen === 'ours' || chosen === 'both') && <pre className="cf-ours">{s.block.ours.join('')}</pre>}
            {!chosen && <div className="cf-mid">{s.block.theirsLabel || 'theirs'}</div>}
            {(!chosen || chosen === 'theirs' || chosen === 'both') && <pre className="cf-theirs">{s.block.theirs.join('')}</pre>}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Route the overlay to it**

In `src/RepoView.tsx`, add the lazy import next to `DiffView` (line 15). Its own chunk matters: diff2html and highlight.js are ~1 MB, and opening a conflicted file must not pay for them.

```tsx
const ConflictView = lazy(() => import('./ConflictView'))
```

Replace the overlay body (lines 408-419) with:

```tsx
          {file && selection && (
            <div className="diff-overlay">
              <div className="diff-overlay-head">
                <span className="file-path">{file.path}</span>
                {status.some(f => f.path === file.path && f.status === 'U')
                  ? <span className="diff-side conflict">conflicted</span>
                  : file.side && <span className="diff-side">{file.side === 'staged' ? 'staged' : 'unstaged'}</span>}
                <button className="diff-close" onClick={() => setFile(null)} title="Close diff">✕</button>
              </div>
              <Suspense fallback={<div className="diffview empty">Loading…</div>}>
                {status.some(f => f.path === file.path && f.status === 'U')
                  ? <ConflictView repo={repo} file={file.path} onResolved={() => { setFile(null); refresh() }} />
                  : <DiffView repo={repo} hash={selection.kind === 'commit' ? selection.hash : null} file={file.path} side={file.side} wipTick={wipTick} />}
              </Suspense>
            </div>
          )}
```

- [ ] **Step 3: Style it**

Append to `src/styles.css`:

```css
/* Resolver pane. Its own styles rather than DiffView's: DiffView renders through
   diff2html and inherits that library's stylesheet, so there's nothing to share. */
.cf-view { flex: 1; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5; }
.cf-progress { position: sticky; top: 0; z-index: 1; padding: 4px 10px; background: var(--bg-panel); border-bottom: 1px solid var(--border); color: var(--fg-dim); }
.cf-view pre { margin: 0; padding: 0 10px; white-space: pre-wrap; word-break: break-word; }
.cf-context { color: var(--fg-dim); }
.cf-block { margin: 6px 0; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.cf-block.picked { border-color: var(--head-bg-hover); }
.cf-bar { display: flex; align-items: center; gap: 6px; padding: 3px 8px; background: var(--bg-hover); border-bottom: 1px solid var(--border); }
.cf-side-name { color: var(--fg-dim); margin-right: auto; }
.cf-chosen { color: var(--head-fg); margin-right: auto; }
.cf-bar button { padding: 2px 8px; font-size: 11px; }
.cf-ours { background: color-mix(in srgb, #98c379 12%, transparent); }
.cf-theirs { background: color-mix(in srgb, #61afef 12%, transparent); }
.cf-mid { padding: 2px 8px; color: var(--fg-dim); border-top: 1px dashed var(--border); border-bottom: 1px dashed var(--border); }
.cf-card { margin: 20px auto; max-width: 420px; padding: 16px; border: 1px solid var(--border); border-radius: 6px; text-align: center; font-family: inherit; }
.cf-card-note { color: var(--fg-dim); margin-bottom: 12px; }
.cf-card-actions { display: flex; gap: 8px; justify-content: center; }
.cf-card-actions button.danger { border-color: #e06c75; color: #e06c75; }
.diff-side.conflict { color: #e06c75; }
```

- [ ] **Step 4: Typecheck, test and build**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx tsc --noEmit && pnpm test && pnpm build
```

Expected: no type errors, all tests pass, build succeeds. Confirm `ConflictView` emitted its own chunk and the main bundle did not grow.

- [ ] **Step 5: Verify the whole feature in the browser**

Use the `verify` skill. Build a repo with a **three-block** conflict so picking is exercised properly, plus a delete/modify conflict:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
R2=$(mktemp -d)/multi && mkdir -p "$R2" && cd "$R2" && git init -q .
printf 'a\nb\nc\nd\ne\nf\ng\nh\ni\n' > m.txt
printf 'gone either way\n' > d.txt
git add . && git commit -qm base
git checkout -qb feature
printf 'a\nTHEIRS1\nc\nd\nTHEIRS2\nf\ng\nh\nTHEIRS3\n' > m.txt
rm d.txt && git add -A && git commit -qm theirs
git checkout -q -
printf 'a\nOURS1\nc\nd\nOURS2\nf\ng\nh\nOURS3\n' > m.txt
printf 'gone either way\nours edit\n' > d.txt
git commit -qam ours
git merge feature; git status --short; echo "$R2"
```

Drive the UI and check each of these:

1. Banner reads "Merging" with the merge message, and `2 conflicts remaining`.
2. Clicking `m.txt` in the Changes list opens the resolver, not a diff. Three blocks, `0 of 3 resolved`.
3. Picking ours on one block collapses it to the ours half and shows Reset; the counter reads `1 of 3`.
4. Reset restores both halves and drops the counter back.
5. Deciding all three writes the file and stages it — `m.txt` moves to Staged Changes, the banner count drops to 1.
6. Clicking `d.txt` shows the whole-file card, not a block list. "Keep ours" stages it and the banner reads `all conflicts resolved`.
7. Continue is now enabled. Clicking it clears the banner and puts a merge commit at the top of the graph.
8. Open the resolved `m.txt` on disk and confirm no `<<<<<<<` survived and the line endings are unchanged.

- [ ] **Step 6: Checkpoint**

Report to the user. Suggested message: `feat: resolve merge conflicts in-app with per-block picking`.

---

### Task 7: Documentation

**Files:**
- Modify: `docs/architecture.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `docs/architecture.md`**

Add `src/conflict.ts` and `server/operation.ts` to the list of pure modules. Document the `/api/conflict` routes alongside the other route descriptions, and state the unmerged-path check as the security property it is. Note that `/api/status` now carries `operation`.

- [ ] **Step 2: Update `README.md`**

Add conflict resolution to the feature list. If the README screenshots are regenerated, `scripts/make-test-repo.sh` is the source — do not hand-edit fixtures.

- [ ] **Step 3: Update `CHANGELOG.md`**

Add an entry under a new heading for the next version. Do not bump `package.json` unless the user asks for a release — the release job publishes on any version not yet on npm.

- [ ] **Step 4: Update `CLAUDE.md` gotchas**

Add: `GIT_ENV` sets no `GIT_EDITOR`, so any git subcommand that opens an editor (`merge --continue`, `rebase --continue`) must pass `GIT_EDITOR=true` through `git()`'s `env` parameter or the request hangs forever.

- [ ] **Step 5: Checkpoint**

Report to the user. Suggested message: `docs: document conflict resolution`.

---

## Known follow-ups, deliberately not in this plan

- ~~**Staging a conflicted file is still possible.**~~ **Done during execution**, on the user's observation that VS Code groups conflicts into their own "Merge Changes" section. `splitStatus` now returns a third list, `CommitPanel` renders it above Staged with no Stage/Discard actions, `stage-all` and `discard` exclude unmerged paths via `:(exclude)` pathspecs, and `ConflictView` gained **Mark resolved** so a hand-fixed file can still be accepted.
- **Stash-pop conflicts get no banner.** The resolver works on them — they are ordinary `U` entries — but there is no state file and no `--continue`, so no operation chrome and no automatic stash drop.
- **`git rebase --continue` mid-sequence.** Continuing into the next conflict works and produces another banner; there is no "skip this commit" button (`rebase --skip`).

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Operation detection, cached git dir, `pickOperation` | 2 |
| `operation` on `/api/status`, `statusFp` | 2, 5 |
| `parseConflict` / `applyPicks`, byte-exact endings, diff3 | 1 |
| `GET /api/conflict` with binary/missing/tooLarge | 3 |
| `POST /api/conflict` — resolve, ours, theirs, delete | 4 |
| Abort / Continue with `GIT_EDITOR=true` | 4, 5 |
| Unmerged-path security check | 3, 4 |
| `express.json` limit | 4 |
| `ConflictBanner` | 5 |
| `ConflictView`, in-place in `.diff-overlay`, own lazy chunk, own CSS | 6 |
| Whole-file card for no-marker conflicts | 6 |
| Auto-write + auto-stage, manual Continue | 5, 6 |
| SSE must not clear picks | 6 (no `wipTick` prop) |
| Tests: parser cases, `pickOperation` precedence | 1, 2 |

No gaps.

**Placeholders:** one intentional `TODO(user)` in Task 1 Step 3, which Task 1 Step 5 is written to resolve. No others.

**Type consistency:** `Choice`, `Block`, `Segment`, `parseConflict`, `applyPicks` are defined in Task 1 and used with the same names and signatures in Task 6. `OpKind`, `STATE_FILES`, `pickOperation` are defined in Task 2 and used in Tasks 4-5. `Operation` is declared in `server/index.ts` (Task 2) and re-declared structurally in `RepoView.tsx` (Task 5) — deliberate, matching how the client already re-states server shapes rather than importing runtime code across the halves. `unmergedPaths` is defined in Task 3 and used in Task 4. `readOperation` is defined in Task 2 and used in Task 4.
