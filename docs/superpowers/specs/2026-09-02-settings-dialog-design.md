# Settings dialog

**Date:** 2026-09-02
**Status:** shipped, with two sections cut during review — see *Cut before shipping*

## Problem

megit has no settings surface. Preferences that exist are hidden: the theme is a
switch in the repo toolbar plus an undocumented `⌘⇧0`, and the nine other
shortcuts are discoverable only by reading source. Font and text size are not
adjustable at all — a 16px base and a 28px row height suit the author's display
and nobody else's.

Three things go in one dialog: fonts (family and size), the shortcut reference,
and the handful of preferences already worth persisting.

## Cut before shipping

Two things this document specifies at length were removed before the feature shipped, on
the maintainer's call after using it: the **free-text custom font family** (with its
`queryLocalFonts` "Browse installed…" enhancement) and the **Google Fonts field**. The font
setting is now exactly the three curated entries.

The reasoning below for both is left intact rather than deleted, because it is still the
answer if either is ever reconsidered — but neither should be re-added as though its absence
were an oversight. Cutting them also removed the entire validation apparatus they needed:
the live preview line existed to validate typed names, `googleHref`'s allow-list existed to
build a third-party URL safely, and the rejected-name hint existed to explain that
allow-list. With no free text there is nothing to validate, and with no Google request the
privacy trade this document weighs at length simply does not arise — megit is back to making
no font requests at all, in any configuration.

The theme control also became the existing `ThemeSwitch` component rather than a select, so
the dialog and the toolbar are now literally the same control bound to the same store.

Zoom changed shape too. This document specifies a `− 110% +` stepper over 80–160% in 10%
steps; what shipped is four presets (80/100/120/140%) as a segmented control, each button
labelled with "aA" set at the size it applies. `ZOOM_MIN`/`ZOOM_MAX` survive as the clamp
`parse` applies to stored values, so a 1.6 written by an earlier build still loads — it just
lights the nearest button rather than reproducing itself exactly. The mechanism the rest of
this document describes (`:root { zoom }`, and why it beats a rem sweep) is unchanged.

## Header

The version tag moves from the right end of the tabbar to just after the logo,
and a cog button takes the right edge.

- `.build-tag` (`styles.css:91`) loses `margin-left: auto`, keeps its `6px`
  bottom margin so it sits on the tab baseline like `.logo`. Content is
  unchanged: `import.meta.env.DEV ? '[DEV]' : \`v${__VERSION__}\``.
- `.tab-cog` gets `margin-left: auto`, an inline 14px SVG, `--fg-faint` →
  `--fg` on hover, `title="Settings"` and `aria-label`. Inline SVG rather than
  an icon package: runtime dependencies stay at `ws`.
- `TabBar` gains one prop, `onSettings`. `App` owns `settingsOpen` and renders
  `<Settings onClose />` in the same slot as `DirBrowser`.

## Settings store

`src/settings.ts`, new. Generalises the `theme.ts` pattern — module-level state,
`useSyncExternalStore`, an `apply()` that writes to `document.documentElement`.

```ts
export type Settings = {
  fontFamily: string   // '' = bundled default
  googleFont: string   // '' = off
  zoom: number         // 0.8–1.6
  avatars: boolean
  diffSplit: boolean
}
```

One `megit-settings` localStorage key holding JSON. Parsing is guarded: a corrupt
value falls back to defaults rather than white-screening the app, and a partial
stored object is merged over defaults so adding a field later doesn't invalidate
anyone's saved settings.

`apply()` runs at module import, before React mounts — the same timing as
`theme.ts` — so zoom and font are correct on first paint and the window never
reflows on load. That timing is the reason this is localStorage and not
server-side config: a `fetch` before first paint would put a visible reflow on
every load, and the only thing server-side persistence buys is sharing settings
between browsers, which is not how megit is used.

`apply()` writes:

- `style.zoom = String(zoom)`
- `style.setProperty('--font-stack', ...)` — the chosen family followed by
  `'Ubuntu Mono', ui-monospace, monospace`, or removed entirely when default
- a managed `<link rel="stylesheet">` in `<head>` when `googleFont` is set,
  removed when it is cleared (the managed-element pattern from `theme.ts:12`)

`theme.ts` stays as it is. It owns the highlight.js stylesheet swap, a concern
nothing else in settings shares, and folding it in would mean migrating the
`megit-theme` key for no user-visible gain. The dialog imports both stores.

## Font size: CSS zoom

`:root { zoom: N }`, 80%–160% in 10% steps, set as an inline style by `apply()`.

`styles.css` has 31 hardcoded px font-sizes and zero rem, and the graph row
height is duplicated across three sites — `GraphView.tsx:13` (`ROW = 28`, which
drives the SVG lane geometry), `.row { height: 28px }` (`:208`), and
`contain-intrinsic-size: auto 28px` (`:188`). Zoom scales CSS pixels, so all
three stay consistent with each other for free and neither the stylesheet nor
`GraphView` is touched.

The alternatives were a rem refactor of all 31 sizes plus the three row-height
sites — a large sweep with likely visual regressions — and a text-only
multiplier, which caps out around 15px because text clips a fixed 28px row.
Zoom also matches what users already expect from `⌘+`.

Two couplings that zoom creates:

1. `TerminalPanel.tsx:56` sets xterm's `fontFamily` in JS, where a CSS variable
   doesn't reach. The panel subscribes to the store, assigns
   `term.options.fontFamily`, then refits. Zoom needs no work — the
   `ResizeObserver` at `TerminalPanel.tsx:108` already refits when the zoomed
   container's box changes.
2. The sticky `.row.wip` (`:210`) and the fixed `.modal-backdrop` (`:93`).
   Modern `zoom` is layout-correct and inherits, so both should scale cleanly;
   "should" is not verified, so E2E drives 80% and 160% with a diff open and the
   WIP row pinned.

No keyboard shortcut for zoom. `⌘+` / `⌘-` belong to the browser and fighting
them is worse than not having it.

## Font family

Three curated entries plus free text:

| Label | Value |
|---|---|
| Ubuntu Mono (bundled) | `''` — self-hosted, works offline |
| System monospace | `ui-monospace, monospace` |
| System UI | `system-ui, sans-serif` |

`ui-monospace` already resolves to each platform's best mono, so listing SF Mono,
Menlo and Consolas separately would be three more rows doing the same job worse.

Free text is an `<input list="megit-fonts">` — a native datalist, so no custom
dropdown code. Any installed family name works, because CSS `font-family`
resolves against the OS.

**Validation is a live preview line, not a detection routine.** A sample
rendered in the chosen family shows immediately whether it took effect. The
canvas width-measure trick works but needs a real canvas, so vitest can't cover
it, and it only reports what the preview already shows. Add it if the preview
proves too subtle in practice.

Where `'queryLocalFonts' in window` (Chromium), a "Browse installed…" button
fills the datalist with deduped, sorted `f.family` values — roughly 15 lines.
Safari and Firefox declined to implement the API, so there the datalist stays
empty and the input is plain free text. One code path, no dead end.

The family setting needs one mechanical CSS sweep: the five
`'Ubuntu Mono', ui-monospace, monospace` literals — `body:66`, `.hash:241`,
`.commit-hash:307`, `.file-status:322`, `.d2h-diff-table:342` — become `var(--font-stack)`, with the default declared on `:root`. The three
`@font-face` blocks stay literal — they define the family.

## Google Fonts

`googleFont`, default `''`, in its own collapsed row, with the cost stated
inline: *"Fetches from fonts.googleapis.com — sends your IP to Google, and won't
work offline."*

This is the one part of the feature that cuts against a decision already
documented in `styles.css:1-7`, where the Google Fonts stylesheet link was
deliberately replaced with a 36 KB self-hosted latin subset precisely because a
link handed the user's IP and User-Agent to a third party on every page load.
Keeping it opt-in and off by default preserves that guarantee for everyone who
doesn't ask for it, while unblocking users who want a font they don't have
installed.

## Extras

Both are one line of wiring each, and both surface behaviour that already
exists but isn't controllable.

- **`avatars`** — `avatar.ts:20` requests `gravatar.com` per author email, plus
  a server-resolved GitHub profile photo. That is the only remaining outbound
  traffic in the app and it is currently invisible to the user. Off makes
  `avatar.ts` return `null`, and the initials fallback downstream is already
  implemented. It also cuts network on large repos.
- **`diffSplit`** — the unified/split toggle already persists, in its own
  `megit-diff-split` localStorage key (`DiffView.tsx:81`). This setting surfaces
  it rather than adding persistence: the key folds into `settings.ts` (reading
  the old key once as the initial value so nobody's preference is lost), and
  `DiffView`'s two toggle buttons write through the store. That also makes a
  change in the dialog apply to an already-open diff instead of waiting for a
  remount. `megit-diff-rich` stays where it is — it is a per-file view mode, not
  a preference.

Deliberately excluded: graph page size (perf-critical, measured at 200, not a
user knob), date format, and an auto-refresh toggle.

## Shortcuts

`src/shortcuts.ts`, pure and DOM-free, joining the tested-module set:

```ts
export type Shortcut = { keys: string; label: string; group: string }
export const SHORTCUTS: Shortcut[]
export const render = (keys: string, mac: boolean) => string  // 'Mod+F' → '⌘F' | 'Ctrl+F'
```

| Group | Keys | Action |
|---|---|---|
| Graph | `↑` `↓` | Select previous / next row |
| View | `Mod+Shift+0` | Toggle light/dark |
| View | `r` | Refresh (outside inputs) |
| Search | `Mod+F` / `Esc` | Open search / close |
| Terminal | `Mod+J` / `Mod+K` / `Mod+D` | Toggle / clear / split |
| Commit | `Mod+Enter` / `Esc` | Commit or save message / cancel edit |
| Dialogs | `Esc` | Close |

Display-only. The six handlers keep their inline `e.code` checks at
`theme.ts:31`, `RepoView.tsx:249-260`, `GraphView.tsx:489`,
`TerminalPanel.tsx:87,95` and `CommitPanel.tsx:356-386`.

Rebinding was considered and rejected for this change. It needs a capture UI,
conflict detection, persisted overrides, and a runtime matcher replacing every
inline check — including inside `TerminalPanel`'s `⌘`-passthrough filter, which
decides what reaches the shell. That roughly triples the feature.

The consequence is drift risk: the registry can fall out of step with the
handlers. The accepted mitigation is a one-line comment at each handler site
pointing at `shortcuts.ts` — not a matcher indirection that every keypress in
the app has to route through.

## Dialog

`src/SettingsDialog.tsx` (not `Settings.tsx` — this filesystem is
case-insensitive, so `./Settings` would resolve to the pure `settings.ts`), reusing `.modal-backdrop` / `.modal` and the three-line
Esc-to-close effect from `DirBrowser.tsx:28`. Four blocks:

1. **Appearance** — theme (bound to the same `theme.ts` store as the existing
   toolbar switch, so the two never disagree), zoom stepper (`− 110% +`, click
   the readout to reset to 100%), font dropdown, datalist input, preview line,
   Google Fonts row
2. **Behaviour** — avatars, default diff view
3. **Shortcuts** — `SHORTCUTS` grouped, `render()` choosing symbols from
   `navigator.platform`
4. **Footer** — `megit v0.9.0 — by Hoang Vuong Vu`, the name linking to the
   repo. The version interpolates `__VERSION__` (already a Vite `define`); the
   author name is a literal in the component, since a second `__AUTHOR__`
   define to avoid typing three words isn't worth the build config.

The toolbar `ThemeSwitch` stays where it is. One click beats two for the
preference people change most.

## Testing

- `shortcuts.test.ts` — `render()` on both platforms; no duplicate keys within
  a group
- `settings.test.ts` — zoom clamping, corrupt-JSON fallback, partial stored
  object merged over defaults
- E2E via the `verify` skill: zoom at 80% and 160% with a diff open and the WIP
  row stuck; a font change reaching xterm; Google opt-in injecting exactly one
  `<link>` and removing it on clear; avatars off producing zero `gravatar.com`
  requests in the network panel

## Cost

No new dependency. `queryLocalFonts` is native, the datalist is native, the
Google `<link>` exists only when opted in. Two new modules (`settings.ts`,
`shortcuts.ts`) and one new component, against a mechanical five-site CSS
sweep. `GraphView`, `lanes.ts` and the server are untouched.
