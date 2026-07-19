import { describe, it, expect, vi } from 'vitest'
import { isRelevant, createDebouncer } from './watch.ts'

describe('isRelevant', () => {
  it.each<[string, boolean]>([
    // working tree: everything counts, including git-ignored dirs (over-notify by design)
    ['src/App.tsx', true],
    ['README.md', true],
    ['node_modules/x/index.js', true],
    ['.gitignore', true],
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
