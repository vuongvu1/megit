import { Component, useEffect, useState, type ReactNode } from 'react'
import { api, jsonInit } from './api'
import TabBar from './TabBar'
import DirBrowser from './DirBrowser'
import RepoView from './RepoView'
import Toasts from './Toast'

// hasTerminal is server-reported: node-pty is optional and has no Linux prebuild
export type Config = { repos: string[]; activeRepo: string | null; hasTerminal: boolean }

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

  useEffect(() => { api<Config>('/api/config').then(setCfg) }, [])
  if (!cfg) return null

  const select = (repo: string) => {
    setCfg({ ...cfg, activeRepo: repo })
    api<Config>('/api/active', jsonInit('PUT', { repo }))
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
      <TabBar repos={cfg.repos} active={cfg.activeRepo} onSelect={select} onAdd={() => setBrowsing(true)} onClose={close} onReorder={reorder} onReorderEnd={reorderEnd} />
      {browsing && <DirBrowser onPicked={c => { setCfg(c); setBrowsing(false) }} onClose={() => setBrowsing(false)} />}
      {cfg.activeRepo
        ? (
          <Boundary key={cfg.activeRepo}>
            <RepoView repo={cfg.activeRepo} onRemove={() => close(cfg.activeRepo!)} hasTerminal={cfg.hasTerminal} />
          </Boundary>
        )
        : <div className="empty">No repository open — add one with “+”</div>}
      <Toasts />
    </div>
  )
}
