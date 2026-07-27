import { describe, it, expect, vi } from 'vitest'
import { branchMenu, type RefChip } from './branchMenu'

const chip = (over: Partial<RefChip>): RefChip =>
  ({ name: 'feature', local: true, remote: false, tag: false, head: false, ...over })

const ctx = (over = {}) => ({ current: 'main', hasRemote: true, canLink: true, run: vi.fn(), ...over })

const labels = (...args: Parameters<typeof branchMenu>) => branchMenu(...args).map(i => i.label)

describe('branchMenu', () => {
  it('offers pull/push/upstream only on the checked-out branch', () => {
    expect(labels(chip({ name: 'main', head: true }), ctx())).toEqual([
      'Pull (fast-forward only)', 'Push', 'Set upstream…',
      'Create branch here…', 'Rename…',
      'Copy branch name', 'Copy GitHub link',
    ])
    expect(labels(chip({}), ctx())).not.toContain('Push')
  })

  it('never offers to delete or check out the checked-out branch', () => {
    const items = labels(chip({ name: 'main', head: true }), ctx())
    expect(items).not.toContain('Delete branch')
    expect(items).not.toContain('Checkout')
  })

  it('names both sides of merge and rebase', () => {
    expect(labels(chip({}), ctx())).toEqual([
      'Checkout', 'Merge feature into main', 'Rebase main onto feature',
      'Create branch here…', 'Rename…', 'Delete branch',
      'Copy branch name', 'Copy GitHub link',
    ])
  })

  it('drops merge/rebase on a detached HEAD', () => {
    expect(labels(chip({}), ctx({ current: null }))).not.toContain('Merge feature into null')
  })

  it('gives a remote-only chip no local-branch actions', () => {
    expect(labels(chip({ local: false, remote: true, name: 'origin-only' }), ctx())).toEqual([
      'Checkout', 'Copy remote branch name', 'Copy GitHub link',
    ])
  })

  it('gives a tag delete and copy actions, and none of the branch ones', () => {
    expect(labels(chip({ tag: true, name: 'v1.0' }), ctx()))
      .toEqual(['Delete tag', 'Copy tag name', 'Copy GitHub link'])
  })

  it('deletes a tag through deleteTag, never the branch delete', () => {
    const run = vi.fn()
    const items = branchMenu(chip({ tag: true, name: 'v1.0' }), ctx({ run }))
    items[0].onClick()
    expect(run).toHaveBeenCalledWith('deleteTag')
  })

  it('hides remote-dependent actions when the repo has none', () => {
    expect(labels(chip({ name: 'main', head: true }), ctx({ hasRemote: false, canLink: false })))
      .toEqual(['Create branch here…', 'Rename…', 'Copy branch name'])
  })

  it('dispatches the action behind each label', () => {
    const c = ctx()
    const items = branchMenu(chip({}), c)
    items.find(i => i.label === 'Delete branch')!.onClick()
    expect(c.run).toHaveBeenCalledWith('delete')
  })
})
