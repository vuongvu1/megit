# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the
version is below 1.0.0, the config file format (`~/.config/megit/config.json`), the CLI
surface, and the HTTP API may change in any minor release.

## [Unreleased]

### Added

- Recent projects in the repo picker now show a colored initial chip, so repeated
  basenames are easier to tell apart at a glance.

## [0.10.0] - 2026-09-03

### Added

- A **Settings** dialog in a cog button at the end of the tab bar: font, app zoom, theme,
  default diff view, an author avatars toggle (stops GitHub/Gravatar lookups when off),
  and a shortcut reference.

### Changed

- The version tag moved from the right end of the tab bar to beside the logo, making room
  for the new settings cog.

## [0.9.0] - 2026-08-28

### Changed

- Returning to the megit browser tab runs a full refresh — spinner and remote fetch, at most
  once every 10 seconds. A background tab can have its event stream throttled or dropped, so
  waiting for a change event was not enough.
- `megit start` now restarts a server that is already running instead of reporting
  "already running", so an upgraded version actually takes effect. It also replaces a
  server running on another port rather than refusing to start.

## [0.8.0] - 2026-08-20

### Added

- An **Amend last commit** checkbox in the commit composer folds staged changes into the
  tip and prefills its message. Refuses mid-merge or on a detached HEAD, and asks again
  before rewriting a commit a remote already has.

### Fixed

- Toolbar actions are disabled while an operation is in flight, so a second click can't
  fire a git command on top of the running one.

## [0.7.0] - 2026-08-19

### Added

- A search box filters the recent-repositories list in the picker. It matches the full
  path, not just the folder name, so two checkouts of the same repo stay distinguishable.

### Changed

- The recent-repositories list keeps 12 entries instead of 10.

## [0.6.0] - 2026-08-16

### Added

- `megit start` runs the server in the background and `megit stop` shuts it down, so the
  terminal that launched megit can be closed. Output goes to `~/.config/megit/megit.log`.

### Removed

- The `[repo-path]` argument is gone — open repositories from the picker in the app.

## [0.5.2] - 2026-08-12

### Fixed

- Ubuntu Mono is bundled instead of fetched from Google Fonts. Every page load used to
  hand your IP and User-Agent to a third party, and the UI fell back to a system font
  when offline — neither matched what the README promised.

### Changed

- README now states that avatar lookups reach `api.github.com` (with your `gh` token,
  when present) as well as Gravatar. That was already true and undocumented.

## [0.5.1] - 2026-08-10

### Changed

- Express is gone; routing and static serving are now ~150 lines on `node:http`. A megit install
  pulls 3 packages instead of 70, and the server starts in about half the time.
- The `postinstall` script is gone. node-pty's `spawn-helper` is made executable on the first
  terminal you open instead, so installing megit runs no scripts of its own.

## [0.5.0] - 2026-08-08

### Added

- Merge conflict resolution. A conflicted merge, rebase, cherry-pick or revert shows a banner
  with Abort and Continue; conflicted files open a per-block picker (Use ours / theirs / both /
  Reset) instead of a diff, and hand-fixed files take Mark resolved. Stash-pop conflicts get the
  picker but no banner — git leaves no state to detect and has no `--continue`.
- Rendered/Source toggle on `.svg` diffs, so a changed `viewBox`, `id` or `stroke-width` is
  reviewable as text. Sticky across files; raster images stay excluded.

### Changed

- The add-repo dialog is two panes: recent repositories on the left, directory browser on the
  right.

### Fixed

- "Stage all" and "Discard all" skip unmerged paths. `git add -A` staged conflict markers, and
`git restore --worktree -- .` failed on paths with no stage-0 entry, killing the whole batch.

## [0.4.1] - 2026-08-05

### Fixed

- <kbd>Esc</kbd> closes the add-repo dialog. The dialog had no keyboard dismissal at all, so the only way out was the ✕ or a click on the backdrop.

## [0.4.0] - 2026-08-05

### Added

- The add-repo dialog lists up to 10 recent repositories. Ones already open are marked and
  clicking them switches to that tab; closing a tab keeps the repo in the list.

### Changed

- "Discard all" discards only unstaged changes — tracked files go back to their staged content,
  untracked files are deleted, staged work survives. It previously reset both sides to HEAD,
  throwing away the hunk you had just staged to protect.

### Fixed

- The search bar (<kbd>⌘F</kbd>) no longer slides sideways when the commit panel opens. It was
  centred on `.graph-pane`, which shrinks with the panel; it is now pinned to the subject column.

## [0.3.0] - 2026-08-01

### Added

- Split terminal panes: <kbd>⌘D</kbd> divides the terminal into up to four side-by-side shells,
  each its own PTY and scrollback, remembered per repository. The four-pane cap is enforced
  server-side — the WebSocket spawns login shells, so an unbounded pane index would be an
  unbounded shell factory.

### Changed

- The package now requires Node ≥ 22 instead of ≥ 24, so `npx megit-app` no longer warns
EBADENGINE on Node 22 or 23. Node 24 was only needed to run `server/*.ts` in development.

### Fixed

- A stash newer than every commit no longer sinks to its base commit's row. The guard that
  snaps a stash down to its base fired on any busy history — it now keeps the chronological row
  whenever the clear lane fits inside the width the graph already draws.

## [0.2.0] - 2026-07-30

### Added

- Merge and Rebase in the right-click menu of a remote branch chip, not only a local one. The
  actions address the branch by its full remote-tracking ref, so a diverged origin/main can
  never resolve to the local main.
- A build badge in the tab bar: [DEV] under the Vite dev server, the package version in a
  production build. Baked in at build time, so it costs no request.

### Fixed

- Refresh (⟳ and <kbd>r</kbd>) fetches from the remote before re-reading the repository, so
  commits pushed by someone else and the Pull/Push counts no longer stay stale. Auto-refresh and
  initial tab load remain local-only; a failed fetch is ignored.
- Ref chips are ordered branches-first, tags-last, instead of git's listing order.
- The tab close button is a real 18×18 target with a hover ring and a Close <repo> label for
  screen readers; its cross is an SVG, since a × glyph centres on its line box, not its ink.

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
- Full-history search on demand: three `git log` passes (message, author, hash) unioned into one date-ordered list, capped at 500 results, with the query treated as a literal so a typed ( or . is not a regex
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

- Server binds 127.0.0.1 only
- Host header pinned to loopback names, closing DNS-rebinding access
- WebSocket Origin checked before handing out a PTY
- Repositories are only reachable once registered in `~/.config/megit/config.json`
- Client-supplied revs whitelisted rather than escaped, so a leading-dash rev cannot smuggle in a git option
- Git invocations cannot block on credential prompts

### Platforms

- macOS (arm64, x64): full support, and the only platform verified by hand
- Windows (arm64, x64): builds and runs, but untested on real hardware — recursive `fs.watch` crashes the test worker there, so auto-refresh is not covered by CI
- Linux: everything except the terminal — node-pty is an optionalDependency with no Linux prebuild, and the terminal button is hidden when it is unavailable

[Unreleased]: https://github.com/vuongvu1/megit/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/vuongvu1/megit/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/vuongvu1/megit/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/vuongvu1/megit/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/vuongvu1/megit/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/vuongvu1/megit/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/vuongvu1/megit/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/vuongvu1/megit/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/vuongvu1/megit/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/vuongvu1/megit/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/vuongvu1/megit/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/vuongvu1/megit/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vuongvu1/megit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vuongvu1/megit/releases/tag/v0.1.0