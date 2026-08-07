import { useEffect, useMemo, useRef, useState } from 'react'
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui.js'
import { ColorSchemeType } from 'diff2html/lib/types'
import 'diff2html/bundles/css/diff2html.min.css'
import { api } from './api'
import { useTheme } from './theme'
import { build, emit, gaps, parse, reveal, STEP, totalLines, type Dir, type Gap, type Model } from './diffExpand'
import { diffMode, needsPatch } from './diffMode'

type DiffResp = { diff?: string; tooLarge?: boolean; size?: number }

const ARROW: Record<Dir, string> = {
  up: 'M3 9.5 7 5.5 11 9.5',
  down: 'M3 5.5 7 9.5 11 5.5',
  all: 'M3 6 7 2.5 11 6M3 9 7 12.5 11 9',
}
const LABEL: Record<Dir, string> = { up: `Expand up ${STEP} lines`, down: `Expand down ${STEP} lines`, all: 'Expand all' }

// which arrows a gap gets: one shorter than a step collapses to a single
// expand-all, and the file's first/last gap only expands one way
function dirs(gap: Gap): Dir[] {
  if (gap.to - gap.from + 1 <= STEP) return ['all']
  if (gap.hunk === -1) return ['down']
  if (gap.from === 1) return ['up']
  return ['up', 'down']
}

// diff2html renders one info row per hunk and nothing at all for the trailing
// gap, so the expanders are grafted onto its output rather than templated in.
// They go in the line-number gutter, which is position:absolute — no row grows,
// so the two side-by-side tables stay aligned.
function decorate(root: HTMLElement, gapList: Gap[], split: boolean, onExpand: (g: Gap, d: Dir) => void) {
  const lineClass = split ? 'd2h-code-side-linenumber' : 'd2h-code-linenumber'
  const contentClass = split ? 'd2h-code-side-line' : 'd2h-code-line'
  for (const tbody of Array.from(root.querySelectorAll('tbody.d2h-diff-tbody'))) {
    const heads = Array.from(tbody.querySelectorAll('tr > td.d2h-info:first-child'))
    for (const gap of gapList) {
      let cell = gap.hunk >= 0 ? heads[gap.hunk] : undefined
      if (!cell) {
        const tr = document.createElement('tr')
        tr.innerHTML = `<td class="${lineClass} d2h-info"></td><td class="d2h-info"><div class="${contentClass}"></div></td>`
        tbody.append(tr)
        cell = tr.firstElementChild!
      }
      const group = document.createElement('div')
      group.className = 'diff-expand-group'
      for (const dir of dirs(gap)) {
        const b = document.createElement('button')
        b.className = 'diff-expand'
        b.type = 'button'
        b.title = LABEL[dir]
        b.setAttribute('aria-label', LABEL[dir])
        b.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${ARROW[dir]}"/></svg>`
        b.onclick = () => onExpand(gap, dir)
        group.append(b)
      }
      cell.append(group)
    }
  }
}

// One side of an image diff. The blob endpoint 404s when the file didn't exist
// on that side (added/deleted), which <img> reports as a load error.
function ImagePane({ src, label }: { src: string; label: string }) {
  const [missing, setMissing] = useState(false)
  const [dims, setDims] = useState('')
  useEffect(() => { setMissing(false); setDims('') }, [src])
  return (
    <div className={`image-pane${missing ? ' missing' : ''}`}>
      <div className="image-pane-label">{label}{dims && <span> · {dims}</span>}</div>
      {missing
        ? <div className="image-pane-none">absent</div>
        : <img src={src} onError={() => setMissing(true)} onLoad={e => setDims(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)} />}
    </div>
  )
}

export default function DiffView({ repo, hash, file, side, wipTick }: { repo: string; hash: string | null; file: string; side?: 'staged' | 'worktree'; wipTick: number }) {
  const [resp, setResp] = useState<DiffResp | null>(null)
  const [error, setError] = useState('')
  const [split, setSplit] = useState(() => localStorage.getItem('megit-diff-split') === '1')
  const [rich, setRich] = useState(() => localStorage.getItem('megit-diff-rich') !== '0')
  // set once a gap is expanded: the full-context diff plus which lines are shown
  const [model, setModel] = useState<Model | null>(null)
  const theme = useTheme()
  const ref = useRef<HTMLDivElement>(null)

  const mode = diffMode(file, rich)
  const pickRich = (v: boolean) => {
    setRich(v)
    localStorage.setItem('megit-diff-rich', v ? '1' : '0')
  }

  const load = (force = false, silent = false) => {
    if (!needsPatch(file)) return
    setModel(null)
    lastDir.current = null
    if (!silent) {
      setError('')
      setResp(null)
    }
    const params = new URLSearchParams({ repo, file, ...(hash ? { hash } : {}), ...(side ? { side } : {}), ...(force ? { force: '1' } : {}) })
    api<DiffResp>(`/api/diff?${params}`)
      .then(r => { setError(''); setResp(r) })
      .catch(e => { if (!silent) setError(e.message) })
  }
  // seenTick: a wipTick that was already current when this file was opened
  // must not trigger a reload; only later increments do. Commit diffs (hash
  // set) never reload — same hash, same content.
  const seenTick = useRef(wipTick)
  useEffect(() => { seenTick.current = wipTick; load() }, [repo, hash, file, side])
  useEffect(() => {
    if (wipTick === seenTick.current) return
    seenTick.current = wipTick
    if (!hash) load(false, true)
  }, [wipTick])

  const plain = !resp?.diff?.trim() || /^Binary files/m.test(resp?.diff ?? '')

  const text = useMemo(() => (model ? emit(model) : resp?.diff), [model, resp])
  const gapList = useMemo(
    () => (text && !plain && mode.body === 'text' ? gaps(parse(text), model ? totalLines(model) : Infinity) : []),
    [text, plain, model, mode.body],
  )

  // a ref so decorate()'s click handlers see the current model without redrawing
  const expandRef = useRef((_g: Gap, _d: Dir) => {})
  const lastDir = useRef<Dir | null>(null)
  expandRef.current = async (gap, dir) => {
    lastDir.current = dir
    let m = model
    if (!m) {
      const params = new URLSearchParams({ repo, file, context: '1000000', ...(hash ? { hash } : {}), ...(side ? { side } : {}) })
      const r = await api<DiffResp>(`/api/diff?${params}`).catch(() => null)
      // ponytail: over DIFF_CAP the full diff comes back tooLarge and the arrows
      // no-op; add a force fetch if anyone hits that on a file worth expanding
      if (!r?.diff || !resp?.diff) return
      m = build(r.diff, resp.diff)
      if (!m) return
    }
    setModel(reveal(m, gap, dir))
  }

  useEffect(() => {
    // the expansion hint is consumed on every run, including the early return
    // below: a hint set by a click whose full-context fetch is still in flight
    // would otherwise survive a mode flip and offset a freshly remounted,
    // empty pane to its bottom
    const dir = lastDir.current
    lastDir.current = null
    const el = ref.current
    if (!el || !text || plain) return
    const top = el.scrollTop
    const before = el.scrollHeight
    const ui = new Diff2HtmlUI(el, text, {
      drawFileList: false,
      matching: 'lines',
      highlight: true,
      outputFormat: split ? 'side-by-side' : 'line-by-line',
      colorScheme: theme === 'dark' ? ColorSchemeType.DARK : ColorSchemeType.LIGHT,
    })
    ui.draw()
    ui.highlightCode()
    decorate(el, gapList, split, (g, d) => expandRef.current(g, d))
    // expanding upward inserts lines above the clicked gap; offsetting by the
    // height added keeps that gap where the user clicked it
    el.scrollTop = dir && dir !== 'down' ? top + (el.scrollHeight - before) : top
    // rich: switching to source mounts a fresh .diff-html, and the `!el` guard
    // above means an effect that doesn't re-fire would leave it blank
  }, [text, gapList, split, plain, theme, rich])

  const toolbar = (mode.richToggle || mode.splitToggle) && (
    <div className="diff-toolbar">
      {mode.richToggle && (
        <div className="view-toggle">
          <button className={rich ? 'active' : ''} aria-pressed={rich} onClick={() => pickRich(true)}>Rendered</button>
          <button className={rich ? '' : 'active'} aria-pressed={!rich} onClick={() => pickRich(false)}>Source</button>
        </div>
      )}
      {mode.splitToggle && (
        <div className="view-toggle">
          <button className={split ? '' : 'active'} aria-pressed={!split} onClick={() => { setSplit(false); localStorage.setItem('megit-diff-split', '0') }}>Unified</button>
          <button className={split ? 'active' : ''} aria-pressed={split} onClick={() => { setSplit(true); localStorage.setItem('megit-diff-split', '1') }}>Split</button>
        </div>
      )}
    </div>
  )

  // every branch below sits in the same keyless child slot, so without a key
  // React would match them by index/type and reuse one host DOM node across
  // branches. diff2html writes into that node imperatively (innerHTML), which
  // React doesn't own and won't clear, so a stale diff table would linger
  // under the image panes or the too-large card. Distinct keys force a remount
  // instead of a reuse.
  const body = () => {
    if (mode.body === 'image') {
      const q = (which: 'old' | 'new') => {
        const p = new URLSearchParams({ repo, file, which, ...(hash ? { hash } : { t: String(wipTick) }), ...(side ? { side } : {}) })
        return `/api/blob?${p}`
      }
      return (
        <div key="image" className="image-diff">
          <ImagePane src={q('old')} label="Before" />
          <ImagePane src={q('new')} label="After" />
        </div>
      )
    }
    if (error) return <div key="state" className="diff-state error">{error}</div>
    if (!resp) return <div key="state" className="diff-state">Loading…</div>
    if (resp.tooLarge) {
      return (
        <div key="state" className="diff-state">
          <div>
            <div>Diff too large ({Math.round((resp.size ?? 0) / 1024)} KB)</div>
            <button onClick={() => load(true)}>Show anyway</button>
          </div>
        </div>
      )
    }
    return plain
      ? <pre className="diff-plain">{text?.trim() || 'No changes'}</pre>
      : <div key="html" ref={ref} className="diff-html" />
  }

  return (
    <div className="diffview">
      {toolbar}
      {body()}
    </div>
  )
}
