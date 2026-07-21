import express from 'express'
import type { RequestHandler } from 'express'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { loadConfig, saveConfig, isPermutation } from './config.ts'
import { resolveAvatar } from './avatars.ts'
import { parseLog, parseStatus, LOG_FORMAT } from './parse.ts'
import { subscribe } from './watch.ts'

const app = express()
app.use(express.json())

function git(repo: string, args: string[], okCodes: number[] = [0]): Promise<string> {
  return new Promise((res, rej) => {
    execFile('git', ['-C', repo, ...args], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !okCodes.includes(typeof err.code === 'number' ? err.code : 1)) {
        rej(new Error(stderr.trim() || err.message))
      } else res(stdout)
    })
  })
}

const repoGuard: RequestHandler = (req, res, next) => {
  const repo = String(req.query.repo ?? '')
  if (!loadConfig().repos.includes(repo)) {
    res.status(400).json({ error: 'unknown repo' })
    return
  }
  if (!existsSync(repo)) {
    res.status(410).json({ error: 'repository path no longer exists' })
    return
  }
  next()
}

app.get('/api/config', (_req, res) => res.json(loadConfig()))

app.post('/api/repos', async (req, res) => {
  const path = resolve(String(req.body.path ?? ''))
  try {
    await git(path, ['rev-parse', '--git-dir'])
  } catch {
    res.status(400).json({ error: `not a git repository: ${path}` })
    return
  }
  const cfg = loadConfig()
  if (!cfg.repos.includes(path)) cfg.repos.push(path)
  cfg.activeRepo = path
  saveConfig(cfg)
  res.json(cfg)
})

app.delete('/api/repos', (req, res) => {
  const path = String(req.query.repo ?? '')
  const cfg = loadConfig()
  cfg.repos = cfg.repos.filter(r => r !== path)
  if (cfg.activeRepo === path) cfg.activeRepo = cfg.repos[0] ?? null
  saveConfig(cfg)
  res.json(cfg)
})

app.put('/api/active', (req, res) => {
  const cfg = loadConfig()
  const repo = String(req.body.repo ?? '')
  if (cfg.repos.includes(repo)) {
    cfg.activeRepo = repo
    saveConfig(cfg)
  }
  res.json(cfg)
})

app.put('/api/repos/order', (req, res) => {
  const repos = req.body?.repos
  const cfg = loadConfig()
  if (!Array.isArray(repos) || !isPermutation(repos, cfg.repos)) {
    res.status(400).json({ error: 'invalid repo order' })
    return
  }
  cfg.repos = repos
  saveConfig(cfg)
  res.json(cfg)
})

app.get('/api/fs', (req, res) => {
  const path = resolve(String(req.query.path ?? homedir()))
  let entries
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
    return
  }
  const dirs = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => ({ name: e.name, path: join(path, e.name), isRepo: existsSync(join(path, e.name, '.git')) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const parent = dirname(path)
  res.json({ path, parent: parent === path ? null : parent, dirs, isRepo: existsSync(join(path, '.git')) })
})

app.get('/api/graph', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const skip = Number(req.query.skip) || 0
  const limit = Math.max(1, Number(req.query.limit) || 500)
  try {
    const [raw, remoteRaw] = await Promise.all([
      git(repo, ['log', '--all', '--topo-order', `--skip=${skip}`, `--max-count=${limit + 1}`, `--format=${LOG_FORMAT}`]),
      git(repo, ['remote']),
    ])
    const commits = parseLog(raw)
    const remotes = remoteRaw.split('\n').filter(Boolean)
    res.json({ commits: commits.slice(0, limit), hasMore: commits.length > limit, remotes })
  } catch (e) {
    const msg = (e as Error).message
    if (/does not have any commits yet/.test(msg)) {
      res.json({ commits: [], hasMore: false, remotes: [] })
      return
    }
    res.status(500).json({ error: msg })
  }
})

app.get('/api/avatar', repoGuard, async (req, res) => {
  const email = String(req.query.email ?? '')
  if (!email) {
    res.status(400).json({ error: 'email required' })
    return
  }
  res.json({ url: await resolveAvatar(String(req.query.repo), email, git) })
})

app.get('/api/status', repoGuard, async (req, res) => {
  try {
    res.json({ files: parseStatus(await git(String(req.query.repo), ['status', '--porcelain=v2', '-uall'])) })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/checkout', repoGuard, async (req, res) => {
  const branch = String(req.body.branch ?? '')
  // reject option-like names so the branch can never be parsed as a git flag
  if (!branch || branch.startsWith('-')) {
    res.status(400).json({ error: 'invalid branch name' })
    return
  }
  try {
    // plain `checkout <name>` DWIMs a remote-only branch into a local tracking branch
    await git(String(req.query.repo), ['checkout', branch])
    res.json({ ok: true })
  } catch (e) {
    res.status(409).json({ error: (e as Error).message })
  }
})

app.get('/api/events', repoGuard, (req, res) => {
  const repo = String(req.query.repo)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write(': connected\n\n')
  const ping = setInterval(() => res.write(': ping\n\n'), 30_000)
  let unsub: (() => void) | null = null
  const cleanup = () => {
    clearInterval(ping)
    unsub?.()
    unsub = null
  }
  try {
    unsub = subscribe(
      repo,
      () => res.write('data: changed\n\n'),
      () => {
        cleanup()
        res.end()
      },
    )
  } catch {
    // watcher couldn't start (EMFILE, permissions) — client degrades to manual refresh
    cleanup()
    res.end()
    return
  }
  req.on('close', cleanup)
})

async function firstParent(repo: string, hash: string): Promise<string | null> {
  const out = await git(repo, ['rev-list', '--parents', '-n1', hash])
  return out.trim().split(' ')[1] ?? null
}

app.get('/api/commit', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const hash = String(req.query.hash ?? '')
  try {
    const parent = await firstParent(repo, hash)
    const raw = parent
      ? await git(repo, ['diff', '--name-status', parent, hash])
      : await git(repo, ['diff-tree', '-r', '--root', '--no-commit-id', '--name-status', hash])
    const files = raw.split('\n').filter(Boolean).map(l => {
      const cols = l.split('\t')
      return { status: cols[0][0], path: cols[cols.length - 1] }
    })
    res.json({ files })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

const DIFF_CAP = 1024 * 1024

app.get('/api/diff', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const hash = req.query.hash ? String(req.query.hash) : null
  const file = String(req.query.file ?? '')
  try {
    let diff: string
    if (hash) {
      const parent = await firstParent(repo, hash)
      diff = parent
        ? await git(repo, ['diff', parent, hash, '--', file])
        : await git(repo, ['show', '--format=', hash, '--', file])
    } else {
      diff = await git(repo, ['diff', 'HEAD', '--', file])
      // untracked file: not in HEAD diff; --no-index exits 1 when files differ
      if (!diff.trim()) diff = await git(repo, ['diff', '--no-index', '--', '/dev/null', file], [0, 1])
    }
    if (req.query.force !== '1' && diff.length > DIFF_CAP) {
      res.json({ tooLarge: true, size: diff.length })
      return
    }
    res.json({ diff })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

const dist = join(import.meta.dirname, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
}

app.listen(3411, '127.0.0.1', () => console.log('megit API on http://127.0.0.1:3411'))
