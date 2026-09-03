// Pure half of the settings feature: no document, no localStorage, so vitest can
// import it in its node environment. The DOM side lives in settingsStore.ts.
export type Settings = {
  fontFamily: string // '' = the bundled Ubuntu Mono stack declared on :root
  zoom: number
  avatars: boolean
  diffSplit: boolean
}

export const ZOOM_MIN = 0.8
export const ZOOM_MAX = 1.6

// Four named sizes rather than a free stepper: nobody wants to hunt for 110%,
// and the buttons can then label themselves by example instead of by number.
export const ZOOM_PRESETS = [
  { id: 'sm', zoom: 0.8 },
  { id: 'md', zoom: 1 },
  { id: 'lg', zoom: 1.2 },
  { id: 'xl', zoom: 1.4 },
] as const

// Exactly one button is lit even for a zoom the presets never produced — one
// stored by an older build, or hand-edited in localStorage.
export const nearestPreset = (zoom: number) =>
  ZOOM_PRESETS.reduce((a, b) => (Math.abs(b.zoom - zoom) < Math.abs(a.zoom - zoom) ? b : a))

export const DEFAULTS: Settings = {
  fontFamily: '',
  zoom: 1,
  avatars: true,
  diffSplit: false,
}

// Snap before clamping so a float that arrived from repeated += 0.1 lands on a
// step instead of accumulating 1.3000000000000003 into storage.
export const clampZoom = (n: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n * 10) / 10))

// Field-by-field with a type check each, so a hand-edited or truncated value
// degrades to the default instead of poisoning the store with a string zoom.
export function parse(raw: string | null, defaults: Settings): Settings {
  if (!raw) return defaults
  let o: Partial<Settings>
  try {
    o = JSON.parse(raw) as Partial<Settings>
  } catch {
    return defaults
  }
  if (!o || typeof o !== 'object') return defaults
  return {
    fontFamily: typeof o.fontFamily === 'string' ? o.fontFamily : defaults.fontFamily,
    zoom: typeof o.zoom === 'number' && Number.isFinite(o.zoom) ? clampZoom(o.zoom) : defaults.zoom,
    avatars: typeof o.avatars === 'boolean' ? o.avatars : defaults.avatars,
    diffSplit: typeof o.diffSplit === 'boolean' ? o.diffSplit : defaults.diffSplit,
  }
}

// The family ends up in a CSS custom property, so quotes, backslashes, semicolons
// and braces come out first — the list is fixed today, but the sanitising is what
// makes that safe to relax later. A value that already names several families (the
// curated system stacks) must not be wrapped in quotes.
export function fontStack(family: string): string {
  const f = family.replace(/["'\\;{}]/g, '').trim()
  if (!f) return ''
  return `${f.includes(',') ? f : `'${f}'`}, 'Ubuntu Mono', ui-monospace, monospace`
}

export const DEFAULT_STACK = "'Ubuntu Mono', ui-monospace, monospace"
