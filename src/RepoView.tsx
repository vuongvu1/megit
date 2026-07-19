import { useCallback, useEffect, useState } from 'react'
import type { Commit, StatusEntry } from '../server/parse.ts'
import { api } from './api'
import GraphView from './GraphView'
import CommitPanel from './CommitPanel'

export type Selection = { kind: 'commit'; hash: string } | { kind: 'wip' } | null

export default function RepoView({ repo, onRemove }: { repo: string; onRemove: () => void }) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [status, setStatus] = useState<StatusEntry[]>([])
  const [selection, setSelection] = useState<Selection>(null)
  const [error, setError] = useState<{ msg: string; gone: boolean } | null>(null)

  const q = `repo=${encodeURIComponent(repo)}`

  const refresh = useCallback(() => {
    setError(null)
    Promise.all([
      api<{ commits: Commit[]; hasMore: boolean }>(`/api/graph?${q}`),
      api<{ files: StatusEntry[] }>(`/api/status?${q}`),
    ]).then(([g, s]) => {
      setCommits(g.commits)
      setHasMore(g.hasMore)
      setStatus(s.files)
    }).catch(e => setError({ msg: e.message, gone: e.status === 410 }))
  }, [q])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && (e.target as HTMLElement).tagName !== 'INPUT') refresh()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh])

  const loadMore = () =>
    api<{ commits: Commit[]; hasMore: boolean }>(`/api/graph?${q}&skip=${commits.length}`)
      .then(g => { setCommits([...commits, ...g.commits]); setHasMore(g.hasMore) })
      .catch(e => setError({ msg: e.message, gone: false }))

  if (error) {
    return (
      <div className="empty">
        <div>
          <div className="error">{error.msg}</div>
          {error.gone ? <button onClick={onRemove}>Remove tab</button> : <button onClick={refresh}>Retry</button>}
        </div>
      </div>
    )
  }

  return (
    <div className="repoview">
      <div className="toolbar">
        <span className="repo-path">{repo}</span>
        <button onClick={refresh} title="Refresh (r)">⟳ Refresh</button>
      </div>
      <div className="panes">
        <GraphView commits={commits} status={status} selection={selection} onSelect={setSelection} onLoadMore={loadMore} hasMore={hasMore} />
        <CommitPanel repo={repo} selection={selection} status={status} />
      </div>
    </div>
  )
}
