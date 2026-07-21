# <img src="public/logo.svg" width="28"/> megit

Read-only git repository viewer in the browser: commit graph with branch lanes, tabs for multiple repos, and diffs (unified or side-by-side) — including your uncommitted WIP.

## Requirements

- Node ≥ 24 (runs TypeScript directly via native type-stripping)
- pnpm

## Run

```bash
pnpm install
pnpm dev        # Express API on :3411 + Vite dev server on :5173
```

Production:

```bash
pnpm build      # vite → dist/
pnpm start      # serves dist/ + API on http://127.0.0.1:3411
```

## Usage

Open the app, hit “+” in the tab bar, browse to a local git repository, Open. Each repo lives in its own tab.

- Commit graph with lanes, incremental “Load more” paging
- Sticky WIP row on top — staged, unstaged, and untracked changes
- Click a commit → changed files → per-file diff; merge commits diff against the first parent
- Unified ⇄ side-by-side toggle, `r` or ⟳ to refresh
- Auto-refresh — the server watches each open repo (`fs.watch` + SSE); the graph and WIP row update within ~1 s of any change. Manual refresh (`r`) still works.

Repo list persists in `~/.config/megit/config.json`.

## Development

```bash
pnpm test           # vitest (parsers, lane layout)
npx tsc --noEmit    # typecheck
```
