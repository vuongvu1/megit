import { useEffect, useState } from 'react'
import type { StatusEntry } from '../server/parse.ts'
import { api } from './api'
import type { Selection } from './RepoView'
import DiffView from './DiffView'

const STATUS_COLOR: Record<string, string> = { M: '#e5c07b', A: '#98c379', D: '#e06c75', R: '#61afef', '?': '#98c379', U: '#e06c75' }

export default function CommitPanel({ repo, selection, status, wipTick }: { repo: string; selection: Selection; status: StatusEntry[]; wipTick: number }) {
  const [fetched, setFetched] = useState<StatusEntry[]>([])
  const [file, setFile] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setFile(null)
    setError('')
    setFetched([])
    if (selection?.kind !== 'commit') return
    api<{ files: StatusEntry[] }>(`/api/commit?repo=${encodeURIComponent(repo)}&hash=${selection.hash}`)
      .then(r => setFetched(r.files))
      .catch(e => setError(e.message))
  }, [repo, selection])

  const files = selection?.kind === 'wip' ? status : fetched

  if (!selection) return <div className="panel empty">Select a commit</div>
  return (
    <div className="panel">
      <div className="filelist">
        {error && <div className="error">{error}</div>}
        {files.map(f => (
          <div key={f.path} className={`file-row${file === f.path ? ' selected' : ''}`} onClick={() => setFile(f.path)}>
            <span className="file-status" style={{ color: STATUS_COLOR[f.status] ?? '#d4d8de' }}>{f.status}</span>
            <span className="file-path">{f.path}</span>
          </div>
        ))}
        {!error && files.length === 0 && <div className="empty">No changes</div>}
      </div>
      {file && <DiffView repo={repo} hash={selection.kind === 'commit' ? selection.hash : null} file={file} wipTick={wipTick} />}
    </div>
  )
}
