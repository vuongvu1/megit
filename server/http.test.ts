import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApp, serveStatic } from './http.ts'

const dist = mkdtempSync(join(tmpdir(), 'megit-http-'))
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>spa</title>')
writeFileSync(join(dist, 'app.js'), 'console.log(1)')

const app = createApp()
app.use((req, res, next) => {
  if (req.headers['x-block']) {
    res.status(403).json({ error: 'blocked' })
    return
  }
  next()
})
app.get('/api/echo', (req, res) => res.json({ query: req.query }))
app.post('/api/echo', (req, res) => res.json({ body: req.body }))
app.put('/api/echo', (req, res) => res.json({ ok: true }))
app.delete('/api/echo', (req, res) => res.json({ ok: true }))
app.get('/api/guarded', (req, res, next) => { if (req.query.pass) next(); else res.status(400).json({ error: 'nope' }) }, (_req, res) => res.json({ reached: true }))
app.get('/api/boom', () => { throw new Error('kaboom') })
app.get('/api/reject', async () => { throw Object.assign(new Error('conflict'), { status: 409 }) })
app.fallback(serveStatic(dist))

const server = app.listen(0, '127.0.0.1')
let base = ''

const url = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`

// the bind can win the race against vitest's first hook, and 'listening' never
// fires twice — check the flag before waiting on the event
beforeAll(() => server.listening
  ? void (base = url())
  : new Promise<void>(ok => server.on('listening', () => { base = url(); ok() })))
afterAll(() => new Promise<void>(ok => { server.close(() => ok()) }))

describe('routing', () => {
  it('dispatches by method and exact path', async () => {
    for (const method of ['PUT', 'DELETE']) {
      const res = await fetch(`${base}/api/echo`, { method })
      expect(await res.json()).toEqual({ ok: true })
    }
  })

  it('parses the query string', async () => {
    const res = await fetch(`${base}/api/echo?repo=/tmp/x&limit=5`)
    expect(await res.json()).toEqual({ query: { repo: '/tmp/x', limit: '5' } })
  })

  it('runs middleware first and stops when it responds', async () => {
    const res = await fetch(`${base}/api/echo`, { headers: { 'x-block': '1' } })
    expect(res.status).toBe(403)
  })

  it('stops a route chain when a guard does not call next', async () => {
    expect((await fetch(`${base}/api/guarded`)).status).toBe(400)
    expect(await (await fetch(`${base}/api/guarded?pass=1`)).json()).toEqual({ reached: true })
  })

  it('turns a thrown handler into a 500 instead of crashing the process', async () => {
    const res = await fetch(`${base}/api/boom`)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'kaboom' })
  })

  it('honours a status carried on the error', async () => {
    expect((await fetch(`${base}/api/reject`)).status).toBe(409)
  })
})

describe('body', () => {
  const post = (init: RequestInit) => fetch(`${base}/api/echo`, { method: 'POST', ...init })

  it('parses a JSON body', async () => {
    const res = await post({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 1 }) })
    expect(await res.json()).toEqual({ body: { a: 1 } })
  })

  it('leaves the body empty for a non-JSON content type', async () => {
    const res = await post({ headers: { 'content-type': 'text/plain' }, body: 'a=1' })
    expect(await res.json()).toEqual({ body: {} })
  })

  it('rejects malformed JSON with a 400', async () => {
    const res = await post({ headers: { 'content-type': 'application/json' }, body: '{oops' })
    expect(res.status).toBe(400)
  })

  it('rejects a body over the 10mb cap', async () => {
    // the cap exists so one request can't buffer the process out of memory
    const body = JSON.stringify({ big: 'x'.repeat(11 * 1024 * 1024) })
    await expect(
      post({ headers: { 'content-type': 'application/json' }, body }).then(r => r.status),
    ).resolves.toBe(413)
  })
})

describe('static', () => {
  it('serves a file with its content type', async () => {
    const res = await fetch(`${base}/app.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/javascript/)
    expect(await res.text()).toBe('console.log(1)')
  })

  it('serves index.html at the root and for unknown client routes', async () => {
    for (const path of ['/', '/settings/deep']) {
      expect(await (await fetch(base + path)).text()).toContain('spa')
    }
  })

  it('404s an unknown /api path instead of falling back to the SPA', async () => {
    const res = await fetch(`${base}/api/nope`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })

  it('answers a matching If-None-Match with 304', async () => {
    const etag = (await fetch(`${base}/app.js`)).headers.get('etag')!
    expect(etag).toBeTruthy()
    const res = await fetch(`${base}/app.js`, { headers: { 'if-none-match': etag } })
    expect(res.status).toBe(304)
  })

  it('refuses a percent-encoded traversal out of the served directory', async () => {
    // %2e%2e%2f survives URL parsing and only decodes inside the handler — the
    // join()+prefix check is what stops it reaching the filesystem
    const res = await fetch(`${base}/%2e%2e%2f%2e%2e%2fetc/passwd`)
    expect(res.status).toBe(403)
  })
})
