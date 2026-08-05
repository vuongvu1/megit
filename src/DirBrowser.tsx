import { useEffect, useState } from 'react'
import { api, jsonInit } from './api'
import type { Config } from './App'

type FsDir = { path: string; parent: string | null; dirs: { name: string; path: string; isRepo: boolean }[]; isRepo: boolean }

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

export default function DirBrowser({ recent, open, onPicked, onSelect, onClose }: {
  recent: string[]
  open: string[]
  onPicked: (c: Config) => void
  onSelect: (r: string) => void
  onClose: () => void
}) {
  const [dir, setDir] = useState<FsDir | null>(null)
  const [error, setError] = useState('')

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
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <button disabled={!dir.parent} onClick={() => dir.parent && load(dir.parent)}>↑</button>
          <span className="modal-path">{dir.path}</span>
          {dir.isRepo && <button onClick={() => pick(dir.path)}>Add</button>}
          <button onClick={onClose}>×</button>
        </div>
        {error && <div className="error">{error}</div>}
        {recent.length > 0 && (
          <>
            <div className="modal-label">Recent</div>
            <ul className="dirlist recent">
              {recent.map(r => (
                <li key={r}>
                  <span className="dirname" title={r} onClick={() => openRecent(r)}>
                    {base(r)}<span className="recent-path">{r}</span>
                  </span>
                  {open.includes(r) && <span className="recent-open">open</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        <ul className="dirlist">
          {dir.dirs.map(d => (
            <li key={d.path}>
              <span className="dirname" onClick={() => load(d.path)}>{d.isRepo ? '● ' : ''}{d.name}</span>
              {d.isRepo && <button onClick={() => pick(d.path)}>Add</button>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
