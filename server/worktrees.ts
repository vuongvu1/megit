// Linked worktrees: listing, per-worktree change counts, which worktree holds a
// branch, and the watch set that keeps a repo tab fresh across all of them.

import { readFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseStatus, parseWorktrees } from './parse.ts'
import type { WorktreeEntry } from './parse.ts'
import { isGitDirRelevant, isRelevant, setIgnored, subscribe } from './watch.ts'

export type Git = (repo: string, args: string[], okCodes?: number[]) => Promise<string>

export type Worktree = { path: string; branch: string | null; head: string; changed: number; current: boolean }

// git lists resolved paths; the caller's may go through a symlink (macOS /var →
// /private/var), so every path comparison happens after realpath on both sides.
// A path that no longer exists compares as given.
const real = (p: string) => realpath(p).catch(() => p)

// A linked worktree's .git is a file pointing into <common>/worktrees/<name>;
// a submodule's points into .../modules/<name> instead and is not one — including
// a submodule of a linked worktree (.../worktrees/<n>/modules/<x>), hence the anchor.
export const isWorktreeGitdir = (gitdir: string) => /[\\/]worktrees[\\/][^\\/]+[\\/]?$/.test(gitdir.trim())

export function isLinkedWorktree(dir: string): boolean {
  try {
    const m = readFileSync(join(dir, '.git'), 'utf8').match(/^gitdir: (.*)$/m)
    return !!m && isWorktreeGitdir(m[1])
  } catch {
    return false // missing, or a directory (main worktree)
  }
}

export async function listWorktrees(repo: string, git: Git): Promise<WorktreeEntry[]> {
  const raw = await git(repo, ['worktree', 'list', '--porcelain'])
  return parseWorktrees(raw).filter(w => !w.prunable && !w.bare)
}

// ponytail: every worktree's status is recomputed on every call — one process per
// worktree, in parallel. A per-path dirty cache (invalidated by the watch set) is
// the upgrade if this ever shows up in a measurement.
export async function worktreesWithCounts(repo: string, git: Git): Promise<Worktree[]> {
  const list = await listWorktrees(repo, git)
  if (list.length <= 1) return []
  const self = await real(repo)
  return Promise.all(
    list.map(async w => {
      // --no-optional-locks: status must not refresh .git/worktrees/<n>/index, a watched path (changed → refetch → status echo)
      const changed = await git(w.path, ['--no-optional-locks', 'status', '--porcelain=v2', '-uall', '-z']).then(
        raw => parseStatus(raw).length,
        () => 0,
      )
      return { path: w.path, branch: w.branch, head: w.head, changed, current: (await real(w.path)) === self }
    }),
  )
}

// The path of a *different* worktree that has `branch` checked out — git refuses
// to check it out a second time. Fails open: on any error git's own refusal still
// applies, and nothing is stashed yet when it does (the stash comes after this).
export async function heldBy(repo: string, branch: string, git: Git): Promise<string | null> {
  try {
    const self = await real(repo)
    for (const w of await listWorktrees(repo, git)) {
      if (w.branch === branch && (await real(w.path)) !== self) return w.path
    }
  } catch { /* fall through */ }
  return null
}

// Watches `repo` (sends 'changed'), its common git dir when it is a linked
// worktree (a commit there lands in the common dir, not the worktree), and every
// sibling worktree (sends 'worktrees', so only the counts refetch). The sibling set
// is reconciled after each 'changed' fire, since worktree add/remove touches the
// common dir. A worktree nested inside any watched root (`repo` or a sibling) is
// ignored by that root's watcher and counted by its own.
export async function watchRepo(
  repo: string,
  git: Git,
  send: (kind: 'changed' | 'worktrees') => void,
  onError: () => void,
): Promise<() => void> {
  const self = await real(repo)
  const common = isLinkedWorktree(repo)
    // not --path-format=absolute (git ≥ 2.31): the bare form may print a relative path
    ? resolve(repo, (await git(repo, ['rev-parse', '--git-common-dir'])).trim())
    : null
  const siblings = new Map<string, () => void>() // realpath → unsubscribe
  let closed = false
  let queue: Promise<void> = Promise.resolve()

  // serialized so two overlapping runs can't both subscribe the same new sibling
  const reconcile = () =>
    (queue = queue
      .then(async () => {
        if (closed) return
        const paths = await Promise.all((await listWorktrees(repo, git)).map(w => real(w.path)))
        if (closed) return
        const others = new Set(paths.filter(p => p !== self))
        for (const [p, unsub] of siblings) {
          if (!others.has(p)) {
            unsub()
            siblings.delete(p)
          }
        }
        for (const p of others) {
          if (siblings.has(p)) continue
          try {
            siblings.set(p, subscribe(p, () => send('worktrees'), () => siblings.delete(p), isRelevant))
          } catch {
            // gone since listing — it is prunable or absent next time round
          }
        }
        // Every watched root ignores the worktrees nested under it: each is counted
        // by its own watcher, and a parent's count never includes them — so this is
        // right for every subscriber sharing the entry. Without it, viewing nested N
        // fires 'worktrees' from parent M's sibling watcher on every edit in N.
        // Re-applied every run: the ignore list lives on the watcher entry and is
        // lost if that watcher errors and is re-created.
        const nestedUnder = (root: string) =>
          paths
            .map(p => relative(root, p))
            .filter(rel => rel && !rel.startsWith('..') && !isAbsolute(rel))
            .map(rel => rel.split(sep).join('/'))
        setIgnored(repo, nestedUnder(self))
        for (const p of siblings.keys()) setIgnored(p, nestedUnder(p))
      })
      .catch(() => {}))

  const changed = () => {
    send('changed')
    void reconcile()
  }
  const unsubs = [subscribe(repo, changed, onError, isRelevant)]
  if (common) {
    try {
      unsubs.push(subscribe(common, changed, onError, isGitDirRelevant))
    } catch (e) {
      unsubs[0]()
      throw e
    }
  }
  await reconcile()
  return () => {
    closed = true
    for (const u of unsubs) u()
    for (const u of siblings.values()) u()
    siblings.clear()
  }
}
