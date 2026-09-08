import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// This file holds every outbound network call the server makes, and every
// external host it knows about:
//
//   api.github.com                — commit -> GitHub account lookup (resolveAvatar)
//   avatars.githubusercontent.com — the photo itself, fetched by the browser
//   github.com/<user>.png         — same, for legacy noreply emails
//
// All three are literals, never assembled from remote input, and nothing here
// runs unless author avatars are on in Settings. Requests are anonymous: no
// token is read, sent or stored, so GitHub's 60 req/h unauthenticated limit
// applies — the on-disk cache below makes that one request per author, ever.
// See SECURITY.md, "Threat model".

// GitHub noreply emails encode the account: "12345+user@users.noreply.github.com"
// (current form) or legacy "user@users.noreply.github.com".
export function noreplyAvatar(email: string): string | null {
  const m = email.match(/^(?:(\d+)\+)?([^@+]+)@users\.noreply\.github\.com$/)
  if (!m) return null
  return m[1]
    ? `https://avatars.githubusercontent.com/u/${m[1]}?s=48`
    : `https://github.com/${m[2]}.png?size=48`
}

// owner/repo out of either remote spelling — ssh (git@host:owner/repo.git) or
// https (host/owner/repo, with or without the .git suffix)
export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const m = url.trim().match(/github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/)
  return m ? { owner: m[1], repo: m[2] } : null
}

const cacheFile = join(homedir(), '.config', 'megit', 'avatars.json')
let cache: Record<string, string | null> | null = null
function loadCache(): Record<string, string | null> {
  if (!cache) {
    try {
      cache = JSON.parse(readFileSync(cacheFile, 'utf8'))
    } catch {
      cache = {}
    }
  }
  return cache!
}
function saveCache() {
  mkdirSync(join(homedir(), '.config', 'megit'), { recursive: true })
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2))
}

type Git = (repo: string, args: string[]) => Promise<string>

// email -> GitHub profile avatar. Strategy: noreply emails resolve locally; anything
// else looks up one commit by that author and asks the GitHub commits API which
// account it belongs to. Definitive answers (incl. "no account") persist to disk;
// rate limits / network errors stay uncached so a later run retries.
export async function resolveAvatar(repo: string, email: string, git: Git): Promise<string | null> {
  const direct = noreplyAvatar(email)
  if (direct) return direct
  const c = loadCache()
  if (email in c) return c[email]

  let url: string | null = null
  let definitive = true
  try {
    const remote = parseGithubRemote(await git(repo, ['remote', 'get-url', 'origin']))
    if (remote) {
      const rx = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const sha = (await git(repo, ['log', '--all', '-1', `--author=${rx}`, '--format=%H'])).trim()
      if (sha) {
        const resp = await fetch(`https://api.github.com/repos/${remote.owner}/${remote.repo}/commits/${sha}`, {
          headers: { 'User-Agent': 'megit', Accept: 'application/vnd.github+json' },
        })
        if (resp.ok) {
          const data = (await resp.json()) as { author?: { avatar_url?: string } | null }
          const raw = data.author?.avatar_url
          url = raw ? raw + (raw.includes('?') ? '&' : '?') + 's=48' : null
        } else if (resp.status !== 404 && resp.status !== 422) {
          // 403/429 = rate limited: leave it uncached so a later run retries
          definitive = false
        }
      }
    }
  } catch {
    definitive = false
  }
  if (definitive) {
    c[email] = url
    saveCache()
  }
  return url
}
