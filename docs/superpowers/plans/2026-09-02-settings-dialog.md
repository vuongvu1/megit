# Settings Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cog-launched settings dialog covering font family, app zoom, a shortcut reference and three existing preferences, and move the version tag next to the logo.

**Architecture:** A pure `settings.ts` (types, parsing, clamping, CSS/URL builders) paired with a DOM-side `settingsStore.ts` that persists one localStorage key and applies state to `document.documentElement` before React mounts — the same shape as the existing `theme.ts`. Text scaling is `:root { zoom: N }`, which scales layout and SVG together so `GraphView`'s `ROW = 28` and the two CSS row-height sites stay consistent untouched. Font family flows through a new `--font-stack` custom property.

**Tech Stack:** React 19 + TypeScript, Vite, vitest (node environment — no jsdom), plain CSS custom properties. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-02-settings-dialog-design.md`

## Global Constraints

- Node ≥ 24. Prefix every command with `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"` — `nvm use` does not persist across tool calls.
- **No new runtime or dev dependency.** Runtime `dependencies` stays `ws` (+ optional `node-pty`). Icons are inline SVG.
- **Do not run `git commit` or `git rm`.** The user commits at task boundaries. Every task's final step is `git add` of the named files plus a one-line report of what is staged.
- vitest runs in the **node** environment. Any module a `*.test.ts` imports must be reachable without `document`, `window` or `localStorage`.
- Branch is already `feat/settings-dialog`, off `main`.
- Zoom range 0.8–1.6 in 0.1 steps. Defaults: `fontFamily: ''`, `googleFont: ''`, `zoom: 1`, `avatars: true`.
- localStorage key is `megit-settings`. `megit-theme` and `megit-diff-rich` keep their own keys; `megit-diff-split` is read once for migration then superseded.
- Google Fonts is opt-in and off by default — the privacy guarantee in `styles.css:1-7` must hold for anyone who does not type a font name.
- Typecheck with `npx tsc --noEmit` and the full suite with `pnpm test` before staging any task.

---

### Task 1: Shortcuts registry

**Files:**
- Create: `src/shortcuts.ts`
- Test: `src/shortcuts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Shortcut = { keys: string; label: string; group: string }`, `SHORTCUTS: Shortcut[]`, `render(keys: string, mac: boolean): string`, `GROUPS: string[]`.

- [ ] **Step 1: Write the failing test**

Create `src/shortcuts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SHORTCUTS, GROUPS, render } from './shortcuts'

describe('render', () => {
  it('uses mac glyphs for modifiers', () => {
    expect(render('Mod+Shift+0', true)).toBe('⌘⇧0')
    expect(render('Mod+Enter', true)).toBe('⌘↵')
  })

  it('uses spelled-out modifiers joined by + elsewhere', () => {
    expect(render('Mod+Shift+0', false)).toBe('Ctrl+Shift+0')
    expect(render('Mod+Enter', false)).toBe('Ctrl+Enter')
  })

  it('abbreviates Escape identically on both platforms', () => {
    expect(render('Escape', true)).toBe('Esc')
    expect(render('Escape', false)).toBe('Esc')
  })

  it('uppercases a bare letter key', () => {
    expect(render('r', true)).toBe('R')
    expect(render('Mod+F', false)).toBe('Ctrl+F')
  })

  it('passes a glyph pair through untouched', () => {
    expect(render('↑ ↓', true)).toBe('↑ ↓')
  })
})

describe('SHORTCUTS', () => {
  it('has no duplicate keys within a group', () => {
    const seen = SHORTCUTS.map(s => `${s.group}::${s.keys}`)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('lists every group in GROUPS, in order, with no empties', () => {
    expect(GROUPS).toEqual([...new Set(SHORTCUTS.map(s => s.group))])
  })

  it('covers the shortcuts the app actually binds', () => {
    const keys = SHORTCUTS.map(s => s.keys)
    for (const k of ['↑ ↓', 'Mod+Shift+0', 'r', 'Mod+F', 'Mod+J', 'Mod+K', 'Mod+D', 'Mod+Enter', 'Escape']) {
      expect(keys).toContain(k)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && pnpm test -- shortcuts`
Expected: FAIL — `Failed to resolve import "./shortcuts"`.

- [ ] **Step 3: Write the implementation**

Create `src/shortcuts.ts`:

```ts
// Reference only — the dialog renders this, nothing dispatches from it. The six
// handlers keep their own inline key checks (theme.ts, RepoView.tsx,
// GraphView.tsx, TerminalPanel.tsx, CommitPanel.tsx); each carries a comment
// pointing back here. Rebinding was considered and rejected: a runtime matcher
// would have to sit in TerminalPanel's ⌘-passthrough filter, which decides what
// reaches the shell.
export type Shortcut = { keys: string; label: string; group: string }

// 'Mod' is ⌘ on mac, Ctrl elsewhere. Letter case here is display-only — 'r' is
// bound unshifted but reads better as R.
export const SHORTCUTS: Shortcut[] = [
  { group: 'Graph', keys: '↑ ↓', label: 'Select previous / next row' },
  { group: 'Search', keys: 'Mod+F', label: 'Open search' },
  { group: 'Search', keys: 'Escape', label: 'Close search' },
  { group: 'Terminal', keys: 'Mod+J', label: 'Toggle terminal' },
  { group: 'Terminal', keys: 'Mod+K', label: 'Clear terminal' },
  { group: 'Terminal', keys: 'Mod+D', label: 'Split terminal pane' },
  { group: 'Commit', keys: 'Mod+Enter', label: 'Commit, or save an edited message' },
  { group: 'Commit', keys: 'Escape', label: 'Cancel message edit' },
  { group: 'View', keys: 'r', label: 'Refresh (outside a text field)' },
  { group: 'View', keys: 'Mod+Shift+0', label: 'Toggle light / dark theme' },
  { group: 'Dialogs', keys: 'Escape', label: 'Close dialog' },
]

export const GROUPS = [...new Set(SHORTCUTS.map(s => s.group))]

const MAC: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↵', Escape: 'Esc' }
const PC: Record<string, string> = { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Enter: 'Enter', Escape: 'Esc' }

export function render(keys: string, mac: boolean): string {
  const map = mac ? MAC : PC
  const parts = keys.split('+').map(t => map[t] ?? (t.length === 1 ? t.toUpperCase() : t))
  // mac stacks glyphs with no separator, the way the OS prints them
  return parts.join(mac ? '' : '+')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && pnpm test -- shortcuts && npx tsc --noEmit`
Expected: PASS, 8 tests. tsc silent.

- [ ] **Step 5: Stage**

```bash
git add src/shortcuts.ts src/shortcuts.test.ts
```

Report: "Staged `shortcuts.ts` + 8 tests. Ready for your commit."

---

### Task 2: Pure settings module

**Files:**
- Create: `src/settings.ts`
- Test: `src/settings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Settings`, `DEFAULTS: Settings`, `ZOOM_MIN/ZOOM_MAX/ZOOM_STEP: number`, `clampZoom(n: number): number`, `parse(raw: string | null, defaults: Settings): Settings`, `fontStack(family: string): string`, `googleHref(name: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULTS, clampZoom, parse, fontStack, googleHref } from './settings'

describe('clampZoom', () => {
  it('holds the range and snaps to 0.1 steps', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(0.4)).toBe(0.8)
    expect(clampZoom(9)).toBe(1.6)
    expect(clampZoom(1.24)).toBe(1.2)
    expect(clampZoom(1.25)).toBeCloseTo(1.3)
  })
})

describe('parse', () => {
  it('returns the defaults for no stored value', () => {
    expect(parse(null, DEFAULTS)).toEqual(DEFAULTS)
  })

  it('returns the defaults for corrupt JSON rather than throwing', () => {
    expect(parse('{not json', DEFAULTS)).toEqual(DEFAULTS)
  })

  it('merges a partial stored object over the defaults', () => {
    expect(parse('{"zoom":1.2}', DEFAULTS)).toEqual({ ...DEFAULTS, zoom: 1.2 })
  })

  it('ignores fields of the wrong type', () => {
    expect(parse('{"zoom":"big","avatars":"yes"}', DEFAULTS)).toEqual(DEFAULTS)
  })

  it('clamps a stored zoom that is out of range', () => {
    expect(parse('{"zoom":42}', DEFAULTS).zoom).toBe(1.6)
  })

  it('honours a caller-supplied default, for the diff-split migration', () => {
    const migrated = { ...DEFAULTS, diffSplit: true }
    expect(parse(null, migrated).diffSplit).toBe(true)
    expect(parse('{"diffSplit":false}', migrated).diffSplit).toBe(false)
  })
})

describe('fontStack', () => {
  it('is empty for the bundled default, so the :root value applies', () => {
    expect(fontStack('')).toBe('')
    expect(fontStack('   ')).toBe('')
  })

  it('quotes a single family and appends the fallbacks', () => {
    expect(fontStack('JetBrains Mono')).toBe("'JetBrains Mono', 'Ubuntu Mono', ui-monospace, monospace")
  })

  it('leaves an already-comma-separated stack unquoted', () => {
    expect(fontStack('ui-monospace, monospace')).toBe("ui-monospace, monospace, 'Ubuntu Mono', ui-monospace, monospace")
  })

  it('strips characters that would corrupt the CSS value', () => {
    expect(fontStack('Evil"; }')).toBe("'Evil', 'Ubuntu Mono', ui-monospace, monospace")
  })
})

describe('googleHref', () => {
  it('is empty when no font is requested', () => {
    expect(googleHref('')).toBe('')
  })

  it('builds a css2 URL with + for spaces', () => {
    expect(googleHref('Fira Code')).toBe('https://fonts.googleapis.com/css2?family=Fira+Code&display=swap')
  })

  it('rejects anything that is not a plain font name', () => {
    expect(googleHref('Evil"><script>')).toBe('')
    expect(googleHref('../../etc/passwd')).toBe('')
    expect(googleHref('x'.repeat(80))).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && pnpm test -- settings`
Expected: FAIL — `Failed to resolve import "./settings"`.

- [ ] **Step 3: Write the implementation**

Create `src/settings.ts`:

```ts
// Pure half of the settings feature: no document, no localStorage, so vitest can
// import it in its node environment. The DOM side lives in settingsStore.ts.
export type Settings = {
  fontFamily: string // '' = the bundled Ubuntu Mono stack declared on :root
  googleFont: string // '' = off; non-empty opts in to a fonts.googleapis.com request
  zoom: number
  avatars: boolean
  diffSplit: boolean
}

export const ZOOM_MIN = 0.8
export const ZOOM_MAX = 1.6
export const ZOOM_STEP = 0.1

export const DEFAULTS: Settings = {
  fontFamily: '',
  googleFont: '',
  zoom: 1,
  avatars: true,
  diffSplit: false,
}

// Snap before clamping so a float that arrived from repeated += 0.1 lands on a
// step instead of accumulating 1.3000000000000003 into storage.
export const clampZoom = (n: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n * 10) / 10))

// Field-by-field with a type check each, so a hand-edited or truncated value
// degrades to the default instead of poisoning the store with a string zoom.
export function parse(raw: string | null, defaults: Settings): Settings {
  if (!raw) return defaults
  let o: Partial<Settings>
  try {
    o = JSON.parse(raw) as Partial<Settings>
  } catch {
    return defaults
  }
  if (!o || typeof o !== 'object') return defaults
  return {
    fontFamily: typeof o.fontFamily === 'string' ? o.fontFamily : defaults.fontFamily,
    googleFont: typeof o.googleFont === 'string' ? o.googleFont : defaults.googleFont,
    zoom: typeof o.zoom === 'number' && Number.isFinite(o.zoom) ? clampZoom(o.zoom) : defaults.zoom,
    avatars: typeof o.avatars === 'boolean' ? o.avatars : defaults.avatars,
    diffSplit: typeof o.diffSplit === 'boolean' ? o.diffSplit : defaults.diffSplit,
  }
}

// The family name is user-typed and ends up in a CSS custom property, so quotes,
// backslashes, semicolons and braces come out first. A value that already names
// several families (the curated system stacks) must not be wrapped in quotes.
export function fontStack(family: string): string {
  const f = family.replace(/["'\\;{}]/g, '').trim()
  if (!f) return ''
  return `${f.includes(',') ? f : `'${f}'`}, 'Ubuntu Mono', ui-monospace, monospace`
}

// Allow-list rather than escape: this string builds a third-party URL, and Google
// font families are letters, digits and spaces.
export function googleHref(name: string): string {
  const f = name.trim()
  if (!/^[A-Za-z0-9 ]{1,60}$/.test(f)) return ''
  return `https://fonts.googleapis.com/css2?family=${f.replace(/ +/g, '+')}&display=swap`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && pnpm test -- settings && npx tsc --noEmit`
Expected: PASS, 14 tests. tsc silent.

- [ ] **Step 5: Stage**

```bash
git add src/settings.ts src/settings.test.ts
```

Report: "Staged pure `settings.ts` + 14 tests."

---

### Task 3: Settings store

**Files:**
- Create: `src/settingsStore.ts`
- Reference: `src/theme.ts` (the pattern being copied)

**Interfaces:**
- Consumes: everything Task 2 produces.
- Produces: `getSettings(): Settings`, `useSettings(): Settings`, `setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void`.

No unit test: every line touches `document` or `localStorage`, which the node-environment suite cannot reach. Task 13's E2E run is this module's verification.

- [ ] **Step 1: Write the implementation**

Create `src/settingsStore.ts`:

```ts
import { useSyncExternalStore } from 'react'
import { DEFAULTS, fontStack, googleHref, parse, type Settings } from './settings'

const KEY = 'megit-settings'

// DiffView persisted its split preference under its own key long before this
// dialog existed. Seeding the default from it means an upgrading user keeps the
// choice they already made; once anything is written to KEY, this stops mattering.
const seeded: Settings = { ...DEFAULTS, diffSplit: localStorage.getItem('megit-diff-split') === '1' }

let settings = parse(localStorage.getItem(KEY), seeded)
const listeners = new Set<() => void>()

// One managed <link>, created eagerly but only attached while a Google font is
// selected — same trick theme.ts uses for the highlight.js stylesheet.
const gfLink = document.createElement('link')
gfLink.rel = 'stylesheet'

const apply = () => {
  const el = document.documentElement
  el.style.zoom = String(settings.zoom)

  // googleFont wins when set: it is the family the <link> just loaded.
  const stack = fontStack(settings.googleFont || settings.fontFamily)
  if (stack) el.style.setProperty('--font-stack', stack)
  else el.style.removeProperty('--font-stack')

  const href = googleHref(settings.googleFont)
  if (href) {
    if (gfLink.href !== href) gfLink.href = href
    if (!gfLink.parentNode) document.head.appendChild(gfLink)
  } else {
    gfLink.remove()
  }
}

// At import, before React mounts: zoom and font are right on the first paint, so
// the window never reflows on load. That timing is why this is localStorage and
// not server config.
apply()

export const getSettings = () => settings

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  if (settings[key] === value) return
  settings = { ...settings, [key]: value }
  localStorage.setItem(KEY, JSON.stringify(settings))
  apply()
  listeners.forEach(l => l())
}

export const useSettings = () =>
  useSyncExternalStore(cb => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, getSettings)
```

- [ ] **Step 2: Import it once so it runs at startup**

Modify `src/main.tsx` — add the import above the existing ones so `apply()` runs before the first render:

```ts
import './settingsStore'
```

- [ ] **Step 3: Verify it typechecks and the suite still passes**

Run: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && npx tsc --noEmit && pnpm test`
Expected: tsc silent, whole suite green (239).

- [ ] **Step 4: Verify it applies nothing by default**

Run `pnpm dev`, open `http://localhost:4000`, and in the console:

```js
document.documentElement.style.zoom            // "1"
document.documentElement.style.getPropertyValue('--font-stack')  // ""
document.querySelectorAll('link[rel=stylesheet][href*=googleapis]').length  // 0
```

Expected exactly those three values — a fresh install must request nothing from Google.

- [ ] **Step 5: Stage**

```bash
git add src/settingsStore.ts src/main.tsx
```

Report: "Staged store + startup import. Verified defaults apply no zoom, no font override, no Google request."

---

### Task 4: --font-stack CSS sweep

**Files:**
- Modify: `src/styles.css` — `:root` (add), `body:66`, `.hash:241`, `.commit-hash:307`, `.file-status:322`, `.diff-html .d2h-diff-table:342`

**Interfaces:**
- Consumes: the `--font-stack` property name written by Task 3.
- Produces: a `--font-stack` default on `:root` that the store overrides inline.

Behaviour must not change in this task — it makes the default reachable by variable. The three `@font-face` blocks at lines 9, 16 and 23 stay literal: they *define* the family, and a variable there would be circular.

- [ ] **Step 1: Add the default to :root**

In the `:root` block that begins at line 32, add as the first declaration:

```css
  /* Overridden inline on <html> by settingsStore.ts when a font is chosen. */
  --font-stack: 'Ubuntu Mono', ui-monospace, monospace;
```

- [ ] **Step 2: Point the five consumers at it**

```css
/* line 66 */
  font: 16px/1.4 var(--font-stack);
/* line 241 */
.hash { color: var(--fg-faint); font-family: var(--font-stack); font-size: 12px; }
/* line 307 */
.commit-hash { position: absolute; top: 10px; right: 12px; color: var(--fg-faint); font-family: var(--font-stack); font-size: 12px; }
/* line 322 */
.file-status { font-family: var(--font-stack); width: 14px; flex-shrink: 0; }
/* line 342 */
.diff-html .d2h-diff-table { font-family: var(--font-stack); }
```

- [ ] **Step 3: Verify no literal remains outside @font-face**

Run: `grep -n "'Ubuntu Mono'" src/styles.css`
Expected: exactly four lines — 9, 16, 23 (the `@font-face` blocks) and the new `:root` default. Nothing else.

- [ ] **Step 4: Verify the app looks unchanged**

Run `pnpm dev`, open the app, confirm the graph rows, hashes and a file diff still render in Ubuntu Mono. In the console:

```js
getComputedStyle(document.body).fontFamily  // "'Ubuntu Mono', ui-monospace, monospace"
```

- [ ] **Step 5: Stage**

```bash
git add src/styles.css
```

Report: "Staged the five-site sweep. Rendering unchanged; only three `@font-face` literals plus the `:root` default remain."

---

### Task 5: Header — version moves, cog appears, dialog shell

**Files:**
- Create: `src/SettingsDialog.tsx`
- Modify: `src/TabBar.tsx:5-13` (props), `src/TabBar.tsx:52` (the `.build-tag` span), `src/App.tsx:34-79`
- Modify: `src/styles.css:80-91` (`.build-tag`, new `.tab-cog`, new `.settings-*`)

**Interfaces:**
- Consumes: `useSettings` (not yet read here), `SHORTCUTS` (not yet rendered here).
- Produces: `<Settings onClose: () => void />` default export; `TabBar` prop `onSettings: () => void`.

- [ ] **Step 1: Move the version tag in TabBar**

In `src/TabBar.tsx`, delete the `<span className="build-tag">` at line 52 and place it directly after the logo image:

```tsx
      <img src="/logo.svg" className="logo" alt="" />
      <span className="build-tag">{import.meta.env.DEV ? '[DEV]' : `v${__VERSION__}`}</span>
```

- [ ] **Step 2: Add the cog button at the tabbar's right edge**

Still in `src/TabBar.tsx`, replace the removed span's position (after the `<button className="tab-add">`) with:

```tsx
      <button className="tab-cog" onClick={onSettings} title="Settings" aria-label="Settings">
        {/* Inline SVG, not an icon package — runtime dependencies stay at ws. */}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.6.65 1.04 1.27 1.09H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
```

Add `onSettings: () => void` to the prop type and destructuring at lines 5-13.

- [ ] **Step 3: Style both**

In `src/styles.css`, replace the `.build-tag` rule at line 91 and add the cog rule:

```css
/* Sits next to the logo; the bottom margin matches .logo so both rest on the tab baseline. */
.build-tag { margin: 0 6px 6px 0; align-self: center; font-size: 11px; color: var(--fg-faint); user-select: none; }
/* margin-left:auto takes the right edge the version tag used to hold. */
.tab-cog { display: inline-flex; align-items: center; margin: 0 4px 6px auto; padding: 3px; border: none; background: none; color: var(--fg-faint); align-self: center; }
.tab-cog:hover { background: none; color: var(--fg); }
```

- [ ] **Step 4: Create the dialog shell**

Create `src/SettingsDialog.tsx`:

```tsx
import { useEffect } from 'react'

// Reuses .modal-backdrop / .modal, and DirBrowser's Escape-to-close effect.
export default function Settings({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-path"><b>Settings</b></span>
          <button onClick={onClose} aria-label="Close settings">Done</button>
        </div>
        <div className="settings-body">
          {/* Task 6 appearance, Task 10-11 behaviour, Task 12 shortcuts */}
        </div>
        <div className="settings-foot">
          megit v{__VERSION__} — by{' '}
          <a href="https://github.com/vuongvu1/megit" target="_blank" rel="noreferrer">Hoang Vuong Vu</a>
        </div>
      </div>
    </div>
  )
}
```

Add to `src/styles.css`:

```css
.modal.settings { width: 520px; display: flex; flex-direction: column; }
.settings-body { flex: 1; overflow-y: auto; padding: 4px 12px 12px; }
.settings-foot { padding: 8px 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--fg-faint); text-align: center; }
.settings-foot a { color: var(--fg-dim); }
.settings-row { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.settings-row label:first-child { flex: 1; color: var(--fg-dim); }
```

- [ ] **Step 5: Wire it into App**

In `src/App.tsx`, add the import, one state hook, the `TabBar` prop and the render:

```tsx
import Settings from './Settings'
// ...
  const [settingsOpen, setSettingsOpen] = useState(false)
// ...
      <TabBar ... onSettings={() => setSettingsOpen(true)} />
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
```

Place the `{settingsOpen && ...}` line immediately after the existing `{browsing && (...)}` block.

- [ ] **Step 6: Verify by hand**

Run `pnpm dev`. Confirm: `[DEV]` sits immediately right of the logo; the cog is at the far right of the tabbar; clicking it opens a dialog with the title, an empty body and the footer; `Escape`, the backdrop and `Done` each close it; clicking inside does not.

- [ ] **Step 7: Typecheck and stage**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && npx tsc --noEmit && pnpm test
git add src/SettingsDialog.tsx src/TabBar.tsx src/App.tsx src/styles.css
```

Report: "Staged header rearrangement + dialog shell. Version next to logo, cog on the right, three ways to close."

---

### Task 6: Appearance block — theme mirror and zoom stepper

**Files:**
- Modify: `src/SettingsDialog.tsx`
- Modify: `src/styles.css` (`.settings-group`, `.zoom-stepper`)

**Interfaces:**
- Consumes: `getTheme`/`toggleTheme` from `./theme`; `useSettings`, `setSetting` from `./settingsStore`; `ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP`, `clampZoom` from `./settings`.
- Produces: nothing new.

The toolbar `ThemeSwitch` stays where it is — one click beats two for the preference people change most. Both controls read the same `theme.ts` store, so they cannot disagree.

- [ ] **Step 1: Add the Appearance group**

In `src/SettingsDialog.tsx`, add the imports and replace the `settings-body` placeholder comment:

```tsx
import { useTheme, toggleTheme } from './theme'
import { useSettings, setSetting } from './settingsStore'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoom } from './settings'
```

```tsx
  const s = useSettings()
  const theme = useTheme()
  const zoomPct = Math.round(s.zoom * 100)
```

```tsx
          <div className="settings-group">
            <div className="modal-label">Appearance</div>
            <div className="settings-row">
              <label htmlFor="set-theme">Theme</label>
              <select id="set-theme" value={theme} onChange={e => { if (e.target.value !== theme) toggleTheme() }}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
            <div className="settings-row">
              <label>Zoom</label>
              <div className="zoom-stepper">
                <button
                  onClick={() => setSetting('zoom', clampZoom(s.zoom - ZOOM_STEP))}
                  disabled={s.zoom <= ZOOM_MIN}
                  aria-label="Decrease zoom"
                >−</button>
                {/* Clicking the readout resets: cheaper than a third button. */}
                <button className="zoom-val" onClick={() => setSetting('zoom', 1)} title="Reset to 100%">{zoomPct}%</button>
                <button
                  onClick={() => setSetting('zoom', clampZoom(s.zoom + ZOOM_STEP))}
                  disabled={s.zoom >= ZOOM_MAX}
                  aria-label="Increase zoom"
                >+</button>
              </div>
            </div>
          </div>
```

- [ ] **Step 2: Style the group and stepper**

```css
.settings-group { margin-bottom: 10px; }
.zoom-stepper { display: inline-flex; align-items: center; gap: 4px; }
.zoom-stepper button { min-width: 26px; padding: 2px 6px; }
.zoom-stepper .zoom-val { min-width: 52px; border-color: transparent; background: none; color: var(--fg-dim); }
.zoom-stepper button:disabled { opacity: .4; cursor: default; }
```

- [ ] **Step 3: Verify the range and the clamp**

Run `pnpm dev`, open Settings. Click `+` repeatedly: the readout stops at 160% and `+` disables. Click `−` down: stops at 80%, `−` disables. Click the readout: returns to 100%. Console check at 130%:

```js
document.documentElement.style.zoom            // "1.3"
JSON.parse(localStorage['megit-settings']).zoom  // 1.3  (not 1.3000000000000003)
```

- [ ] **Step 4: Verify it survives reload without a flash**

Set 140%, reload. The app must come up already at 140% with no visible jump from 100%.

- [ ] **Step 5: Verify the theme controls agree**

Toggle the theme in the dialog — the toolbar `ThemeSwitch` behind it must move too. Toggle with `⌘⇧0` while the dialog is open — the dropdown must follow.

- [ ] **Step 6: Typecheck and stage**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && npx tsc --noEmit && pnpm test
git add src/SettingsDialog.tsx src/styles.css
```

Report: "Staged theme mirror + zoom stepper. Range clamps at 80/160, readout resets, value persists un-drifted, no reload flash."

---

### Task 7: Appearance block — font family picker

**Files:**
- Modify: `src/SettingsDialog.tsx`
- Modify: `src/styles.css` (`.font-preview`)

**Interfaces:**
- Consumes: `useSettings`, `setSetting`; `fontStack` from `./settings`.
- Produces: nothing new.

- [ ] **Step 1: Add the curated list, datalist input and preview**

In `src/SettingsDialog.tsx`, add the constant above the component:

```tsx
// ui-monospace already resolves to each platform's best mono, so SF Mono, Menlo
// and Consolas would be three more rows doing the same job worse.
const FONTS = [
  { label: 'Ubuntu Mono (bundled)', value: '' },
  { label: 'System monospace', value: 'ui-monospace, monospace' },
  { label: 'System UI', value: 'system-ui, sans-serif' },
]
```

Add local state for the browse-installed list, extending the React import Task 5 created (`useEffect` only) to `import { useEffect, useState } from 'react'`:

```tsx
  const [installed, setInstalled] = useState<string[]>([])
```

Then inside the Appearance group, after the Zoom row:

```tsx
            <div className="settings-row">
              <label htmlFor="set-font">Font</label>
              <select
                id="set-font"
                value={FONTS.some(f => f.value === s.fontFamily) ? s.fontFamily : '__custom'}
                onChange={e => { if (e.target.value !== '__custom') setSetting('fontFamily', e.target.value) }}
              >
                {FONTS.map(f => <option key={f.label} value={f.value}>{f.label}</option>)}
                <option value="__custom">Custom…</option>
              </select>
            </div>
            <div className="settings-row">
              <label htmlFor="set-font-custom">Custom family</label>
              {/* Native datalist: any installed family resolves through CSS, so
                  there is no dropdown to build. */}
              <input
                id="set-font-custom"
                list="megit-fonts"
                placeholder="e.g. JetBrains Mono"
                value={FONTS.some(f => f.value === s.fontFamily) ? '' : s.fontFamily}
                onChange={e => setSetting('fontFamily', e.target.value)}
              />
              <datalist id="megit-fonts">
                {installed.map(f => <option key={f} value={f} />)}
              </datalist>
              {'queryLocalFonts' in window && (
                <button onClick={browseFonts} title="List fonts installed on this machine">Browse…</button>
              )}
            </div>
            <div className="font-preview" style={{ fontFamily: fontStack(s.googleFont || s.fontFamily) || undefined }}>
              The quick brown fox — 0O1lI {'{}'} =&gt;
            </div>
```

- [ ] **Step 2: Add the browse handler**

Above the `return`:

```tsx
  // Chromium only — Safari and Firefox declined the API over fingerprinting. Where
  // it is missing the datalist just stays empty and the input is plain free text.
  const browseFonts = async () => {
    try {
      const fonts = await (window as unknown as {
        queryLocalFonts: () => Promise<{ family: string }[]>
      }).queryLocalFonts()
      setInstalled([...new Set(fonts.map(f => f.family))].sort())
    } catch {
      // permission denied or dismissed — leave the list empty, the input still works
    }
  }
```

- [ ] **Step 3: Style the preview**

```css
.font-preview { margin: 6px 0 2px; padding: 8px; border: 1px solid var(--border); border-radius: 4px; color: var(--fg-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

- [ ] **Step 4: Verify a curated choice**

Run `pnpm dev`, open Settings, pick "System UI". Body text must switch to a sans-serif immediately, and the preview line with it. Console:

```js
document.documentElement.style.getPropertyValue('--font-stack')
// "system-ui, sans-serif, 'Ubuntu Mono', ui-monospace, monospace"
```

- [ ] **Step 5: Verify custom text and the preview-as-validation**

Type a font you have installed (e.g. `Menlo`) into Custom family — the preview changes. Type `Nonexistent Font XYZ` — the preview stays in the fallback, which is how a typo announces itself. No error UI is expected: the preview *is* the check.

- [ ] **Step 6: Verify Browse where available**

In Chrome, click "Browse…", grant the permission, reopen the Custom family input: the datalist suggests installed families. Confirm the button is absent in Safari or Firefox and the input still accepts typed names there.

- [ ] **Step 7: Typecheck and stage**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && npx tsc --noEmit && pnpm test
git add src/SettingsDialog.tsx src/styles.css
```

Report: "Staged font picker: 3 curated entries, free-text datalist, live preview, Browse gated on queryLocalFonts."

---

### Task 8: Google Fonts opt-in row

**Files:**
- Modify: `src/SettingsDialog.tsx`
- Modify: `src/styles.css` (`.settings-warn`)

**Interfaces:**
- Consumes: `setSetting('googleFont', …)`; the `<link>` handling already in `settingsStore.apply()`.
- Produces: nothing new.

This is the one part of the feature that cuts against `styles.css:1-7`, where the Google Fonts link was deliberately replaced by a self-hosted subset. Off by default and stated plainly is the agreed resolution — do not soften the warning copy.

- [ ] **Step 1: Add the row**

In `src/SettingsDialog.tsx`, after the font preview:

```tsx
            <div className="settings-row">
              <label htmlFor="set-gfont">Google font</label>
              <input
                id="set-gfont"
                placeholder="off"
                value={s.googleFont}
                onChange={e => setSetting('googleFont', e.target.value)}
              />
            </div>
            <div className="settings-warn">
              Fetches from fonts.googleapis.com — sends your IP to Google, and won’t work offline.
              Leave empty to keep everything local.
            </div>
```

- [ ] **Step 2: Style the warning**

```css
.settings-warn { margin: 2px 0 6px; font-size: 11px; line-height: 1.35; color: var(--fg-faint); }
```

- [ ] **Step 3: Verify the link is created and removed**

Run `pnpm dev`, open Settings. With the field empty:

```js
document.querySelectorAll('link[href*=googleapis]').length  // 0
```

Type `Fira Code`, then:

```js
document.querySelectorAll('link[href*=googleapis]').length  // 1
document.querySelector('link[href*=googleapis]').href
// "https://fonts.googleapis.com/css2?family=Fira+Code&display=swap"
```

Clear the field — the count returns to 0 and the app reverts to Ubuntu Mono.

- [ ] **Step 4: Verify no duplicate links accumulate**

Type `Fira Code`, clear, type `Roboto Mono`, clear, type `Fira Code` again. The count must never exceed 1 — `apply()` reuses the one managed element.

- [ ] **Step 5: Verify the allow-list rejects a hostile name**

Type `Evil"><script>` — no `<link>` appears (`googleHref` returns `''`), and the app keeps its current font rather than applying a broken stack.

- [ ] **Step 6: Typecheck and stage**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && npx tsc --noEmit && pnpm test
git add src/SettingsDialog.tsx src/styles.css
```

Report: "Staged Google Fonts opt-in. Off by default, exactly one managed <link>, hostile names rejected by the allow-list."

---

### Task 9: Terminal font follows the setting

**Files:**
- Modify: `src/TerminalPanel.tsx:56` and the effect that owns the `term` instance

**Interfaces:**
- Consumes: `getSettings` from `./settingsStore`, `fontStack` from `./settings`.
- Produces: `subscribe(cb: () => void): () => void` — added to `settingsStore.ts` in Step 3, and the primitive `useSettings` is refactored onto.

xterm's font is a JS option, so `--font-stack` does not reach it. Zoom needs no work here: the `ResizeObserver` at `TerminalPanel.tsx:108` already refits when the zoomed container's box changes.

- [ ] **Step 1: Seed the initial font from settings**

In `src/TerminalPanel.tsx`, add the imports and replace the hardcoded option at line 56:

```tsx
import { getSettings } from './settingsStore'
import { fontStack } from './settings'
```

```tsx
      fontFamily: fontStack(getSettings().googleFont || getSettings().fontFamily) || "'Ubuntu Mono', ui-monospace, monospace",
```

- [ ] **Step 2: Follow later changes**

In the same effect, after `fit.fit()` at line 63, subscribe and refit on change:

```tsx
    // A CSS variable cannot reach xterm's options, so the panel listens instead.
    // Refit after the assignment: the cell metrics change with the family.
    const offFont = subscribe(() => {
      const s = getSettings()
      const next = fontStack(s.googleFont || s.fontFamily) || "'Ubuntu Mono', ui-monospace, monospace"
      if (term.options.fontFamily === next) return
      term.options.fontFamily = next
      fit.fit()
    })
```

Then dispose it in the effect's existing cleanup block (currently `TerminalPanel.tsx:111-118`), as the first line so it stops firing before `term.dispose()`:

```tsx
    return () => {
      unmounted = true
      offFont()
      ro.disconnect()
      onData.dispose()
      onResize.dispose()
      ws.close() // detaches only — the shell keeps running server-side
      term.dispose()
    }
```

- [ ] **Step 3: Export the subscribe primitive the step above needs**

The store currently exposes only the React hook. Add to `src/settingsStore.ts`:

```ts
// TerminalPanel lives outside React's render cycle for xterm's options, so it
// needs the raw subscription the hook wraps.
export const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
```

and reuse it in `useSettings`:

```ts
export const useSettings = () => useSyncExternalStore(subscribe, getSettings)
```

Import it in `TerminalPanel.tsx` next to `getSettings`.

- [ ] **Step 4: Verify the terminal follows the font**

Run `pnpm dev`, open a repo, open the terminal with `⌘J`, run `ls -la` so there is aligned output. Open Settings, switch Font to "System UI": the terminal text changes family and stays column-aligned (no clipped or overlapping cells). Switch back.

- [ ] **Step 5: Verify the terminal follows zoom**

With the terminal open, set zoom to 140%. The terminal must scale and reflow to fill its pane, with no blank strip at the right or bottom. Resize the window at 140% and confirm it still refits.

- [ ] **Step 6: Typecheck and stage**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && npx tsc --noEmit && pnpm test
git add src/TerminalPanel.tsx src/settingsStore.ts
```

Report: "Staged xterm font subscription + `subscribe` export. Terminal follows both font and zoom, stays aligned."

---

### Task 10: Behaviour block — avatars toggle

**Files:**
- Modify: `src/avatar.ts:36-58` (`useAvatar`)
- Modify: `src/SettingsDialog.tsx`

**Interfaces:**
- Consumes: `useSettings` from `./settingsStore`.
- Produces: nothing new.

`avatar.ts:20` requests `gravatar.com` per author email plus a server-resolved GitHub photo. That is the app's only remaining outbound traffic and it is currently invisible. The initials fallback already exists downstream, so `null` is all the guard has to return.

- [ ] **Step 1: Guard the hook**

In `src/avatar.ts`, add the import and the early return inside `useAvatar`. Import the hook, not `getSettings` — flipping the toggle has to re-render the rows that show avatars:

```ts
import { useSettings } from './settingsStore'
```

```ts
export function useAvatar(repo: string, email: string | null): string | null {
  // Off means no request at all, not a hidden image: this is the only outbound
  // traffic megit makes, and initials are already the fallback downstream.
  const avatars = useSettings().avatars
  const [url, setUrl] = useState(() => (email ? cache.get(email) ?? null : null))
  useEffect(() => {
    if (!email || !avatars) return
    if (cache.has(email)) {
      setUrl(cache.get(email)!)
      return
    }
    let live = true
    let p = pending.get(email)
    if (!p) {
      p = probe(repo, email)
      pending.set(email, p)
    }
    p.then(u => {
      cache.set(email, u)
      pending.delete(email)
      if (live) setUrl(u)
    })
    return () => { live = false }
  }, [repo, email, avatars])
  return email && avatars ? url : null
}
```

Exactly four lines change: the `useSettings` import, the `avatars` read, `!avatars` in the effect's early return plus `avatars` in its dependency array, and the `return`. The body between is the existing code, unmodified.

- [ ] **Step 2: Add the Behaviour group to the dialog**

In `src/SettingsDialog.tsx`, after the Appearance group:

```tsx
          <div className="settings-group">
            <div className="modal-label">Behaviour</div>
            <div className="settings-row">
              <label htmlFor="set-avatars">Author avatars</label>
              <input
                id="set-avatars"
                type="checkbox"
                checked={s.avatars}
                onChange={e => setSetting('avatars', e.target.checked)}
              />
            </div>
            <div className="settings-warn">
              Fetches author photos from GitHub and gravatar.com. Off shows initials and makes no
              outbound requests.
            </div>
          </div>
```

- [ ] **Step 3: Verify avatars disappear and reappear live**

Run `pnpm dev`, open a repo with commits from several authors. Uncheck "Author avatars" — the photos must become initials without a reload. Re-check — they come back (from `cache`, so no new request).

- [ ] **Step 4: Verify no requests are made when off**

Reload with the setting off, open the Network tab filtered to `gravatar`, and scroll the graph. Expected: zero requests. Also filter to `/api/avatar`: zero.

- [ ] **Step 5: Typecheck and stage**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && npx tsc --noEmit && pnpm test
git add src/avatar.ts src/SettingsDialog.tsx
```

Report: "Staged avatars toggle. Off = initials, zero gravatar and zero /api/avatar requests."

---

### Task 11: Behaviour block — default diff view

**Files:**
- Modify: `src/DiffView.tsx:81` (initial state), `:182-183` (the two toggle buttons)
- Modify: `src/SettingsDialog.tsx`

**Interfaces:**
- Consumes: `useSettings`, `setSetting` from `./settingsStore`.
- Produces: nothing new.

This does not add persistence — `DiffView.tsx:81` already persists to `megit-diff-split`. It moves that key into the store (Task 3 already seeds the default from it, so no preference is lost) and makes a dialog change apply to an already-open diff instead of waiting for a remount. `megit-diff-rich` stays as it is: a per-file view mode, not a preference.

- [ ] **Step 1: Read split from the store**

In `src/DiffView.tsx`, add the import and replace the `useState` at line 81:

```tsx
import { useSettings, setSetting } from './settingsStore'
```

```tsx
  const split = useSettings().diffSplit
```

Delete the `setSplit` state entirely — the store is now the only source.

- [ ] **Step 2: Point the toggle buttons at the store**

Replace lines 182-183, dropping both `localStorage.setItem` calls:

```tsx
          <button className={split ? '' : 'active'} aria-pressed={!split} onClick={() => setSetting('diffSplit', false)}>Unified</button>
          <button className={split ? 'active' : ''} aria-pressed={split} onClick={() => setSetting('diffSplit', true)}>Split</button>
```

- [ ] **Step 3: Verify no stale reference to the old key remains**

Run: `grep -n "megit-diff-split" src/`
Expected: exactly one hit — the migration read in `src/settingsStore.ts`.

- [ ] **Step 4: Add the dialog row**

In `src/SettingsDialog.tsx`, inside the Behaviour group after the avatars warning:

```tsx
            <div className="settings-row">
              <label htmlFor="set-diff">Diff view</label>
              <select id="set-diff" value={s.diffSplit ? 'split' : 'unified'} onChange={e => setSetting('diffSplit', e.target.value === 'split')}>
                <option value="unified">Unified</option>
                <option value="split">Split</option>
              </select>
            </div>
```

- [ ] **Step 5: Verify the migration**

Clear storage, then seed the old key only and reload:

```js
localStorage.clear(); localStorage.setItem('megit-diff-split', '1'); location.reload()
```

Open Settings — Diff view must read "Split", proving the old preference carried over.

- [ ] **Step 6: Verify it is now live in both directions**

Open a file diff, leave it open, open Settings and switch Diff view: the open diff must re-render side-by-side without being reopened. Then use the diff's own Unified/Split buttons and confirm the dialog's dropdown follows.

- [ ] **Step 7: Typecheck and stage**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && npx tsc --noEmit && pnpm test
git add src/DiffView.tsx src/SettingsDialog.tsx
```

Report: "Staged diff-view setting. Old `megit-diff-split` migrated, toggle and dropdown share one source, change applies to an open diff."

---

### Task 12: Shortcuts section and handler pointer comments

**Files:**
- Modify: `src/SettingsDialog.tsx`
- Modify: `src/styles.css` (`.sc-table`)
- Modify: `src/theme.ts:30`, `src/RepoView.tsx:248`, `src/GraphView.tsx:486`, `src/TerminalPanel.tsx:82`, `src/CommitPanel.tsx:355`

**Interfaces:**
- Consumes: `SHORTCUTS`, `GROUPS`, `render` from `./shortcuts`.
- Produces: nothing new.

- [ ] **Step 1: Render the grouped table**

In `src/SettingsDialog.tsx`, add the import and the mac test above the component:

```tsx
import { GROUPS, SHORTCUTS, render } from './shortcuts'

// navigator.platform is deprecated but still the only synchronous way to tell;
// getting this wrong costs a wrong glyph in a reference table, nothing more.
const MAC = /Mac|iPhone|iPad/.test(navigator.platform)
```

Then after the Behaviour group:

```tsx
          <div className="settings-group">
            <div className="modal-label">Shortcuts</div>
            {GROUPS.map(g => (
              <div key={g} className="sc-group">
                <div className="sc-group-name">{g}</div>
                {SHORTCUTS.filter(s => s.group === g).map(s => (
                  <div key={s.keys} className="sc-row">
                    <kbd>{render(s.keys, MAC)}</kbd>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
```

- [ ] **Step 2: Style it**

```css
.sc-group { margin-bottom: 8px; }
.sc-group-name { font-size: 11px; color: var(--fg-faint); margin: 6px 0 2px; }
.sc-row { display: flex; align-items: baseline; gap: 10px; padding: 1px 0; }
.sc-row kbd { flex-shrink: 0; min-width: 78px; padding: 1px 5px; border: 1px solid var(--border); border-radius: 3px; background: var(--bg-hover); font: inherit; font-size: 12px; color: var(--fg-dim); text-align: center; }
.sc-row span { color: var(--fg-dim); font-size: 13px; }
```

- [ ] **Step 3: Add the drift-mitigation comments**

The registry is display-only, so nothing enforces agreement with the handlers. Add one line immediately above each handler — at `src/theme.ts:30`, `src/RepoView.tsx:248`, `src/GraphView.tsx:486`, `src/TerminalPanel.tsx:82`, `src/CommitPanel.tsx:355`:

```ts
// Listed in shortcuts.ts for the Settings dialog — change one, change both.
```

- [ ] **Step 4: Verify every listed shortcut actually works**

Run `pnpm dev`, open Settings, read the table, then close it and exercise all eleven entries: `↑`/`↓` in the graph, `⌘F` then `Escape`, `r`, `⌘⇧0`, `⌘J`, `⌘K`, `⌘D`, `⌘Enter` on a staged commit, `Escape` on a message edit, `Escape` on the dialog. Any entry that does not fire is a registry bug — fix the registry, not the handler.

- [ ] **Step 5: Verify the glyphs**

On macOS the modifier column must read `⌘F`, `⌘⇧0`, `⌘↵`, `Esc`, `R`. Temporarily flip `MAC` to `false` and confirm `Ctrl+F`, `Ctrl+Shift+0`, `Ctrl+Enter`, then restore it.

- [ ] **Step 6: Typecheck and stage**

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && npx tsc --noEmit && pnpm test
git add src/SettingsDialog.tsx src/styles.css src/theme.ts src/RepoView.tsx src/GraphView.tsx src/TerminalPanel.tsx src/CommitPanel.tsx
```

Report: "Staged shortcuts section + 5 pointer comments. All 11 entries verified against live handlers."

---

### Task 13: End-to-end verification and docs

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture.md`
- Modify: `README.md` (only if it lists features or shows the header in a screenshot)

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Full suite and typecheck**

Run: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && pnpm test && npx tsc --noEmit`
Expected: 217 + 22 = 239 tests passing in 21 files, tsc silent.

- [ ] **Step 2: Production build, with chunk sizes recorded**

Run: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && pnpm build`
Expected: build succeeds. Note the main chunk size and compare with `main` — the feature adds two small modules and one component and must not move the xterm chunk at all.

- [ ] **Step 3: Drive the zoom extremes with the verify skill**

Use the `verify` skill (`.claude/skills/verify/SKILL.md`), launching the server with an isolated `HOME` so `~/.config/megit/config.json` is untouched. At **80%** and at **160%**, with a file diff open and the WIP row scrolled so it is stuck to the top of the graph, confirm:

- the sticky `.row.wip` stays pinned and does not overlap the row beneath it
- the `.modal-backdrop` still covers the full viewport
- graph lane connectors still meet their commit nodes — this is the check that `zoom` kept `ROW = 28`, `.row { height }` and `contain-intrinsic-size` in agreement
- the terminal fills its pane

Screenshot both extremes.

- [ ] **Step 4: Confirm the privacy default from a clean profile**

With a fresh browser profile, load the app and check the Network tab, unfiltered:

```
requests to fonts.googleapis.com   → 0
requests to fonts.gstatic.com      → 0
```

Then set a Google font, reload, confirm the requests appear; clear it, reload, confirm they are gone again.

- [ ] **Step 5: Confirm settings survive a restart**

Set a non-default value in every field (custom font, 120%, avatars off, split diff, light theme). Stop the server, restart it, reload. All five must persist, and the first paint must already show them.

- [ ] **Step 6: Add the CHANGELOG entry**

Under a new version heading, one bullet per user-visible change, 1-3 lines each, naming the change and — only where it is not obvious — why. No design rationale; that lives in the spec.

```markdown
### Added
- Settings dialog behind a cog in the header: font family, app zoom, a shortcut
  reference, and toggles for author avatars and the default diff view.
- Optional Google Fonts family. Off by default — enabling it fetches from
  fonts.googleapis.com, so the self-hosted default stays the privacy-preserving one.

### Changed
- The version tag moved from the right of the tabbar to beside the logo.
- Author avatars can now be turned off, which stops all outbound requests.
```

- [ ] **Step 7: Update the architecture doc**

In `docs/architecture.md`, add `settings.ts` (pure: parsing, clamping, CSS and URL builders) and `settingsStore.ts` (localStorage + `document.documentElement`, applied at import so first paint is correct) alongside the existing `theme.ts` description, and add `shortcuts.ts` to the list of pure DOM-free modules. Note that app text scaling is `:root { zoom }` specifically so `GraphView`'s `ROW = 28` and the two CSS row-height sites need no coordination.

- [ ] **Step 8: Check the README**

Run: `grep -n "version\|shortcut\|font" README.md`

If the README lists features or its header screenshot shows the version tag at the right, update the text and note that the screenshot needs regenerating via `scripts/make-test-repo.sh`.

- [ ] **Step 9: Remove Playwright artifacts and stage**

```bash
node -e "require('fs').rmSync('.playwright-mcp',{recursive:true,force:true})"
git add CHANGELOG.md docs/architecture.md README.md
git status --short
```

Report the test count, the build chunk sizes against `main`, the two zoom screenshots, and the clean-profile network result. Confirm `.playwright-mcp/` is not staged.

---

## Notes for the executor

- **Nothing here needs `GraphView.tsx` or `lanes.ts` to change.** If a task seems to require touching lane geometry, stop — that means `zoom` is not behaving as the spec assumes, which is a design question, not an implementation one.
- **`pnpm test` counts should only ever go up.** Tasks 1 and 2 add 22 tests; no existing test should change. If one breaks, the cause is Task 11's `DiffView` edit or Task 10's `avatar.ts` edit, not the store.
- **The server is untouched.** No route, no `repoGuard`, no config-file change. If you find yourself editing `server/`, re-read the spec.
