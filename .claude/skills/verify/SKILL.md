---
name: verify
description: Build, launch and drive krakenlite to verify changes end-to-end
---

# Verifying krakenlite

Node ≥ 24 required (native TS type-stripping). With nvm: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"` (plain `nvm use` doesn't persist across Bash tool calls).

## Build + launch (production surface)

```bash
pnpm build                                   # vite → dist/
node server/index.ts &                       # serves dist/ + API on http://127.0.0.1:3411
```

Server only mounts `dist/` static serving if it exists **at startup** — restart after first build. Frontend changes need `pnpm build` + hard reload (hashed asset names, no cache issue).

Dev mode alternative: `pnpm dev` (Express on 3411 + Vite on 5173 with /api proxy).

## Drive it

Playwright MCP against `http://127.0.0.1:3411/`. Flows worth driving:

- Tab bar → “+” → dir browser → navigate to a repo → Open
- Big-history repo for lanes/paging: `~/WORKSPACE/BLS/bikeleasing-app` (14k commits, 5k merges)
- WIP row (top, sticky) → file list → diff; untracked files go through `git diff --no-index`
- Merge commit → files vs first parent; toggle Unified ⇄ Side-by-side
- `r` key / ⟳ button refresh; Load more at list bottom
- Deleted-repo error state: `git init` a scratchpad repo, POST it to `/api/repos`, `mv` the dir away, reload → tab shows error + "Remove tab"

## API probes (curl)

```bash
curl -s localhost:3411/api/config
curl -s "localhost:3411/api/graph?repo=<urlencoded-abs-path>"      # unknown path → {"error":"unknown repo"}
curl -s "localhost:3411/api/diff?repo=…&file=…"                    # no hash = WIP diff
```

## Gotchas

- App config is real: `~/.config/krakenlite/config.json` — remove test repos you add (DELETE `/api/repos?repo=…` or the tab's ×).
- Playwright MCP drops `.playwright-mcp/` snapshots and screenshots into the CWD — move them out before committing.
- Unit tests (parsers, lanes): `pnpm test`; typecheck: `npx tsc --noEmit`.
