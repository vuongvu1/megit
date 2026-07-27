import { describe, it, expect } from 'vitest'
import { toolbar, type ToolbarAction, type ToolbarCtx } from './toolbar'

// on main, one commit ahead of origin/main, dirty worktree, one stash
const base: ToolbarCtx = {
  branch: 'main',
  remotes: ['origin'],
  upstream: 'origin/main',
  ahead: 1,
  behind: 0,
  dirty: true,
  stashCount: 1,
  head: { parents: ['bbb'], refs: ['HEAD -> main'] },
}
const btn = (ctx: Partial<ToolbarCtx>, action: ToolbarAction) =>
  toolbar({ ...base, ...ctx }).find(b => b.action === action)!

describe('toolbar', () => {
  it('always renders the same six buttons in the same order', () => {
    expect(toolbar(base).map(b => b.action)).toEqual(['pull', 'push', 'branch', 'stash', 'pop', 'undo'])
    // an empty repo with no remote still shows all six — the bar must not reflow
    expect(toolbar({ ...base, remotes: [], upstream: null, head: null, dirty: false, stashCount: 0 })).toHaveLength(6)
  })

  it('badges pull with behind and push with ahead, omitting zeroes', () => {
    expect(btn({ behind: 3 }, 'pull').badge).toBe(3)
    expect(btn({ behind: 0 }, 'pull').badge).toBeUndefined()
    expect(btn({ ahead: 2 }, 'push').badge).toBe(2)
    expect(btn({ ahead: 0 }, 'push').badge).toBeUndefined()
  })

  it('disables pull and push without a remote', () => {
    expect(btn({ remotes: [], upstream: null }, 'pull').disabled).toMatch(/no remote/)
    expect(btn({ remotes: [], upstream: null }, 'push').disabled).toMatch(/no remote/)
  })

  it('keeps push live for a first push, but disables pull', () => {
    // no upstream yet + exactly one remote: the server's `push -u` sets it
    const first = { upstream: null, ahead: 0, behind: 0 }
    expect(btn(first, 'push').disabled).toBeUndefined()
    expect(btn(first, 'pull').disabled).toMatch(/no upstream/)
    // more than one remote and push can't guess which — the chip menu sets it
    expect(btn({ ...first, remotes: ['origin', 'fork'] }, 'push').disabled).toMatch(/no upstream/)
  })

  it('disables push with nothing to push, and on a detached HEAD', () => {
    expect(btn({ ahead: 0 }, 'push').disabled).toMatch(/nothing to push/)
    expect(btn({ branch: null }, 'push').disabled).toMatch(/detached/)
  })

  it('stays live for pull when up to date — a fetch may still find something', () => {
    expect(btn({ ahead: 0, behind: 0 }, 'pull').disabled).toBeUndefined()
  })

  it('gates stash on a dirty worktree and pop on a stash existing', () => {
    expect(btn({ dirty: false }, 'stash').disabled).toMatch(/nothing to stash/)
    expect(btn({ dirty: true }, 'stash').disabled).toBeUndefined()
    expect(btn({ stashCount: 0 }, 'pop').disabled).toMatch(/no stash/)
    expect(btn({ stashCount: 2 }, 'pop').badge).toBe(2)
  })

  it('needs a commit to branch from', () => {
    expect(btn({ head: null }, 'branch').disabled).toMatch(/no commits/)
    // detached is fine: a branch can be created at any commit
    expect(btn({ branch: null }, 'branch').disabled).toBeUndefined()
  })

  describe('undo', () => {
    it('undoes a single-parent unpushed tip', () => {
      expect(btn({}, 'undo').disabled).toBeUndefined()
    })

    it('refuses a merge or a root commit — a soft reset of either is not an undo', () => {
      expect(btn({ head: { parents: ['bbb', 'ccc'], refs: [] } }, 'undo').disabled).toMatch(/merge/)
      expect(btn({ head: { parents: [], refs: [] } }, 'undo').disabled).toMatch(/first commit/)
    })

    it('refuses a pushed tip: undoing it would need a force push', () => {
      expect(btn({ head: { parents: ['bbb'], refs: ['HEAD -> main', 'origin/main'] } }, 'undo').disabled).toMatch(/pushed/)
      // "origin/HEAD -> origin/main" is a symref pointer, not a second branch — but it
      // only ever sits where origin/main sits, so either way the tip counts as pushed
      expect(btn({ head: { parents: ['bbb'], refs: ['HEAD -> main', 'my-origin/main'], }, remotes: ['my-origin'] }, 'undo').disabled).toMatch(/pushed/)
      // a tag on the tip is not a remote ref
      expect(btn({ head: { parents: ['bbb'], refs: ['HEAD -> main', 'tag: v1.0'] } }, 'undo').disabled).toBeUndefined()
      // a local branch whose name starts with a remote's name is not a remote ref
      expect(btn({ head: { parents: ['bbb'], refs: ['HEAD -> origin-fix'] } }, 'undo').disabled).toBeUndefined()
    })

    it('refuses an empty repo and a detached HEAD', () => {
      expect(btn({ head: null }, 'undo').disabled).toMatch(/nothing to undo/)
      expect(btn({ branch: null }, 'undo').disabled).toMatch(/detached/)
    })
  })
})
