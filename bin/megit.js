#!/usr/bin/env node
// megit CLI — start the local server, open the browser at it, and register the
// repo path given as an argument (if any) by POSTing to our own /api/repos, so
// path validation stays in one place.
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const arg = process.argv[2]

// handled before importing the server, so --help never binds a port
if (arg === '-h' || arg === '--help') {
  console.log(`megit — git repository viewer in the browser

Usage:
  megit [repo-path]

Arguments:
  repo-path        open this repository in a tab (default: reopen last session)

Options:
  -h, --help       show this message
  -v, --version    print the version

Environment:
  PORT             port to listen on (default 3411)`)
  process.exit(0)
}

if (arg === '-v' || arg === '--version') {
  console.log(createRequire(import.meta.url)('../package.json').version)
  process.exit(0)
}

const port = Number(process.env.PORT) || 3411
const url = `http://127.0.0.1:${port}`

const { server } = await import('../dist-server/index.js')
if (!server.listening) await new Promise(r => server.once('listening', r))

if (arg) {
  await fetch(`${url}/api/repos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: resolve(arg) }),
  })
    .then(async r => { if (!r.ok) console.error(`megit: ${(await r.json()).error}`) })
    .catch(() => {})
}

// ponytail: no `open` dependency — three platform names cover what it does.
const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
execFile(opener, [url], () => {}) // exit code ignored: explorer.exe returns 1 on success
console.log(`megit → ${url}`)
