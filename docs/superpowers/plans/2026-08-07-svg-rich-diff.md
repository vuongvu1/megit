# SVG Rich/Source Diff Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `.svg` files a Rendered/Source toggle in the diff toolbar, so an SVG's real patch is reachable instead of only its rendered picture.

**Architecture:** A pure module (`src/diffMode.ts`) decides which body and which toolbar controls a file gets; `DiffView.tsx` renders that decision. The toolbar is hoisted above the body so it survives every state (loading, error, too-large). No server change, no new dependency — `/api/diff` already serves the patch and `/api/blob?which=old|new` already serves the two sides.

**Tech Stack:** React 19, TypeScript, vitest, diff2html (all already present).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-svg-rich-diff-design.md`.
- **No new dependency.** Runtime `dependencies` stays `express` + `ws`; no new devDependency, no lazy chunk.
- **Do not run `git commit` or `git rm`** (CLAUDE.md). The user commits at task boundaries. Where this plan says "checkpoint", stop and report — do not commit.
- Node ≥ 24. `nvm use` does not persist across Bash calls; prefix every command with:
  `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`
- Package manager is pnpm.
- Branch is already `feat/svg-rich-diff`, cut from `main`.
- localStorage key is exactly `megit-diff-rich`; `'0'` means source, anything else (including absent) means rendered.
- Only `.svg` gets the toggle. Raster images keep no toolbar at all.

---

### Task 1: Pure mode decision module

**Files:**
- Create: `src/diffMode.ts`
- Test: `src/diffMode.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type DiffMode = { body: 'image' | 'text'; richToggle: boolean; splitToggle: boolean }`
  - `export function diffMode(file: string, rich: boolean): DiffMode`
  - `export function needsPatch(file: string): boolean`

  Task 2 imports all three. `IMAGE_RE` moves here from `DiffView.tsx:61` and is **not** exported — `needsPatch` is the only consumer outside this file.

- [ ] **Step 1: Write the failing test**

Create `src/diffMode.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { diffMode, needsPatch } from './diffMode'

describe('diffMode', () => {
  it('renders an SVG as an image in rich mode, with only the rich toggle', () => {
    expect(diffMode('icons/logo.svg', true)).toEqual({ body: 'image', richToggle: true, splitToggle: false })
  })

  it('renders an SVG as a text diff in source mode, with both toggles', () => {
    expect(diffMode('icons/logo.svg', false)).toEqual({ body: 'text', richToggle: true, splitToggle: true })
  })

  it('gives raster images no toggle in either mode', () => {
    const expected = { body: 'image', richToggle: false, splitToggle: false }
    expect(diffMode('public/shot.png', true)).toEqual(expected)
    expect(diffMode('public/shot.png', false)).toEqual(expected)
    expect(diffMode('a.JPEG', true)).toEqual(expected)
  })

  it('gives ordinary files the split toggle only', () => {
    expect(diffMode('src/App.tsx', true)).toEqual({ body: 'text', richToggle: false, splitToggle: true })
    expect(diffMode('README.md', false)).toEqual({ body: 'text', richToggle: false, splitToggle: true })
  })

  it('matches the extension case-insensitively and only at the end', () => {
    expect(diffMode('a.SVG', false).richToggle).toBe(true)
    expect(diffMode('svg/notes.txt', true).richToggle).toBe(false)
  })
})

describe('needsPatch', () => {
  it('fetches a patch for text files and for SVG in either mode', () => {
    expect(needsPatch('src/App.tsx')).toBe(true)
    expect(needsPatch('icons/logo.svg')).toBe(true)
  })

  it('skips the patch for raster images', () => {
    expect(needsPatch('public/shot.png')).toBe(false)
    expect(needsPatch('a.webp')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test -- diffMode
```

Expected: FAIL — `Failed to resolve import "./diffMode"`.

- [ ] **Step 3: Write the implementation**

Create `src/diffMode.ts`:

```ts
// Which body a diffed file gets, and which toolbar controls come with it.
//
// SVG is the one rendered type where the picture is lossy: a changed viewBox, a
// renamed id, a stroke tweak below visual threshold, or a rewritten path with
// identical output are all invisible. So SVG alone gets a rendered/source toggle.
// Raster images have no readable source — git only says "Binary files ... differ" —
// so they get no toggle; a control that leads nowhere is worse than none.
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i
const SVG_RE = /\.svg$/i

export type DiffMode = {
  body: 'image' | 'text'
  richToggle: boolean // Rendered | Source
  splitToggle: boolean // Unified | Split — nothing to split in an image body
}

export function diffMode(file: string, rich: boolean): DiffMode {
  const svg = SVG_RE.test(file)
  const image = IMAGE_RE.test(file) && (rich || !svg)
  return { body: image ? 'image' : 'text', richToggle: svg, splitToggle: !image }
}

// SVG fetches its patch even in rendered mode, so flipping the toggle needs no
// round trip. One extra `git diff` on one small file is cheaper than a stall.
export function needsPatch(file: string): boolean {
  return !IMAGE_RE.test(file) || SVG_RE.test(file)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm test -- diffMode
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Checkpoint**

Report: new module + test passing, full suite still green (`pnpm test`). Do not commit — the user commits.

---

### Task 2: Wire the toggle into DiffView

**Files:**
- Modify: `src/DiffView.tsx` (lines 61, 88, 91, 158, 160–199)
- Modify: `src/styles.css:295`

**Interfaces:**
- Consumes: `diffMode`, `needsPatch`, and the `DiffMode` type from Task 1 (`./diffMode`).
- Produces: nothing other tasks depend on. This is the last task.

- [ ] **Step 1: Import the module and delete the local regex**

In `src/DiffView.tsx`, add to the imports at the top:

```tsx
import { diffMode, needsPatch } from './diffMode'
```

Delete line 61 entirely (`const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i`). `ImagePane`
just below it stays exactly as it is.

- [ ] **Step 2: Add the `rich` state and replace `isImage`**

Inside the `DiffView` component, add the state next to `split` (currently `DiffView.tsx:82`):

```tsx
  const [rich, setRich] = useState(() => localStorage.getItem('megit-diff-rich') !== '0')
```

Replace line 88 (`const isImage = IMAGE_RE.test(file)`) with:

```tsx
  const mode = diffMode(file, rich)
```

Add a setter helper below it, mirroring how `split` persists:

```tsx
  const pickRich = (v: boolean) => {
    setRich(v)
    localStorage.setItem('megit-diff-rich', v ? '1' : '0')
  }
```

- [ ] **Step 3: Fix the fetch guard**

Inside `load`, replace `if (isImage) return` (line 91) with:

```tsx
    if (!needsPatch(file)) return
```

Leave the `useEffect` dependency arrays at lines 107 and 112 alone — `needsPatch` does not depend on
`rich`, so an SVG's patch is fetched once per file, in either mode.

- [ ] **Step 4: Add `rich` to the draw effect's dependencies**

This step is load-bearing. Change line 158 from:

```tsx
  }, [text, gapList, split, plain, theme])
```

to:

```tsx
    // rich: switching to source mounts a fresh .diff-html, and the `!el` guard
    // above means an effect that doesn't re-fire would leave it blank
  }, [text, gapList, split, plain, theme, rich])
```

- [ ] **Step 5: Restructure the return — toolbar above, body as a switch**

Replace everything from `if (isImage) {` (line 160) to the end of the component (line 199) with:

```tsx
  const toolbar = (mode.richToggle || mode.splitToggle) && (
    <div className="diff-toolbar">
      {mode.richToggle && (
        <div className="view-toggle">
          <button className={rich ? 'active' : ''} aria-pressed={rich} onClick={() => pickRich(true)}>Rendered</button>
          <button className={rich ? '' : 'active'} aria-pressed={!rich} onClick={() => pickRich(false)}>Source</button>
        </div>
      )}
      {mode.splitToggle && (
        <div className="view-toggle">
          <button className={split ? '' : 'active'} aria-pressed={!split} onClick={() => { setSplit(false); localStorage.setItem('megit-diff-split', '0') }}>Unified</button>
          <button className={split ? 'active' : ''} aria-pressed={split} onClick={() => { setSplit(true); localStorage.setItem('megit-diff-split', '1') }}>Split</button>
        </div>
      )}
    </div>
  )

  const body = () => {
    if (mode.body === 'image') {
      const q = (which: 'old' | 'new') => {
        const p = new URLSearchParams({ repo, file, which, ...(hash ? { hash } : { t: String(wipTick) }), ...(side ? { side } : {}) })
        return `/api/blob?${p}`
      }
      return (
        <div className="image-diff">
          <ImagePane src={q('old')} label="Before" />
          <ImagePane src={q('new')} label="After" />
        </div>
      )
    }
    if (error) return <div className="diff-state">{error}</div>
    if (!resp) return <div className="diff-state">Loading…</div>
    if (resp.tooLarge) {
      return (
        <div className="diff-state">
          <div>
            <div>Diff too large ({Math.round((resp.size ?? 0) / 1024)} KB)</div>
            <button onClick={() => load(true)}>Show anyway</button>
          </div>
        </div>
      )
    }
    return plain
      ? <pre className="diff-plain">{text?.trim() || 'No changes'}</pre>
      : <div ref={ref} className="diff-html" />
  }

  return (
    <div className="diffview">
      {toolbar}
      {body()}
    </div>
  )
}
```

Note what changed and why: the `isImage`, `error`, `!resp` and `tooLarge` early returns are gone, so
the toolbar renders for every state — without this, an SVG whose patch errors or exceeds `DIFF_CAP`
would show no toggle and the user could not get back to the rendered view. The `.diffview error` and
`.diffview empty` classes are replaced by an inner `.diff-state` (added in Step 6) because
`.diffview.empty` centers all children, which would centre the toolbar too. `ConflictView.tsx` and
`RepoView.tsx` still use `.diffview empty` — leave both alone.

- [ ] **Step 6: CSS**

In `src/styles.css`, add `gap: 8px` to `.diff-toolbar` (line 295) so the two segmented groups do not
touch:

```css
.diff-toolbar { padding: 6px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; display: flex; justify-content: center; gap: 8px; }
```

Add the state wrapper directly after the `.diffview.empty` rule (line 294) — it centres a message in
the space left below the toolbar:

```css
.diff-state { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; }
```

- [ ] **Step 7: Typecheck and run the suite**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
npx tsc --noEmit && pnpm test
```

Expected: no tsc output; suite green (174+ tests, plus Task 1's 7).

- [ ] **Step 8: Verify in the browser**

Use the `verify` skill (`.claude/skills/verify/SKILL.md`) to build and drive the app. `test-repo/` has
no SVG, so point megit at this repo itself, which has `public/logo.svg`.

Check, in order:

1. Edit `public/logo.svg` in the worktree (e.g. change `width`), open the WIP row, click the file.
2. Rendered mode: before/after image panes, toolbar shows `Rendered | Source` only.
3. Click Source: a real diff2html patch appears — **not a blank pane** (this is what Step 4 guards).
   Toolbar now shows both groups.
4. Unified/Split works in source mode.
5. Open a `.ts` file: only `Unified | Split`, no rich toggle. Open a `.png` (`git log --diff-filter=A
   -- '*.png'` for one, or check `public/`): image panes, no toolbar at all.
6. Reopen the SVG: still Source. Reload the page: still Source. Click Rendered, reload: Rendered.
7. Revert the `public/logo.svg` edit (`git checkout -- public/logo.svg`).

- [ ] **Step 9: Checkpoint**

Report what was verified, with the screenshots from Step 8. Do not commit.

---

## Notes for the implementer

- `plain` (line 114) is computed from `resp`, which is `null` for raster images; the body switch
  returns before `plain` is read in that case, so no guard is needed there.
- Do not add SVG fixtures to `scripts/make-test-repo.sh` — that script is also the source of the
  README screenshots, and Step 8 does not need it.
- Playwright MCP drops `.playwright-mcp/` into the CWD. Keep it out of the change.
- Delete this plan file once the feature ships (CLAUDE.md: plans are scratch).
