import { useEffect, useState } from 'react'
import { api, jsonInit } from './api'
import type { Config } from './App'

type FsDir = { path: string; parent: string | null; dirs: { name: string; path: string; isRepo: boolean }[]; isRepo: boolean }

export default function DirBrowser({ onPicked, onClose }: { onPicked: (c: Config) => void; onClose: () => void }) {
  const [dir, setDir] = useState<FsDir | null>(null)
  const [error, setError] = useState('')

  const load = (path?: string) => {
    setError('')
    api<FsDir>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`).then(setDir).catch(e => setError(e.message))
  }
  useEffect(() => { load() }, [])

  const pick = (path: string) =>
    api<Config>('/api/repos', jsonInit('POST', { path })).then(onPicked).catch(e => setError(e.message))

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
