import express from 'express'
import type { RequestHandler } from 'express'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { loadConfig, saveConfig, isPermutation } from './config.ts'
import { resolveAvatar, parseGithubRemote } from './avatars.ts'
import { parseBranchHeader, parseLog, parseMeta, parseNameStatus, parseStatus, stashIndex, LOG_FORMAT, META_FORMAT } from './parse.ts'
import { subscribe } from './watch.ts'
import { wireTerminal } from './term.ts'

const app = express()
app.use(express.json())

// The server listens on loopback only, but that alone doesn't stop a page on
// attacker.tld from rebinding its DNS to 127.0.0.1: the browser then treats this
// API as same-origin and CORS never applies. Pinning Host closes that — a rebound
// request still carries the attacker's hostname. (/api/term does the same with Origin.)
app.use((req, res, next) => {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? '')) {
    res.status(403).json({ error: 'forbidden host' })
    return
  }
  next()
})

// git treats a leading-dash rev as an option (`git diff --output=<file>` writes files),
// so revs from the client are whitelisted rather than escaped
const isSha = (s: string) => /^[0-9a-f]{4,40}$/.test(s)

// No git invocation may block on a prompt: a passphrase-protected key, an expired
// token or a missing credential helper has to fail fast. Without these, a push
// waits on stdin that no one is attached to and the request never returns.
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'echo',
  SSH_ASKPASS: 'echo',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
}

// core.quotePath=false: git otherwise C-quotes non-ASCII paths in every kind of
// output, and a quoted literal fed back as a pathspec matches nothing. The `-z`
// readers below don't need it, but `git show`/`ls-files`/error messages do.
const QUOTE_PATH = ['-c', 'core.quotePath=false']

function git(repo: string, args: string[], okCodes: number[] = [0], timeout = 0, env?: Record<string, string>): Promise<string> {
  return new Promise((res, rej) => {
    execFile('git', ['-C', repo, ...QUOTE_PATH, ...args], { maxBuffer: 50 * 1024 * 1024, env: { ...GIT_ENV, ...env }, timeout }, (err, stdout, stderr) => {
      if (err && (err as { killed?: boolean }).killed) {
        rej(new Error(`git ${args[0]} timed out after ${timeout / 1000}s`))
      } else if (err && !okCodes.includes(typeof err.code === 'number' ? err.code : 1)) {
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
  // capped: the client asks for as many as it has loaded, which grows a page at a
  // time, but an uncapped limit turns one request into the whole history (4.2 MB /
  // 380 ms on a 14.8k-commit repo). 5000 rows is far past where the DOM gives out.
  const limit = Math.min(5000, Math.max(1, Number(req.query.limit) || 100))
  try {
    const stashRaw = await git(repo, ['stash', 'list', '--format=%H%x1f%P%x1f%ct%x1f%s']).catch(() => '')
    const stashes = stashRaw.split('\n').filter(Boolean).map(l => {
      const [hash, parents, date, subject] = l.split('\x1f')
      return { hash, parent: parents.split(' ')[0], date: Number(date), subject }
    })
    const [raw, remoteRaw, originUrl] = await Promise.all([
      // Whitelist the tips, don't use --all: --all means every ref under refs/, which drags in
      // tool-written namespaces (agent checkpoints, refs/prefetch from git maintenance, refs/bisect)
      // that are noise in the graph — and each parentless one burns a lane. HEAD covers detached.
      // Stash bases are added as explicit tips — a reset/dropped branch can leave a base
      // reachable only through its stash, and it must still show in the graph. The stash commits
      // themselves stay out (refs/stash isn't a branch/tag/remote) and render as stash rows.
      // --date-order: children still precede parents (lane layout invariant), but
      // branches interleave by commit date, GitKraken-style — --topo-order would list
      // HEAD's whole branch chain before any other branch appears.
      git(repo, ['log', 'HEAD', '--branches', '--tags', '--remotes', ...stashes.map(s => s.parent), '--date-order', `--skip=${skip}`, `--max-count=${limit + 1}`, `--format=${LOG_FORMAT}`]),
      git(repo, ['remote']),
      git(repo, ['remote', 'get-url', 'origin']).catch(() => ''),
    ])
    const commits = parseLog(raw)
    const remotes = remoteRaw.split('\n').filter(Boolean)
    const gh = parseGithubRemote(originUrl)
    res.json({ commits: commits.slice(0, limit), hasMore: commits.length > limit, remotes, stashes, githubUrl: gh ? `https://github.com/${gh.owner}/${gh.repo}` : null })
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
    // --branch prepends the branch/upstream/ahead-behind headers to the output this
    // already parses — the toolbar's Pull/Push badges for no extra git process
    const raw = await git(String(req.query.repo), ['status', '--porcelain=v2', '-uall', '--branch', '-z'])
    res.json({ files: parseStatus(raw), branch: parseBranchHeader(raw) })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// resolves to a sha, or null when the ref doesn't exist (--quiet: exit 1, empty output)
async function revParse(repo: string, ref: string): Promise<string | null> {
  const out = await git(repo, ['rev-parse', '--verify', '--quiet', ref], [0, 1])
  return out.trim() || null
}

// Uncommitted work goes to a stash before anything that moves the worktree, so no
// path can fail on (or silently carry over) a dirty tree. Returns whether it stashed.
async function stashIfDirty(repo: string, why: string): Promise<boolean> {
  if ((await git(repo, ['status', '--porcelain'])).trim() === '') return false
  await git(repo, ['stash', 'push', '-u', '-m', `megit: ${why}`])
  return true
}

app.post('/api/checkout', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const branch = String(req.body.branch ?? '')
  const reset = req.body.reset === true
  // reject option-like names so the branch can never be parsed as a git flag
  if (!branch || branch.startsWith('-')) {
    res.status(400).json({ error: 'invalid branch name' })
    return
  }
  try {
    const dirty = (await git(repo, ['status', '--porcelain'])).trim() !== ''
    const stash = (why: string) => stashIfDirty(repo, why)
    const remotes = (await git(repo, ['remote'])).split('\n').filter(Boolean)
    let remoteRef: string | null = null
    for (const r of remotes) {
      if (await revParse(repo, `refs/remotes/${r}/${branch}`)) {
        remoteRef = `${r}/${branch}`
        break
      }
    }
    const hasLocal = !!(await revParse(repo, `refs/heads/${branch}`))
    if (!remoteRef || !hasLocal) {
      // plain `checkout <name>` DWIMs a remote-only branch into a local tracking branch
      await stash(`WIP before checkout ${branch}`)
      await git(repo, ['checkout', branch])
      res.json({ ok: true, stashed: dirty })
      return
    }
    const localOnly = Number((await git(repo, ['rev-list', '--count', `${remoteRef}..refs/heads/${branch}`])).trim())
    const remoteOnly = Number((await git(repo, ['rev-list', '--count', `refs/heads/${branch}..${remoteRef}`])).trim())
    if (localOnly === 0) {
      // equal or strictly behind: checkout, then fast-forward to the remote
      await stash(`WIP before checkout ${branch}`)
      await git(repo, ['checkout', branch])
      if (remoteOnly > 0) await git(repo, ['merge', '--ff-only', remoteRef])
      res.json({ ok: true, forwarded: remoteOnly, stashed: dirty })
      return
    }
    if (!reset) {
      // diverged (or ahead): the client asks the user before anything destructive
      res.json({ diverged: true, remoteRef, ahead: localOnly, behind: remoteOnly })
      return
    }
    await stash(`${branch} before reset to ${remoteRef}`)
    await git(repo, ['checkout', '-B', branch, remoteRef])
    res.json({ ok: true, reset: true, stashed: dirty })
  } catch (e) {
    res.status(409).json({ error: (e as Error).message })
  }
})

app.post('/api/stash', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const hash = String(req.body.hash ?? '')
  const action = req.body.action
  if (action !== 'push' && (!isSha(hash) || !['pop', 'drop', 'retitle'].includes(action))) {
    res.status(400).json({ error: 'invalid stash request' })
    return
  }
  try {
    if (action === 'push') {
      const message = String(req.body.message ?? '').trim()
      // -u: the WIP row counts untracked files, so stashing without them would
      // leave the row standing after a "stash everything" action.
      // --message=<msg> (not -m <msg>): the value can't be mistaken for a flag.
      await git(repo, ['stash', 'push', '-u', ...(message ? [`--message=${message}`] : [])])
      res.json({ ok: true })
      return
    }
    // the index is derived from git's own list here, never from the request, so
    // no client string reaches argv and a concurrent drop can't misaddress this one
    const idx = stashIndex(await git(repo, ['stash', 'list', '--format=%H']), hash)
    if (idx < 0) {
      res.status(409).json({ error: 'stash no longer exists — it was already popped or dropped' })
      return
    }
    if (action === 'retitle') {
      const message = String(req.body.message ?? '').trim()
      if (!message) {
        res.status(400).json({ error: 'empty stash message' })
        return
      }
      // A stash's label is its own commit message, so editing it means rewriting the
      // commit — same tree, same parents (3 when untracked files went in), same
      // author/committer identity and dates, so the row keeps its place in the graph.
      const [tree, parents, an, ae, ad, cn, ce, cd] =
        (await git(repo, ['show', '-s', '--format=%T%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI', hash])).trim().split('\x1f')
      const rewritten = (await git(repo, ['commit-tree', tree, ...parents.split(' ').flatMap(p => ['-p', p]), '-m', message], [0], 0, {
        GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_AUTHOR_DATE: ad,
        GIT_COMMITTER_NAME: cn, GIT_COMMITTER_EMAIL: ce, GIT_COMMITTER_DATE: cd,
      })).trim()
      // store lands at stash@{0} and pushes the rest down one, so the original is at
      // idx + 1 (it can't be found by sha — both entries carry the old one's sha until
      // the drop). ponytail: the edited stash keeps its new place at the top of
      // `git stash list`; the graph orders stashes by date, so nothing moves there.
      await git(repo, ['stash', 'store', `--message=${message}`, rewritten])
      await git(repo, ['stash', 'drop', `stash@{${idx + 1}}`])
      res.json({ ok: true, hash: rewritten })
      return
    }
    // ponytail: plain `pop`, no --index — restoring the staged/unstaged split fails
    // outright when the index can't be reapplied. Add --index if that split matters.
    await git(repo, ['stash', action, `stash@{${idx}}`])
    res.json({ ok: true })
  } catch (e) {
    // conflicting pop leaves the stash in place and markers in the tree — git says so
    res.status(409).json({ error: (e as Error).message })
  }
})

const NET_TIMEOUT = 30_000

// same shape the client's api() throws — an Error carrying the status to send
const httpError = (status: number, msg: string) => Object.assign(new Error(msg), { status })

// An existing branch is only ever addressed by a string git itself printed —
// the request supplies a name, and it has to match one of these exactly.
const knownRefs = async (repo: string, ...args: string[]) =>
  (await git(repo, ['for-each-ref', '--format=%(refname:short)', ...args])).split('\n').filter(Boolean)

const mustExist = (refs: string[], name: unknown, kind: string) => {
  const s = String(name ?? '')
  if (!refs.includes(s)) throw httpError(400, `unknown ${kind}: ${s}`)
  return s
}

// A new name is the one string git hasn't produced itself: reject option-like
// names so it can't be read as a flag, then let git's own validator rule on the
// rest rather than re-deriving refname syntax in a regex here.
async function newRefName(repo: string, raw: unknown, kind: 'branch' | 'tag'): Promise<string> {
  const name = String(raw ?? '').trim()
  if (!name || name.startsWith('-')) throw httpError(400, `invalid ${kind} name`)
  try {
    await git(repo, ['check-ref-format', `refs/${kind === 'tag' ? 'tags' : 'heads'}/${name}`])
  } catch {
    throw httpError(400, `'${name}' is not a valid ${kind} name`)
  }
  return name
}

// A commit sha is checked for shape, then resolved: what reaches a mutating
// command is the sha git printed back, and an unknown one fails here.
async function mustResolve(repo: string, raw: unknown): Promise<string> {
  const hash = String(raw ?? '')
  if (!isSha(hash)) throw httpError(400, 'invalid commit')
  const sha = await revParse(repo, `${hash}^{commit}`)
  if (!sha) throw httpError(400, `unknown commit: ${hash}`)
  return sha
}

app.post('/api/branch', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const action = String(req.body.action ?? '')
  const locals = () => knownRefs(repo, 'refs/heads')
  try {
    switch (action) {
      case 'create': {
        const at = String(req.body.at ?? '')
        if (!isSha(at)) throw httpError(400, 'invalid commit')
        // create only, no checkout: /api/checkout stays the single path that has
        // to reason about a dirty worktree
        await git(repo, ['branch', await newRefName(repo, req.body.name, 'branch'), at])
        break
      }
      case 'rename': {
        const branch = mustExist(await locals(), req.body.branch, 'branch')
        await git(repo, ['branch', '-m', branch, await newRefName(repo, req.body.name, 'branch')])
        break
      }
      case 'delete': {
        const branch = mustExist(await locals(), req.body.branch, 'branch')
        const current = (await git(repo, ['branch', '--show-current'])).trim()
        if (branch === current) throw httpError(409, 'cannot delete the checked-out branch')
        // -d refuses to drop unmerged work; the client re-asks and sends force
        await git(repo, ['branch', req.body.force === true ? '-D' : '-d', branch])
        break
      }
      case 'deleteTag': {
        // ponytail: local tag only — the graph's chips come from local refs, so a
        // remote tag would need `push --delete`, a network action nobody asked for
        const tag = mustExist(await knownRefs(repo, 'refs/tags'), req.body.tag, 'tag')
        await git(repo, ['tag', '-d', tag])
        break
      }
      case 'merge':
      case 'rebase': {
        const branch = mustExist(await locals(), req.body.branch, 'branch')
        // --autostash, matching the auto-stash /api/checkout does — git's flag,
        // not our own stash dance. A conflict stops and stays stopped: the files
        // show up in the WIP row and get resolved in the terminal.
        await git(repo, [action, '--autostash', branch])
        break
      }
      case 'upstream': {
        const branch = mustExist(await locals(), req.body.branch, 'branch')
        const upstream = mustExist(await knownRefs(repo, 'refs/remotes'), req.body.upstream, 'remote branch')
        await git(repo, ['branch', `--set-upstream-to=${upstream}`, branch])
        break
      }
      case 'pull':
        await git(repo, ['pull', '--ff-only', '--autostash'], [0], NET_TIMEOUT)
        break
      case 'push': {
        const current = (await git(repo, ['branch', '--show-current'])).trim()
        if (!current) throw httpError(409, 'detached HEAD — nothing to push')
        const upstream = (await git(repo, ['rev-parse', '--abbrev-ref', `${current}@{upstream}`], [0, 128])).trim()
        const remotes = (await git(repo, ['remote'])).split('\n').filter(Boolean)
        // never --force. A first push with one remote sets the upstream, which is
        // what the missing-upstream error would have told the user to do by hand
        const args = upstream || remotes.length !== 1 ? ['push'] : ['push', '-u', remotes[0], current]
        await git(repo, args, [0], NET_TIMEOUT)
        break
      }
      default:
        throw httpError(400, `unknown action: ${action}`)
    }
    res.json({ ok: true })
  } catch (e) {
    const err = e as Error
    res.status((err as { status?: number }).status ?? 409).json({ error: err.message })
  }
})

app.post('/api/commit', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const action = String(req.body.action ?? '')
  try {
    const sha = await mustResolve(repo, req.body.hash)
    const short = sha.slice(0, 7)
    switch (action) {
      case 'checkout':
        // detaches HEAD; the client says so before asking for it
        await stashIfDirty(repo, `WIP before checkout ${short}`)
        await git(repo, ['checkout', sha])
        break
      case 'cherry-pick':
      case 'revert':
        // --no-edit: no editor can open here. A conflict stops mid-operation and
        // stays that way — the files land in the WIP row, the terminal finishes it.
        await git(repo, [action, '--no-edit', sha])
        break
      case 'tag':
        await git(repo, ['tag', await newRefName(repo, req.body.name, 'tag'), sha])
        break
      case 'amend': {
        // only the tip is amendable — anything older needs a rebase, which this isn't
        if (sha !== (await git(repo, ['rev-parse', 'HEAD'])).trim()) throw httpError(409, 'only the latest commit can be edited')
        if (!(await git(repo, ['branch', '--show-current'])).trim()) throw httpError(409, 'detached HEAD — check out a branch first')
        const message = String(req.body.message ?? '').trim()
        if (!message) throw httpError(400, 'empty commit message')
        if (req.body.force !== true) {
          // rewriting a pushed commit leaves the remote needing a force push, which
          // megit never does — so the client has to ask again before this proceeds
          const onRemote = (await git(repo, ['branch', '-r', '--contains', sha]))
            .split('\n').map(s => s.trim())
            // drop the "origin/HEAD -> origin/main" symref line: it's a pointer, not a second branch
            .filter(r => r && !r.includes(' -> '))
          if (onRemote.length) throw httpError(409, `already pushed to ${onRemote.join(', ')}`)
        }
        // --only: a plain --amend folds whatever is staged into the rewritten commit,
        // so editing a message with unrelated work staged would quietly commit it.
        // --no-verify: nothing changes in the tree, so pre-commit has nothing to check.
        // --message=: the value can't be read as a flag, and carries newlines fine.
        await git(repo, ['commit', '--amend', '--only', '--no-verify', `--message=${message}`], [0], NET_TIMEOUT)
        res.json({ ok: true, hash: (await git(repo, ['rev-parse', 'HEAD'])).trim() })
        return
      }
      case 'reset': {
        const mode = req.body.mode
        if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') throw httpError(400, 'invalid reset mode')
        // --hard is the only action here that can destroy uncommitted work, so it
        // doesn't: the worktree goes to a stash first and the reset is recoverable
        if (mode === 'hard') await stashIfDirty(repo, `WIP before reset to ${short}`)
        await git(repo, ['reset', `--${mode}`, sha])
        break
      }
      default:
        throw httpError(400, `unknown action: ${action}`)
    }
    res.json({ ok: true })
  } catch (e) {
    const err = e as Error
    res.status((err as { status?: number }).status ?? 409).json({ error: err.message })
  }
})

app.post('/api/wip', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const action = String(req.body.action ?? '')
  try {
    // Every pathspec is matched against a status read taken right now, and goes
    // after `--`. That matters most for discard: it runs `git clean`, so a path
    // the request invented would be arbitrary file deletion.
    const mustBeDirty = async () => {
      const path = String(req.body.path ?? '')
      const dirty = parseStatus(await git(repo, ['status', '--porcelain=v2', '-uall', '-z']))
      const entry = dirty.find(f => f.path === path)
      if (!entry) throw httpError(400, `no uncommitted change at: ${path}`)
      return entry
    }
    switch (action) {
      case 'stage':
        await git(repo, ['add', '--', (await mustBeDirty()).path])
        break
      case 'unstage':
        await git(repo, ['restore', '--staged', '--', (await mustBeDirty()).path])
        break
      case 'stage-all':
        await git(repo, ['add', '-A'])
        break
      case 'unstage-all':
        await git(repo, ['restore', '--staged', '--', '.'])
        break
      case 'discard-file': {
        const entry = await mustBeDirty()
        // an untracked file has nothing to restore from — discarding it means deleting it.
        // Tracked: restore the worktree from the index, so a staged part survives.
        if (entry.y === '?') await git(repo, ['clean', '-f', '--', entry.path])
        else await git(repo, ['restore', '--', entry.path])
        break
      }
      case 'discard':
        // everything back to HEAD: tracked files restored on both sides, untracked
        // removed. No -x — ignored files (node_modules, .env) are not "changes".
        await git(repo, ['restore', '--staged', '--worktree', '--', '.'])
        await git(repo, ['clean', '-fd'])
        break
      case 'stash': {
        const message = String(req.body.message ?? '').trim()
        const msg = message ? [`--message=${message}`] : []
        if (req.body.scope === 'staged') {
          // --staged stashes exactly the index and leaves the worktree edits alone
          await git(repo, ['stash', 'push', '--staged', ...msg])
        } else if (req.body.scope === 'unstaged') {
          // ponytail: --keep-index leaves the staged set in place, which is what the
          // button promises — but the stash it writes holds the whole worktree, staged
          // content included. Exact split would be push --staged, push -u, pop --index
          // stash@{1}; three commands with a half-failed middle state. Upgrade if the
          // superset ever bites when popping.
          await git(repo, ['stash', 'push', '-u', '--keep-index', ...msg])
        } else throw httpError(400, 'invalid stash scope')
        break
      }
      case 'commit': {
        const message = String(req.body.message ?? '').trim()
        if (!message) throw httpError(400, 'empty commit message')
        // hooks run as they would in a terminal — this commit has real content —
        // but a hook that blocks on stdin gets killed rather than wedging the request
        await git(repo, ['commit', `--message=${message}`], [0], NET_TIMEOUT)
        res.json({ ok: true, hash: (await git(repo, ['rev-parse', 'HEAD'])).trim() })
        return
      }
      default:
        throw httpError(400, `unknown action: ${action}`)
    }
    res.json({ ok: true })
  } catch (e) {
    const err = e as Error
    res.status((err as { status?: number }).status ?? 409).json({ error: err.message })
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
  if (!isSha(hash)) {
    res.status(400).json({ error: 'invalid hash' })
    return
  }
  try {
    // one show call yields message/author/committer AND the parent list for the diff
    const meta = parseMeta(await git(repo, ['show', '-s', `--format=${META_FORMAT}`, hash]))
    const parent = meta.parents[0] ?? null
    const raw = parent
      ? await git(repo, ['diff', '--name-status', '-z', parent, hash])
      : await git(repo, ['diff-tree', '-r', '--root', '--no-commit-id', '--name-status', '-z', hash])
    res.json({ files: parseNameStatus(raw), meta })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

const DIFF_CAP = 1024 * 1024

app.get('/api/diff', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const hash = req.query.hash ? String(req.query.hash) : null
  const file = String(req.query.file ?? '')
  if (hash !== null && !isSha(hash)) {
    res.status(400).json({ error: 'invalid hash' })
    return
  }
  // `context` widens -U so the client can expand hunk gaps from one response
  const n = Number(req.query.context)
  const ctx = Number.isInteger(n) && n > 0 ? [`-U${Math.min(n, 1e6)}`] : []
  try {
    let diff: string
    if (hash) {
      const parent = await firstParent(repo, hash)
      diff = parent
        ? await git(repo, ['diff', ...ctx, parent, hash, '--', file])
        : await git(repo, ['show', '--format=', ...ctx, hash, '--', file])
    } else if (req.query.side === 'staged') {
      // HEAD vs index only — the merged HEAD-vs-worktree diff below would be empty
      // for a file that's fully staged, and misleading for a partially staged one
      diff = await git(repo, ['diff', '--cached', ...ctx, '--', file])
    } else {
      // index vs worktree for the unstaged side, HEAD vs worktree when no side is given
      diff = await git(repo, ['diff', ...ctx, ...(req.query.side === 'worktree' ? [] : ['HEAD']), '--', file])
      // untracked file: not in HEAD diff; --no-index exits 1 when files differ
      if (!diff.trim()) diff = await git(repo, ['diff', '--no-index', ...ctx, '--', '/dev/null', file], [0, 1])
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

// raw bytes of one blob, for rendering image diffs as two <img>. `which` picks
// the before/after side; a missing blob (added or deleted file) is a 404 the
// client renders as an empty pane.
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
}

function gitBuf(repo: string, args: string[]): Promise<Buffer> {
  return new Promise((res, rej) => {
    execFile('git', ['-C', repo, ...args], { maxBuffer: 50 * 1024 * 1024, env: GIT_ENV, encoding: 'buffer' }, (err, stdout, stderr) => {
      if (err) rej(new Error(stderr.toString().trim() || err.message))
      else res(stdout)
    })
  })
}

app.get('/api/blob', repoGuard, async (req, res) => {
  const repo = String(req.query.repo)
  const hash = req.query.hash ? String(req.query.hash) : null
  const file = String(req.query.file ?? '')
  const side = String(req.query.side ?? '')
  const old = req.query.which === 'old'
  if (hash !== null && !isSha(hash)) {
    res.status(400).json({ error: 'invalid hash' })
    return
  }
  const mime = MIME[file.split('.').pop()?.toLowerCase() ?? '']
  if (!mime) {
    res.status(400).json({ error: 'unsupported file type' })
    return
  }
  try {
    let buf: Buffer
    if (hash) {
      const rev = old ? await firstParent(repo, hash) : hash
      if (!rev) {
        res.status(404).end()
        return
      }
      buf = await gitBuf(repo, ['show', `${rev}:${file}`])
    } else if (old) {
      // staged pane compares against HEAD; unstaged compares against the index
      buf = await gitBuf(repo, ['show', `${side === 'worktree' ? '' : 'HEAD'}:${file}`])
    } else if (side === 'staged') {
      buf = await gitBuf(repo, ['show', `:${file}`])
    } else {
      // worktree content isn't in any git object — read it off disk, but only
      // from inside the (already guarded) repo
      // realpath, not resolve: a cloned repo can contain a symlink pointing
      // outside itself, and git will happily materialize it on checkout
      const abs = await realpath(resolve(repo, file))
      const root = await realpath(repo)
      if (!abs.startsWith(root + sep)) {
        res.status(400).json({ error: 'path outside repo' })
        return
      }
      buf = await readFile(abs)
    }
    // repo content is untrusted (an SVG can carry script); <img> never runs it,
    // but a direct navigation to this URL would — sandbox it either way
    res.set('Content-Security-Policy', "sandbox; default-src 'none'").set('X-Content-Type-Options', 'nosniff')
    res.type(mime).send(buf)
  } catch {
    res.status(404).end()
  }
})

const dist = join(import.meta.dirname, '..', 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
}

const port = Number(process.env.PORT) || 3411
wireTerminal(app.listen(port, '127.0.0.1', () => console.log(`megit API on http://127.0.0.1:${port}`)))
