# Merge conflict resolution

**Date:** 2026-08-06
**Status:** approved, not yet implemented

## Problem

megit can start every operation that produces a conflict — merge, rebase, cherry-pick, revert — and cannot finish any of them.

When one stops on a conflict today, the conflicted files appear in the WIP row as `U` entries with a red "conflicted" chip, and that is the entire signal. The app never reads `MERGE_HEAD`, `rebase-merge/`, `CHERRY_PICK_HEAD` or `REVERT_HEAD`, so it does not know an operation is in progress, cannot say which one, and offers no way to abort or continue. The comments at `server/index.ts:443` and `server/index.ts:502` state the intent plainly: "A conflict stops and stays stopped — the files land in the WIP row, the terminal finishes it."

Deferring to the embedded terminal was the right call while the write operations were being built. It is the wrong call now that they all exist: megit will start a rebase for you and then strand you.

## Scope

In:

- Operation state surfaced in the UI, with Abort and Continue.
- Per-conflict-block picking inside megit — take ours, theirs, or both — for text conflicts.
- Whole-file resolution for conflicts that have no markers to pick: delete/modify, binary, submodule.

Out, and why:

- **Stash-pop conflicts get no banner.** `git stash pop` leaves unmerged index entries but no state file and has no `--continue`. The file picker still works on them — they are ordinary `U` entries — they just get no operation chrome.
- **No rebase step counter** ("step 3 of 7"). Orientation aid, not resolution.
- **No base pane.** The parser captures the `|||||||` base section when `merge.conflictStyle` is `diff3`/`zdiff3`, but the inline layout has nowhere to render it.
- **No inline text editing.** That means shipping a code editor into the bundle, which collides with the performance priority. Mixed edits that neither side satisfies stay a terminal job.
- **No `git am` state.** Not something megit starts.

## Decisions

| Decision | Chosen | Rejected |
|---|---|---|
| Depth | Hunk-level picker | Orchestration only; full inline editor |
| UI slot | In-place — resolver replaces `DiffView` in the same pane | Modal; whole-app conflict mode |
| Layout | Inline stacked, VS Code style | Side-by-side ours\|theirs; three-way + result |
| Completion | Auto-write + auto-stage per file, **manual** Continue | Auto-continue; explicit per-file Save |
| Pick state | Client state, disk written only on full resolve | Write per pick; debounced write |

Two of these carry reasoning worth keeping.

**Manual Continue.** Auto-continuing on the last resolved file lands a merge commit with no confirmation and no chance to inspect the staged result. One click is worth that.

**Client-held picks.** Writing each pick straight to disk makes the file the only source of truth and survives a reload, but the resolved region loses its markers, so per-block Reset would need a separate saved copy — and every click feeds a write into the `fs.watch` → SSE loop. Holding picks in React state keeps Reset free and the disk quiet. The cost is that a browser reload mid-file loses the picks; the file on disk is untouched, so nothing is corrupted and the work is a re-click, not a recovery.

## Server: operation detection

The git directory comes from `git rev-parse --git-dir` — `repo/.git` is a file, not a directory, in linked worktrees and submodules.

The git directory is resolved once per repo and cached for the process lifetime, so steady-state detection costs no git processes at all — only file existence checks:

| kind | evidence | label |
|---|---|---|
| `rebase` | `rebase-merge/` or `rebase-apply/` | — |
| `merge` | `MERGE_HEAD` | first line of `MERGE_MSG` |
| `cherry-pick` | `CHERRY_PICK_HEAD` | short sha, read from the file |
| `revert` | `REVERT_HEAD` | short sha, read from the file |

Checked in that order. A rebase applying a commit can also leave `CHERRY_PICK_HEAD` behind; rebase wins.

This rides on `/api/status`, which SSE already refreshes, so it costs no new request and no new poll:

```ts
{ files: StatusEntry[], branch: BranchHeader, operation: { kind, label } | null }
```

Per status call: five `existsSync` and one small read, plus a single `rev-parse --absolute-git-dir` the first time a repo is seen.

`operation.kind` joins the status fingerprint in `RepoView` (`statusFp`). Without it a state change that leaves the file list untouched would not reach `setState`, and the banner would go stale.

The decision itself is a pure function — `pickOperation(present: string[])` — so it is testable without a filesystem, following the pattern that already puts most of the suite in `lanes.ts`, `parse.ts` and friends.

## Parser: `src/conflict.ts`

Pure, DOM-free, no git.

```ts
type Choice = 'ours' | 'theirs' | 'both'
type Block = { ours: string[]; base: string[] | null; theirs: string[]; oursLabel: string; theirsLabel: string }
type Segment = { kind: 'context'; lines: string[] } | { kind: 'conflict'; block: Block }

parseConflict(text: string): Segment[] | null
applyPicks(segs: Segment[], picks: Map<number, Choice>): string
```

`picks` is keyed by index into `segs` — not by a separate conflict-only ordinal — so a pick survives nothing shifting under it and `applyPicks` is a single pass. `applyPicks` throws if a conflict segment has no pick; the client only calls it once every block is decided.

`parseConflict` returns `null` for a file with no markers and for one whose markers are malformed or nested. The pane then says the file cannot be parsed and points at the terminal, rather than guessing and writing a corrupted file.

Lines are split with `text.split(/(?<=\n)/)`, so each line keeps its own terminator. CRLF files, mixed-ending files and a missing final newline all round-trip byte-exact, and `applyPicks` is a concatenation. No normalization pass, no end-of-line detection, no way to rewrite endings the user did not ask to change.

Recognized markers, each at line start: `<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`. The `|||||||` case matters — under `merge.conflictStyle=diff3` or `zdiff3` a parser that does not know about the base section will fold it into the ours side and silently corrupt the resolved file.

`both` means ours followed by theirs. A theirs-first variant is one more button for a case that reordering in the terminal already covers.

## Routes

```
GET  /api/conflict?repo&file   → { content } | { binary: true } | { missing: true } | { tooLarge: true, size }
POST /api/conflict?repo        → { action, file?, content? }
```

| action | effect |
|---|---|
| `resolve` | write `content`, then `git add -- <file>` |
| `ours` / `theirs` | `git checkout --ours\|--theirs -- <file>`, then `git add` |
| `delete` | `git rm -- <file>` |
| `abort` | `<detected op> --abort` |
| `continue` | `<detected op> --continue` |

Three things this depends on:

**The unmerged-path check is a security boundary.** Every file-scoped action first confirms the path appears in `git diff --name-only --diff-filter=U`. Without it, `POST /api/conflict` is an arbitrary-file-write primitive bounded only by `repoGuard` — that is, write anything anywhere inside any registered repo. The check is not a nicety and must not be optimized away.

**`--continue` needs `GIT_EDITOR=true`.** `GIT_ENV` (`server/index.ts:36`) sets `GIT_TERMINAL_PROMPT`, `GIT_ASKPASS` and friends but no editor, so `merge --continue` would block forever on an editor that cannot open. `--no-edit` does not cover it: `git rebase --continue` rejects that flag.

**`express.json()` needs a bigger limit.** It is currently the 100 KB default (`server/index.ts:15`); a few thousand lines of source exceeds that. Raised to `10mb`, and the GET refuses anything over the existing `DIFF_CAP` (1 MB, `server/index.ts:688`) with `{ tooLarge: true }`, so the client cannot assemble a body larger than what it was given.

A rebase that continues into the next conflict simply produces another status refresh with `operation` still set — no special casing.

## Client

**A third WIP section, "Merge Changes"** — `splitStatus` returns conflicts as their own list instead of folding them into the unstaged one, and `CommitPanel` renders them last, after Changes, only while non-empty. The separation is not cosmetic: rows in Changes carry a Stage button, and staging a file that still has `<<<<<<<` in it commits conflict markers to history. The Merge Changes rows carry no Stage and no Discard — clicking one opens the resolver, which is the only way through.

Order is Staged Changes, Changes, Merge Changes, by the user's call. VS Code puts its equivalent section first, and the argument for that is that git stages every cleanly-merged file itself, so mid-merge the conflicts can end up below a much longer staged list. The banner carries the same count and does not scroll, which covers the discoverability that ordering would otherwise have to.

The batch buttons had the same hole and are fixed with it: `stage-all` ran `git add -A` and `discard` ran `git restore --worktree -- .`, so one swept conflicted files in and the other failed outright on paths that have no stage-0 entry to restore from. Both now append `:(exclude)<path>` pathspecs for every unmerged path.

Because those rows lose their Stage button, `ConflictView` grows a **Mark resolved** action on the no-markers case — otherwise a file someone fixed by hand in an editor or the terminal would have no way to be accepted.

**`ConflictBanner.tsx`** — a strip above the graph: `⚠ Merging — 3 conflicts remaining · [Abort] [Continue]`. Continue is disabled until the unmerged count reaches zero. Abort confirms first; it discards resolution work.

**`ConflictView.tsx`** — `RepoView` renders it inside the existing `.diff-overlay` in place of `DiffView` when the selected WIP file has `status === 'U'`. Context lines render plain; each conflict block renders as its ours half above its theirs half, with a button strip: Use ours / Use theirs / Use both / Reset. The block header shows the labels git wrote into the markers (`HEAD` vs `feature/x`).

It gets its own CSS block rather than reusing `DiffView`'s: `DiffView` renders through diff2html and inherits that library's stylesheet, so there are no megit-owned row styles to share. It also gets its own `lazy()` chunk — opening a conflicted file must not pull in diff2html and highlight.js, which are ~1 MB and the reason `DiffView` is lazy in the first place.

Files with nothing to pick — binary, delete/modify, submodule — render a single choice card instead of a block list: Keep ours / Keep theirs / Delete.

Picks live in React state keyed by file path. When the last block in a file is decided, `applyPicks` produces the text, the client POSTs `resolve`, and the file leaves the conflicted list and appears staged; the banner count drops.

**SSE must not clear picks.** `DiffView` takes a `wipTick` prop and reloads on every increment; `ConflictView` does not take it at all, and reloads only when `repo` or `file` changes. Nothing but megit writes the file while it is being picked, and when it stops being unmerged `RepoView` stops rendering the component. That is the whole guard — no extra state.

No new dependency and no lazy chunk — the pane is a few KB of JSX. Conflicted files are source files; the GET cap keeps a pathological one from being loaded at all.

## Tests

`src/conflict.test.ts`, against the parser:

- two-way markers; `diff3`; `zdiff3`
- CRLF preserved; mixed endings preserved; no trailing newline
- multiple blocks in one file
- unterminated or nested markers → `null`
- `applyPicks` for each of `ours`, `theirs`, `both`

Server-side: `pickOperation` precedence, in particular rebase winning over a co-present `CHERRY_PICK_HEAD`.

## Risks

- **Corrupting a file on write.** Mitigated by the byte-exact split/join, by `null` on anything the parser does not fully understand, and by writing only when every block has been decided.
- **Path guard regression.** Called out above; belongs in review of any change to `/api/conflict`.
- **Abort discarding work.** Confirmation before it runs.
