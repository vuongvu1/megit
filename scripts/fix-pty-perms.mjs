// node-pty ships spawn-helper as a prebuilt binary, and some package managers drop
// the executable bit when extracting the tarball — the terminal then fails to spawn.
// Resolve node-pty rather than guessing ./node_modules: under `npx` it is hoisted to
// the installing project's node_modules, not ours.
import { chmodSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

try {
  const require = createRequire(import.meta.url)
  const prebuilds = join(dirname(require.resolve('node-pty/package.json')), 'prebuilds')
  for (const platform of readdirSync(prebuilds)) {
    try {
      chmodSync(join(prebuilds, platform, 'spawn-helper'), 0o755)
    } catch {
      // win32 prebuilds have no spawn-helper; nothing to do
    }
  }
} catch {
  // node-pty is optional — absent on Linux installs without build tools
}
