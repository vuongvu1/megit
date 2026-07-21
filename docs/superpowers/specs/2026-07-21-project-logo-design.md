# megit project logo — design

Date: 2026-07-21
Status: approved (concept A, chosen via visual companion)

## Goal

Give megit a visual identity: a logo mark used as the browser favicon, in the app's TabBar, and in the README header.

## The mark

Concept A — "graph-lane m": the letter **m** drawn as git branch lanes. Two
arches (left arch blue `#61afef`, right arch purple `#c678dd`, stroke width 6,
round caps) ending in three commit dots (blue `#61afef`, green `#98c379`,
purple `#c678dd`, radius 6). ViewBox `0 0 64 64`. Colors come from the app's
existing GraphView lane palette (one-dark), so the mark matches the UI.

One colorway for all contexts. The mid-saturation lane colors are readable on
both the dark (`#1e2228`) and light (`#f6f8fa`) themes — no per-theme variants,
no embedded media queries.

Reference geometry (from the approved mockup):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M12 50 V28 C12 15 32 15 32 28" stroke="#61afef" stroke-width="6" fill="none" stroke-linecap="round"/>
  <path d="M32 28 V50 M32 28 C32 15 52 15 52 28 V50" stroke="#c678dd" stroke-width="6" fill="none" stroke-linecap="round"/>
  <circle cx="12" cy="50" r="6" fill="#61afef"/>
  <circle cx="32" cy="50" r="6" fill="#98c379"/>
  <circle cx="52" cy="50" r="6" fill="#c678dd"/>
</svg>
```

## Placement

1. **Asset**: `public/logo.svg` (new file, new `public/` dir). Vite serves
   `public/` at the site root in dev and copies it into `dist/` on build.
   Single source of truth — every placement references this one file.
2. **Favicon**: in `index.html` `<head>`:
   `<link rel="icon" type="image/svg+xml" href="/logo.svg" />`.
   SVG favicons work in current Chrome/Firefox/Edge; no `.ico` fallback
   (personal tool).
3. **TabBar**: `<img src="/logo.svg" className="logo" alt="" />` at the left
   end of the tab strip in `src/TabBar.tsx`, before the repo tabs. Sized
   ~18px via a `.logo` rule in `src/styles.css` (vertically centered,
   small horizontal padding, non-interactive).
4. **README**: header becomes
   `# <img src="public/logo.svg" width="28"/> megit` so GitHub renders the
   mark next to the title (relative path resolves in the repo).

## Out of scope

- PNG/ICO fallbacks, apple-touch-icon, PWA manifest icons
- Wordmark/typography treatment beyond the plain README title
- Per-theme logo variants

## Error handling

None needed — static asset. If the image fails to load, the empty `alt`
keeps the TabBar clean.

## Testing

No unit tests (static asset, no logic). Verification via the project's
`/verify` skill: build + launch, confirm favicon appears in the browser tab
and the logo renders in the TabBar in both dark and light themes.

## Scope summary

- New: `public/logo.svg`
- Edit: `index.html`, `src/TabBar.tsx`, `src/styles.css`, `README.md`
- No new dependencies
