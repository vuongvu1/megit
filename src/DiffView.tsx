import { useEffect, useRef, useState } from 'react'
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui.js'
import { ColorSchemeType } from 'diff2html/lib/types'
import 'diff2html/bundles/css/diff2html.min.css'
import { api } from './api'
import { useTheme } from './theme'

type DiffResp = { diff?: string; tooLarge?: boolean; size?: number }

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i

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
  const theme = useTheme()
  const ref = useRef<HTMLDivElement>(null)

  const isImage = IMAGE_RE.test(file)

  const load = (force = false, silent = false) => {
    if (isImage) return
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

  useEffect(() => {
    if (!ref.current || !resp?.diff || plain) return
    const ui = new Diff2HtmlUI(ref.current, resp.diff, {
      drawFileList: false,
      matching: 'lines',
      highlight: true,
      outputFormat: split ? 'side-by-side' : 'line-by-line',
      colorScheme: theme === 'dark' ? ColorSchemeType.DARK : ColorSchemeType.LIGHT,
    })
    ui.draw()
    ui.highlightCode()
  }, [resp, split, plain, theme])

  if (isImage) {
    const q = (which: 'old' | 'new') => {
      const p = new URLSearchParams({ repo, file, which, ...(hash ? { hash } : { t: String(wipTick) }), ...(side ? { side } : {}) })
      return `/api/blob?${p}`
    }
    return (
      <div className="diffview">
        <div className="image-diff">
          <ImagePane src={q('old')} label="Before" />
          <ImagePane src={q('new')} label="After" />
        </div>
      </div>
    )
  }

  if (error) return <div className="diffview error">{error}</div>
  if (!resp) return <div className="diffview empty">Loading…</div>
  if (resp.tooLarge) {
    return (
      <div className="diffview empty">
        <div>
          <div>Diff too large ({Math.round((resp.size ?? 0) / 1024)} KB)</div>
          <button onClick={() => load(true)}>Show anyway</button>
        </div>
      </div>
    )
  }
  return (
    <div className="diffview">
      <div className="diff-toolbar">
        <div className="view-toggle">
          <button className={split ? '' : 'active'} onClick={() => { setSplit(false); localStorage.setItem('megit-diff-split', '0') }}>Diff View</button>
          <button className={split ? 'active' : ''} onClick={() => { setSplit(true); localStorage.setItem('megit-diff-split', '1') }}>File View</button>
        </div>
      </div>
      {plain
        ? <pre className="diff-plain">{resp.diff?.trim() || 'No changes'}</pre>
        : <div ref={ref} className="diff-html" />}
    </div>
  )
}
