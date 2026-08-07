import { describe, it, expect } from 'vitest'
import { diffMode, needsPatch } from './diffMode'

describe('diffMode', () => {
  it('renders an SVG as an image in rich mode, with only the rich toggle', () => {
    expect(diffMode('icons/logo.svg', true)).toEqual({ body: 'image', richToggle: true, splitToggle: false })
  })

  it('renders an SVG as a text diff in source mode, with both toggles', () => {
    expect(diffMode('icons/logo.svg', false)).toEqual({ body: 'text', richToggle: true, splitToggle: true })
  })

  it('gives raster images no toggle in either mode', () => {
    const expected = { body: 'image', richToggle: false, splitToggle: false }
    expect(diffMode('public/shot.png', true)).toEqual(expected)
    expect(diffMode('public/shot.png', false)).toEqual(expected)
    expect(diffMode('a.JPEG', true)).toEqual(expected)
  })

  it('gives ordinary files the split toggle only', () => {
    expect(diffMode('src/App.tsx', true)).toEqual({ body: 'text', richToggle: false, splitToggle: true })
    expect(diffMode('README.md', false)).toEqual({ body: 'text', richToggle: false, splitToggle: true })
  })

  it('matches the extension case-insensitively and only at the end', () => {
    expect(diffMode('a.SVG', false).richToggle).toBe(true)
    expect(diffMode('assets/logo.svg.bak', true).richToggle).toBe(false)
    expect(diffMode('a.svgx', true).richToggle).toBe(false)
  })
})

describe('needsPatch', () => {
  it('fetches a patch for text files and for SVG in either mode', () => {
    expect(needsPatch('src/App.tsx')).toBe(true)
    expect(needsPatch('icons/logo.svg')).toBe(true)
  })

  it('skips the patch for raster images', () => {
    expect(needsPatch('public/shot.png')).toBe(false)
    expect(needsPatch('a.webp')).toBe(false)
    expect(needsPatch('a.JPEG')).toBe(false)
  })
})
