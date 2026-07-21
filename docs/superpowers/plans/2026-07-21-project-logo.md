# megit Project Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved "graph-lane m" logo as favicon, TabBar mark, and README header image.

**Architecture:** One static SVG at `public/logo.svg` is the single source of truth. Vite serves `public/` at the site root in dev and copies it into `dist/` on build, so `index.html` (favicon), `TabBar.tsx` (`<img>`), and `README.md` all reference the same file. No logic, no new dependencies.

**Tech Stack:** SVG, Vite static assets, React, plain CSS.

Spec: `docs/superpowers/specs/2026-07-21-project-logo-design.md`

## Global Constraints

- Prefix EVERY Bash call with `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && ` — system node 22 cannot strip TypeScript.
- Do NOT run `git add` / `git commit` / `rm` — permission-denied for agents in this repo. At each commit step, print the exact commands and pause; the user commits manually.
- No new dependencies. No unit tests for static assets (spec: Testing) — per-task verification is `pnpm build` + `pnpm test` (existing lanes tests must stay green); end-to-end visual check happens once at the end via the project `/verify` skill.
- Logo colors are fixed by the spec: blue `#61afef`, green `#98c379`, purple `#c678dd`. One colorway, no theme variants.

---

### Task 1: Logo asset + favicon

**Files:**
- Create: `public/logo.svg` (new `public/` directory at repo root)
- Modify: `index.html` (head, after the `<meta name="viewport">` line)

**Interfaces:**
- Consumes: nothing
- Produces: `/logo.svg` served at the site root — Tasks 2 and 3 reference this exact path/file.

- [ ] **Step 1: Create `public/logo.svg`**

Exact content (geometry approved in spec — do not restyle):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M12 50 V28 C12 15 32 15 32 28" stroke="#61afef" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M32 28 V50 M32 28 C32 15 52 15 52 28 V50" stroke="#c678dd" stroke-width="6" fill="none" stroke-linecap="round"/>
  <circle cx="12" cy="50" r="6" fill="#61afef"/>
  <circle cx="32" cy="50" r="6" fill="#98c379"/>
  <circle cx="52" cy="50" r="6" fill="#c678dd"/>
</svg>
```

- [ ] **Step 2: Add favicon link to `index.html`**

Current head:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>megit</title>
  </head>
```

Becomes:

```html
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <title>megit</title>
  </head>
```

- [ ] **Step 3: Verify build picks up the asset**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && pnpm build && ls dist/logo.svg && grep -c 'rel="icon"' dist/index.html
```
Expected: build succeeds, `dist/logo.svg` listed, grep prints `1`.

- [ ] **Step 4: Commit (user runs)**

Print for the user and pause:
```bash
git add public/logo.svg index.html
git commit -m "feat: add logo asset and SVG favicon"
```

---

### Task 2: TabBar logo

**Files:**
- Modify: `src/TabBar.tsx:16-17` (insert `<img>` as first child of `.tabbar`)
- Modify: `src/styles.css:41` (add `.logo` rule after the `.tabbar` rule)

**Interfaces:**
- Consumes: `/logo.svg` from Task 1.
- Produces: nothing later tasks use.

- [ ] **Step 1: Add logo image to `src/TabBar.tsx`**

Current:

```tsx
  return (
    <div className="tabbar">
      {repos.map((r, i) => (
```

Becomes:

```tsx
  return (
    <div className="tabbar">
      <img src="/logo.svg" className="logo" alt="" />
      {repos.map((r, i) => (
```

- [ ] **Step 2: Add `.logo` rule to `src/styles.css`**

After line 41 (`.tabbar { ... }`), insert:

```css
.logo { width: 18px; height: 18px; align-self: center; margin: 0 4px 6px 2px; pointer-events: none; }
```

(`margin-bottom: 6px` compensates the tabbar's `padding: 6px 6px 0` so the mark centers on the tab row; `pointer-events: none` keeps it inert next to draggable tabs.)

- [ ] **Step 3: Verify build + tests stay green**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH" && pnpm build && pnpm test
```
Expected: build succeeds; all existing vitest tests pass (38 at last count).

- [ ] **Step 4: Commit (user runs)**

Print for the user and pause:
```bash
git add src/TabBar.tsx src/styles.css
git commit -m "feat: show logo in TabBar"
```

---

### Task 3: README header

**Files:**
- Modify: `README.md:1`

**Interfaces:**
- Consumes: `public/logo.svg` from Task 1 (relative repo path).
- Produces: nothing.

- [ ] **Step 1: Replace the title line**

Current line 1:

```markdown
# megit
```

Becomes:

```markdown
# <img src="public/logo.svg" width="28"/> megit
```

- [ ] **Step 2: Verify**

Run:
```bash
head -1 README.md
```
Expected: `# <img src="public/logo.svg" width="28"/> megit`

- [ ] **Step 3: Commit (user runs)**

Print for the user and pause:
```bash
git add README.md
git commit -m "docs: add logo to README header"
```

---

### Final verification (after Task 3)

Run the project `/verify` skill: build + launch megit, confirm the favicon shows in the browser tab and the logo renders at the left of the TabBar in both dark and light themes (theme toggle in UI). No code changes expected from this step.
