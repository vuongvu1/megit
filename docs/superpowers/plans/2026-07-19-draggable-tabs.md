# Draggable Repo Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder repo tabs by dragging, persisted in server config.

**Architecture:** Native HTML5 drag-and-drop in `TabBar.tsx` with live tab shuffle during drag; `App.tsx` mutates `cfg.repos` optimistically and persists the final order via a new `PUT /api/repos/order` endpoint that validates the payload is an exact permutation of the current repo list.

**Tech Stack:** React 18, Express, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-19-draggable-tabs-design.md`

## Global Constraints

- No new dependencies.
- Git commits are performed by the user at task boundaries (Claude is denied `git commit` in this project). Commit steps below mean: pause and let the user commit.
- Run server tests with: `npm test` (vitest run) from repo root.

---

### Task 1: Server — permutation validation + `PUT /api/repos/order`

**Files:**
- Modify: `server/config.ts` (append helper)
- Modify: `server/index.ts` (add endpoint after the existing `app.put('/api/active', ...)` block, ~line 63-71)
- Test: `server/config.test.ts` (create)

**Interfaces:**
- Produces: `isPermutation(a: string[], b: string[]): boolean` exported from `server/config.ts`; HTTP endpoint `PUT /api/repos/order` with JSON body `{ repos: string[] }` returning the full `Config` on success, `400 { error: 'invalid repo order' }` on invalid payload.
- Consumes: existing `loadConfig` / `saveConfig` from `server/config.ts`.

- [ ] **Step 1: Write the failing test**

Create `server/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isPermutation } from './config.ts'

describe('isPermutation', () => {
  it.each<[string[], string[], boolean]>([
    [['a', 'b', 'c'], ['c', 'a', 'b'], true],
    [[], [], true],
    [['a', 'b'], ['a', 'b'], true],
    // wrong length
    [['a'], ['a', 'b'], false],
    [['a', 'b', 'c'], ['a', 'b'], false],
    // same length, different members (path injection attempt)
    [['a', 'x'], ['a', 'b'], false],
    // duplicates must not pass as members
    [['a', 'a'], ['a', 'b'], false],
  ])('%j vs %j → %s', (a, b, expected) => {
    expect(isPermutation(a, b)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `config.test.ts` errors with `isPermutation` not exported / not found.

- [ ] **Step 3: Write minimal implementation**

Append to `server/config.ts`:

```ts
export function isPermutation(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const as = [...a].sort()
  const bs = [...b].sort()
  return as.every((v, i) => v === bs[i])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all suites green (existing `parse.test.ts`, `watch.test.ts`, `lanes.test.ts` untouched).

- [ ] **Step 5: Add the endpoint**

In `server/index.ts`, import `isPermutation` by extending the existing import:

```ts
import { loadConfig, saveConfig, isPermutation } from './config.ts'
```

Insert after the `app.put('/api/active', ...)` block:

```ts
app.put('/api/repos/order', (req, res) => {
  const repos = req.body.repos
  const cfg = loadConfig()
  if (!Array.isArray(repos) || !isPermutation(repos, cfg.repos)) {
    res.status(400).json({ error: 'invalid repo order' })
    return
  }
  cfg.repos = repos
  saveConfig(cfg)
  res.json(cfg)
})
```

Note: `isPermutation` against the current (all-string) `cfg.repos` also rejects non-string elements — no separate type check needed.

- [ ] **Step 6: Type-check and test**

Run: `npx tsc --noEmit && npm test`
Expected: clean tsc, all tests PASS.

- [ ] **Step 7: Commit (user)**

User commits, suggested message: `feat: add PUT /api/repos/order with permutation validation`

---

### Task 2: Client — drag-and-drop in TabBar + persistence in App

**Files:**
- Modify: `src/TabBar.tsx` (full component below)
- Modify: `src/App.tsx` (add `reorder` / `reorderEnd`, pass props)
- Modify: `src/styles.css` (one rule)

**Interfaces:**
- Consumes: `PUT /api/repos/order` with body `{ repos: string[] }` (Task 1); existing `api<T>` / `jsonInit` from `src/api.ts`.
- Produces: `TabBar` props `onReorder(from: number, to: number): void` and `onReorderEnd(): void`.

- [ ] **Step 1: Rewrite `src/TabBar.tsx`**

```tsx
import { useState } from 'react'

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

export default function TabBar({ repos, active, onSelect, onAdd, onClose, onReorder, onReorderEnd }: {
  repos: string[]
  active: string | null
  onSelect: (r: string) => void
  onAdd: () => void
  onClose: (r: string) => void
  onReorder: (from: number, to: number) => void
  onReorderEnd: () => void
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  return (
    <div className="tabbar">
      {repos.map((r, i) => (
        <div
          key={r}
          className={`tab${r === active ? ' active' : ''}${i === dragIdx ? ' dragging' : ''}`}
          title={r}
          draggable
          onClick={() => onSelect(r)}
          onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r); setDragIdx(i) }}
          onDragOver={e => {
            e.preventDefault()
            if (dragIdx !== null && dragIdx !== i) {
              onReorder(dragIdx, i)
              setDragIdx(i)
            }
          }}
          onDragEnd={() => { setDragIdx(null); onReorderEnd() }}
        >
          {base(r)}
          <button className="tab-close" onClick={e => { e.stopPropagation(); onClose(r) }}>×</button>
        </div>
      ))}
      <button className="tab-add" onClick={onAdd}>+</button>
    </div>
  )
}
```

- [ ] **Step 2: Wire up `src/App.tsx`**

Add below the existing `close` handler:

```tsx
const reorder = (from: number, to: number) => {
  const repos = [...cfg.repos]
  repos.splice(to, 0, ...repos.splice(from, 1))
  setCfg({ ...cfg, repos })
}
const reorderEnd = () =>
  api<Config>('/api/repos/order', jsonInit('PUT', { repos: cfg.repos })).then(setCfg).catch(() => {})
```

Update the `TabBar` element:

```tsx
<TabBar repos={cfg.repos} active={cfg.activeRepo} onSelect={select} onAdd={() => setBrowsing(true)} onClose={close} onReorder={reorder} onReorderEnd={reorderEnd} />
```

Note: `reorderEnd` reads `cfg.repos` from the render closure — safe because React flushes the `dragover` state update before the separate `dragend` event dispatch. The `.catch(() => {})` implements the spec's error handling: on 400 keep the optimistic local order; reload restores server truth.

- [ ] **Step 3: Add CSS**

Append to `src/styles.css` after the `.tab.active` rule:

```css
.tab.dragging { opacity: 0.5; }
```

- [ ] **Step 4: Type-check and test**

Run: `npx tsc --noEmit && npm test`
Expected: clean tsc, all tests PASS.

- [ ] **Step 5: End-to-end verification**

Invoke the project `verify` skill: launch megit, drag the first repo tab past the second, confirm tab order changes live during drag, then reload the page and confirm the new order persisted.

- [ ] **Step 6: Commit (user)**

User commits, suggested message: `feat: drag repo tabs to reorder, order persisted in config`
