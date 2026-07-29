// fs.watch reports a bad path differently per platform: macOS and Windows throw
// from watch(), while Linux — where recursive watching is layered over inotify —
// returns a watcher and emits 'error' later. Only the synchronous path is
// reachable with a real fs on macOS, and deleting a watched directory there
// produces no error at all, so the asynchronous path is mocked here rather than
// left to be discovered on a Linux CI runner.
//
// Separate file: the mock replaces node:fs for the whole module graph, and
// watch.test.ts needs the real one for its integration tests.
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const h = vi.hoisted(() => ({ watchers: [] as (EventEmitter & { close: () => void })[] }))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    watch: () => {
      const w = Object.assign(new EventEmitter(), { close: () => {} })
      h.watchers.push(w)
      return w
    },
  }
})

const { subscribe, activeWatcherCount } = await import('./watch.ts')

const lastWatcher = () => h.watchers[h.watchers.length - 1]

describe('subscribe, when fs.watch defers the error (the Linux path)', () => {
  it('reports the failure through onError and drops the registry entry', () => {
    let failed = false
    expect(() => subscribe('/nonexistent/a', () => {}, () => { failed = true })).not.toThrow()

    // registered optimistically — this is the window that leaked into other tests
    expect(activeWatcherCount()).toBe(1)

    lastWatcher().emit('error', Object.assign(new Error('watch ENOENT'), { code: 'ENOENT' }))

    expect(failed).toBe(true)
    expect(activeWatcherCount()).toBe(0)
  })

  it('survives a watcher whose close() throws', () => {
    let failed = false
    subscribe('/nonexistent/b', () => {}, () => { failed = true })

    // closing a watcher that never started is not portable; an uncaught throw here
    // would escape the 'error' handler and take the process down
    lastWatcher().close = () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) }

    expect(() => lastWatcher().emit('error', new Error('watch ENOENT'))).not.toThrow()
    expect(failed).toBe(true)
    expect(activeWatcherCount()).toBe(0)
  })
})
