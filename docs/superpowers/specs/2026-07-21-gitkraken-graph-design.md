# GitKraken-style graph: avatars + left ref chips

**Date:** 2026-07-21 · **Status:** approved (avatar source: Gravatar + initials fallback)

## Goal

Make the commit graph read like GitKraken:

1. Non-merge commit nodes render the author's avatar (Gravatar photo, initials-circle fallback) instead of a plain dot. Merge commits keep the small dot. WIP row keeps the hollow circle.
2. Branch/tag refs move to a dedicated column **left of the graph**, as chips with icons: monitor = local ref, GitHub mark = remote ref, tag glyph = tag. A branch present both locally and remotely at the same commit renders one chip with both icons. The checked-out branch (`HEAD ->`) chip gets a check mark.

## Changes

### Server

- `LOG_FORMAT` gains `%ae` (author email); `Commit` type gains `email: string`; `parseLog` splits the extra field. `parse.test.ts` updated.

### Avatar resolution (v2, approved 2026-07-21)

Order: GitHub profile photo → Gravatar → initials.

- `server/avatars.ts`: `GET /api/avatar?repo&email` resolves email → GitHub avatar. Noreply emails (`12345+user@users.noreply.github.com`) resolve locally to `avatars.githubusercontent.com/u/<id>`; other emails find one commit by that author (`git log --all -1 --author=<escaped email>`) and ask `api.github.com/repos/<owner>/<repo>/commits/<sha>` for `author.avatar_url`. Uses `gh auth token` when available (5000 req/h vs 60). Definitive results (incl. "no account") persist to `~/.config/megit/avatars.json`; rate-limit/network errors stay uncached for retry.

### Client

- `src/avatar.ts` (new): `useAvatar(repo, email)` — probes `/api/avatar` first, then Gravatar (`sha256hex(email)` via `crypto.subtle`, `?d=404&s=48`, `Image()` preload), else null → initials. Module-level result cache per email.
- `GraphView.tsx`:
  - `GraphCell`: non-merge commits draw ring circle (lane color) + clipped `<image>` when avatar loaded, else initials `<text>` on filled circle. Merge commits: existing 4px dot.
  - Row layout becomes: `refs-column | graph | subject | author | date | hash`.
  - Ref parsing per commit: strip `HEAD -> `, group `origin/x` with `x` → `{name, local, remote, tag, head}`; render chips right-aligned against the graph, truncated with ellipsis (max-width).
- `styles.css`: refs column width + chip styling (icon + text, ellipsis), avatar sizing.

## Non-goals

- No GitHub API username resolution.
- No per-remote distinction beyond "remote" (any `<remote>/` prefix counts).
- No graph re-layout changes (lanes.ts untouched).

## Testing

- `parse.test.ts` covers the email field.
- Existing lane tests untouched.
- E2E via `verify` skill: avatars/initials visible, chips left of graph with icons.
