// Filesystem watching for auto-refresh: which paths matter, and event debouncing.

import { existsSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'

// dependency/build dirs git will never report on: an install or a bundler watch
// otherwise pins the debouncer's max-wait cap and refetches the graph every 2 s
const NOISE = /^(node_modules|dist|build|target|out|coverage|\.next|\.nuxt|\.turbo|\.venv|__pycache__)(\/|$)/

// rel is '/'-separated relative to the repo root (fs.watch recursive on macOS).
// Working-tree paths count — including git-ignored ones; over-notifying is fine
// because the client refetch is cheap and fingerprint-gated. Exception: NOISE.
// Inside .git only the ref/index surface counts; objects/lock/log churn is noise.
export function isRelevant(rel: string): boolean {
  if (rel === '.git') return false
  if (NOISE.test(rel)) return false
  if (!rel.startsWith('.git/')) return true
  const inner = rel.slice('.git/'.length)
  return inner === 'HEAD' || inner === 'index' || inner === 'packed-refs' || inner.startsWith('refs/')
}

export type Debouncer = { hit: () => void; dispose: () => void }

// Trailing debounce with a max-wait cap: quiet bursts flush once after `delay`;
// sustained churn (long install, big rebase) still flushes every `maxWait`.
export function createDebouncer(fire: () => void, delay = 400, maxWait = 2000): Debouncer {
  let trailing: NodeJS.Timeout | null = null
  let cap: NodeJS.Timeout | null = null
  const clear = () => {
    if (trailing) clearTimeout(trailing)
    if (cap) clearTimeout(cap)
    trailing = cap = null
  }
  const flush = () => {
    clear()
    fire()
  }
  return {
    hit() {
      if (trailing) clearTimeout(trailing)
      trailing = setTimeout(flush, delay)
      if (!cap) cap = setTimeout(flush, maxWait)
    },
    dispose: clear,
  }
}

type Sub = { onChange: () => void; onError: () => void }
type Entry = { watcher: FSWatcher; debouncer: Debouncer; subs: Set<Sub> }

const entries = new Map<string, Entry>()

// test introspection: how many repos have a live watcher entry
export function activeWatcherCount(): number {
  return entries.size
}

// One shared recursive watcher per repo, alive only while subscribed.
export function subscribe(repo: string, onChange: () => void, onError: () => void): () => void {
  let entry = entries.get(repo)
  if (!entry) {
    // fs.watch does not agree across platforms about a path that isn't there:
    // macOS and Windows reject it, but Linux — where recursive watching is layered
    // over inotify — hands back a watcher that never fires and never errors. That
    // silently dead subscription is worse than a failure, because the caller has no
    // way to find out. Checking here makes the contract identical everywhere:
    // subscribing to a missing path throws, and registers nothing.
    if (!existsSync(repo)) {
      throw Object.assign(new Error(`ENOENT: no such directory, watch '${repo}'`), { code: 'ENOENT' })
    }
    const subs = new Set<Sub>()
    const debouncer = createDebouncer(() => {
      for (const s of subs) s.onChange()
    })
    const watcher = watch(repo, { recursive: true }, (_event, filename) => {
      // null filename: platform couldn't tell — refresh conservatively
      if (filename === null || isRelevant(filename.toString())) debouncer.hit()
    })
    const fresh: Entry = { watcher, debouncer, subs }
    watcher.on('error', () => {
      entries.delete(repo)
      debouncer.dispose()
      // The watcher may have failed before it ever started (a path that vanished, or
      // never existed — Linux reports that here rather than throwing from watch()).
      // Closing one in that state is not portable, and a throw inside an 'error'
      // handler is an uncaught exception that takes the server down with it.
      try {
        watcher.close()
      } catch { /* already dead — nothing to release */ }
      for (const s of [...subs]) s.onError()
      subs.clear()
    })
    entries.set(repo, fresh)
    entry = fresh
  }
  const sub: Sub = { onChange, onError }
  entry.subs.add(sub)
  return () => {
    entry.subs.delete(sub)
    if (entry.subs.size === 0 && entries.get(repo) === entry) {
      entry.watcher.close()
      entry.debouncer.dispose()
      entries.delete(repo)
    }
  }
}
