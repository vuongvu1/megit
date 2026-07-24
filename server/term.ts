import type { Server } from 'node:http'
import { existsSync } from 'node:fs'
import { WebSocketServer, WebSocket } from 'ws'
import { loadConfig } from './config.ts'

// One live shell per repo. Created on first attach (node-pty loads lazily then),
// survives panel hide/tab switch — the socket detaches but the PTY keeps running,
// and the ring buffer replays recent output on reattach. Dies with `exit` or server stop.
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

async function getSession(repo: string): Promise<Session> {
  const existing = sessions.get(repo)
  if (existing) return existing
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
  sessions.set(repo, s)
  pty.onData(d => {
    s.size = pushCapped(s.buffer, s.size, d)
    for (const ws of s.clients) ws.send(d)
  })
  pty.onExit(() => {
    sessions.delete(repo)
    for (const ws of s.clients) {
      ws.send('\r\n[session ended]\r\n')
      ws.close()
    }
  })
  return s
}

async function attach(repo: string, ws: WebSocket) {
  const s = await getSession(repo)
  s.clients.add(ws)
  if (s.buffer.length) ws.send(s.buffer.join(''))
  ws.on('message', raw => {
    let msg: { t: string; d?: string; cols?: number; rows?: number }
    try { msg = JSON.parse(String(raw)) } catch { return }
    if (msg.t === 'i' && typeof msg.d === 'string') s.pty.write(msg.d)
    else if (msg.t === 'r' && msg.cols && msg.rows) s.pty.resize(msg.cols, msg.rows)
    else if (msg.t === 'c') { s.buffer.length = 0; s.size = 0 }
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
    wss.handleUpgrade(req, socket, head, ws => { attach(repo, ws) })
  })
}
