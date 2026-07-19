# megit — Design

**Date:** 2026-07-18
**Status:** Approved

## Overview

A minimal, read-only GitKraken-style git viewer for personal use. Three features, nothing else:

1. **Git graph** — commit graph across all refs, GitKraken-style lanes
2. **Project tabs** — multiple repos open at once, switch via tabs
3. **File changes view** — diffs for any commit, plus uncommitted working-tree changes

All mutations (commit, push, checkout, staging) stay in the terminal. The app never writes to a repository.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Interaction scope | Read-only viewer |
| Platform | Local web app: Node server + browser UI |
| Changes view | Both commit diffs and working-tree (WIP row) |
| Adding repos | Server-side directory browser in UI |
| Graph scope | All refs (local + remote + tags), paged 500 commits |
| Frontend | React + Vite |
| Refresh | Manual (button + `r` hotkey) |
| Diff rendering | Syntax highlighting + unified/side-by-side toggle, via diff2html |

## Architecture

```
megit/
├── server/     Node 24 + TypeScript + Express, shells out to `git` CLI
├── src/        React + Vite frontend
└── package.json   single package, pnpm, no monorepo
```

- **Git access:** `child_process.execFile('git', [...])`. No libgit2/nodegit dependency. Only read-only commands are used: `log`, `status`, `show`, `diff`, `diff-tree`, `rev-parse`.
- **Config:** `~/.config/megit/config.json` — list of repo paths plus last active tab. Owned and written by the server.
- **Dev mode:** Vite dev server proxies `/api` to Express.
- **Daily use:** `vite build` once; Express serves `dist/` — a single `node` process, open localhost in the browser.

## API

| Route | Backs | Git command |
|---|---|---|
| `GET /api/config` | tabs on startup | — |
| `POST /api/repos` | add tab | `rev-parse --git-dir` validates path is a repo |
| `DELETE /api/repos` | remove tab | — |
| `GET /api/fs?path=` | directory browser | — (marks directories containing `.git`) |
| `GET /api/graph?repo=&skip=` | graph, 500 commits per page | `log --all --topo-order` with custom `--format` |
| `GET /api/status?repo=` | WIP row | `status --porcelain=v2` |
| `GET /api/commit?repo=&hash=` | files-changed list | `diff-tree --name-status` |
| `GET /api/diff?repo=&hash=&file=` | diff panel | `show`; omitting `hash` means WIP → `diff HEAD -- <file>` |

## Frontend

```
App
├── TabBar            repo tabs, "+" opens DirBrowser
├── DirBrowser        modal; lists directories via /api/fs, git repos marked
└── RepoView          per active tab
    ├── GraphView     left ~55%: commit graph, WIP row pinned on top when dirty
    ├── CommitPanel   right: files-changed list for selected commit or WIP
    └── DiffView      below file list: diff2html render, unified ⇄ split toggle
```

- **State:** plain React `useState` + `fetch` in `RepoView`. No Redux/Zustand/react-query — seven endpoints and manual refresh leave nothing to cache-invalidate.
- **Refresh:** `r` key or toolbar button refetches graph page 0 + status for the active repo.
- **Diffs:** diff2html parses raw git diff text and provides unified/side-by-side rendering with syntax highlighting out of the box.

## Graph layout

The only algorithmically interesting part. Hand-rolled (~150 lines), no library — existing graph libraries target generated diagrams, not real repo history.

- **Input:** topo-ordered commits with parent hashes (git provides the ordering).
- **Lane assignment:** greedy walk top→down. A commit takes the lane reserved by its child; a branch-out opens a new lane; a merge closes one. Output per commit: `{ commit, lane, edges[] }`.
- **Rendering:** one flex row per commit — an SVG cell for dots/edges plus text columns for refs, subject, author, date. 500 rows render as plain DOM; no virtualization. A "Load more" button appends the next page.
- **Ref labels:** branch/tag chips on their commit's row, colored by lane.

## Error handling

- Adding a non-repo path → 400, inline message in DirBrowser.
- Repo path deleted after adding → tab renders an error state with a "remove tab" button.
- Git command failure → stderr passed through and shown in the panel where content would have appeared.
- Oversized diffs (lockfiles, minified bundles) → server caps a file diff at ~1 MB; UI shows "diff too large — show anyway", which refetches with `?force=1`.
- Binary files → git prints "Binary files differ"; show that line as the diff.

## Security

- Server binds to `127.0.0.1` only — `/api/fs` exposes filesystem listing and must never be reachable from the network.
- Repo paths are passed to git via `execFile` argument arrays, never shell interpolation.
- Every repo-scoped endpoint validates the repo path against the config list before running git — arbitrary paths from the client are rejected.

## Testing

Vitest, server-side only:

- **Parsers:** `git log` custom format → commit objects; `porcelain=v2` → status entries.
- **Lane assignment:** fixture histories (linear, branch, merge, octopus) → expected lane layouts.
- **UI:** manual smoke testing. No component tests in v1.

## Out of scope (v1)

- Any git mutation (commit, stage, push, pull, checkout, branch, stash)
- Auto-refresh / filesystem watching
- Commit search and filtering
- Blame, file history view
- Graph virtualization
- Packaging as a desktop app
