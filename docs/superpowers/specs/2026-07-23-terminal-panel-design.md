# Terminal Panel — Design

**Date:** 2026-07-23
**Status:** v2 — full PTY terminal, lazy-loaded (supersedes the command-runner
variant, which shipped briefly and was replaced same day at the user's request).

## What

A show/hide **real terminal** (full PTY: vim, pagers, `git rebase -i`, colors,
completion) at the bottom of the repo view. Toggled by a toolbar button (left
of the theme switch) or `Cmd/Ctrl+J`.

**Lazy everywhere — zero cost until first use:**

- Client: xterm.js lives in its own code-split chunk (`React.lazy` +
  dynamic `import()`); the main bundle is unchanged and the chunk downloads
  on first open.
- Server: `node-pty` is `import()`ed on first terminal attach — the native
  module never loads, and no shell process exists, until a terminal is opened.

## Client

- `src/TerminalPanel.tsx` — xterm.js (`@xterm/xterm`) + fit addon, rendered
  inside `.repoview` after `.panes`, fixed height 220 px. Loaded via
  `React.lazy` from `RepoView`; `Suspense` fallback is an empty panel shell.
- WebSocket to `/api/term?repo=…`. Keystrokes → JSON `{t:'i', d}` frames;
  resize → `{t:'r', cols, rows}`; server output arrives as raw text frames
  written straight to the terminal.
- xterm theme derives from the CSS variables at mount and re-derives on
  megit theme toggle (`useTheme`).
- Toolbar `>_` button + `Cmd/Ctrl+J` toggle (unchanged from v1); `✕` close
  button top-right of the panel.
- Panel height is drag-resizable via a grab strip on its top edge (pointer
  capture, clamped 120 px – 80 % of the viewport, persisted in
  `localStorage["megit-term-h"]`); the fit addon reflows the PTY on resize.

## Server

- `server/term.ts` — PTY session manager. One session per repo, created on
  first attach: `pty.spawn($SHELL, ['-l'], { cwd: repo, TERM: xterm-256color })`.
- **Hide ≠ kill** (VS Code semantics): closing the panel closes the socket,
  but the PTY keeps running. A ring buffer (last 200 KB of output) replays on
  reattach, so scrollback and running processes survive toggle and tab
  switches. Session ends when the shell exits (`exit`) or the megit server
  stops.
- WS endpoint via `ws` package on the existing HTTP server's `upgrade` event,
  path `/api/term`. Repo must be registered in config (same check as
  `repoGuard`).
- **Origin check on upgrade** — WebSockets are not CORS-protected, and this
  socket is a shell. Only `localhost`/`127.0.0.1` origins may connect;
  anything else is destroyed. (The rest of the API is safe cross-origin
  because JSON preflights fail without CORS headers; WS needs this explicit
  guard.)
- Vite dev proxy gets `ws: true` so the socket tunnels through :4000 → :4500.

## Skipped (upgrade paths)

- Idle reaping of detached PTYs — sessions are per registered repo on a
  personal tool; kill-on-shell-exit is enough. Add a TTL if shells pile up.
- Multiple terminals per repo.

## Testing

- Unit: ring-buffer capping logic in `server/term.ts` (pure function).
- E2E via the `verify` skill: build, launch, Playwright — open panel, run a
  command, see PTY output (colored prompt), toggle Cmd+J, confirm the session
  survives (scrollback replayed, running process still alive).
- Bundle check: `pnpm build` output shows xterm in a separate chunk.
