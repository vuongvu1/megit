import { describe, it, expect, vi } from 'vitest'
import { commitMenu, type CommitCtx } from './commitMenu'

const ctx = (over: Partial<CommitCtx> = {}): CommitCtx =>
  ({ isHead: false, current: 'main', canLink: true, run: vi.fn(), ...over })

const labels = (c: CommitCtx) => commitMenu(c).map(i => i.label)

describe('commitMenu', () => {
  it('offers the full set on another commit while on a branch', () => {
    expect(labels(ctx())).toEqual([
      'Checkout this commit',
      'Cherry-pick onto main', 'Revert commit',
      'Create branch here…', 'Create tag here…',
      'Reset main here, keep changes', 'Reset main here, unstage changes', 'Reset main here, discard changes',
      'Copy commit sha', 'Copy GitHub link',
    ])
  })

  it('drops what is meaningless on the commit HEAD is already at, but keeps revert', () => {
    const items = labels(ctx({ isHead: true }))
    // revert stays: undoing the commit you just made is the common case
    expect(items).toEqual(['Revert commit', 'Create branch here…', 'Create tag here…', 'Copy commit sha', 'Copy GitHub link'])
    expect(items).not.toContain('Checkout this commit')
    expect(items).not.toContain('Cherry-pick onto main')
    expect(items.some(l => l.startsWith('Reset'))).toBe(false)
  })

  it('drops branch-relative actions on a detached HEAD', () => {
    const items = labels(ctx({ current: null }))
    expect(items).toEqual(['Checkout this commit', 'Create branch here…', 'Create tag here…', 'Copy commit sha', 'Copy GitHub link'])
  })

  it('hides the GitHub link without a GitHub origin', () => {
    expect(labels(ctx({ canLink: false }))).not.toContain('Copy GitHub link')
  })

  it('marks only the discarding reset as dangerous', () => {
    const danger = commitMenu(ctx()).filter(i => i.danger).map(i => i.label)
    expect(danger).toEqual(['Reset main here, discard changes'])
  })

  it('dispatches the action behind each label', () => {
    const c = ctx()
    commitMenu(c).find(i => i.label === 'Cherry-pick onto main')!.onClick()
    expect(c.run).toHaveBeenCalledWith('cherry-pick')
  })
})
