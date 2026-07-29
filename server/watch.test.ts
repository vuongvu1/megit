import { describe, it, expect, vi, afterEach } from 'vitest'
import { isRelevant, createDebouncer } from './watch.ts'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { subscribe, activeWatcherCount } from './watch.ts'

describe('isRelevant', () => {
  it.each<[string, boolean]>([
    // working tree: everything counts, including git-ignored files (over-notify by design)
    ['src/App.tsx', true],
    ['README.md', true],
    ['.gitignore', true],
    ['distributed/x.ts', true], // NOISE matches whole segments only
    ['src/node_modules_helper.ts', true],
    // …except dependency/build dirs, whose churn git never reports on
    ['node_modules/x/index.js', false],
    ['node_modules', false],
    ['dist/assets/index.js', false],
    ['.next/cache/x', false],
    // .git internals: only the ref/index surface counts
    ['.git/HEAD', true],
    ['.git/index', true],
    ['.git/packed-refs', true],
    ['.git/refs/heads/main', true],
    ['.git/refs/tags/v1', true],
    ['.git', false],
    ['.git/objects/ab/cdef0123', false],
    ['.git/index.lock', false],
    ['.git/logs/HEAD', false],
    ['.git/FETCH_HEAD', false],
    ['.git/COMMIT_EDITMSG', false],
  ])('%s → %s', (path, expected) => {
    expect(isRelevant(path)).toBe(expected)
  })
})

describe('createDebouncer', () => {
  it('coalesces a burst into one trailing flush', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const d = createDebouncer(fire, 400, 2000)
    d.hit()
    vi.advanceTimersByTime(100)
    d.hit()
    vi.advanceTimersByTime(100)
    d.hit()
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(fire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(fire).toHaveBeenCalledTimes(1) // no stray max-wait flush after quiet
    vi.useRealTimers()
  })

  it('spaced events flush separately', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const d = createDebouncer(fire, 400, 2000)
    d.hit()
    vi.advanceTimersByTime(500)
    expect(fire).toHaveBeenCalledTimes(1)
    d.hit()
    vi.advanceTimersByTime(500)
    expect(fire).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('continuous churn still flushes at maxWait', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const d = createDebouncer(fire, 400, 2000)
    // hits every 300 ms — trailing timer never gets 400 ms of quiet
    for (let i = 0; i < 10; i++) {
      d.hit()
      vi.advanceTimersByTime(300)
    }
    // t = 3000 now; the 2 s cap fired exactly once during the churn
    expect(fire).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(400) // trailing flush for the tail of the burst
    expect(fire).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('dispose cancels pending flushes', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const d = createDebouncer(fire, 400, 2000)
    d.hit()
    d.dispose()
    vi.advanceTimersByTime(5000)
    expect(fire).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await sleep(50)
  }
}

describe('subscribe (integration, real fs + timers)', () => {
  // `entries` is module-level state shared by every test here. Without this, a test
  // that leaks a watcher fails the *next* test's count assertion instead of its own,
  // which is how a platform difference in one test turned into two confusing failures.
  afterEach(() => {
    expect(activeWatcherCount(), 'test leaked a watcher into the shared registry').toBe(0)
  })

  it('fires on working-tree change and on commit; unsubscribe stops events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'megit-watch-'))
    try {
      execFileSync('git', ['-C', dir, 'init'])
      let events = 0
      const unsub = subscribe(dir, () => { events++ }, () => {})
      await sleep(300) // FSEvents warm-up

      writeFileSync(join(dir, 'a.txt'), 'hello')
      await waitFor(() => events >= 1, 5000) // ~400 ms debounce + fs latency

      const before = events
      execFileSync('git', ['-C', dir, 'add', '.'])
      execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'x'])
      await waitFor(() => events > before, 5000)

      unsub()
      const after = events
      writeFileSync(join(dir, 'b.txt'), 'bye')
      await sleep(800) // > debounce window
      expect(events).toBe(after)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15000)

  // subscribe() checks the path itself rather than letting fs.watch decide, because
  // fs.watch disagrees across platforms: macOS and Windows reject a missing path,
  // but Linux hands back a watcher that never fires and never errors. See watch.ts.
  it('throws for a missing path, registering nothing', () => {
    const missing = join(tmpdir(), `megit-does-not-exist-${process.pid}`)
    expect(() => subscribe(missing, () => {}, () => {})).toThrow(/ENOENT/)
    expect(activeWatcherCount()).toBe(0)
  })

  it('stale double-unsubscribe does not evict a newer subscription from the registry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'megit-watch-'))
    try {
      execFileSync('git', ['-C', dir, 'init'])
      const unsub1 = subscribe(dir, () => {}, () => {})
      unsub1()
      expect(activeWatcherCount()).toBe(0)
      let events = 0
      const unsub2 = subscribe(dir, () => { events++ }, () => {})
      expect(activeWatcherCount()).toBe(1)
      unsub1() // stale second call must not evict the live entry
      expect(activeWatcherCount()).toBe(1) // ← discriminates: 0 under the pre-fix code
      await sleep(300) // FSEvents warm-up
      writeFileSync(join(dir, 'a.txt'), 'x')
      await waitFor(() => events >= 1, 5000)
      unsub2()
      expect(activeWatcherCount()).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15000)
})
