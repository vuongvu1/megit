import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), '.config', 'megit')
const file = join(dir, 'config.json')

export type Config = { repos: string[]; activeRepo: string | null; recent: string[] }

export function loadConfig(): Config {
  try {
    // Spread order matters: a config written before `recent` existed gets the default.
    return { recent: [], ...JSON.parse(readFileSync(file, 'utf8')) }
  } catch {
    return { repos: [], activeRepo: null, recent: [] }
  }
}

export function saveConfig(c: Config): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(c, null, 2))
}

// MRU: most recent first, deduped, capped. The cap is what keeps the config file
// from growing without bound as repos come and go.
export function touchRecent(recent: string[], path: string, limit = 12): string[] {
  return [path, ...recent.filter(r => r !== path)].slice(0, limit)
}

export function isPermutation(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const as = [...a].sort()
  const bs = [...b].sort()
  return as.every((v, i) => v === bs[i])
}
