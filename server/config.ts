import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dir = join(homedir(), '.config', 'megit')
const file = join(dir, 'config.json')

export type Config = { repos: string[]; activeRepo: string | null }

export function loadConfig(): Config {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { repos: [], activeRepo: null }
  }
}

export function saveConfig(c: Config): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(c, null, 2))
}

export function isPermutation(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const as = [...a].sort()
  const bs = [...b].sort()
  return as.every((v, i) => v === bs[i])
}
