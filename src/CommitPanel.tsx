import { useEffect, useMemo, useState } from 'react'
import type { CommitMeta, StatusEntry } from '../server/parse.ts'
import { api } from './api'
import { useAvatar, initials } from './avatar'
import type { Selection } from './RepoView'
import { buildTree, type TreeNode } from './tree'

const STATUS_COLOR: Record<string, string> = { M: '#e5c07b', A: '#98c379', D: '#e06c75', R: '#61afef', '?': '#98c379', U: '#e06c75' }
const COUNT_LABEL: [string, string, string][] = [['M', 'modified', '#e5c07b'], ['A', 'added', '#98c379'], ['D', 'deleted', '#e06c75'], ['R', 'renamed', '#61afef'], ['U', 'conflicted', '#e06c75']]

const fmtWhen = (unix: number) =>
  new Date(unix * 1000).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function Face({ repo, name, email }: { repo: string; name: string; email: string }) {
  const url = useAvatar(repo, email)
  return url
    ? <img className="face" src={url} alt="" />
    : <span className="face face-fallback">{initials(name)}</span>
}

function Person({ repo, name, email, verb, date }: { repo: string; name: string; email: string; verb: string; date: number }) {
  return (
    <div className="person">
      <Face repo={repo} name={name} email={email} />
      <div className="person-text">
        <span className="person-name">{name}</span>
        <span className="person-when">{verb} {fmtWhen(date)}</span>
      </div>
    </div>
  )
}

function FileRow({ path, name, dir, status, depth, selected, onClick }: { path: string; name: string; dir?: string; status: string; depth: number; selected: boolean; onClick: () => void }) {
  return (
    <div className={`file-row${selected ? ' selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={onClick} title={path}>
      <span className="file-status" style={{ color: STATUS_COLOR[status] ?? 'var(--fg)' }}>{status}</span>
      <span className="file-path">{dir && <span className="file-dir">{dir}</span>}{name}</span>
    </div>
  )
}

function Tree({ nodes, depth, collapsed, onToggle, file, onFileSelect }: {
  nodes: TreeNode[]
  depth: number
  collapsed: Set<string>
  onToggle: (path: string) => void
  file: string | null
  onFileSelect: (file: string) => void
}) {
  return (
    <>
      {nodes.map(n =>
        n.children ? (
          <div key={n.path}>
            <div className="file-row dir-row" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onToggle(n.path)}>
              <span className="dir-arrow">{collapsed.has(n.path) ? '▸' : '▾'}</span>
              <span className="file-dir">{n.name}</span>
            </div>
            {!collapsed.has(n.path) && (
              <Tree nodes={n.children} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} file={file} onFileSelect={onFileSelect} />
            )}
          </div>
        ) : (
          <FileRow key={n.path} path={n.path} name={n.name} status={n.status!} depth={depth} selected={file === n.path} onClick={() => onFileSelect(n.path)} />
        ),
      )}
    </>
  )
}

export default function CommitPanel({ repo, selection, status, file, onFileSelect }: { repo: string; selection: Selection; status: StatusEntry[]; file: string | null; onFileSelect: (file: string) => void }) {
  const [fetched, setFetched] = useState<StatusEntry[]>([])
  const [meta, setMeta] = useState<CommitMeta | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<'path' | 'tree'>(() => (localStorage.getItem('megit-files-view') === 'tree' ? 'tree' : 'path'))
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    setError('')
    setFetched([])
    setMeta(null)
    setCollapsed(new Set())
    if (selection?.kind !== 'commit') return
    api<{ files: StatusEntry[]; meta: CommitMeta }>(`/api/commit?repo=${encodeURIComponent(repo)}&hash=${selection.hash}`)
      .then(r => { setFetched(r.files); setMeta(r.meta) })
      .catch(e => setError(e.message))
  }, [repo, selection])

  const files = selection?.kind === 'wip' ? status : fetched
  const tree = useMemo(() => (view === 'tree' ? buildTree(files) : []), [view, files])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const f of files) {
      const s = f.status === '?' ? 'A' : f.status
      c[s] = (c[s] ?? 0) + 1
    }
    return c
  }, [files])

  if (!selection) return <div className="panel empty">Select a commit</div>

  const setViewPersist = (v: 'path' | 'tree') => {
    setView(v)
    localStorage.setItem('megit-files-view', v)
  }
  const onToggle = (path: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const [subject, ...body] = (meta?.message ?? '').split('\n')
  const bodyText = body.join('\n').trim()
  const coAuthored = meta && (meta.committer !== meta.author || meta.committerEmail !== meta.authorEmail)

  return (
    <div className="panel">
      {error && <div className="error">{error}</div>}
      {selection.kind === 'commit' && meta && (
        <>
          <div className="commit-msg">
            <div className="commit-subject">{subject}</div>
            {bodyText && <div className="commit-body">{bodyText}</div>}
          </div>
          <div className="commit-people">
            <Person repo={repo} name={meta.author} email={meta.authorEmail} verb="authored" date={meta.authorDate} />
            {coAuthored && <Person repo={repo} name={meta.committer} email={meta.committerEmail} verb="committed" date={meta.commitDate} />}
            <span className="commit-hash" title={selection.hash} onClick={() => navigator.clipboard.writeText(selection.hash)}>{selection.hash.slice(0, 7)}</span>
          </div>
        </>
      )}
      <div className="files-head">
        <span className="files-counts">
          {COUNT_LABEL.filter(([s]) => counts[s]).map(([s, label, color]) => (
            <span key={s} className="files-count"><b style={{ color }}>{counts[s]}</b> {label}</span>
          ))}
        </span>
        <span className="view-toggle">
          <button className={view === 'path' ? 'active' : ''} onClick={() => setViewPersist('path')}>Path</button>
          <button className={view === 'tree' ? 'active' : ''} onClick={() => setViewPersist('tree')}>Tree</button>
        </span>
      </div>
      <div className="filelist">
        {view === 'tree' ? (
          <Tree nodes={tree} depth={0} collapsed={collapsed} onToggle={onToggle} file={file} onFileSelect={onFileSelect} />
        ) : (
          files.map(f => {
            const cut = f.path.lastIndexOf('/') + 1
            return <FileRow key={f.path} path={f.path} name={f.path.slice(cut)} dir={cut ? f.path.slice(0, cut) : undefined} status={f.status} depth={0} selected={file === f.path} onClick={() => onFileSelect(f.path)} />
          })
        )}
        {!error && files.length === 0 && <div className="empty">No changes</div>}
      </div>
    </div>
  )
}
