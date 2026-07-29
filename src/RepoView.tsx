import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { BranchHeader, Commit, StashEntry, StatusEntry } from '../server/parse.ts'
import { api } from './api'
import GraphView from './GraphView'
import type { DiffSide } from './wip'
import CommitPanel from './CommitPanel'
import ThemeSwitch from './ThemeSwitch'
import ActionBar from './ActionBar'
import SearchBar from './SearchBar'
import { label, matchLocal, stepMatch } from './search'
import { toastErr } from './Toast'

// diff2html + highlight.js (~1 MB, 82% of the old main bundle) stay out until a
// file is actually clicked; xterm.js + panel likewise until the terminal opens
const DiffView = lazy(() => import('./DiffView'))
const TerminalPanel = lazy(() => import('./TerminalPanel'))

export type Selection = { kind: 'commit'; hash: string } | { kind: 'wip' } | null

// survives RepoView remounts so the terminal stays open across tab switches
const termOpenByRepo = new Map<string, boolean>()

// Cheap change detection: hashes + ref positions cover every visible graph change
// (amend/rebase rewrite hashes; branch moves show up in refs). Status compares
// path+code pairs. Identical fingerprint → skip setState → no full-list re-render.
const graphFp = (commits: Commit[], hasMore: boolean, stashes: StashEntry[] = []) =>
  commits.map(c => `${c.hash}\x1f${c.refs.join(',')}`).join('\n') + (hasMore ? '+' : '') + stashes.map(s => s.hash).join(',')

// One page, the server's own default and the client's paging step.
const PAGE = 200
// Probe fingerprint for a silent refresh: the first page plus the stash list, which
// arrives whole at any limit. No hasMore — a one-page probe always reports more
// while 150 rows are loaded, and that difference isn't a change in the repo.
const headFp = (commits: Commit[], stashes: StashEntry[] = []) =>
  commits.slice(0, PAGE).map(c => `${c.hash}\x1f${c.refs.join(',')}`).join('\n') + stashes.map(s => s.hash).join(',')
// x/y, not the collapsed status: staging a modified file moves it from ".M" to "M."
// while `status` stays "M", so hashing only that made staging invisible to the panel
// the branch header goes in too: a push changes nothing about the files, but leaves
// the toolbar's ahead/behind badges stale if it doesn't reach setState
const statusFp = (files: StatusEntry[], b: BranchHeader) =>
  `${b.head}\x1f${b.upstream}\x1f${b.ahead}\x1f${b.behind}\n`
  + files.map(f => `${f.x ?? ''}${f.y ?? ''}${f.status}${f.path}`).join('\n')

const NO_BRANCH: BranchHeader = { head: null, upstream: null, ahead: 0, behind: 0 }

export default function RepoView({ repo, onRemove, hasTerminal }: { repo: string; onRemove: () => void; hasTerminal: boolean }) {
  const [commits, setCommits] = useState<Commit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [remotes, setRemotes] = useState<string[]>([])
  const [githubUrl, setGithubUrl] = useState<string | null>(null)
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [status, setStatus] = useState<StatusEntry[]>([])
  const [branch, setBranch] = useState<BranchHeader>(NO_BRANCH)
  const [selection, setSelection] = useState<Selection>(null)
  // side is set only from the WIP panel's two sections — it picks which diff to show
  const [file, setFile] = useState<{ path: string; side?: DiffSide } | null>(null)
  const [error, setError] = useState<{ msg: string; gone: boolean } | null>(null)
  const [wipTick, setWipTick] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [busy, setBusy] = useState(false)
  const inflight = useRef(false)
  const [termOpen, setTermOpen] = useState(() => termOpenByRepo.get(repo) ?? false)
  const toggleTerm = useCallback(() => {
    if (!hasTerminal) return
    setTermOpen(o => { termOpenByRepo.set(repo, !o); return !o })
  }, [repo, hasTerminal])
  const [graphPct, setGraphPct] = useState(() => Number(localStorage.getItem('megit-split')) || 55)
  const [refsW, setRefsW] = useState(() => Number(localStorage.getItem('megit-refs-w')) || 120)
  const [graphColW, setGraphColW] = useState(() => Number(localStorage.getItem('megit-graph-col')) || 90)
  // 0 = closed; every ⌘F bumps it, which re-focuses and selects the input. One number
  // instead of an `open` boolean plus a separate focus nonce.
  const [searchSeq, setSearchSeq] = useState(0)
  const [query, setQuery] = useState('')
  const [cur, setCur] = useState(-1)
  // null = local scope. Set by the deep button only, cleared by the next keystroke.
  const [deep, setDeep] = useState<{ matches: string[]; truncated: boolean } | null>(null)
  // declared up here, not beside the other search callbacks: the keydown effect below
  // closes on it, and that effect is defined before them
  const closeSearch = useCallback(() => {
    setSearchSeq(0)
    setQuery('')
    setDeep(null)
    setCur(-1)
  }, [])

  const fps = useRef({ graph: '', status: '', head: '' })
  const loaded = useRef(0)
  loaded.current = commits.length
  const gen = useRef(0)

  const q = `repo=${encodeURIComponent(repo)}`

  // `full` refetches every row currently loaded; a silent refresh instead probes the
  // first page and only pays for the rest once that page has actually moved. An fs
  // event fires every 400 ms–2 s, and the full refetch was 277 KB / 209 ms at 1000
  // rows loaded — a cost that grew with every "Load more". A rewrite that lands
  // entirely below page 1 (deep rebase) needs a manual `r`.
  // named function expression, not an arrow: a probe that finds page 1 moved calls
  // straight back into `run` for the full refetch
  const refresh = useCallback(function run(silent = false, full = !silent) {
    // spin only on manual refresh — silent SSE refetches must not re-render RepoView
    if (!silent) { setError(null); inflight.current = true; setSpinning(true) }
    const g = ++gen.current
    const probe = !full && loaded.current > PAGE
    const limit = probe ? PAGE : Math.max(loaded.current, PAGE)
    return Promise.all([
      api<{ commits: Commit[]; hasMore: boolean; remotes: string[]; stashes: StashEntry[]; githubUrl: string | null }>(`/api/graph?${q}&limit=${limit}`),
      api<{ files: StatusEntry[]; branch: BranchHeader }>(`/api/status?${q}`),
    ]).then(([gRes, s]) => {
      if (g !== gen.current) return // superseded by a newer request — latest wins
      inflight.current = false // spin stops at next iteration boundary, never mid-turn
      setError(null)
      if (probe) {
        // page 1 hasn't moved: nothing loaded below it can have changed either, so
        // the rows stay as they are. Moved → refetch the whole loaded range now.
        if (headFp(gRes.commits, gRes.stashes) !== fps.current.head) run(true, true)
      } else {
        fps.current.head = headFp(gRes.commits, gRes.stashes)
        const gf = graphFp(gRes.commits, gRes.hasMore, gRes.stashes)
        if (fps.current.graph !== gf) {
          fps.current.graph = gf
          setCommits(gRes.commits)
          setHasMore(gRes.hasMore)
          setRemotes(gRes.remotes)
          setStashes(gRes.stashes ?? [])
          setGithubUrl(gRes.githubUrl ?? null)
          // commit rewritten away (rebase/amend) → back to initial-load selection.
          // stashes count as selectable rows, so a selected stash isn't "gone".
          setSelection(sel =>
            sel?.kind === 'commit'
              && !gRes.commits.some(c => c.hash === sel.hash)
              && !(gRes.stashes ?? []).some(s => s.hash === sel.hash) ? null : sel)
        }
      }
      const sb = s.branch ?? NO_BRANCH
      const sf = statusFp(s.files, sb)
      if (fps.current.status !== sf) {
        fps.current.status = sf
        setStatus(s.files)
        setBranch(sb)
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
  // ...and blur the graph for the same window: the rows on screen are stale from the
  // moment the mutation starts until the refetch lands, so they're not clickable either
  const spinWhile = useCallback((p: Promise<unknown>) => {
    inflight.current = true
    setSpinning(true)
    setBusy(true)
    // finally waits on a thenable the callback returns, so this clears once refresh settles
    p.finally(() => refresh()).finally(() => setBusy(false))
  }, [refresh])

  // selection identity only changes on a real selection change (refresh returns
  // the same object when unchanged) — so this closes the diff exactly then
  useEffect(() => { setFile(null) }, [selection])

  // "HEAD -> name" only: a detached HEAD shows as plain "HEAD" and has no tip to amend
  const headCommit = commits.find(c => c.refs.some(r => r.startsWith('HEAD -> ')))

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
      // TEXTAREA as well as INPUT: the commit-message editor is a textarea, and
      // typing "r" in it must not trigger a refresh
      const tag = (e.target as HTMLElement).tagName
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && tag !== 'INPUT' && tag !== 'TEXTAREA') refresh()
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyJ') {
        e.preventDefault() // keep Chrome's downloads panel closed
        toggleTerm()
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyF') {
        e.preventDefault() // and keep the browser's own find bar shut
        setSearchSeq(s => s + 1)
      }
      // on the window, not the input: Esc has to close the bar even after focus moved
      // to a row or the commit panel
      if (e.key === 'Escape' && searchSeq > 0) closeSearch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh, toggleTerm, searchSeq, closeSearch])

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
          // stashes must go in: refresh computes the fp with them, and a mismatch
          // here means every later SSE tick re-renders the whole list for nothing
          fps.current.graph = graphFp(next, res.hasMore, stashes)
          return next
        })
        setHasMore(res.hasMore)
      })
      .catch(e => { if (g !== gen.current) return; setError({ msg: e.message, gone: false }) })
  }, [q, stashes])

  // The default search scope. Derived, not stored: an SSE refresh replaces `commits` and
  // this recomputes, so the count can't drift and a rebased-away hash can't go stale.
  const localMatches = useMemo(() => matchLocal(commits, query), [commits, query])
  const matches = deep?.matches ?? localMatches

  // Selecting the match is the whole highlight: GraphView already styles .row.selected
  // and scrolls it into view, so there is nothing to add there. `list` is a parameter
  // rather than a read of `matches` because runDeep has to jump into a result set that
  // hasn't reached state yet.
  const jumpTo = useCallback((list: string[], i: number) => {
    const hash = list[i]
    setCur(hash ? i : -1)
    if (!hash) return
    if (commits.some(c => c.hash === hash)) {
      setSelection({ kind: 'commit', hash })
      return
    }
    // Below the loaded window. lanes.ts lays out top-down, so row N needs rows 0..N-1 —
    // the only way down is to load more. Doubling gets there in a handful of growing
    // requests instead of dozens of sequential `loadMore` pages.
    const g = ++gen.current
    void (async () => {
      let limit = Math.max(loaded.current, PAGE)
      while (limit < 5000) {
        limit = Math.min(5000, limit * 2)
        const res = await api<{ commits: Commit[]; hasMore: boolean }>(`/api/graph?${q}&limit=${limit}`)
        if (g !== gen.current) return // superseded — a newer jump or refresh owns the list
        setCommits(res.commits)
        setHasMore(res.hasMore)
        // both fingerprints, or the next silent refresh re-renders the whole list for nothing
        fps.current.graph = graphFp(res.commits, res.hasMore, stashes)
        fps.current.head = headFp(res.commits, stashes)
        if (res.commits.some(c => c.hash === hash)) {
          setSelection({ kind: 'commit', hash })
          return
        }
      }
      // 5000 is the server's cap, and far past where the DOM gives out
      toastErr('Match is too deep in history to display')
    })().catch(e => toastErr(e.message))
  }, [commits, q, stashes])

  const onQuery = useCallback((v: string) => {
    setQuery(v)
    setDeep(null) // a new query is a local query again
    // matchLocal runs twice per keystroke (here and in the memo) — it's a lowercase +
    // includes over the loaded rows, and this way the jump needs no effect to chase state
    jumpTo(matchLocal(commits, v), 0)
  }, [commits, jumpTo])

  // One shot, not a mode: the only thing in this feature that spends a git process, and
  // it spends it because the user asked.
  const runDeep = useCallback(() => {
    if (!query.trim()) return
    api<{ matches: string[]; truncated: boolean }>(`/api/search?${q}&q=${encodeURIComponent(query)}`)
      .then(r => { setDeep(r); jumpTo(r.matches, 0) })
      .catch(e => toastErr(e.message))
  }, [q, query, jumpTo])

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
      {/* three zones: repo identity left, repo actions centred, app controls right */}
      <div className="toolbar">
        <div className="tb-left">
          <span className="repo-path">{repo}</span>
          {githubUrl && (
            <a className="github-link" href={githubUrl} target="_blank" rel="noreferrer" title="Open on GitHub" aria-label="Open on GitHub">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
              </svg>
            </a>
          )}
          <button className="refresh-btn" onClick={() => refresh()} title="Refresh (r)" aria-label="Refresh">
            <svg className={spinning ? 'spin' : undefined} onAnimationIteration={() => { if (!inflight.current) setSpinning(false) }} viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
        </div>
        <ActionBar repo={repo} commits={commits} branch={branch} remotes={remotes} stashes={stashes} dirty={status.length > 0} onBusy={spinWhile} />
        <div className="tb-right">
          {hasTerminal && (
            <button
              className={`term-btn${termOpen ? ' active' : ''}`}
              onClick={toggleTerm}
              title="Toggle terminal (⌘J)"
              aria-label="Toggle terminal"
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 17l6-5-6-5" />
                <path d="M12 19h8" />
              </svg>
            </button>
          )}
          <ThemeSwitch />
        </div>
      </div>
      <div className="panes" style={{ '--graph-w': selection ? `${graphPct}%` : '100%' } as CSSProperties}>
        <div className={busy ? 'graph-pane busy' : 'graph-pane'} style={{ '--refs-w': `${refsW}px`, '--graph-col-w': `${graphColW}px` } as CSSProperties}>
          <GraphView repo={repo} commits={commits} status={status} remotes={remotes} stashes={stashes} githubUrl={githubUrl} selection={selection} onSelect={setSelection} onLoadMore={loadMore} hasMore={hasMore} onBusy={spinWhile} />
          {searchSeq > 0 && (
            <SearchBar
              seq={searchSeq}
              value={query}
              count={label(cur, matches.length, { truncated: deep?.truncated, deep: !!deep })}
              deep={!!deep}
              onChange={onQuery}
              onDeep={runDeep}
              onPrev={() => jumpTo(matches, stepMatch(matches.length, cur, -1))}
              onNext={() => jumpTo(matches, stepMatch(matches.length, cur, 1))}
              onClose={closeSearch}
            />
          )}
          <div className="col-splitter" style={{ left: refsW + 9 }} onPointerDown={onSplitDown} onPointerMove={onRefsMove} />
          <div className="col-splitter" style={{ left: refsW + graphColW + 17 }} onPointerDown={onSplitDown} onPointerMove={onGraphColMove} />
          {file && selection && (
            <div className="diff-overlay">
              <div className="diff-overlay-head">
                <span className="file-path">{file.path}</span>
                {file.side && <span className="diff-side">{file.side === 'staged' ? 'staged' : 'unstaged'}</span>}
                <button className="diff-close" onClick={() => setFile(null)} title="Close diff">✕</button>
              </div>
              <Suspense fallback={<div className="diffview empty">Loading…</div>}>
                <DiffView repo={repo} hash={selection.kind === 'commit' ? selection.hash : null} file={file.path} side={file.side} wipTick={wipTick} />
              </Suspense>
            </div>
          )}
        </div>
        {selection && (
          <>
            <div className="splitter" onPointerDown={onSplitDown} onPointerMove={onSplitMove} />
            <CommitPanel
              selection={selection}
              status={status}
              repo={repo}
              file={file?.path ?? null}
              fileSide={file?.side}
              onFileSelect={(path, side) => setFile({ path, side })}
              canAmend={selection?.kind === 'commit' && selection.hash === headCommit?.hash}
              isStash={selection?.kind === 'commit' && stashes.some(s => s.hash === selection.hash)}
              branch={headCommit?.refs.find(r => r.startsWith('HEAD -> '))?.slice(8) ?? null}
              // amend rewrites the sha and commit makes a new one: either way follow the
              // selection there, or the refresh drops it as a commit that no longer exists
              onCommitted={hash => { setSelection({ kind: 'commit', hash }); refresh() }}
              onChanged={refresh}
            />
          </>
        )}
      </div>
      {termOpen && <Suspense fallback={<div className="term-panel" />}><TerminalPanel repo={repo} onClose={toggleTerm} /></Suspense>}
    </div>
  )
}
