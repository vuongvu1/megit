import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { isLinkedWorktree, isWorktreeGitdir, listWorktrees, worktreesWithCounts, heldBy, watchRepo } from './worktrees.ts'
import { activeWatcherCount } from './watch.ts'

const git = (repo: string, args: string[], okCodes: number[] = [0]): Promise<string> =>
  new Promise((res, rej) => {
    execFile('git', ['-C', repo, ...args], (err, stdout, stderr) => {
      if (err && !okCodes.includes(typeof err.code === 'number' ? err.code : 1)) rej(new Error(stderr.trim() || err.message))
      else res(stdout)
    })
  })

const run = (cwd: string, ...a: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a])

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await sleep(50)
  }
}

// root is deliberately NOT realpath'd: macOS tmpdir is a /var → /private/var
// symlink, and git lists resolved paths — the code under test must cope.
const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'megit-wt-'))
  roots.push(root)
  const repo = join(root, 'main')
  const wt = join(root, 'wt')
  execFileSync('git', ['init', '-b', 'main', repo])
  run(repo, 'commit', '--allow-empty', '-m', 'init')
  run(repo, 'worktree', 'add', wt, '-b', 'feat')
  return { root, repo, wt }
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe('isWorktreeGitdir', () => {
  it('matches only a gitdir that ends in worktrees/<name>', () => {
    expect(isWorktreeGitdir('/r/.git/worktrees/wt')).toBe(true)
    expect(isWorktreeGitdir('/r/.git/worktrees/wt/')).toBe(true)
    expect(isWorktreeGitdir('C:\\r\\.git\\worktrees\\wt')).toBe(true)
    expect(isWorktreeGitdir('/r/.git/modules/sub')).toBe(false)
    // a submodule inside a linked worktree is not itself a linked worktree
    expect(isWorktreeGitdir('/r/.git/worktrees/wt/modules/sub')).toBe(false)
  })
})

describe('heldBy', () => {
  it('fails open: a git error answers null so git\'s own refusal applies', async () => {
    const broken = async () => { throw new Error('unknown option -z') }
    expect(await heldBy(tmpdir(), 'main', broken)).toBeNull()
  })
})

// see watch.test.ts: real recursive fs.watch kills the vitest worker on Windows
const integration = process.platform === 'win32' ? describe.skip : describe

integration('worktrees (integration)', () => {
  it('isLinkedWorktree', () => {
    const { root, repo, wt } = fixture()
    expect(isLinkedWorktree(wt)).toBe(true)
    expect(isLinkedWorktree(repo)).toBe(false)
    expect(isLinkedWorktree(join(root, 'nope'))).toBe(false)
  })

  it('worktreesWithCounts counts changes and marks the current one', async () => {
    const { repo, wt } = fixture()
    writeFileSync(join(wt, 'file.txt'), 'x')
    const list = await worktreesWithCounts(repo, git)
    expect(list).toHaveLength(2)
    const w = list.find(x => x.path === realpathSync(wt))!
    const r = list.find(x => x.path === realpathSync(repo))!
    expect(w).toMatchObject({ branch: 'feat', changed: 1, current: false })
    expect(r).toMatchObject({ branch: 'main', changed: 0, current: true })
  })

  it('single worktree: [] without running status', async () => {
    const root = mkdtempSync(join(tmpdir(), 'megit-wt-'))
    roots.push(root)
    execFileSync('git', ['init', '-b', 'main', root])
    run(root, 'commit', '--allow-empty', '-m', 'init')
    const spy = vi.fn(git)
    expect(await worktreesWithCounts(root, spy)).toEqual([])
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toEqual(['worktree', 'list', '--porcelain'])
  })

  it('heldBy names a different worktree holding the branch', async () => {
    const { repo, wt } = fixture()
    expect(await heldBy(repo, 'feat', git)).toBe(realpathSync(wt))
    expect(await heldBy(repo, 'main', git)).toBeNull() // main is current
    expect(await heldBy(wt, 'main', git)).toBe(realpathSync(repo))
  })

  it('listWorktrees drops a removed worktree', async () => {
    const { repo, wt } = fixture()
    run(repo, 'worktree', 'remove', wt)
    const paths = (await listWorktrees(repo, git)).map(w => w.path)
    expect(paths).toEqual([realpathSync(repo)])
  })
})

integration('watchRepo (integration, real fs + timers)', () => {
  afterEach(() => {
    expect(activeWatcherCount(), 'test leaked a watcher into the shared registry').toBe(0)
  })

  // warm up FSEvents and let any events from fixture setup flush past the debounce
  async function settle(events: string[]) {
    await sleep(700)
    events.length = 0
  }

  it('a commit inside a linked worktree sends changed', async () => {
    const { wt } = fixture()
    const events: string[] = []
    const unsub = await watchRepo(wt, git, k => events.push(k), () => {})
    try {
      await settle(events)
      run(wt, 'commit', '--allow-empty', '-m', 'in wt')
      await waitFor(() => events.includes('changed'), 5000)
    } finally {
      unsub()
    }
  }, 15000)

  it('editing a sibling worktree sends worktrees, not changed', async () => {
    const { repo, wt } = fixture()
    const events: string[] = []
    const unsub = await watchRepo(repo, git, k => events.push(k), () => {})
    try {
      await settle(events)
      writeFileSync(join(wt, 'file.txt'), 'x')
      await waitFor(() => events.includes('worktrees'), 5000)
      await sleep(800)
      expect(events).not.toContain('changed')
    } finally {
      unsub()
    }
  }, 15000)

  it('a worktree nested inside the repo sends worktrees only', async () => {
    const { repo } = fixture()
    const n = join(repo, '.claude', 'worktrees', 'n')
    mkdirSync(join(repo, '.claude', 'worktrees'), { recursive: true })
    run(repo, 'worktree', 'add', n, '-b', 'n')
    const events: string[] = []
    const unsub = await watchRepo(repo, git, k => events.push(k), () => {})
    try {
      await settle(events)
      writeFileSync(join(n, 'f'), 'x')
      await waitFor(() => events.includes('worktrees'), 5000)
      await sleep(2500) // past the debouncer's max-wait
      expect(events).not.toContain('changed')
    } finally {
      unsub()
    }
  }, 15000)

  it('viewing a nested worktree: an edit inside it sends changed, not worktrees', async () => {
    const { repo } = fixture()
    const n = join(repo, '.claude', 'worktrees', 'n')
    mkdirSync(join(repo, '.claude', 'worktrees'), { recursive: true })
    run(repo, 'worktree', 'add', n, '-b', 'n')
    const events: string[] = []
    const unsub = await watchRepo(n, git, k => events.push(k), () => {})
    try {
      await settle(events)
      writeFileSync(join(n, 'f'), 'x')
      await waitFor(() => events.includes('changed'), 5000)
      await sleep(2500) // past the debouncer's max-wait
      expect(events).not.toContain('worktrees')
    } finally {
      unsub()
    }
  }, 15000)
})
