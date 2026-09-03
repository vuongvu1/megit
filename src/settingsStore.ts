import { useCallback, useSyncExternalStore } from 'react'
import { clampZoom, DEFAULTS, fontStack, parse, type Settings } from './settings'

const KEY = 'megit-settings'

// DiffView persisted its split preference under its own key long before this
// dialog existed. Seeding the default from it means an upgrading user keeps the
// choice they already made; once anything is written to KEY, this stops mattering.
const seeded: Settings = { ...DEFAULTS, diffSplit: localStorage.getItem('megit-diff-split') === '1' }

let settings = parse(localStorage.getItem(KEY), seeded)
const listeners = new Set<() => void>()

const apply = () => {
  const el = document.documentElement
  el.style.zoom = String(settings.zoom)
  // Removing rather than setting an empty value leaves the :root declaration in
  // charge when the bundled default is selected.
  const stack = fontStack(settings.fontFamily)
  if (stack) el.style.setProperty('--font-stack', stack)
  else el.style.removeProperty('--font-stack')
}

// At import, before React mounts: zoom and font are right on the first paint, so
// the window never reflows on load. That timing is why this is localStorage and
// not server config.
apply()

export const getSettings = () => settings

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  // The store owns the zoom invariant: callers pass an intent (+0.1) and get a
  // snapped, in-range value, so repeated steps cannot drift the stored number.
  const v = (key === 'zoom' ? clampZoom(value as number) : value) as Settings[K]
  if (settings[key] === v) return
  settings = { ...settings, [key]: v }
  localStorage.setItem(KEY, JSON.stringify(settings))
  apply()
  listeners.forEach(l => l())
}

// TerminalPanel lives outside React's render cycle for xterm's options, so it
// needs the raw subscription the hook wraps.
export const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export const useSettings = () => useSyncExternalStore(subscribe, getSettings)

// Key-scoped so an unrelated write bails out in React instead of re-rendering.
// useAvatar runs once per commit row, so a whole-object snapshot made every
// zoom or font change reconcile the entire graph.
export function useSetting<K extends keyof Settings>(k: K): Settings[K] {
  return useSyncExternalStore(subscribe, useCallback(() => settings[k], [k]))
}
