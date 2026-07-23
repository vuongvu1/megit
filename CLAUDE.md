# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

megit — git repository viewer in the browser: commit graph with branch lanes, tabs for multiple repos, diffs (unified/side-by-side) including uncommitted WIP, stash visualization, and branch checkout.

## Requirements & commands

Node ≥ 24 (runs TypeScript directly via native type-stripping — no build step for the server). With nvm, `nvm use` does not persist across Bash tool calls; prefix commands with:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
```

Package manager is pnpm.

```bash
pnpm dev                    # Express API on :4500 + Vite dev server on :4000 (proxies /api)
pnpm test                   # vitest (parsers, lane layout, watcher, config)
pnpm test -- lanes          # single test file by name filter
npx tsc --noEmit            # typecheck
pnpm build && pnpm start    # production: vite → dist/, server serves dist/ + API on :4500
```

Ports come from env vars: `PORT` (API, default 3411) and `UI_PORT` (Vite, default 5173); the dev/start scripts pin 4500/4000. The server only mounts `dist/` static serving if it exists at startup — restart after the first build.

End-to-end verification (build, launch, drive with Playwright, API curl probes): use the `verify` skill (`.claude/skills/verify/SKILL.md`).

## Workflow

- Do not run `git commit` or `git rm` — the user commits at task boundaries.
- Design docs and implementation plans live in `docs/superpowers/{specs,plans}/`.
- Playwright MCP drops `.playwright-mcp/` artifacts into the CWD — keep them out of commits.

## Architecture

Two halves, no shared code except the shape of the JSON that crosses `/api`:

**Server (`server/`, plain Express, no bundling)** — `index.ts` defines all routes and shells out to `git` via `execFile` (`git()` helper, 50 MB buffer). Every repo-scoped route goes through `repoGuard`, which rejects paths not registered in `~/.config/megit/config.json` (that config is real user state — clean up test repos you add). `parse.ts` turns `git log`/`git status --porcelain` output into JSON using unit-separator delimited format (`LOG_FORMAT`); graph queries use `--date-order` (not topo) so parallel branches interleave by time. `watch.ts` implements auto-refresh: `fs.watch` per open repo, filtered by `isRelevant`, debounced (400 ms, 2 s max wait), pushed to the client over SSE (`/api/events`). `/api/checkout` auto-stashes a dirty worktree before switching.

**Client (`src/`, React 19 + Vite)** — `RepoView.tsx` owns data fetching, SSE subscription, and paging state per tab. The graph is the heart: `lanes.ts` is a pure, unit-tested layout module — `layout()` does greedy top-down lane assignment over the commit list, with a lane-reservation mechanism (`reserve`/`nRes`) that pins the leftmost lanes for WIP and stash connectors so they get straight runs into HEAD; `activeTrail()` marks the checked-out branch's path for thick/highlighted rendering; `stashSlot()`/`freeLane()` place stash rows without crossing traffic. `GraphView.tsx` renders those rows as SVG plus ref chips, avatars, and the sticky WIP row. Theme (light/dark, `Cmd+Shift+0`) is CSS variables via `data-theme` in `styles.css`.

When changing graph behavior, change `lanes.ts` + its tests first; `GraphView.tsx` should stay a dumb renderer of `LaneRow`s.
