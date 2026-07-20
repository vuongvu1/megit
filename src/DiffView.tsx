import { useEffect, useRef, useState } from 'react'
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui.js'
import 'diff2html/bundles/css/diff2html.min.css'
import 'highlight.js/styles/github-dark.css'
import { api } from './api'

type DiffResp = { diff?: string; tooLarge?: boolean; size?: number }

export default function DiffView({ repo, hash, file, wipTick }: { repo: string; hash: string | null; file: string; wipTick: number }) {
  const [resp, setResp] = useState<DiffResp | null>(null)
  const [error, setError] = useState('')
  const [split, setSplit] = useState(() => localStorage.getItem('megit-diff-split') === '1')
  const ref = useRef<HTMLDivElement>(null)

  const load = (force = false, silent = false) => {
    if (!silent) {
      setError('')
      setResp(null)
    }
    const params = new URLSearchParams({ repo, file, ...(hash ? { hash } : {}), ...(force ? { force: '1' } : {}) })
    api<DiffResp>(`/api/diff?${params}`)
      .then(r => { setError(''); setResp(r) })
      .catch(e => { if (!silent) setError(e.message) })
  }
  // seenTick: a wipTick that was already current when this file was opened
  // must not trigger a reload; only later increments do. Commit diffs (hash
  // set) never reload — same hash, same content.
  const seenTick = useRef(wipTick)
  useEffect(() => { seenTick.current = wipTick; load() }, [repo, hash, file])
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
    })
    ui.draw()
    ui.highlightCode()
  }, [resp, split, plain])

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
        <button onClick={() => { setSplit(!split); localStorage.setItem('megit-diff-split', split ? '0' : '1') }}>{split ? 'Unified' : 'Side-by-side'}</button>
      </div>
      {plain
        ? <pre className="diff-plain">{resp.diff?.trim() || 'No changes'}</pre>
        : <div ref={ref} className="diff-html" />}
    </div>
  )
}
