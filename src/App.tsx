import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, jsonInit } from './api'
import TabBar from './TabBar'
import DirBrowser from './DirBrowser'
import RepoView from './RepoView'
import Toasts, { toastErr } from './Toast'
import Settings from './SettingsDialog'

// hasTerminal is server-reported: node-pty is optional and has no Linux prebuild
export type Config = { repos: string[]; activeRepo: string | null; recent: string[]; hasTerminal: boolean; home: string; linked: string[] }

// Fetch failures already surface inside RepoView; a *render* throw is the one that
// unmounts the tree and leaves a blank window with only the console to explain it.
// No hook does this — a class is the whole API. Keyed by repo below, so switching
// tabs is itself a reset.
class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null }
  static getDerivedStateFromError(err: Error) {
    return { err }
  }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="empty">
        <div>
          <div className="error">{this.state.err.message}</div>
          <button onClick={() => this.setState({ err: null })}>Try again</button>
        </div>
      </div>
    )
  }
}

export default function App() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Session union: the server stops reporting a worktree once its directory is gone, but the tab must stay marked.
  const everLinked = useRef(new Set<string>())
  useEffect(() => { api<Config>('/api/config').then(setCfg) }, [])
  if (!cfg) return null
  for (const p of cfg.linked) everLinked.current.add(p)
  const linked = cfg.repos.filter(r => everLinked.current.has(r))

  const select = (repo: string) => {
    setCfg({ ...cfg, activeRepo: repo })
    api<Config>('/api/active', jsonInit('PUT', { repo }))
  }
  // `after` seats a worktree opened from the strip beside the tab that opened it.
  const open = (path: string) => {
    if (cfg.repos.includes(path)) return select(path)
    api<Config>('/api/repos', jsonInit('POST', { path, after: cfg.activeRepo })).then(setCfg).catch(e => toastErr(e.message))
  }
  const close = (repo: string) =>
    api<Config>(`/api/repos?repo=${encodeURIComponent(repo)}`, { method: 'DELETE' }).then(setCfg)

  const reorder = (from: number, to: number) => {
    const repos = [...cfg.repos]
    repos.splice(to, 0, ...repos.splice(from, 1))
    setCfg({ ...cfg, repos })
  }
  const reorderEnd = () =>
    api<Config>('/api/repos/order', jsonInit('PUT', { repos: cfg.repos })).then(setCfg).catch(() => {})

  return (
    <div className="app">
      <TabBar repos={cfg.repos} home={cfg.home} linked={linked} active={cfg.activeRepo} onSelect={select} onAdd={() => setBrowsing(true)} onClose={close} onReorder={reorder} onReorderEnd={reorderEnd} onSettings={() => setSettingsOpen(true)} />
      {browsing && (
        <DirBrowser
          recent={cfg.recent}
          open={cfg.repos}
          home={cfg.home}
          active={cfg.activeRepo}
          onPicked={c => { setCfg(c); setBrowsing(false) }}
          onSelect={select}
          onClose={() => setBrowsing(false)}
        />
      )}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {cfg.activeRepo
        ? (
          <Boundary key={cfg.activeRepo}>
            <RepoView repo={cfg.activeRepo} home={cfg.home} linked={linked.includes(cfg.activeRepo)} onOpen={open} onRemove={() => close(cfg.activeRepo!)} hasTerminal={cfg.hasTerminal} />
          </Boundary>
        )
        : <div className="empty">No repository open — add one with “+”</div>}
      <Toasts />
    </div>
  )
}
