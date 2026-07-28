# Commit search — design

Date: 2026-07-28
Status: approved, ready for implementation plan
Scope: v2b of the megit v2 roadmap (v2a auto-refresh shipped; v2c mutations shipped ahead of this)

## Goal

A find-bar over the commit graph, modelled on GitKraken's: a floating pill holding a
magnifier, a text input, a match counter (`1 of 4`), previous/next arrows and a close
button. `⌘F` opens it.

Search is **local by default** — it filters the rows already loaded, with no network and no
git process. One extra control in the pill, a "search all history" button, escalates the
current query to a full-history `git log` search when the local result isn't enough.

## Decisions

Five questions settled before design, recorded here so they don't get re-litigated:

1. **Two scopes, local first.** Filtering the loaded rows is instant and free; scanning a
   14k-commit history is neither. Default to the cheap one and make the expensive one an
   explicit act.
2. **The deep control is a one-shot button, not a mode.** Clicking it runs one search for
   the query as typed. Editing the query returns to local. No debounce is needed anywhere,
   and no git process runs unless the user asks for it.
3. **Match rule: message OR author OR hash prefix**, one box, no query syntax. Local mode
   additionally matches ref names, because loaded rows already carry them.
4. **Deep matches below the loaded window: escalate the graph limit.** Re-fetch
   `/api/graph` with a larger `limit`, rather than calling `Load more` repeatedly.
5. **Highlight: the current match only**, expressed through the existing `selection` state.
   No new GraphView props, no per-row match tinting.

## Constraint that shapes everything

`lanes.ts` assigns lanes greedily top-down over the commit list, so row N cannot render
without rows 0..N-1. There is no way to jump straight to commit 4200 of a 14k history —
reaching it means loading every row above it. The deep path is a way to pay that cost
gracefully, not a way to avoid it. It is also the whole reason local search is the default:
a local match is by definition already on screen.

## Local search (default path)

### `matchLocal(commits, q): string[]` — new pure export in `src/search.ts`

Case-insensitive substring test, OR'd across `subject`, `author`, `email` and each entry of
`refs`, plus a `hash.startsWith(q)` prefix test. Returns the matching hashes **in
`commits` order**, which is the graph's own order — so `next` always moves down the screen.

Wired in RepoView as `useMemo(() => matchLocal(commits, query), [commits, query])`. No
debounce: the list is at most a few thousand objects and the test is a `toLowerCase` +
`includes` per field. Because it derives from `commits`, an SSE refresh recomputes it
automatically, and a rewritten commit can't leave a stale hash behind.

## Deep search (opt-in path)

### `GET /api/search?repo=<path>&q=<query>` — new route in `server/index.ts`, behind `repoGuard`

Same ref whitelist and ordering flags as `/api/graph`, so a match is always a commit the
graph can actually show:

```
git log HEAD --branches --tags --remotes --date-order -i -F --grep=<q>   --max-count=501 --format=%H%x1f%ct
git log HEAD --branches --tags --remotes --date-order -i -F --author=<q> --max-count=501 --format=%H%x1f%ct
git log -1 --format=%H%x1f%ct <q>     # only when /^[0-9a-f]{4,40}$/i.test(q); .catch(() => '')
```

Three calls rather than one because git ANDs its commit-limiting options: `--grep=X
--author=X` means "message contains X *and* author contains X", which is not the OR the
one-box UI promises.

- `-F` (`--fixed-strings`) — a typed `.`, `(` or `*` is a literal, not a regex. Without it
  a query holding `(` makes git exit non-zero.
- `-i` (`--regexp-ignore-case`) — applies to `--grep` and `--author` alike.
- The hash call resolves unique abbreviated shas; a non-existent or ambiguous prefix makes
  git exit non-zero, which the `.catch` turns into "no hash match".
- `--max-count=501` bounds the work a one-character query can ask for: `q = "a"` matches
  most of a 14k history, and the route only ever reports the first 500 anyway. The 501st
  row is what proves there were more.
- Empty/whitespace-only `q` → `{ matches: [], truncated: false }` with no git calls.

Response: `{ matches: string[], truncated: boolean }` — full 40-char shas, at most 500 of
them, `truncated` true when the merged union held more.

Ref names are **not** searched here. Local mode gets them free from the loaded rows;
matching them across all history would mean a `for-each-ref` pass and a tip-to-commit
resolution step, for a case the ref chips already make visible.

### `mergeMatches(lists: [string, number][][]): { matches: string[]; truncated: boolean }` — new pure export in `server/parse.ts`

Union by hash, sort by commit date descending, drop the dates, then slice to 500 and report
whether the slice dropped anything. Unit-tested alongside the other parsers: dedupe across
lists, ordering, the cap and its `truncated` flag, empty input.

### Reaching a deep match

- The hash is in `commits` → `setSelection({ kind: 'commit', hash })`. The existing effect
  at `GraphView.tsx:496` scrolls `.row.selected` into view; the existing `.selected` CSS
  highlights it. Nothing new.
- Not loaded → re-fetch `/api/graph` with the limit repeatedly doubled, starting from the
  current loaded count (100 → 200 → 400 → …), until the hash appears in the response. Each
  response replaces `commits` wholesale, exactly as `refresh` already does, so the graph
  stays a contiguous list from HEAD down. Most matches resolve at 200–400 rows; the worst
  case is six growing requests rather than 42 sequential `loadMore` calls.
- The escalation passes the server's 5000-row cap without finding the hash → Toast, "match
  too deep to display". The cap is deliberate (an uncapped limit is 4.2 MB / 380 ms on a
  14.8k-commit repo) and 5000 rows is already far past where the DOM gives out.

## UI

### `src/SearchBar.tsx` — new, presentational

The pill from the reference screenshot — magnifier icon, `<input>`, counter, ↑, ↓, ✕ — plus
a globe-ish "search all history" button between the counter and the arrows. Props are
value, label, a `deep` flag for the button's active styling, and five callbacks
(`onChange`, `onDeep`, `onPrev`, `onNext`, `onClose`). No state of its own beyond the
input's DOM focus.

Rendered as a **sibling of `.graphview`** inside `.graph-pane`, not a child. GraphView's
arrow-key handler bails unless the event target is `document.body` or inside `.graphview`
(`GraphView.tsx:485`), so this placement keeps ↑/↓ as ordinary text-cursor movement in the
input for free, with no new guard.

Styling follows `styles.css` CSS variables so it themes with `data-theme` like everything
else.

### `label(cur, len, opts): string` — new pure export in `src/search.ts`

`"1 of 4"`, `"No results"` when `len === 0`, `"1 of 500+"` when truncated. Deep results
append a scope marker so a count can't be mistaken for the other scope: `"1 of 37 · all"`.

### `stepMatch(len, cur, dir: 1 | -1): number` — new pure export in `src/search.ts`

Wraps: at match 4 of 4, next goes to 1. Deliberately unlike `rowNav.step`, which clamps at
the ends so a held arrow key stops instead of looping; a find-bar is the opposite
convention.

### `RepoView` wiring

New state: `{ searchOpen, query, cur, deep }` where `deep` is `null` for local mode or
`{ matches, truncated }` from the last deep search. Per tab — RepoView is already remounted
per repo by key, so nothing extra is needed.

The active match list is `deep?.matches ?? localMatches`. Any edit to `query` sets
`deep = null`, dropping back to local. Clicking the deep button fires one `/api/search`
guarded by the existing `gen` ref pattern, then sets `deep` and jumps to match 0.

**Keys**, added to RepoView's existing `onKey` effect:

| Key | Action |
|---|---|
| `⌘F` / `Ctrl+F` | open + focus the input; `preventDefault` so the browser's own find bar stays shut |
| `Esc` | close, clear query and matches; selection stays where it landed |
| `Enter` | next match |
| `Shift+Enter` | previous match |

The effect's existing `tag !== 'INPUT' && tag !== 'TEXTAREA'` guard already stops `r`
(refresh) from firing while the user types in the search box.

Jumping selects the commit, which opens CommitPanel — identical to clicking the row. That
is accepted, not a side effect to suppress.

## Error handling

- The deep request fails → Toast with the error, `deep` stays `null` so the bar falls back
  to the local count. A failed search must not replace the graph with RepoView's full-pane
  error state; that state is reserved for a repo that cannot be read at all.
- A gone repo (410) is already handled by `refresh`; the escalation fetch reuses the same
  `api` helper and inherits it.
- Query matching nothing → `No results`, arrows inert, deep button still available.

## Testing

- `server/parse.test.ts` — `mergeMatches`: dedupe across lists, date-desc order, 500 cap
  and its `truncated` flag, empty input.
- `src/search.test.ts` — `matchLocal` across each field (subject, author, email, ref name,
  hash prefix), case-insensitivity, order matches input order, empty query returns nothing;
  `stepMatch` wrap at both ends, single match, zero matches; `label` for the empty, normal,
  truncated and deep cases.
- End-to-end via the `verify` skill: `⌘F` opens, typing finds a known subject, the counter
  reads correctly, arrows move the selection, `Esc` closes. Then a deep search on a large
  repo (`~/WORKSPACE/BLS/bikeleasing-app`, 14k commits — registered temporarily, then
  removed from config) for a subject that exists only deep in history, confirming the
  escalation lands and the row renders.
- Measure `/api/search` with `curl -w '%{time_total}'` on that repo before claiming it is
  fast. Two full-history `git log --grep` scans are the cost to watch. Confirm the local
  path issues no request at all (Network panel empty while typing).

## Known ceilings

Carried in the code as `ponytail:` comments, so they are tracked rather than forgotten:

- Deep match order is commit-date descending, which can disagree with `--date-order`'s
  topological tie-breaks, so `next` may occasionally step one row upward. Local mode is
  exact, because it filters the graph's own list. Fixing deep properly means a
  full-history `--format=%H` pass per query to recover exact graph positions.
- A deep match list isn't re-run when SSE reports a repo change, so a commit rewritten by
  rebase/amend leaves a stale hash that fails to resolve on jump. Local mode is immune —
  it derives from `commits`.

## Explicitly out of scope

Stash rows as search targets (they are selectable rows with subjects, but including them
means teaching `matchLocal` a second row type); tinting every loaded match; `<mark>`
substring highlight inside the subject cell; `author:` / `file:` query prefixes; ref-name
matching in deep mode; pickaxe (`-S`) content search; server-side match indices.
