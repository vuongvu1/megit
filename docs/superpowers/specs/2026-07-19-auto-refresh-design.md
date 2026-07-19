# megit v2a — Auto-refresh — Design

**Date:** 2026-07-19
**Status:** Approved

## Overview

First of three sequential v2 sub-projects (auto-refresh → commit search → git mutations). The server watches each open repository's filesystem and pushes a change signal to the browser, which refetches what it already shows. The stale-data problem — megit showing yesterday's graph while you commit in the terminal — disappears. Manual refresh (`r` / toolbar button) stays as a fallback.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Watch scope | `.git` **and** working tree (graph + WIP row both stay fresh) |
| Transport | Server-Sent Events (`EventSource`), no new dependencies |
| Watcher lifecycle | Lazy — runs only while the repo has an SSE subscriber |
| Refresh granularity | Client refetches; server only signals "changed" |
| Scroll/selection | Preserve loaded pages and selected commit across refreshes |
| v1 manual refresh | Kept unchanged |

## Server

### Watcher (`server/watch.ts`)

- One `fs.watch(repoRoot, { recursive: true })` per repo — native FSEvents on macOS, no chokidar.
- Started when a repo gains its first SSE subscriber, closed when the last one disconnects.
- **Event filter** (pure function, unit-tested):
  - Any working-tree path → relevant.
  - Under `.git/`, only `HEAD`, `index`, `packed-refs`, and `refs/**` are relevant; everything else (`objects/`, `*.lock`, `logs/`, …) is ignored to avoid churn during git operations.
- **Debounce:** relevant events are coalesced; 400 ms after the last one, a single `changed` notification fires for that repo. A 2 s max-wait caps the trailing delay — sustained churn (long install, big rebase) still surfaces updates every ~2 s instead of waiting for quiet.
- Over-notification is accepted: edits under git-ignored directories (e.g. `node_modules`) still trigger a refresh. The refetch is a handful of cheap git reads, and the debounce caps the rate. No `.gitignore` parsing.

### Endpoint

| Route | Backs | Behavior |
|---|---|---|
| `GET /api/events?repo=` | auto-refresh stream | SSE: `data: changed\n\n` per debounce flush; `: ping` comment every 30 s as heartbeat |

- Repo path validated against the config list, like every other repo-scoped endpoint.
- Plain `res.write` on a kept-open response — no SSE library.
- Client disconnect (`close` event) unsubscribes; last unsubscribe closes the watcher.

## Client

- `RepoView` opens one `EventSource` for the **active tab only**; closed on tab switch or unmount. Inactive tabs keep v1 behavior (refetch on activation).
- On `changed`: refetch status and the loaded graph range, then recompute lanes over the full list — a scrolled view doesn't collapse back to page 0.
- Selected commit is kept if its hash is still in the refetched list; if rewritten away (rebase, amend), selection resets exactly as on initial load of the repo view. WIP selection persists whenever the WIP row still exists.
- `EventSource` auto-reconnects. On `open` after a reconnect, refetch once — covers events missed while disconnected (including server restarts).

## Performance

- **One git call per refresh, not N.** With N pages loaded, the refetch asks for the whole range in a single request (`GET /api/graph?repo=&limit=(N+1)*500`) — one `git log` invocation and one parse, instead of N+1 sequential `--skip` calls (each of which re-walks history from the tip anyway). `limit` is additive server-side; the existing `skip` paging for "Load more" is untouched.
- **Skip identical updates.** The client fingerprints each refetch (commit-hash list + ref positions + status entries). If nothing differs from current state, no `setState` — an over-notification (e.g. churn in a git-ignored directory) costs one cheap fetch and zero re-render of the 500+ row graph DOM.
- **Visibility gating.** When `document.visibilityState === 'hidden'`, a `changed` event only sets a dirty flag; the refetch runs once on `visibilitychange` back to visible. The common flow — editing in the IDE with megit in a background tab — does no fetch/render work until you actually look at it.
- **Commit diffs are immutable.** A refresh never refetches the open diff when the selection is a commit hash — same hash, same content. Only the WIP diff (and WIP file list) refetches on change.
- **Watcher cost.** Recursive `fs.watch` on macOS is FSEvents-backed — one OS watch per repo regardless of tree size. The event filter is a plain string check per event; lazy lifecycle means zero watchers when no client is connected.

## Error handling

- Watcher creation fails (EMFILE, permissions, repo path gone) → the SSE response ends. Client degrades silently to manual refresh; no error banner. A deleted repo already surfaces v1's tab error state on the next fetch.
- Refetch triggered mid-git-operation may catch transient states; reads (`log`, `status`) take no lock, and the next fs event re-syncs. No special handling.

## Testing

Vitest, server-side:

- **Event filter:** table of paths → relevant/ignored (working-tree file, `.git/HEAD`, `.git/refs/heads/main`, `.git/objects/ab/cdef`, `.git/index.lock`, …).
- **Debounce:** burst of events → one flush; spaced events → multiple flushes; continuous churn → flush at 2 s max-wait (fake timers).
- **Integration (one test):** temp git repo, subscribe, touch a file → `changed` arrives; commit → `changed` arrives.

UI verified via the repo's `/verify` skill (Playwright): edit a file in a watched repo → WIP row appears without pressing `r`; commit in terminal → graph updates.

## Out of scope

- Watching inactive tabs / background repos
- Diff-level incremental updates (server sends no payload, only a signal)
- `.gitignore`-aware filtering
- Commit search, git mutations (later v2 sub-projects)
