import { describe, it, expect } from 'vitest'
import { DEFAULTS, ZOOM_PRESETS, clampZoom, nearestPreset, parse, fontStack } from './settings'

describe('clampZoom', () => {
  it('holds the range and snaps to 0.1 steps', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(0.4)).toBe(0.8)
    expect(clampZoom(9)).toBe(1.6)
    expect(clampZoom(1.24)).toBe(1.2)
    expect(clampZoom(1.25)).toBeCloseTo(1.3)
  })
})

describe('parse', () => {
  it('returns the defaults for no stored value', () => {
    expect(parse(null, DEFAULTS)).toEqual(DEFAULTS)
  })

  it('returns the defaults for corrupt JSON rather than throwing', () => {
    expect(parse('{not json', DEFAULTS)).toEqual(DEFAULTS)
  })

  it('merges a partial stored object over the defaults', () => {
    expect(parse('{"zoom":1.2}', DEFAULTS)).toEqual({ ...DEFAULTS, zoom: 1.2 })
  })

  it('ignores fields of the wrong type', () => {
    expect(parse('{"zoom":"big","avatars":"yes"}', DEFAULTS)).toEqual(DEFAULTS)
  })

  it('clamps a stored zoom that is out of range', () => {
    expect(parse('{"zoom":42}', DEFAULTS).zoom).toBe(1.6)
  })

  it('honours a caller-supplied default, for the diff-split migration', () => {
    const migrated = { ...DEFAULTS, diffSplit: true }
    expect(parse(null, migrated).diffSplit).toBe(true)
    expect(parse('{"diffSplit":false}', migrated).diffSplit).toBe(false)
  })
})

describe('fontStack', () => {
  it('is empty for the bundled default, so the :root value applies', () => {
    expect(fontStack('')).toBe('')
    expect(fontStack('   ')).toBe('')
  })

  it('quotes a single family and appends the fallbacks', () => {
    expect(fontStack('JetBrains Mono')).toBe("'JetBrains Mono', 'Ubuntu Mono', ui-monospace, monospace")
  })

  it('leaves an already-comma-separated stack unquoted', () => {
    expect(fontStack('ui-monospace, monospace')).toBe("ui-monospace, monospace, 'Ubuntu Mono', ui-monospace, monospace")
  })

  it('strips characters that would corrupt the CSS value', () => {
    expect(fontStack('Evil"; }')).toBe("'Evil', 'Ubuntu Mono', ui-monospace, monospace")
  })

  it('strips before deciding the comma-bypass: a genuinely comma-separated value after stripping stays unquoted', () => {
    // 'Evil"; }, x' strips its quote, semicolon and braces down to 'Evil , x',
    // which still contains a comma — asserting the strip runs before the
    // comma check, not after (a post-strip check on the raw string would see
    // no comma pre-strip and wrongly quote the whole thing).
    expect(fontStack('Evil"; }, x')).toBe("Evil , x, 'Ubuntu Mono', ui-monospace, monospace")
  })
})

describe('nearestPreset', () => {
  it('matches a preset exactly', () => {
    for (const p of ZOOM_PRESETS) expect(nearestPreset(p.zoom).id).toBe(p.id)
  })

  it('lights the closest button for a value no preset produces', () => {
    expect(nearestPreset(1.05).id).toBe('md')
    expect(nearestPreset(1.15).id).toBe('lg')
    expect(nearestPreset(1.6).id).toBe('xl')   // above the top preset, from an older build
    expect(nearestPreset(0.5).id).toBe('sm')
  })
})
