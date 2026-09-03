import { describe, it, expect } from 'vitest'
import { SHORTCUTS, GROUPS, renderKeys } from './shortcuts'

describe('renderKeys', () => {
  it('splits a combination into its keys, with mac glyphs', () => {
    expect(renderKeys('Mod+Shift+0', true)).toEqual([['⌘', '⇧', '0']])
    expect(renderKeys('Mod+Enter', true)).toEqual([['⌘', '↵']])
  })

  it('spells the modifiers out on other platforms', () => {
    expect(renderKeys('Mod+Shift+0', false)).toEqual([['Ctrl', 'Shift', '0']])
    expect(renderKeys('Mod+Enter', false)).toEqual([['Ctrl', 'Enter']])
  })

  it('keeps Meta distinct from Mod, since the handler excludes ctrlKey', () => {
    expect(renderKeys('Meta+K', true)).toEqual([['⌘', 'K']])
    expect(renderKeys('Meta+K', false)).toEqual([['Meta', 'K']])
  })

  it('treats a space as alternatives, not a combination', () => {
    expect(renderKeys('↑ ↓', true)).toEqual([['↑'], ['↓']])
    expect(renderKeys('Home End', true)).toEqual([['Home'], ['End']])
  })

  it('abbreviates Escape and uppercases a bare letter', () => {
    expect(renderKeys('Escape', true)).toEqual([['Esc']])
    expect(renderKeys('Escape', false)).toEqual([['Esc']])
    expect(renderKeys('r', true)).toEqual([['R']])
  })
})

describe('SHORTCUTS', () => {
  it('has no duplicate keys within a group', () => {
    const seen = SHORTCUTS.map(s => `${s.group}::${s.keys}`)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('lists every group in GROUPS, in order, with no empties', () => {
    expect(GROUPS).toEqual([...new Set(SHORTCUTS.map(s => s.group))])
  })

  it('covers the shortcuts the app actually binds', () => {
    const keys = SHORTCUTS.map(s => s.keys)
    for (const k of ['↑ ↓', 'Home End', 'Mod+Shift+0', 'r', 'Mod+F', 'Enter', 'Shift+Enter', 'Mod+J', 'Meta+K', 'Meta+D', 'Mod+Enter', 'Escape']) {
      expect(keys).toContain(k)
    }
  })
})
