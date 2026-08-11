import type { Server } from 'node:http'
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { loadConfig } from './config.ts'

// node-pty is an optionalDependency: it ships prebuilds for darwin and win32 only,
// so a Linux install either compiles from source or omits the package entirely.
// resolve() answers "is it installed?" without executing the native binding — the
// lazy import in getSession() stays lazy, and /api/config stays cheap.
export function hasPty(): boolean {
  try {
    createRequire(import.meta.url).resolve('node-pty')
    return true
  } catch {
    return false
  }
}

// One live shell per (repo, pane). Created on first attach (node-pty loads lazily
// then), survives panel hide/tab switch — the socket detaches but the PTY keeps
// running, and the ring buffer replays recent output on reattach. Dies with `exit`,
// a kill message from a closed pane, or server stop.
type Session = {
  pty: { write(d: string): void; resize(c: number, r: number): void; kill(): void }
  buffer: string[]
  size: number
  clients: Set<WebSocket>
}

const MAX_BUFFER = 200 * 1024

// keep the last ~cap chars: append chunk, evict oldest whole chunks; returns new size
export function pushCapped(buf: string[], size: number, chunk: string, cap = MAX_BUFFER): number {
  buf.push(chunk)
  size += chunk.length
  while (size > cap && buf.length > 1) size -= buf.shift()!.length
  return size
}

const sessions = new Map<string, Session>()

// Split panes are numbered 0..MAX_PANES-1 and each gets its own shell. The bound is
// enforced here, not by the client: this socket spawns login shells, so an unvalidated
// pane param is an unbounded shell factory for anything that reaches the upgrade.
export const MAX_PANES = 4

export function termKey(repo: string, pane: string | null): string | null {
  const p = pane ?? '0'
  if (!/^\d$/.test(p) || Number(p) >= MAX_PANES) return null
  return `${repo}\0${p}`
}

// node-pty ships spawn-helper as a prebuilt binary, and some package managers drop
// the executable bit when extracting the tarball — the terminal then fails to spawn.
// This ran as a postinstall script until an install script proved to be the kind of
// supply-chain surface scanners flag on sight; it costs nothing to do it here, once,
// on the first shell. Resolve node-pty rather than guessing ./node_modules: under
// `npx` it is hoisted to the installing project's node_modules, not ours.
let helperFixed = false
function fixSpawnHelper() {
  if (helperFixed) return
  helperFixed = true
  try {
    const prebuilds = join(dirname(createRequire(import.meta.url).resolve('node-pty/package.json')), 'prebuilds')
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
}

async function getSession(key: string, repo: string): Promise<Session> {
  const existing = sessions.get(key)
  if (existing) return existing
  fixSpawnHelper()
  // dynamic import: the native module never loads until a terminal is actually opened
  const { spawn } = await import('node-pty')
  const shell = process.env.SHELL || '/bin/sh'
  const pty = spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: repo,
    env: process.env as Record<string, string>,
  })
  const s: Session = { pty, buffer: [], size: 0, clients: new Set() }
  sessions.set(key, s)
  pty.onData(d => {
    s.size = pushCapped(s.buffer, s.size, d)
    for (const ws of s.clients) ws.send(d)
  })
  pty.onExit(() => {
    sessions.delete(key)
    // 4000 tells the client "the shell is gone" (vs. a plain close, which is the
    // server going away) so it can drop the pane instead of showing a reconnect hint
    for (const ws of s.clients) ws.close(4000, 'exit')
  })
  return s
}

async function attach(key: string, repo: string, ws: WebSocket) {
  let s: Session
  try {
    s = await getSession(key, repo)
  } catch {
    // resolve() said the package is there but the native binding failed to load
    ws.send('\r\n[terminal unavailable: node-pty could not be loaded on this platform]\r\n')
    ws.close()
    return
  }
  s.clients.add(ws)
  if (s.buffer.length) ws.send(s.buffer.join(''))
  ws.on('message', raw => {
    let msg: { t: string; d?: string; cols?: number; rows?: number }
    try { msg = JSON.parse(String(raw)) } catch { return }
    if (msg.t === 'i' && typeof msg.d === 'string') s.pty.write(msg.d)
    else if (msg.t === 'r' && msg.cols && msg.rows) s.pty.resize(msg.cols, msg.rows)
    else if (msg.t === 'c') { s.buffer.length = 0; s.size = 0 }
    else if (msg.t === 'k') s.pty.kill() // pane closed by its ✕ — onExit does the cleanup
  })
  ws.on('close', () => s.clients.delete(ws))
}

export function wireTerminal(server: Server) {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (url.pathname !== '/api/term') { socket.destroy(); return }
    // WebSockets bypass CORS and this socket is a shell: only local pages may
    // connect (no Origin header = non-browser client on this machine, allowed)
    const origin = req.headers.origin
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) { socket.destroy(); return }
    const repo = url.searchParams.get('repo') ?? ''
    if (!loadConfig().repos.includes(repo) || !existsSync(repo)) { socket.destroy(); return }
    const key = termKey(repo, url.searchParams.get('pane'))
    if (!key) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => { void attach(key, repo, ws) })
  })
}
