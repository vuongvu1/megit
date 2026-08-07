import { useEffect, useMemo, useState } from 'react'
import { api, jsonInit } from './api'
import { applyPicks, parseConflict, type Choice } from './conflict'

type Resp = { content?: string; binary?: true; missing?: true; tooLarge?: true; size?: number }

const CHOICES: [Choice, string][] = [['ours', 'Use ours'], ['theirs', 'Use theirs'], ['both', 'Use both']]

// Files with nothing to pick — binary, submodule, or a delete/modify conflict
// where one side has no version at all. Whole-file decision, no block list.
function WholeFile({ note, busy, onPick, onMarkResolved }: {
  note: string
  busy: boolean
  onPick: (a: 'ours' | 'theirs' | 'delete') => void
  onMarkResolved?: () => void // only when there is content to accept as-is
}) {
  return (
    <div className="cf-card">
      <div className="cf-card-note">{note}</div>
      <div className="cf-card-actions">
        {onMarkResolved && <button className="primary" disabled={busy} onClick={onMarkResolved}>Mark resolved</button>}
        <button disabled={busy} onClick={() => onPick('ours')}>Keep ours</button>
        <button disabled={busy} onClick={() => onPick('theirs')}>Keep theirs</button>
        <button className="danger" disabled={busy} onClick={() => onPick('delete')}>Delete file</button>
      </div>
    </div>
  )
}

export default function ConflictView({ repo, file, onResolved }: { repo: string; file: string; onResolved: () => void }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [picks, setPicks] = useState<Map<number, Choice>>(new Map())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const q = `repo=${encodeURIComponent(repo)}`

  // No wipTick prop, unlike DiffView: reloading on every SSE refresh would wipe
  // the picks mid-edit. Nothing but megit writes this file while it's open, and
  // once it stops being unmerged RepoView stops rendering this component.
  useEffect(() => {
    setResp(null)
    setPicks(new Map())
    setError('')
    api<Resp>(`/api/conflict?${q}&file=${encodeURIComponent(file)}`)
      .then(setResp)
      .catch(e => setError(e.message))
  }, [repo, file])

  const segs = useMemo(() => (resp?.content ? parseConflict(resp.content) : null), [resp])
  const total = useMemo(() => segs?.filter(s => s.kind === 'conflict').length ?? 0, [segs])

  // every block decided → write the file and stage it. The banner's Continue is
  // the only thing that finishes the operation; this only finishes the file.
  useEffect(() => {
    if (!segs || !total || picks.size < total) return
    setBusy(true)
    api(`/api/conflict?${q}`, jsonInit('POST', { action: 'resolve', file, content: applyPicks(segs, picks) }))
      .then(onResolved)
      .catch(e => { setError(e.message); setBusy(false) })
  }, [picks, segs, total])

  const wholeFile = (action: 'ours' | 'theirs' | 'delete') => {
    setBusy(true)
    api(`/api/conflict?${q}`, jsonInit('POST', { action, file }))
      .then(onResolved)
      .catch(e => { setError(e.message); setBusy(false) })
  }

  // accept the file exactly as it sits on disk. The Merge Changes rows carry no
  // Stage button, so without this there'd be no way to take a file somebody
  // already fixed by hand in an editor or the terminal.
  const markResolved = () => {
    setBusy(true)
    api(`/api/conflict?${q}`, jsonInit('POST', { action: 'resolve', file, content: resp?.content ?? '' }))
      .then(onResolved)
      .catch(e => { setError(e.message); setBusy(false) })
  }

  const pick = (i: number, choice: Choice) => setPicks(p => new Map(p).set(i, choice))
  const reset = (i: number) => setPicks(p => { const n = new Map(p); n.delete(i); return n })

  if (error) return <div className="diffview error">{error}</div>
  if (!resp) return <div className="diffview empty">Loading…</div>
  if (resp.tooLarge) return <div className="diffview empty">File too large to resolve here ({Math.round((resp.size ?? 0) / 1024)} KB) — use the terminal</div>
  if (resp.binary) return <div className="cf-view"><WholeFile note="Binary file — there is nothing to merge line by line." busy={busy} onPick={wholeFile} /></div>
  if (resp.missing) return <div className="cf-view"><WholeFile note="Deleted on one side and modified on the other." busy={busy} onPick={wholeFile} /></div>
  if (!segs) return <div className="cf-view"><WholeFile note="No conflict markers left in this file — it looks already resolved." busy={busy} onPick={wholeFile} onMarkResolved={markResolved} /></div>

  return (
    <div className="cf-view">
      <div className="cf-progress">{picks.size} of {total} resolved</div>
      {segs.map((s, i) => {
        if (s.kind === 'context') return <pre key={i} className="cf-context">{s.lines.join('')}</pre>
        const chosen = picks.get(i)
        return (
          <div key={i} className={`cf-block${chosen ? ' picked' : ''}`}>
            <div className="cf-bar">
              <span className="cf-side-name">{s.block.oursLabel || 'ours'}</span>
              {chosen ? (
                <>
                  <span className="cf-chosen">took {chosen}</span>
                  <button disabled={busy} onClick={() => reset(i)}>Reset</button>
                </>
              ) : (
                CHOICES.map(([c, label]) => (
                  <button key={c} disabled={busy} onClick={() => pick(i, c)}>{label}</button>
                ))
              )}
            </div>
            {(!chosen || chosen === 'ours' || chosen === 'both') && <pre className="cf-ours">{s.block.ours.join('')}</pre>}
            {!chosen && <div className="cf-mid">{s.block.theirsLabel || 'theirs'}</div>}
            {(!chosen || chosen === 'theirs' || chosen === 'both') && <pre className="cf-theirs">{s.block.theirs.join('')}</pre>}
          </div>
        )
      })}
    </div>
  )
}
