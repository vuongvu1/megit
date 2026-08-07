# SVG rich/source diff toggle

Date: 2026-08-07

## Problem

`DiffView` decides how to show a file from its extension and gives the user no say. `IMAGE_RE`
(`src/DiffView.tsx:61`) matches `png|jpe?g|gif|webp|svg|avif|ico|bmp` and renders every match as two
`<img>` panes, before and after.

SVG is text. Rendering it as a picture hides the diff that matters: a changed `viewBox`, a renamed
`id`, a `stroke-width` tweak below visual threshold, a swapped path with identical output. The source
is unreachable — there is no control anywhere in the UI to get at it.

GitHub solves this with a per-file toggle between the rich diff and the source diff. This adopts the
same idea, narrowed to the one file type in megit where rendering is lossy.

## Scope

Only `.svg` gets a toggle.

Raster images (`png`, `jpg`, `gif`, `webp`, `avif`, `ico`, `bmp`) are excluded: their source diff is
`Binary files a/x.png and b/x.png differ`, a dead end. A control that leads nowhere is worse than no
control.

Explicitly out of scope:

- Markdown, CSV/TSV, notebooks, geojson, PDF rich views. Markdown is the obvious next candidate and
  needs a renderer dependency in a lazy chunk (xterm.js precedent); nothing here blocks it.
- Source mode for raster images.
- Per-repo or per-file persistence.

## Behaviour

Default is Rendered. The choice is sticky across files and reloads, stored in
`localStorage['megit-diff-rich']` (`'0'` = source), matching the `megit-diff-split` key already read
at `src/DiffView.tsx:82`.

Toolbar contents by state:

| file | mode | body | Rendered\|Source | Unified\|Split |
| --- | --- | --- | --- | --- |
| `icon.svg` | rendered | image panes | shown | hidden |
| `icon.svg` | source | diff2html | shown | shown |
| `logo.png` | — | image panes | hidden | hidden |
| `a.ts` | — | diff2html | hidden | shown |

Unified\|Split is hidden in rendered mode because there is nothing to split. Non-SVG images get no
toolbar at all, preserving today's appearance.

## Design

### Pure decision module

New `src/diffMode.ts`, with `src/diffMode.test.ts` asserting the table above:

```ts
export type DiffMode = { body: 'image' | 'text'; richToggle: boolean; splitToggle: boolean }
export function diffMode(file: string, rich: boolean): DiffMode
```

The branching lives in a DOM-free module and `DiffView` renders its answer. This follows the existing
split in the codebase — `lanes.ts`, `toolbar.ts`, `wip.ts`, `diffExpand.ts` hold the rules and carry
the test suite, the components stay renderers.

### `DiffView.tsx`

Three changes.

**Fetch guard.** `if (isImage) return` at `src/DiffView.tsx:91` becomes `if (isImage && !isSvg)
return`. SVG fetches its patch in both modes, so toggling is instant and needs no refetch and no new
effect dependencies. Measured: toggling costs zero extra `/api/diff` requests.

The cost is one extra `git diff` on a single small file per SVG viewed **plus one per `wipTick`** —
the watcher-driven silent reload fires for any `!hash` diff regardless of mode. Each response is a
new `resp`, so the `gapList` memo must be gated on `mode.body === 'text'`; otherwise `parse()` and
`gaps()` run over the whole patch on every tick to produce a gap list that a rendered body can never
use (`decorate()` is unreachable while `ref.current` is null).

**Draw effect dependencies.** `rich` joins the dependency array at `src/DiffView.tsx:158`. This is
load-bearing: switching to source mounts a fresh `.diff-html` div, and the effect's `if (!el) return`
guard means an effect that does not re-fire leaves the pane blank. None of the current dependencies
(`text`, `gapList`, `split`, `plain`, `theme`) change when `rich` flips.

**Render structure.** The toolbar moves above the body and renders once; the body becomes a switch.
This removes the early returns for `isImage` (line 160), `error` (175), `!resp` (176) and
`tooLarge` (177). Side effect worth having: an SVG over `DIFF_CAP` currently returns before the
toolbar exists, which would strand the user in source mode with no way back. With the toolbar
hoisted, the toggle survives every body state.

The restructure is not free, and this is the part that is easy to get wrong. Collapsing four early
returns into one child slot means every body branch is a keyless child at the same index, and React
matches those by index and element type — so `.diff-html` and `.image-diff` would reuse a single host
DOM node. diff2html writes into that node imperatively (`innerHTML`), which React does not own and
will not clear, so a stale diff table lingers under the image panes. The old early returns were
accidentally immune: each produced a different tree root, so the `.diff-html` node was itself a
React-owned child being deleted, and the imperative DOM went with it. **Every body branch therefore
carries a `key`**, which forces a remount instead of a reuse. Do not "simplify" the keys away, and do
not substitute an effect cleanup that clears `el.innerHTML` — passive cleanup runs after the mutation
phase and would delete the freshly inserted image panes instead.

One consequence: a keyed remount means the draw effect runs against an empty `.diff-html`, so the
`lastDir` scroll hint from a gap expansion must be consumed **on every run of the effect, before its
`if (!el || …) return` guard** — not after the `scrollTop` assignment, which the guard skips. The
first expand on any file awaits a full-context fetch before `setModel`, so a toggle during that
flight re-runs the effect with a null ref; a hint left set there survives to the next mount and
offsets an empty pane to its bottom.

```tsx
return (
  <div className="diffview">
    {(mode.richToggle || mode.splitToggle) && <div className="diff-toolbar">…</div>}
    {body()}
  </div>
)
```

### CSS

`gap: 8px` added to `.diff-toolbar` (`src/styles.css:295`), so the two segmented groups do not touch.
Both groups reuse `.view-toggle` unchanged — no new styles, no new icons.

## Non-goals confirmed

- No new dependency. Runtime `dependencies` stays express + ws; no new devDependency, no lazy chunk,
  no measurable bundle change.
- No server change. `/api/diff` and `/api/blob` already serve both shapes: `/api/diff` the patch,
  `/api/blob?which=old|new` the two sides for the image panes.

## Testing

`src/diffMode.test.ts` covers the four rows of the behaviour table. That is the branchy logic; the
rest is markup.

Manual check via the `verify` skill, against `test-repo/`. `scripts/make-test-repo.sh` grows an
`assets/star.svg` carrying exactly the edits this feature exists for:

- commit `add star sprite` — the file arrives
- commit `add a second star, tune the core` — an `id` rename and a one-digit `fill` change, both
  invisible in the picture, alongside one second star that is visible
- an unstaged worktree edit adding `role="img"` and a `<title>` — zero rendered pixels change

Confirm the toggle appears on that file, source mode shows a real patch with working Unified/Split,
the choice survives a file switch and a reload, and a raster image still shows image panes with no
toolbar. The fixture has no raster, so use megit's own repo (`docs/*.png`) for that last check.
