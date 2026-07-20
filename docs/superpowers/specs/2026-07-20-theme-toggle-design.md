# Theme toggle (light/dark) — design

Date: 2026-07-20
Status: approved (chat)

## Goal

App-wide light theme alongside the existing dark theme. Toggle button in the
repo toolbar next to Refresh. Choice persists in `localStorage['megit-theme']`.
Default: dark (no system-preference detection).

## Approach

CSS variables + `data-theme` attribute on `<html>`. Rejected: two swapped
stylesheets (duplicates everything), React context (ceremony for one boolean).

## Pieces

### `src/theme.ts` (new, ~25 lines)

Single source of truth:

- `getTheme(): 'dark' | 'light'` — reads module state, initialized from
  localStorage, falls back to `'dark'`.
- `toggleTheme()` — flips, persists, applies, notifies subscribers.
- `useTheme()` — React hook via `useSyncExternalStore`.
- Applying = set `document.documentElement.dataset.theme` and swap
  highlight.js CSS. Both `highlight.js/styles/github.css` and
  `github-dark.css` are imported as `?raw` strings and written into one
  managed `<style>` element — they collide on the same `.hljs-*` classes if
  both are imported normally.
- Module side effect on load: apply initial theme. The static
  `import 'highlight.js/styles/github-dark.css'` in DiffView is removed.

### `src/styles.css`

Extract the recurring dark colors into `:root` variables; add one
`[data-theme="light"]` override block:

| Variable        | Dark      | Light     | Used for                          |
|-----------------|-----------|-----------|-----------------------------------|
| `--bg`          | `#1e2228` | `#f6f8fa` | body                              |
| `--bg-panel`    | `#23272e` | `#ffffff` | repoview, modal, diff-overlay     |
| `--bg-tabbar`   | `#14171c` | `#e4e7eb` | tab bar strip                     |
| `--bg-tab`      | `#1a1e24` | `#eef0f3` | inactive tab                      |
| `--bg-hover`    | `#2c313a` | `#e8eaed` | buttons, row/tab hover, active tab|
| `--bg-selected` | `#354254` | `#cfdff5` | selected row / file               |
| `--bg-wip`      | `#2a2e25` | `#f3f5e8` | sticky WIP row                    |
| `--border`      | `#3a404b` | `#d0d7de` | borders, splitter, button hover   |
| `--fg`          | `#d4d8de` | `#1f2328` | body text, ref chips              |
| `--fg-dim`      | `#9aa4b2` | `#57606a` | secondary text                    |
| `--fg-faint`    | `#6b7280` | `#8b949e` | hash, empty state                 |

Unchanged (work on both themes): error red `#e06c75`, splitter accent
`#5a80b0`, modal backdrop, graph lane colors in GraphView.

diff2html: keep `--d2h-dark-bg-color: #23272e`; add
`--d2h-bg-color: var(--bg-panel)` so the light diff matches panels.

### RepoView toolbar

Button next to Refresh: shows `☀` in dark / `🌙` in light, calls
`toggleTheme()`. Uses `useTheme()` for re-render.

### DiffView

`useTheme()`; `colorScheme: theme === 'dark' ? DARK : LIGHT` in the
Diff2HtmlUI config; theme in the redraw effect deps.

## Testing

Existing unit tests untouched (theme.ts touches `document` at module load —
no jsdom in test setup, so no unit test; E2E is the check). Playwright:
toggle → computed body bg/fg change, diff2html wrapper class flips,
localStorage persists across reload.
