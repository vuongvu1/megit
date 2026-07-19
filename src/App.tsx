import { useEffect, useState } from 'react'
import { api, jsonInit } from './api'
import TabBar from './TabBar'
import DirBrowser from './DirBrowser'
import RepoView from './RepoView'

export type Config = { repos: string[]; activeRepo: string | null }

export default function App() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [browsing, setBrowsing] = useState(false)

  useEffect(() => { api<Config>('/api/config').then(setCfg) }, [])
  if (!cfg) return null

  const select = (repo: string) => {
    setCfg({ ...cfg, activeRepo: repo })
    api<Config>('/api/active', jsonInit('PUT', { repo }))
  }
  const close = (repo: string) =>
    api<Config>(`/api/repos?repo=${encodeURIComponent(repo)}`, { method: 'DELETE' }).then(setCfg)

  return (
    <div className="app">
      <TabBar repos={cfg.repos} active={cfg.activeRepo} onSelect={select} onAdd={() => setBrowsing(true)} onClose={close} />
      {browsing && <DirBrowser onPicked={c => { setCfg(c); setBrowsing(false) }} onClose={() => setBrowsing(false)} />}
      {cfg.activeRepo
        ? <RepoView key={cfg.activeRepo} repo={cfg.activeRepo} onRemove={() => close(cfg.activeRepo!)} />
        : <div className="empty">No repository open — add one with “+”</div>}
    </div>
  )
}
