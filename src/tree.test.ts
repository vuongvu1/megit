import { describe, it, expect } from 'vitest'
import { buildTree } from './tree'

describe('buildTree', () => {
  it('nests files under directories, dirs first, sorted', () => {
    expect(buildTree([
      { path: 'src/b.ts', status: 'M' },
      { path: 'src/a.ts', status: 'A' },
      { path: 'README.md', status: 'M' },
    ])).toEqual([
      {
        name: 'src', path: 'src', children: [
          { name: 'a.ts', path: 'src/a.ts', status: 'A' },
          { name: 'b.ts', path: 'src/b.ts', status: 'M' },
        ],
      },
      { name: 'README.md', path: 'README.md', status: 'M' },
    ])
  })

  it('compresses single-child directory chains', () => {
    expect(buildTree([
      { path: 'src/components/common/Copy/Copy.tsx', status: 'A' },
      { path: 'src/components/common/Copy/Copy.test.tsx', status: 'A' },
    ])).toEqual([
      {
        name: 'src/components/common/Copy', path: 'src/components/common/Copy', children: [
          { name: 'Copy.test.tsx', path: 'src/components/common/Copy/Copy.test.tsx', status: 'A' },
          { name: 'Copy.tsx', path: 'src/components/common/Copy/Copy.tsx', status: 'A' },
        ],
      },
    ])
  })

  it('stops compressing where a dir holds a file', () => {
    expect(buildTree([
      { path: 'src/hooks/useCopy.ts', status: 'A' },
      { path: 'src/hooks/__tests__/useCopy.test.ts', status: 'A' },
    ])).toEqual([
      {
        name: 'src/hooks', path: 'src/hooks', children: [
          { name: '__tests__', path: 'src/hooks/__tests__', children: [
            { name: 'useCopy.test.ts', path: 'src/hooks/__tests__/useCopy.test.ts', status: 'A' },
          ] },
          { name: 'useCopy.ts', path: 'src/hooks/useCopy.ts', status: 'A' },
        ],
      },
    ])
  })

  it('handles empty input', () => {
    expect(buildTree([])).toEqual([])
  })
})
