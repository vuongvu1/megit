import { useEffect, useMemo, useState } from 'react'
import type { CommitMeta, StatusEntry } from '../server/parse.ts'
import { api, jsonInit } from './api'
import { useAvatar, initials } from './avatar'
import type { Selection } from './RepoView'
import { buildTree, type TreeNode } from './tree'
import { splitStatus, type DiffSide } from './wip'

const STATUS_COLOR: Record<string, string> = { M: '#e5c07b', A: '#98c379', D: '#e06c75', R: '#61afef', '?': '#98c379', U: '#e06c75' }
const COUNT_LABEL: [string, string, string][] = [['M', 'modified', '#e5c07b'], ['A', 'added', '#98c379'], ['D', 'deleted', '#e06c75'], ['R', 'renamed', '#61afef'], ['U', 'conflicted', '#e06c75']]

const fmtWhen = (unix: number) =>
  new Date(unix * 1000).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const PencilIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.4 1.9l2.7 2.7-8.5 8.5-3.3.6.6-3.3z" />
    <path d="M9.5 3.8l2.7 2.7" />
  </svg>
)

const icon = (d: string, size = 15) => () => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {d.split('|').map(p => <path key={p} d={p} />)}
  </svg>
)

const PlusIcon = icon('M8 3.5v9|M3.5 8h9')
const MinusIcon = icon('M3.5 8h9')
const TrashIcon = icon('M2.5 4h11|M6.5 4V2.5h3V4|M4 4l.7 9.5h6.6L12 4|M6.5 6.5v5|M9.5 6.5v5')
// the inbox tray the stash rows draw in the graph, redrawn to fill the viewBox —
// the graph's version is centred in a 20px node and reads small next to +/trash
const StashIcon = icon('M2.5 8.5v4h11v-4|M2.5 8.5h3l1.2 1.7h2.6l1.2-1.7h3|M4.8 6.6L8 3.4l3.2 3.2')

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

type RowAction = { Icon: () => React.ReactElement; title: string; danger?: boolean; run: (path: string, status: string) => void }

function FileRow({ path, name, dir, status, depth, selected, onClick, actions }: { path: string; name: string; dir?: string; status: string; depth: number; selected: boolean; onClick: () => void; actions?: RowAction[] }) {
  return (
    <div className={`file-row${selected ? ' selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={onClick} title={path}>
      <span className="file-status" style={{ color: STATUS_COLOR[status] ?? 'var(--fg)' }}>{status}</span>
      <span className="file-path">{dir && <span className="file-dir">{dir}</span>}{name}</span>
      {actions?.map(a => (
        <button key={a.title} className={`row-action${a.danger ? ' danger' : ''}`} title={a.title} aria-label={a.title}
          onClick={e => { e.stopPropagation(); a.run(path, status) }}>
          <a.Icon />
        </button>
      ))}
    </div>
  )
}

function Tree({ nodes, depth, collapsed, onToggle, file, onFileSelect, actions }: {
  nodes: TreeNode[]
  depth: number
  collapsed: Set<string>
  onToggle: (path: string) => void
  file: string | null
  onFileSelect: (file: string) => void
  actions?: RowAction[]
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
              <Tree nodes={n.children} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} file={file} onFileSelect={onFileSelect} actions={actions} />
            )}
          </div>
        ) : (
          <FileRow key={n.path} path={n.path} name={n.name} status={n.status!} depth={depth} selected={file === n.path} onClick={() => onFileSelect(n.path)} actions={actions} />
        ),
      )}
    </>
  )
}

// one WIP section; same rows as the commit view, plus a stage/unstage button and
// a side so a partially staged file highlights only in the half you clicked
function FileList({ files, side, actions, view, collapsed, onToggle, file, fileSide, onFileSelect, empty }: {
  files: StatusEntry[]
  side: DiffSide
  actions: RowAction[]
  view: 'path' | 'tree'
  collapsed: Set<string>
  onToggle: (path: string) => void
  file: string | null
  fileSide?: DiffSide
  onFileSelect: (file: string, side?: DiffSide) => void
  empty: string
}) {
  const tree = useMemo(() => (view === 'tree' ? buildTree(files) : []), [view, files])
  const selected = file && fileSide === side ? file : null
  const select = (path: string) => onFileSelect(path, side)
  if (!files.length) return <div className="empty">{empty}</div>
  return view === 'tree' ? (
    <Tree nodes={tree} depth={0} collapsed={collapsed} onToggle={onToggle} file={selected} onFileSelect={select} actions={actions} />
  ) : (
    <>
      {files.map(f => {
        const cut = f.path.lastIndexOf('/') + 1
        return <FileRow key={f.path} path={f.path} name={f.path.slice(cut)} dir={cut ? f.path.slice(0, cut) : undefined} status={f.status} depth={0} selected={selected === f.path} onClick={() => select(f.path)} actions={actions} />
      })}
    </>
  )
}

export default function CommitPanel({ repo, selection, status, file, fileSide, onFileSelect, canAmend, isStash, branch, onCommitted, onChanged }: {
  repo: string
  selection: Selection
  status: StatusEntry[]
  file: string | null
  fileSide?: DiffSide
  onFileSelect: (file: string, side?: DiffSide) => void
  canAmend: boolean // selection is the tip of the checked-out branch
  isStash: boolean // selection is a stash commit — its message is editable too
  branch: string | null // checked-out branch, for default stash messages
  onCommitted: (hash: string) => void
  onChanged: () => void // staged/discarded — refetch, selection stays put
}) {
  const [fetched, setFetched] = useState<StatusEntry[]>([])
  const [meta, setMeta] = useState<CommitMeta | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<'path' | 'tree'>(() => (localStorage.getItem('megit-files-view') === 'tree' ? 'tree' : 'path'))
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<string | null>(null) // null = not editing
  const [saving, setSaving] = useState(false)
  // survives refreshes: the wip selection object is identity-stable, so a background
  // refetch mid-typing can't wipe what's in the composer
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setError('')
    setFetched([])
    setMeta(null)
    setCollapsed(new Set())
    setDraft(null)
    if (selection?.kind !== 'commit') return
    api<{ files: StatusEntry[]; meta: CommitMeta }>(`/api/commit?repo=${encodeURIComponent(repo)}&hash=${selection.hash}`)
      .then(r => { setFetched(r.files); setMeta(r.meta) })
      .catch(e => setError(e.message))
  }, [repo, selection])

  const isWip = selection?.kind === 'wip'
  const files = isWip ? status : fetched
  const sides = useMemo(() => splitStatus(isWip ? status : []), [isWip, status])
  const tree = useMemo(() => (view === 'tree' ? buildTree(files) : []), [view, files])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const f of files) {
      const s = f.status === '?' ? 'A' : f.status
      c[s] = (c[s] ?? 0) + 1
    }
    return c
  }, [files])

  if (!selection) return null // parent hides the panel; kept for type narrowing

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

  const wipPost = (body: object, label: string, after: (r: { hash?: string }) => void) => {
    setBusy(true)
    setError('')
    api<{ hash?: string }>(`/api/wip?repo=${encodeURIComponent(repo)}`, jsonInit('POST', body))
      .then(after)
      .catch((err: Error) => setError(`${label} failed: ${err.message}`))
      .finally(() => setBusy(false))
  }
  const stage = (path: string) => wipPost({ action: 'stage', path }, 'Stage', onChanged)
  const unstage = (path: string) => wipPost({ action: 'unstage', path }, 'Unstage', onChanged)
  const stageAll = () => wipPost({ action: 'stage-all' }, 'Stage all', onChanged)
  const unstageAll = () => wipPost({ action: 'unstage-all' }, 'Unstage all', onChanged)
  const discardFile = (path: string, status: string) => {
    // untracked has no index copy to restore from, so discarding it is a delete —
    // the wording has to say which one is about to happen
    const what = status === '?'
      ? `Delete untracked file ${path}?`
      : `Discard changes to ${path}?\n\nThe file goes back to its staged content.`
    if (confirm(`${what}\n\nThis cannot be undone.`)) wipPost({ action: 'discard-file', path }, 'Discard', onChanged)
  }
  const discardAll = () => {
    if (!confirm(`Discard all ${files.length} uncommitted change${files.length > 1 ? 's' : ''}?\n\nStaged and unstaged edits go back to HEAD and untracked files are deleted. This cannot be undone — stash them instead to keep them.`)) return
    wipPost({ action: 'discard' }, 'Discard', onChanged)
  }
  const stashScope = (scope: 'staged' | 'unstaged') => {
    const message = prompt(`Stash ${scope} changes as`, `${scope === 'staged' ? 'Staged' : 'Unstaged'} changes on ${branch ?? 'HEAD'}`)
    if (message !== null) wipPost({ action: 'stash', scope, message }, 'Stash', onChanged)
  }
  const commit = () =>
    wipPost({ action: 'commit', message: msg.trim() }, 'Commit', r => {
      setMsg('')
      if (r.hash) onCommitted(r.hash)
    })

  const save = () => {
    if (selection.kind !== 'commit') return
    const message = (draft ?? '').trim()
    if (!message || message === (meta?.message ?? '').trim()) {
      setDraft(null)
      return
    }
    if (isStash) {
      // a stash is unreachable from any remote, so there's nothing to force past
      setSaving(true)
      setError('')
      api<{ hash: string }>(`/api/stash?repo=${encodeURIComponent(repo)}`, jsonInit('POST', { action: 'retitle', hash: selection.hash, message }))
        .then(r => { setDraft(null); onCommitted(r.hash) })
        .catch((err: Error) => setError(`Edit message failed: ${err.message}`))
        .finally(() => setSaving(false))
      return
    }
    const post = (force: boolean) =>
      api<{ hash: string }>(`/api/commit?repo=${encodeURIComponent(repo)}`, jsonInit('POST', { action: 'amend', hash: selection.hash, message, force }))
    setSaving(true)
    setError('')
    post(false)
      .catch((err: Error) => {
        // amending a pushed commit is a second, explicit decision
        if (!/already pushed/.test(err.message)) throw err
        return confirm(`This commit is ${err.message}.\n\nEditing it rewrites its sha, so the remote would need a force push — which megit won't do for you.\n\nEdit anyway?`)
          ? post(true)
          : null
      })
      .then(r => { if (r) { setDraft(null); onCommitted(r.hash) } })
      .catch((err: Error) => setError(`Edit message failed: ${err.message}`))
      .finally(() => setSaving(false))
  }

  return (
    <div className="panel">
      {error && <div className="error">{error}</div>}
      {selection.kind === 'commit' && meta && (
        <>
          <div className="commit-msg">
            {draft === null ? (
              <>
                <div className="commit-subject">
                  {subject}
                  {(canAmend || isStash) && (
                    <button className="msg-edit" title={isStash ? 'Edit stash message' : 'Edit message (amends this commit)'} aria-label="Edit message" onClick={() => setDraft(meta.message)}>
                      <PencilIcon />
                    </button>
                  )}
                </div>
                {bodyText && <div className="commit-body">{bodyText}</div>}
              </>
            ) : (
              <>
                <textarea
                  className="msg-box"
                  value={draft}
                  autoFocus
                  disabled={saving}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setDraft(null)
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
                  }}
                />
                <div className="msg-actions">
                  <span className="msg-hint">⌘↵ save · esc cancel</span>
                  <button onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
                  <button className="primary" onClick={save} disabled={saving || !draft.trim()}>Save</button>
                </div>
              </>
            )}
          </div>
          <div className="commit-people">
            <Person repo={repo} name={meta.author} email={meta.authorEmail} verb="authored" date={meta.authorDate} />
            {coAuthored && <Person repo={repo} name={meta.committer} email={meta.committerEmail} verb="committed" date={meta.commitDate} />}
            <span className="commit-hash" title={selection.hash} onClick={() => navigator.clipboard.writeText(selection.hash)}>{selection.hash.slice(0, 7)}</span>
          </div>
        </>
      )}
      {/* the composer sits where a commit's message sits — top of the panel, above
          the file list, so both selections read the same way */}
      {isWip && (
        <div className="composer">
          <textarea
            className="msg-box"
            placeholder="Commit message"
            value={msg}
            disabled={busy}
            onChange={e => setMsg(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && sides.staged.length && msg.trim()) commit()
            }}
          />
          <div className="msg-actions">
            <span className="msg-hint">{sides.staged.length ? '⌘↵ to commit' : 'stage something to commit'}</span>
            <button className="primary" onClick={commit} disabled={busy || !msg.trim() || !sides.staged.length}>
              Commit{sides.staged.length ? ` ${sides.staged.length}` : ''}
            </button>
          </div>
        </div>
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
      {isWip ? (
        // unstaged on top, staged below: the order work moves through
        <div className="filelist">
            <div className="section-head">
              Changes <b>{sides.unstaged.length}</b>
              {/* stage/unstage last: it's the one you reach for repeatedly, so it sits
                  in the same spot as the per-row +/− directly below */}
              {sides.unstaged.length > 0 && (
                <span className="head-actions">
                  <button title="Stash unstaged changes" aria-label="Stash unstaged changes" onClick={() => stashScope('unstaged')} disabled={busy}><StashIcon /></button>
                  <button className="danger" title="Discard all changes" aria-label="Discard all changes" onClick={discardAll} disabled={busy}><TrashIcon /></button>
                  <button title="Stage all changes" aria-label="Stage all changes" onClick={stageAll} disabled={busy}><PlusIcon /></button>
                </span>
              )}
            </div>
            <FileList files={sides.unstaged} side="worktree"
              actions={[
                { Icon: TrashIcon, title: 'Discard changes', danger: true, run: discardFile },
                { Icon: PlusIcon, title: 'Stage', run: stage },
              ]}
              view={view} collapsed={collapsed} onToggle={onToggle} file={file} fileSide={fileSide} onFileSelect={onFileSelect} empty="Nothing to stage" />
            <div className="section-head">
              Staged Changes <b>{sides.staged.length}</b>
              {sides.staged.length > 0 && (
                <span className="head-actions">
                  <button title="Stash staged changes" aria-label="Stash staged changes" onClick={() => stashScope('staged')} disabled={busy}><StashIcon /></button>
                  <button title="Unstage all changes" aria-label="Unstage all changes" onClick={unstageAll} disabled={busy}><MinusIcon /></button>
                </span>
              )}
            </div>
            <FileList files={sides.staged} side="staged" actions={[{ Icon: MinusIcon, title: 'Unstage', run: unstage }]}
              view={view} collapsed={collapsed} onToggle={onToggle} file={file} fileSide={fileSide} onFileSelect={onFileSelect} empty="Nothing staged" />
        </div>
      ) : (
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
      )}
    </div>
  )
}
