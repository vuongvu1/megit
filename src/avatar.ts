import { useEffect, useState } from 'react'
import { api } from './api'

// email -> avatar URL, or null when nothing resolves (fall back to initials)
const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

const loads = (url: string) =>
  new Promise<boolean>(resolve => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })

async function gravatar(email: string): Promise<string | null> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  const url = `https://gravatar.com/avatar/${hex}?d=404&s=48`
  return (await loads(url)) ? url : null
}

// GitHub profile photo (server-resolved) -> gravatar -> null (initials)
async function probe(repo: string, email: string): Promise<string | null> {
  try {
    const { url } = await api<{ url: string | null }>(
      `/api/avatar?repo=${encodeURIComponent(repo)}&email=${encodeURIComponent(email)}`,
    )
    if (url && (await loads(url))) return url
  } catch {
    // server unreachable or errored — fall through to gravatar
  }
  return gravatar(email)
}

export function useAvatar(repo: string, email: string | null): string | null {
  const [url, setUrl] = useState(() => (email ? cache.get(email) ?? null : null))
  useEffect(() => {
    if (!email) return
    if (cache.has(email)) {
      setUrl(cache.get(email)!)
      return
    }
    let live = true
    let p = pending.get(email)
    if (!p) {
      p = probe(repo, email)
      pending.set(email, p)
    }
    p.then(u => {
      cache.set(email, u)
      pending.delete(email)
      if (live) setUrl(u)
    })
    return () => { live = false }
  }, [repo, email])
  return email ? url : null
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
