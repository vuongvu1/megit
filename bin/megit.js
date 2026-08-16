#!/usr/bin/env node
// megit CLI — run the local server in this terminal, or detach it with
// `start`/`stop` so it outlives the terminal that launched it.
import { execFile, spawn } from 'node:child_process'
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cmd = process.argv[2]

// handled before importing the server, so --help never binds a port
if (cmd === '-h' || cmd === '--help') {
  console.log(`megit — git repository viewer in the browser

Usage:
  megit            run in this terminal
  megit start      run in the background
  megit stop       stop the background server

Options:
  -h, --help       show this message
  -v, --version    print the version

Environment:
  PORT             port to listen on (default 3411)`)
  process.exit(0)
}

if (cmd === '-v' || cmd === '--version') {
  console.log(createRequire(import.meta.url)('../package.json').version)
  process.exit(0)
}

const port = Number(process.env.PORT) || 3411
const url = `http://127.0.0.1:${port}`

const dir = join(homedir(), '.config', 'megit')
const stateFile = join(dir, 'daemon.json')
const logFile = join(dir, 'megit.log')

const readState = () => {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    return null
  }
}

const pidAlive = pid => {
  try {
    process.kill(pid, 0) // signal 0 tests for existence, sends nothing
    return true
  } catch {
    return false
  }
}

// "Is megit up?" is answered by megit answering, not by a PID existing. A PID
// can be reused after an unclean exit, and a port can be held by anything.
const megitAnswers = async p => {
  try {
    const r = await fetch(`http://127.0.0.1:${p}/api/config`, { signal: AbortSignal.timeout(1000) })
    return r.ok && 'hasTerminal' in (await r.json())
  } catch {
    return false
  }
}

if (cmd === 'start') {
  const prev = readState()
  if (prev && pidAlive(prev.pid) && (await megitAnswers(prev.port))) {
    // ponytail: one daemon is tracked, so a second PORT is a conflict rather than
    // a second server. Key the state file by port if anyone actually wants two.
    if (prev.port === port) {
      console.log(`megit already running → http://127.0.0.1:${prev.port}`)
      process.exit(0)
    }
    console.error(`megit: already running on http://127.0.0.1:${prev.port} — run 'megit stop' first`)
    process.exit(1)
  }

  mkdirSync(dir, { recursive: true })
  // Without a log, a daemon that dies during startup dies invisibly.
  const log = openSync(logFile, 'a')
  // Re-run this same script with no arguments: the foreground path below is the
  // one startup sequence, and the daemon must not diverge from it. `detached`
  // gives the child its own process group so the shell's SIGHUP on exit misses
  // it; `unref` lets this process leave without waiting.
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  })
  child.unref()

  // unref() only stops the child from holding this process open — 'exit' still
  // fires, which turns the common failure (port already in use) into an
  // immediate answer instead of five seconds of polling a corpse.
  let died = false
  child.once('exit', () => (died = true))

  // Poll rather than assume: a failed bind would otherwise be reported as success.
  for (let i = 0; i < 50 && !died; i++) {
    if (await megitAnswers(port)) {
      writeFileSync(stateFile, JSON.stringify({ pid: child.pid, port }))
      console.log(`megit → ${url}`)
      process.exit(0)
    }
    await new Promise(r => setTimeout(r, 100))
  }
  console.error(`megit: server did not come up on ${url} — see ${logFile}`)
  process.exit(1)
}

if (cmd === 'stop') {
  const state = readState()
  if (!state || !pidAlive(state.pid)) {
    rmSync(stateFile, { force: true })
    console.log('megit: no background server running')
    process.exit(0)
  }
  if (!(await megitAnswers(state.port))) {
    rmSync(stateFile, { force: true })
    console.error(`megit: stale state file — PID ${state.pid} is not megit, leaving it alone`)
    process.exit(1)
  }
  process.kill(state.pid, 'SIGTERM')
  rmSync(stateFile, { force: true })
  console.log('megit stopped')
  process.exit(0)
}

if (cmd) {
  console.error(`megit: unknown command '${cmd}' — try 'megit --help'`)
  process.exit(1)
}

const { server } = await import('../dist-server/index.js')
if (!server.listening) await new Promise(r => server.once('listening', r))

// ponytail: no `open` dependency — three platform names cover what it does.
const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
execFile(opener, [url], () => {}) // exit code ignored: explorer.exe returns 1 on success
console.log(`megit → ${url}`)
