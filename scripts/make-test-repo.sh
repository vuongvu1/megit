#!/usr/bin/env bash
# Regenerates test-repo/ — a git-ignored fixture repo for manually exercising megit
# and for the README screenshots. Interleaved commit dates matter: /api/graph uses
# --date-order, so parallel branches only weave into visible lanes when their
# timestamps overlap. Safe to delete and re-run.
set -euo pipefail

cd "$(dirname "$0")/.."
rm -rf test-repo
mkdir test-repo
cd test-repo

git init -q -b main
git config user.name "Ada Lovelace"
git config user.email "ada@example.com"

# commit <msg> <DD> <HH:MM> [author-name] [author-email]
commit() {
  local msg=$1 day=$2 time=$3 name=${4:-Ada Lovelace} email=${5:-ada@example.com}
  GIT_AUTHOR_DATE="2026-03-${day}T${time}:00" GIT_COMMITTER_DATE="2026-03-${day}T${time}:00" \
  GIT_AUTHOR_NAME="$name" GIT_AUTHOR_EMAIL="$email" \
    git commit -q -m "$msg"
}

# merge <branch> <DD> <HH:MM> — dated so the merge sits in the right lane position
merge() {
  GIT_AUTHOR_DATE="2026-03-${2}T${3}:00" GIT_COMMITTER_DATE="2026-03-${2}T${3}:00" \
    git merge -q --no-ff "$1" -m "merge $1"
}

w() { mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" >> "$1"; git add "$1"; }

# f <path> — write file from stdin (heredoc). Used where the diff itself is on
# screen in the README, so it needs to be a realistic multi-line change.
f() { mkdir -p "$(dirname "$1")"; cat > "$1"; git add "$1"; }

# ── main: project skeleton ────────────────────────────────────────────────────
w README.md "# starfield"                     ; commit "initial commit"              02 09:00
w src/index.ts "export const version = '0.1'" ; commit "add entry point"             02 11:30
w package.json '{ "name": "starfield" }'      ; commit "add package manifest"        03 09:15

# assets/star.svg exists to exercise the rich/source diff toggle: it is rendered
# as a picture by default, and the interesting edits below are ones the picture
# cannot show.
f assets/star.svg <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <circle id="core" cx="16" cy="16" r="5" fill="#f5c542"/>
  <path d="M16 2 L18 12 L28 16 L18 20 L16 30 L14 20 L4 16 L14 12 Z" fill="#ffffff"/>
</svg>
EOF
commit "add star sprite" 03 10:00

# ── feature/renderer: long-running, merges back ───────────────────────────────
git checkout -qb feature/renderer
f src/renderer.ts <<'EOF'
import { fps } from './config'

export type Sprite = { x: number; y: number; frame: number }

export function draw(ctx: CanvasRenderingContext2D, sprites: Sprite[]) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  for (const s of sprites) {
    ctx.drawImage(atlas, s.frame * 32, 0, 32, 32, s.x, s.y, 32, 32)
  }
}

export function frameBudget() {
  return 1000 / fps
}
EOF
commit "sketch renderer" 03 14:00 "Grace Hopper" "grace@example.com"

f src/renderer.ts <<'EOF'
import { fps } from './config'

export type Sprite = { x: number; y: number; frame: number }

// One drawImage per sprite stalls on state changes; group by atlas frame and
// emit a single batch per frame index instead.
export function draw(ctx: CanvasRenderingContext2D, sprites: Sprite[]) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  const byFrame = new Map<number, Sprite[]>()
  for (const s of sprites) {
    const bucket = byFrame.get(s.frame)
    if (bucket) bucket.push(s)
    else byFrame.set(s.frame, [s])
  }

  for (const [frame, batch] of byFrame) {
    for (const s of batch) {
      ctx.drawImage(atlas, frame * 32, 0, 32, 32, s.x, s.y, 32, 32)
    }
  }
}

export function frameBudget() {
  return 1000 / fps
}
EOF
commit "batch draw calls" 04 10:20 "Grace Hopper" "grace@example.com"

# ── main moves on in parallel ─────────────────────────────────────────────────
git checkout -q main
w src/config.ts "export const fps = 60"       ; commit "add config"                  04 08:45

# ── feature/particles: branches off main, stays unmerged ──────────────────────
git checkout -qb feature/particles
w src/particles.ts "export class Particle {}" ; commit "particle system skeleton"    04 16:10 "Alan Turing" "alan@example.com"
w src/particles.ts "// gravity"               ; commit "add gravity"                 05 09:30 "Alan Turing" "alan@example.com"

# ── back to renderer, then merge it ───────────────────────────────────────────
git checkout -q feature/renderer
f src/renderer.ts <<'EOF'
import { fps } from './config'

export type Sprite = { x: number; y: number; frame: number }

// One drawImage per sprite stalls on state changes; group by atlas frame and
// emit a single batch per frame index instead.
export function draw(ctx: CanvasRenderingContext2D, sprites: Sprite[]) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  const { width, height } = ctx.canvas
  const byFrame = new Map<number, Sprite[]>()

  for (const s of sprites) {
    // offscreen sprites still cost a drawImage call — drop them here
    if (s.x < -32 || s.y < -32 || s.x > width || s.y > height) continue

    const bucket = byFrame.get(s.frame)
    if (bucket) bucket.push(s)
    else byFrame.set(s.frame, [s])
  }

  for (const [frame, batch] of byFrame) {
    for (const s of batch) {
      ctx.drawImage(atlas, frame * 32, 0, 32, 32, s.x, s.y, 32, 32)
    }
  }
}

export function frameBudget() {
  return 1000 / fps
}
EOF
commit "cull offscreen sprites" 05 11:00 "Grace Hopper" "grace@example.com"

f test/renderer.test.ts <<'EOF'
import { describe, expect, it } from 'vitest'
import { frameBudget } from '../src/renderer'

describe('frameBudget', () => {
  it('is derived from the configured fps', () => {
    expect(frameBudget()).toBeCloseTo(16.67, 1)
  })
})
EOF
commit "start renderer tests" 05 15:45 "Grace Hopper" "grace@example.com"

git checkout -q main
merge feature/renderer 06 09:00

# ── hotfix off main, merged straight back ─────────────────────────────────────
git checkout -qb fix/nan-positions
w src/renderer.ts "// guard against NaN"      ; commit "guard against NaN positions" 06 13:20
git checkout -q main
merge fix/nan-positions 06 15:00

# ── particles picks up again, interleaved with main ───────────────────────────
git checkout -q feature/particles
w src/particles.ts "// collision response"    ; commit "collision response"          06 17:40 "Alan Turing" "alan@example.com"

git checkout -q main
w docs/architecture.md "# Architecture"       ; commit "document architecture"       07 10:00

# Two of these three edits are invisible in the rendered SVG — the id rename and
# the one-digit fill change. Only the second star shows up in the picture. This
# is the commit to open when checking that the source diff is reachable.
f assets/star.svg <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <circle id="star-core" cx="16" cy="16" r="5" fill="#f5c53f"/>
  <path d="M16 2 L18 12 L28 16 L18 20 L16 30 L14 20 L4 16 L14 12 Z" fill="#ffffff"/>
  <path d="M26 4 L27 8 L31 9 L27 10 L26 14 L25 10 L21 9 L25 8 Z" fill="#9aa7b5"/>
</svg>
EOF
commit "add a second star, tune the core" 07 11:00

w src/index.ts "// boot the renderer"         ; commit "boot the renderer"           07 14:25

# ── chore branch, never merged ────────────────────────────────────────────────
git checkout -qb chore/bump-deps
w package.json '{ "devDependencies": {} }'    ; commit "bump dev dependencies"       07 16:00 "Grace Hopper" "grace@example.com"

git checkout -q main
w src/config.ts "export const vsync = true"   ; commit "enable vsync by default"     08 09:10

# ── two stashes ───────────────────────────────────────────────────────────────
printf '%s\n' "// bloom shader spike" > src/experiment.ts
git add src/experiment.ts
git stash push -q -m "spike: bloom shader"
printf '%s\n' "// half-finished profiler" >> src/index.ts
git stash push -q -m "wip: frame profiler"

# ── dirty worktree: staged, unstaged, and untracked all at once ───────────────
cat > src/config.ts <<'EOF'
export const fps = 60
export const vsync = true

// tunables, overridable from the debug overlay
export const maxSprites = 4096
export const cullMargin = 32
EOF
git add src/config.ts                      # staged

cat >> README.md <<'EOF'

## Roadmap

- [x] sprite batching
- [ ] particle collisions
- [ ] bloom post-processing
EOF
                                           # unstaged
cat > NOTES.md <<'EOF'
Profiler shows 3ms in draw() on the 4k-sprite scene.
Most of it is the per-frame Map allocation — reuse it across frames.
EOF
                                           # untracked

# unstaged SVG edit: a role and a <title>, neither of which alters a single
# rendered pixel. Open this from the WIP row to see why the source diff needs
# to be reachable at all.
cat > assets/star.svg <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img">
  <title>Star sprite</title>
  <circle id="star-core" cx="16" cy="16" r="5" fill="#f5c53f"/>
  <path d="M16 2 L18 12 L28 16 L18 20 L16 30 L14 20 L4 16 L14 12 Z" fill="#ffffff"/>
  <path d="M26 4 L27 8 L31 9 L27 10 L26 14 L25 10 L21 9 L25 8 Z" fill="#9aa7b5"/>
</svg>
EOF
                                           # unstaged

echo "test-repo ready: $(git log --oneline --all | wc -l | tr -d ' ') commits, $(git branch | wc -l | tr -d ' ') branches, $(git stash list | wc -l | tr -d ' ') stashes, dirty worktree"
