import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { Commit, StashEntry, StatusEntry } from '../server/parse.ts'
import { api } from './api'
import GraphView from './GraphView'
import CommitPanel from './CommitPanel'
import DiffView from './DiffView'
import ThemeSwitch from './ThemeSwitch'

export type Selection = { kind: 'commit'; hash: string } | { kind: 'wip' } | null

// Cheap change detection: hashes + ref positions cover every visible graph change
// (amend/rebase rewrite hashes; branch moves show up in refs). Status compares
// path+code pairs. Identical fingerprint → skip setState → no 500-row re-render.
const graphFp = (commits: Commit[], hasMore: boolean, stashes: StashEntry[] = []) =>
  commits.map(c => `${c.hash}\x1f${c.refs.join(',')}`).join('\n') + (hasMore ? '+' : '') + stashes.map(s => s.hash).join(',')
const statusFp = (files: StatusEntry[]) => files.map(f => f.status + f.path).join('\n')

export default function RepoView({ repo, onRemove }: { repo: string; onRemove: () => void }) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [remotes, setRemotes] = useState<string[]>([])
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [status, setStatus] = useState<StatusEntry[]>([])
  const [selection, setSelection] = useState<Selection>(null)
  const [file, setFile] = useState<string | null>(null)
  const [error, setError] = useState<{ msg: string; gone: boolean } | null>(null)
  const [wipTick, setWipTick] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const inflight = useRef(false)
  const [graphPct, setGraphPct] = useState(() => Number(localStorage.getItem('megit-split')) || 55)
  const [refsW, setRefsW] = useState(() => Number(localStorage.getItem('megit-refs-w')) || 120)
  const [graphColW, setGraphColW] = useState(() => Number(localStorage.getItem('megit-graph-col')) || 90)

  const fps = useRef({ graph: '', status: '' })
  const loaded = useRef(0)
  loaded.current = commits.length
  const gen = useRef(0)

  const q = `repo=${encodeURIComponent(repo)}`

  const refresh = useCallback((silent = false) => {
    // spin only on manual refresh — silent SSE refetches must not re-render RepoView
    if (!silent) { setError(null); inflight.current = true; setSpinning(true) }
    const g = ++gen.current
    const limit = Math.max(loaded.current, 500)
    Promise.all([
      api<{ commits: Commit[]; hasMore: boolean; remotes: string[]; stashes: StashEntry[] }>(`/api/graph?${q}&limit=${limit}`),
      api<{ files: StatusEntry[] }>(`/api/status?${q}`),
    ]).then(([gRes, s]) => {
      if (g !== gen.current) return // superseded by a newer request — latest wins
      inflight.current = false // spin stops at next iteration boundary, never mid-turn
      setError(null)
      const gf = graphFp(gRes.commits, gRes.hasMore, gRes.stashes)
      if (fps.current.graph !== gf) {
        fps.current.graph = gf
        setCommits(gRes.commits)
        setHasMore(gRes.hasMore)
        setRemotes(gRes.remotes)
        setStashes(gRes.stashes ?? [])
        // commit rewritten away (rebase/amend) → back to initial-load selection
        setSelection(sel =>
          sel?.kind === 'commit' && !gRes.commits.some(c => c.hash === sel.hash) ? null : sel)
      }
      const sf = statusFp(s.files)
      if (fps.current.status !== sf) {
        fps.current.status = sf
        setStatus(s.files)
      }
      // bump unconditionally: an unchanged status fingerprint doesn't mean the WIP
      // diff contents are unchanged (re-saving a modified file keeps status+path the
      // same) — DiffView needs a signal on every successful refresh, not just fp changes
      setWipTick(t => t + 1)
    }).catch(e => {
      if (g !== gen.current) return
      inflight.current = false
      // background refreshes fail silently — except a gone repo, which must surface
      if (!silent || e.status === 410) setError({ msg: e.message, gone: e.status === 410 })
    })
  }, [q])

  useEffect(() => { refresh() }, [refresh])

  // spin the toolbar refresh icon while an arbitrary async action (e.g. checkout) runs,
  // then refetch immediately — beats the fs.watch → SSE → 400ms-debounce round-trip
  const spinWhile = useCallback((p: Promise<unknown>) => {
    inflight.current = true
    setSpinning(true)
    p.finally(() => refresh())
  }, [refresh])

  // selection identity only changes on a real selection change (refresh returns
  // the same object when unchanged) — so this closes the diff exactly then
  useEffect(() => { setFile(null) }, [selection])

  // auto-refresh: SSE signal → refetch; hidden tab defers to one refetch on return.
  // refresh's identity only changes with q (both derive from the stable `repo` prop —
  // App remounts RepoView by key), so these deps never tear down the connection on their own.
  useEffect(() => {
    const es = new EventSource(`/api/events?${q}`)
    let dirty = false
    let firstOpen = true
    const kick = () => {
      if (document.visibilityState === 'hidden') { dirty = true; return }
      refresh(true)
    }
    es.onmessage = kick
    es.onopen = () => {
      // initial open: mount effect already fetched; reconnect: catch up on missed events
      if (firstOpen) { firstOpen = false; return }
      kick()
    }
    const onVis = () => {
      if (document.visibilityState === 'visible' && dirty) { dirty = false; refresh(true) }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { es.close(); document.removeEventListener('visibilitychange', onVis) }
  }, [q, refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && (e.target as HTMLElement).tagName !== 'INPUT') refresh()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh])

  // pointer capture keeps drag events on the splitter — no window listeners to clean up
  const onSplitDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onSplitMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const r = e.currentTarget.parentElement!.getBoundingClientRect()
    const pct = Math.min(80, Math.max(20, ((e.clientX - r.left) / r.width) * 100))
    setGraphPct(pct)
    localStorage.setItem('megit-split', String(pct))
  }
  // column splitters overlay the pane; row geometry: 8px padding + refs + 8px gap + graph + 8px gap
  const onRefsMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const r = e.currentTarget.parentElement!.getBoundingClientRect()
    const w = Math.min(400, Math.max(40, e.clientX - r.left - 12))
    setRefsW(w)
    localStorage.setItem('megit-refs-w', String(w))
  }
  const onGraphColMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const r = e.currentTarget.parentElement!.getBoundingClientRect()
    const w = Math.min(500, Math.max(24, e.clientX - r.left - refsW - 20))
    setGraphColW(w)
    localStorage.setItem('megit-graph-col', String(w))
  }

  const loadMore = useCallback(() => {
    const g = ++gen.current
    api<{ commits: Commit[]; hasMore: boolean }>(`/api/graph?${q}&skip=${loaded.current}`)
      .then(res => {
        if (g !== gen.current) return
        setCommits(prev => {
          const next = [...prev, ...res.commits]
          fps.current.graph = graphFp(next, res.hasMore)
          return next
        })
        setHasMore(res.hasMore)
      })
      .catch(e => { if (g !== gen.current) return; setError({ msg: e.message, gone: false }) })
  }, [q])

  if (error) {
    return (
      <div className="empty">
        <div>
          <div className="error">{error.msg}</div>
          {error.gone ? <button onClick={onRemove}>Remove tab</button> : <button onClick={() => refresh()}>Retry</button>}
        </div>
      </div>
    )
  }

  return (
    <div className="repoview">
      <div className="toolbar">
        <span className="repo-path">{repo}</span>
        <button className="refresh-btn" onClick={() => refresh()} title="Refresh (r)" aria-label="Refresh">
          <svg className={spinning ? 'spin' : undefined} onAnimationIteration={() => { if (!inflight.current) setSpinning(false) }} viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
        </button>
        <ThemeSwitch />
      </div>
      <div className="panes" style={{ '--graph-w': `${graphPct}%` } as CSSProperties}>
        <div className="graph-pane" style={{ '--refs-w': `${refsW}px`, '--graph-col-w': `${graphColW}px` } as CSSProperties}>
          <GraphView repo={repo} commits={commits} status={status} remotes={remotes} stashes={stashes} selection={selection} onSelect={setSelection} onLoadMore={loadMore} hasMore={hasMore} onBusy={spinWhile} />
          <div className="col-splitter" style={{ left: refsW + 9 }} onPointerDown={onSplitDown} onPointerMove={onRefsMove} />
          <div className="col-splitter" style={{ left: refsW + graphColW + 17 }} onPointerDown={onSplitDown} onPointerMove={onGraphColMove} />
          {file && selection && (
            <div className="diff-overlay">
              <div className="diff-overlay-head">
                <span className="file-path">{file}</span>
                <button className="diff-close" onClick={() => setFile(null)} title="Close diff">✕</button>
              </div>
              <DiffView repo={repo} hash={selection.kind === 'commit' ? selection.hash : null} file={file} wipTick={wipTick} />
            </div>
          )}
        </div>
        <div className="splitter" onPointerDown={onSplitDown} onPointerMove={onSplitMove} />
        <CommitPanel selection={selection} status={status} repo={repo} file={file} onFileSelect={setFile} />
      </div>
    </div>
  )
}
