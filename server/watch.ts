// Filesystem watching for auto-refresh: which paths matter, and event debouncing.

// rel is '/'-separated relative to the repo root (fs.watch recursive on macOS).
// Working-tree paths all count — including git-ignored dirs; over-notifying is
// fine because the client refetch is cheap and fingerprint-gated.
// Inside .git only the ref/index surface counts; objects/lock/log churn is noise.
export function isRelevant(rel: string): boolean {
  if (rel === '.git') return false
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
