# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

megit — git repository viewer in the browser: commit graph with branch lanes, tabs for multiple repos, diffs (unified/split) including uncommitted WIP, stash visualization, commit search, an embedded PTY, and the common git write operations (stage/commit/amend, branch and tag CRUD, stash, checkout, revert, reset, cherry-pick, merge, rebase, pull, push).

Published to npm as **`megit-app`** (the name `megit` was taken); the installed binary is still `megit`.

## Performance is the top priority

Every change is judged against it. Concretely:

- Keep the main bundle lean — heavy dependencies (xterm.js is the precedent) go in lazy `React.lazy`/dynamic-`import()` chunks; server-side natives (node-pty) load via dynamic `import()` on first use. Nothing may cost anything until the user actually uses it.
- `/api/graph` must stay fast on 10k+-commit repos. Commits page in at 200 per request (server default and client floor) — don't raise it without measuring.
- Avoid re-renders: RepoView gates `setState` behind fingerprint comparison; keep that pattern for new data flows.
- Client-only deps belong in `devDependencies` — Vite inlines them into `dist/`. Runtime `dependencies` is deliberately just ws (+ optional node-pty); routing/static serving is `server/http.ts` on `node:http`. Adding a runtime dep means adding its whole transitive tree to every user's install — justify it against writing the few lines instead.
- Measure before claiming: `curl -w '%{time_total}'` on API routes, `pnpm build` chunk sizes, DOM row counts / `performance.getEntriesByType` in the browser. Verify against a big repo (`~/WORKSPACE/BLS/bikeleasing-app`, 14k commits — register temporarily, then remove from config).

## Requirements & commands

Node ≥ 24. With nvm, `nvm use` does not persist across Bash tool calls; prefix commands with:

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
```

Package manager is pnpm.

```bash
pnpm dev                    # API on :4500 + Vite dev server on :4000 (proxies /api)
pnpm test                   # vitest — pure modules, parsers, watcher
pnpm test -- lanes          # single test file by name filter
npx tsc --noEmit            # typecheck
pnpm build                  # vite → dist/
pnpm build:server           # tsc → dist-server/ (publishing only)
pnpm build && pnpm start    # production: server serves dist/ + API on :4500
```

Ports come from env vars: `PORT` (API, default 3411) and `UI_PORT` (Vite, default 5173); the dev/start scripts pin 4500/4000. The server only mounts `dist/` static serving if it exists at startup — restart after the first build.

End-to-end verification (build, launch, drive with Playwright, API curl probes): use the `verify` skill (`.claude/skills/verify/SKILL.md`).

## Gotchas

- **Dev runs TypeScript directly; publishing cannot.** Node refuses to type-strip files under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so `server/` is compiled to `dist-server/` by `prepublishOnly`. Never assume the raw `.ts` server ships.
- **`fs.watch` on a missing path behaves three ways**: macOS and Windows throw ENOENT, Linux returns a watcher that never fires and never errors. `subscribe()` checks `existsSync` itself so the contract is identical everywhere — don't delegate that to `fs.watch`.
- **Hang startup logging off the server's `'listening'` event**, never a `listen()` callback — a callback can fire on a failed bind (`server.listening === false`) and announce a URL that never came up.
- **vitest excludes `test-repo/`** (`vite.config.ts`) — the generated fixture contains a plausible `test/renderer.test.ts` that would otherwise join the real suite.
- **Watcher integration tests are skipped on Windows** — a real recursive `fs.watch` kills the vitest worker with no output. Windows auto-refresh is therefore unverified.
- **`npx megit-app` fails with `sh: megit: command not found` when run from anywhere inside this repo.** A bare name is a `*` range to npm, which matches the repo's own root package, so npx decides it's already installed, skips the cache install, and never adds a bin dir to PATH (`libnpmexec/lib/index.js` — line 56 returns the local node, so line 306's `binPaths.push` is skipped). Smoke-test with `node bin/megit.js` or `npx megit-app@latest` instead. Not a user-facing bug.
- **`rm -rf` is often denied** by the permission layer; use `node -e "fs.rmSync(p,{recursive:true,force:true})"`.
- **`ps` is shadowed by an npm alias** in this shell; use `/bin/ps`.
- Test-count and per-test-duration arithmetic is the fastest way to identify which file killed a CI worker that reported nothing.

## Workflow

- Start every request on a fresh branch off `main`: `git checkout -b <feat|fix|docs|chore>/<slug>`. Uncommitted changes carry across, so a request already underway can be moved retroactively. Never let work pile up on `main`.
- Do not run `git commit` or `git rm` — the user commits at task boundaries.
- `~/.config/megit/config.json` is real user state. To drive the app without touching it (screenshots, probes), launch the server with an isolated `HOME`.
- Design docs live in `docs/superpowers/specs/` — the *why* behind a feature, kept so decisions don't get re-litigated. Implementation plans are scratch: write them wherever, delete them once the feature ships.
- Playwright MCP drops `.playwright-mcp/` artifacts into the CWD — keep them out of commits.
- `scripts/make-test-repo.sh` regenerates `test-repo/`: interleaved branches, merges, two stashes, dirty worktree. It is also the source of the README screenshots.

## Releasing

Automated — see `CONTRIBUTING.md`. Merging to `main` publishes **only** when `package.json`'s version is not yet on npm; the job separately creates the tag and GitHub release if those are missing, so the two halves self-heal. Release notes are sliced out of `CHANGELOG.md` by `scripts/release-notes.mjs`, and a missing `## [x.y.z]` heading aborts the run before publishing. Auth is npm trusted publishing (OIDC) — there is no token to rotate, and classic npm tokens no longer exist.

When bumping a version, update `CHANGELOG.md` in the same change.

Entries stay short and precise: one bullet per user-visible change, 1–3 lines, naming what
changed and — only where it isn't obvious — why. Design rationale belongs in
`docs/superpowers/specs/`, not the release notes.

## Architecture

Two halves, no shared code except the shape of the JSON that crosses `/api`. **`docs/architecture.md` is the full account — read it before large changes, and update it rather than duplicating it here.**

The load-bearing points:

- **`server/index.ts`** defines all routes and shells out to `git` via `execFile`. Every repo-scoped route goes through `repoGuard` (path must be registered in the config, and must exist). Client-supplied revs are allow-listed, not escaped — a leading-dash rev is a git option.
- **`parse.ts`** uses a unit-separator format (`LOG_FORMAT`) so newlines in subjects can't break records; graph queries use `--date-order`, not topo, so parallel branches interleave into legible lanes.
- **`lanes.ts` is the heart, and it is pure** — greedy top-down lane assignment with a reservation mechanism pinning the leftmost lanes for WIP/stash connectors. `GraphView.tsx` stays a dumb renderer of `LaneRow`s. Change `lanes.ts` and its tests first.
- **Search is client-first**: `matchLocal` filters loaded commits in a `useMemo` (no request, can't go stale). `/api/search` runs only on explicit full-history search, and costs three `git log` processes because git ANDs its commit-limiting options.
- **`term.ts`** loads node-pty lazily; `hasPty()` answers "installed?" via `require.resolve` without loading the binding, and `/api/config` reports it as `hasTerminal` so Linux hides the terminal button.
- The pure, DOM-free modules — `lanes.ts`, `search.ts`, `rowNav.ts`, `branchMenu.ts`, `commitMenu.ts`, `parse.ts` — carry most of the suite. Put logic there when you can.
