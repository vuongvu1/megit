# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the
version is below 1.0.0, the config file format (`~/.config/megit/config.json`), the CLI
surface, and the HTTP API may change in any minor release.

## [Unreleased]

## [0.2.0] - 2026-07-30

### Added

- Merge and Rebase in the right-click menu of a remote branch chip, not only a local one. When a local branch has diverged from its upstream — a local commit here, a new commit on the remote — `origin/x` is drawn as its own chip, and that chip is exactly what you want to merge in or rebase onto. The actions address the branch by its full remote-tracking ref, so a diverged `origin/main` can never resolve to the local `main`.
- A build badge in the top-right of the tab bar: `[DEV]` when running the Vite dev server, the package version (`v0.2.0`) in a production build. Baked in at build time, so it costs no request and the unused branch is dropped from the production bundle.

### Fixed

- Refresh (⟳ button and <kbd>r</kbd>) now fetches from the remote before re-reading the repository. It previously only read local git, so commits pushed by someone else — and the Pull/Push badge counts — stayed stale until you hit Pull. Auto-refresh over SSE and the initial load of a tab remain local-only, so neither costs a network round-trip; a fetch that fails is ignored and the local refresh still happens.
- Ref chips are ordered branches-first, tags-last, instead of taking whatever order git listed them in. The sort is stable, so git's ordering still decides within each group.
- The tab close button is a real 18×18 target with a hover ring and a `Close <repo>` label for screen readers, and its cross is an SVG rather than a `×` glyph — a text glyph is positioned from the font's baseline, so flex centring aligned its line box and left the visible ink off-centre.

## [0.1.0] - 2026-07-28

First public release.

### Graph

- Commit graph with per-branch lanes and colours, greedy top-down lane assignment, and reserved leftmost lanes so WIP and stash connectors get straight runs into HEAD
- The checked-out branch's path is drawn thicker and highlighted
- Merge edges bulge around the lanes they cross rather than cutting through them
- Commits page in 200 at a time, loading more on demand
- Stash entries render as their own rows, dot-connected to the commit they were taken from
- Sticky WIP row at the top of the list whenever the worktree is dirty
- Resizable ref / graph / message columns, with widths persisted
- Gravatar avatars with initials fallback

### Diffs

- Unified and split (side-by-side) views
- Syntax highlighting and word-level intra-line highlighting
- Collapsed context expandable a hunk at a time
- Per-file "Viewed" checkbox
- Merge commits diff against their first parent
- Images diff visually instead of as binary noise
- Untracked files diff via `git diff --no-index`

### Search

- <kbd>⌘F</kbd> find bar filtering the loaded rows as you type, matching commit message, author name, email, hash prefix, or ref name — no request, and immune to going stale across a background refresh
- <kbd>Enter</kbd> / <kbd>Shift+Enter</kbd> step through matches, wrapping at both ends
- Full-history search on demand: three `git log` passes (message, author, hash) unioned into one date-ordered list, capped at 500 results, with the query treated as a literal so a typed `(` or `.` is not a regex
- A match below the loaded window pulls the graph down to it

### Working tree

- Stage, unstage, and discard individual files
- Commit message composer with staged / unstaged sections and counts
- Amend the last commit's message
- Non-ASCII paths handled correctly (`core.quotePath=false`, NUL-delimited output)

### Git operations

- Toolbar: pull (fast-forward only), push, create branch, stash all, pop latest stash, undo last commit (soft reset)
- Ref chips: checkout, create branch here, rename, delete, set upstream, merge, rebase, delete tag, copy name, copy GitHub link
- Commit rows: checkout, cherry-pick, revert, reset (soft / mixed / hard), copy hash, copy GitHub link
- Checkout auto-stashes a dirty worktree first
- Destructive actions are marked, and hidden where they would be meaningless

### Shell

- Full PTY terminal (xterm.js + node-pty) opened in the active repository, lazy-loaded so it costs nothing until used
- Sessions survive panel hides and tab switches, with a replay buffer on reattach

### App

- Multiple repositories in draggable tabs
- Light and dark themes
- Auto-refresh: the server watches each open repo (`fs.watch`, filtered and debounced) and pushes updates over SSE
- Keyboard navigation through rows, plus shortcuts for refresh, terminal, theme, and commit
- Toast notifications for errors

### Security

- Server binds `127.0.0.1` only
- `Host` header pinned to loopback names, closing DNS-rebinding access
- WebSocket `Origin` checked before handing out a PTY
- Repositories are only reachable once registered in `~/.config/megit/config.json`
- Client-supplied revs whitelisted rather than escaped, so a leading-dash rev cannot smuggle in a git option
- Git invocations cannot block on credential prompts

### Platforms

- macOS (arm64, x64): full support, and the only platform verified by hand
- Windows (arm64, x64): builds and runs, but untested on real hardware — recursive `fs.watch` crashes the test worker there, so auto-refresh is not covered by CI
- Linux: everything except the terminal — `node-pty` is an `optionalDependency` with no Linux prebuild, and the terminal button is hidden when it is unavailable

[Unreleased]: https://github.com/vuongvu1/megit/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/vuongvu1/megit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vuongvu1/megit/releases/tag/v0.1.0
