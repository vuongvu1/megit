import { useEffect, useRef, useState } from 'react'
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui.js'
import 'diff2html/bundles/css/diff2html.min.css'
import 'highlight.js/styles/github-dark.css'
import { api } from './api'

type DiffResp = { diff?: string; tooLarge?: boolean; size?: number }

export default function DiffView({ repo, hash, file }: { repo: string; hash: string | null; file: string }) {
  const [resp, setResp] = useState<DiffResp | null>(null)
  const [error, setError] = useState('')
  const [split, setSplit] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = (force = false) => {
    setError('')
    setResp(null)
    const params = new URLSearchParams({ repo, file, ...(hash ? { hash } : {}), ...(force ? { force: '1' } : {}) })
    api<DiffResp>(`/api/diff?${params}`).then(setResp).catch(e => setError(e.message))
  }
  useEffect(() => { load() }, [repo, hash, file])

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
        <button onClick={() => setSplit(!split)}>{split ? 'Unified' : 'Side-by-side'}</button>
      </div>
      {plain
        ? <pre className="diff-plain">{resp.diff?.trim() || 'No changes'}</pre>
        : <div ref={ref} className="diff-html" />}
    </div>
  )
}
