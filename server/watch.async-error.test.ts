// fs.watch reports a bad path differently per platform: macOS and Windows throw
// from watch(), while Linux — where recursive watching is layered over inotify —
// returns a watcher and emits 'error' later. Only the synchronous path is
// reachable with a real fs on macOS, and deleting a watched directory there
// produces no error at all, so the asynchronous path is mocked here rather than
// left to be discovered on a Linux CI runner.
//
// Separate file: the mock replaces node:fs for the whole module graph, and
// watch.test.ts needs the real one for its integration tests.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

// Real directories: subscribe() rejects a missing path before it ever reaches
// fs.watch, so these have to exist for the mocked watcher to be created at all.
const dirs: string[] = []
const freshDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'megit-mock-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  expect(activeWatcherCount()).toBe(0)
})

describe('subscribe, when a started watcher errors later', () => {
  it('reports the failure through onError and drops the registry entry', () => {
    let failed = false
    subscribe(freshDir(), () => {}, () => { failed = true })
    expect(activeWatcherCount()).toBe(1)

    lastWatcher().emit('error', Object.assign(new Error('watch ENOENT'), { code: 'ENOENT' }))

    expect(failed).toBe(true)
    expect(activeWatcherCount()).toBe(0)
  })

  it('survives a watcher whose close() throws', () => {
    let failed = false
    subscribe(freshDir(), () => {}, () => { failed = true })

    // a watcher whose directory vanished may refuse to close; an uncaught throw
    // here would escape the 'error' handler and take the process down
    lastWatcher().close = () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) }

    expect(() => lastWatcher().emit('error', new Error('watch ENOENT'))).not.toThrow()
    expect(failed).toBe(true)
    expect(activeWatcherCount()).toBe(0)
  })
})
