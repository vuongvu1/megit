# Architecture

Two halves that share nothing but the shape of the JSON crossing `/api`.

```
browser                          node
─────────────────────────        ─────────────────────────────────────
src/                             server/
  App.tsx      tabs, config        index.ts   all routes, execFile('git')
  RepoView.tsx fetch, SSE, paging  parse.ts   git output → JSON
  GraphView.tsx dumb renderer      watch.ts   fs.watch → debounce → SSE
  lanes.ts     ← the graph         term.ts    PTY over WebSocket
  search.ts    client-first find   config.ts  ~/.config/megit/config.json
  DiffView.tsx diff2html + hljs    avatars.ts Gravatar lookup
```

There is no ORM, no state library, and no shared model layer. The server produces plain JSON; the client owns all presentation.

## Server

**Plain Express, no bundling.** `index.ts` defines every route and shells out to `git` through an `execFile` helper with a 50 MB buffer. In development Node runs the TypeScript directly via native type-stripping; `pnpm build:server` compiles it to `dist-server/` only for publishing, because Node refuses to strip types under `node_modules`.

**Every repo-scoped route passes through `repoGuard`**, which rejects any path not registered in `~/.config/megit/config.json`. See [SECURITY.md](../SECURITY.md) for why that, the `Host` pin, and the rev allow-list exist.

**`parse.ts` turns git output into JSON.** `git log` runs with a unit-separator-delimited format (`LOG_FORMAT`, `%x1f` between fields and `%x1e` between records) rather than anything human-readable, so commit subjects containing newlines or tabs can't corrupt a record boundary. `git status --porcelain` is read NUL-delimited with `core.quotePath=false`, which is what makes non-ASCII paths work.

Graph queries use `--date-order`, deliberately not `--topo-order`: topological order groups each branch's commits together, which reads as a tidy list but destroys the interleaving that makes parallel branches legible as lanes.

**`watch.ts` drives auto-refresh.** One `fs.watch` per open repository, filtered by `isRelevant`, fed into a trailing debouncer with a max-wait cap (400 ms quiet flush, 2 s under sustained churn — a long install or a big rebase still updates twice a second rather than never). Changes are pushed to the browser over SSE at `/api/events`, with a 30 s `: ping` comment to keep intermediaries from closing an idle stream.

**Only a manual refresh touches the network.** `/api/graph` and `/api/status` read local git, which cannot see upstream commits until something fetches — so Pull was once the only button that surfaced them. The ⟳ button and <kbd>r</kbd> now POST `{action:'fetch'}` to `/api/branch` and re-enter `refresh` for the local read; a failed fetch is swallowed so the read still lands. Everything else stays local-only on purpose: SSE refetches fire every 400 ms–2 s, and RepoView remounts per tab switch, so neither may cost a round-trip.

**`/api/graph` pages.** 200 commits per request by default, clamped to 5000 — an uncapped limit turns one request into the entire history (4.2 MB / 380 ms on a 14.8k-commit repo), and 5000 rows is already far past where the DOM gives out.

**`/api/search` is the one expensive route.** git ANDs its commit-limiting options, so "message OR author OR hash" cannot be one invocation — it is three `git log` runs unioned by `mergeMatches`, sorted date-descending and capped at 500. `-F` keeps a typed `(` or `.` literal instead of a regex; `--max-count=501` lets the server tell "exactly 500" from "more than 500" so the UI can show a truncation marker. It only runs when the user explicitly asks for full-history search.

**`term.ts` is the only native dependency.** node-pty loads through a dynamic `import()` on first attach, so it costs nothing until a terminal is opened, and `hasPty()` answers "is it installed?" via `require.resolve` without loading the binding — that keeps `/api/config` cheap and lets Linux, which has no prebuild, degrade to hiding the button.

## Client

**`RepoView.tsx` owns data.** Fetching, the SSE subscription, and paging state, per tab. It gates `setState` behind fingerprint comparison so an SSE tick that changes nothing doesn't re-render the graph; new data flows should keep that pattern.

**`lanes.ts` is the heart, and it is pure.** `layout()` does greedy top-down lane assignment over the commit list, with a reservation mechanism (`reserve`/`nRes`) that pins the leftmost lanes so WIP and stash connectors get straight runs into HEAD instead of weaving through traffic. `activeTrail()` marks the checked-out branch's path for thick rendering. `stashSlot()`/`freeLane()` place stash rows.

It has no DOM dependency and is unit-tested in isolation. **`GraphView.tsx` is a dumb renderer of the `LaneRow`s it emits** — SVG paths, ref chips, avatars, the sticky WIP row. Graph behaviour changes belong in `lanes.ts` and its tests first.

**Search is client-first.** `matchLocal` filters the already-loaded commits inside a `useMemo`, so the default path costs no request and cannot go stale when SSE refreshes underneath it. `SearchBar.tsx` renders as a *sibling* of `.graphview`, not a child — GraphView's arrow-key handler only fires for `document.body` or targets inside `.graphview`, and that placement is what keeps ↑/↓ working as text-cursor movement while the input is focused. Reaching a match below the loaded window re-fetches with a doubling `limit`, because `lanes.ts` lays out top-down and row N needs rows 0..N-1.

**Theming is CSS variables** behind `data-theme` on the root element, with the two highlight.js stylesheets swapped in a single managed `<style>` (they target the same `.hljs-*` classes, so they cannot both be static-imported).

## The pure modules

`lanes.ts`, `search.ts`, `rowNav.ts`, `branchMenu.ts`, `commitMenu.ts`, `parse.ts`, and the `watch.ts` debouncer are all testable without a DOM or a real repository, and carry most of the test suite. Logic that can live in one of them should.
