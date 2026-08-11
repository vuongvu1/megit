// A ~150-line stand-in for the slice of express this server actually used:
// exact-path routing, JSON bodies, static files and an SPA fallback. express
// itself is fine, but it drags 67 transitive packages into the published
// install — most of them single-function modules untouched for five years —
// and every one of those is install-time attack surface for a tool people run
// against their own repos. Node's http module covers the rest.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, sep } from 'node:path'

export type Req = IncomingMessage & {
  query: Record<string, string>
  // unvalidated by definition — every route narrows what it reads off this
  body: any
}

export type Res = ServerResponse & {
  status(code: number): Res
  set(name: string, value: string): Res
  type(mime: string): Res
  json(value: unknown): void
  send(body: string | Buffer): void
}

export type Handler = (req: Req, res: Res, next: () => void) => unknown

// 10mb, not express's 100kb default: a resolved conflicted file goes back as a
// JSON string, and a few thousand lines of source blows past the default.
const BODY_LIMIT = 10 * 1024 * 1024

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

function decorate(res: ServerResponse): Res {
  const r = res as Res
  r.status = code => { r.statusCode = code; return r }
  r.set = (name, value) => { r.setHeader(name, value); return r }
  r.type = mime => r.set('Content-Type', mime)
  r.json = value => {
    if (!r.hasHeader('Content-Type')) r.setHeader('Content-Type', 'application/json; charset=utf-8')
    r.end(JSON.stringify(value))
  }
  r.send = body => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
    r.setHeader('Content-Length', String(buf.length))
    r.end(buf)
  }
  return r
}

// Resolves to {} unless the request carries a JSON body — matching express.json,
// which leaves req.body empty for any other content type.
function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve({})
  if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) return Promise.resolve({})
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (c: Buffer) => {
      size += c.length
      if (over) return
      if (size > BODY_LIMIT) {
        // Past the cap: drop what was buffered and swallow the rest. Answering
        // now instead would mean closing the socket with an upload still in
        // flight, and that close is a TCP reset — which is allowed to discard
        // the 413 along with it, leaving the client an ECONNRESET (or an EPIPE
        // on its next write) and no status at all. Reading to the end costs
        // constant memory and buys a clean FIN with the response intact.
        chunks.length = 0
        over = true
        return
      }
      chunks.push(c)
    })
    req.on('error', fail)
    req.on('end', () => {
      if (over) return fail(Object.assign(new Error('request entity too large'), { status: 413 }))
      if (!chunks.length) return ok({})
      try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { fail(Object.assign(new Error('invalid JSON body'), { status: 400 })) }
    })
  })
}

function sendFile(file: string, req: Req, res: Res): boolean {
  const st = statSync(file, { throwIfNoEntry: false })
  if (!st?.isFile()) return false
  // vite fingerprints asset filenames, so a weak validator off size+mtime is
  // enough to keep reloads from re-sending the bundle
  const etag = `W/"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`
  res.set('ETag', etag)
  if (req.headers['if-none-match'] === etag) { res.status(304).end(); return true }
  res.set('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
  res.set('Content-Length', String(st.size))
  createReadStream(file).pipe(res)
  return true
}

// Serves `dir`, falling back to its index.html so client-side routes survive a
// reload. /api/* never falls through — an unknown API path is a 404, not a page.
export function serveStatic(dir: string): Handler {
  const index = join(dir, 'index.html')
  return (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    const file = join(dir, path)
    // join() collapses `..`, but only after decoding — `%2e%2e%2f` arrives here
    // as a real traversal and this is what stops it
    if (file !== dir && !file.startsWith(dir + sep)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    if (sendFile(file, req, res)) return
    if (path.startsWith('/api')) {
      res.status(404).json({ error: 'not found' })
      return
    }
    if (!sendFile(index, req, res)) res.status(404).json({ error: 'not found' })
  }
}

export function createApp() {
  const middleware: Handler[] = []
  const routes = new Map<string, Handler[]>()
  let fallback: Handler = (_req, res) => { res.status(404).json({ error: 'not found' }) }

  const on = (method: string) => (path: string, ...handlers: Handler[]) => {
    routes.set(`${method} ${path}`, handlers)
  }

  const listener = async (raw: IncomingMessage, rawRes: ServerResponse) => {
    const req = raw as Req
    const res = decorate(rawRes)
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      req.query = Object.fromEntries(url.searchParams)
      req.body = await readBody(req)
      // HEAD reuses the GET handler; node drops the body for us
      const verb = req.method === 'HEAD' ? 'GET' : req.method
      for (const handler of [...middleware, ...(routes.get(`${verb} ${url.pathname}`) ?? [fallback])]) {
        let advance = false
        await handler(req, res, () => { advance = true })
        if (!advance) return
      }
    } catch (e) {
      // express 5 turns a rejected handler into a 500 rather than an unhandled
      // rejection that takes the process down; so does this
      const err = e as Error & { status?: number }
      if (res.headersSent) { res.end(); return }
      // a client that overshot the cap gets its connection retired rather than
      // parked for reuse. Safe only because the body was drained to the end
      // first — closing with an upload still in flight is a reset, not a FIN.
      if (err.status === 413) res.setHeader('Connection', 'close')
      res.status(err.status ?? 500).json({ error: err.message })
    }
  }

  return {
    use: (handler: Handler) => { middleware.push(handler) },
    get: on('GET'),
    post: on('POST'),
    put: on('PUT'),
    delete: on('DELETE'),
    fallback: (handler: Handler) => { fallback = handler },
    listen: (port: number, host: string) => createServer(listener).listen(port, host),
  }
}
