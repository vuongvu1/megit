import { useEffect, useMemo, useState } from 'react'
import { api, jsonInit } from './api'
import type { Config } from './App'

type FsDir = { path: string; parent: string | null; dirs: { name: string; path: string; isRepo: boolean }[]; isRepo: boolean }

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

// Deterministic hue from the full path, so a repo keeps the same colour across
// sessions and two checkouts of the same project stay distinguishable.
const hue = (p: string) => {
  let h = 0
  for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) % 360
  return h
}

export default function DirBrowser({ recent, open, active, onPicked, onSelect, onClose }: {
  recent: string[]
  open: string[]
  active: string | null
  onPicked: (c: Config) => void
  onSelect: (r: string) => void
  onClose: () => void
}) {
  const [dir, setDir] = useState<FsDir | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const load = (path?: string) => {
    setError('')
    api<FsDir>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`).then(setDir).catch(e => setError(e.message))
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  // Matches the full path, not just the basename: two checkouts of the same repo
  // are only distinguishable by their parent directories.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? recent.filter(r => r.toLowerCase().includes(q)) : recent
  }, [recent, query])

  const pick = (path: string) =>
    api<Config>('/api/repos', jsonInit('POST', { path })).then(onPicked).catch(e => setError(e.message))

  // An already-open repo is a tab switch, not a re-add: adding it again would
  // reorder nothing and just round-trip the config.
  const openRecent = (path: string) => {
    if (!open.includes(path)) return pick(path)
    onSelect(path)
    onClose()
  }

  if (!dir) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal picker" onClick={e => e.stopPropagation()}>
        {recent.length > 0 && (
          <div className="picker-pane picker-recent">
            <div className="modal-label">Recent</div>
            <input
              className="recent-filter"
              placeholder="Search…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
            <ul className="dirlist">
              {shown.map(r => (
                <li key={r} className={r === active ? 'sel' : ''}>
                  <span className="repo-logo" style={{ background: `hsl(${hue(r)} 42% 42%)` }} aria-hidden>
                    {base(r).charAt(0).toUpperCase()}
                  </span>
                  <span className="dirname" title={r} onClick={() => openRecent(r)}>{base(r)}</span>
                  {open.includes(r) && <span className="recent-dot" title="open" />}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="picker-pane">
          <div className="modal-head">
            <button disabled={!dir.parent} onClick={() => dir.parent && load(dir.parent)}>↑</button>
            <span className="modal-path" title={dir.path}>
              {dir.path.slice(0, dir.path.length - base(dir.path).length)}
              <b>{base(dir.path)}</b>
            </span>
            {dir.isRepo && <button onClick={() => pick(dir.path)}>Add</button>}
            <button onClick={onClose}>×</button>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-label">Folders</div>
          <ul className="dirlist">
            {dir.dirs.map(d => (
              <li key={d.path}>
                <span className="dirname" onClick={() => load(d.path)}>{d.name}</span>
                {d.isRepo && <button onClick={() => pick(d.path)}>Add</button>}
                <span className="dir-chevron" onClick={() => load(d.path)}>›</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
