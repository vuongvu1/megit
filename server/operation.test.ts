import { describe, expect, it } from 'vitest'
import { pickOperation } from './operation.ts'

describe('pickOperation', () => {
  it('returns null when no state file is present', () => {
    expect(pickOperation([])).toBeNull()
  })

  it('detects each operation from its own state file', () => {
    expect(pickOperation(['MERGE_HEAD'])).toBe('merge')
    expect(pickOperation(['CHERRY_PICK_HEAD'])).toBe('cherry-pick')
    expect(pickOperation(['REVERT_HEAD'])).toBe('revert')
    expect(pickOperation(['rebase-merge'])).toBe('rebase')
  })

  it('detects the am-backend rebase directory too', () => {
    expect(pickOperation(['rebase-apply'])).toBe('rebase')
  })

  it('prefers rebase when a rebase also left CHERRY_PICK_HEAD behind', () => {
    // a rebase applying a commit writes CHERRY_PICK_HEAD; the user is rebasing
    expect(pickOperation(['CHERRY_PICK_HEAD', 'rebase-merge'])).toBe('rebase')
  })

  it('ignores unrelated entries', () => {
    expect(pickOperation(['HEAD', 'index', 'config'])).toBeNull()
  })
})
