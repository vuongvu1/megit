import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
// type-only: server/worktrees.ts imports node:fs, which must not reach the bundle
import type { Worktree } from '../server/worktrees.ts'
import { api, jsonInit } from './api'
import { tilde } from './paths'
import { toastErr } from './Toast'

const W_KEY = 'megit-wt-w'
const OPEN_KEY = 'megit-wt-open'

type Props = {
  repo: string
  worktrees: Worktree[]
  home: string
  onOpen: (path: string) => void
  onBusy: (p: Promise<unknown>) => void
  onRemoved: () => void
}

// One row per worktree of this repo; the current one is highlighted and inert.
// Empty list (a repo with a single worktree) → nothing rendered, no column taken.
// Width and collapsed state are global (localStorage), like the other splitters.
export default function WorktreeStrip({ repo, worktrees, home, onOpen, onBusy, onRemoved }: Props) {
  const [width, setWidth] = useState(() => Number(localStorage.getItem(W_KEY)) || 160)
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== '0')
  const strip = useRef<HTMLDivElement>(null)
  if (worktrees.length === 0) return null

  const toggle = () => {
    localStorage.setItem(OPEN_KEY, open ? '0' : '1')
    setOpen(!open)
  }
  // pointer capture keeps the drag on the splitter, same as RepoView's splitters
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const w = Math.round(Math.min(480, Math.max(100, e.clientX - strip.current!.getBoundingClientRect().left)))
    setWidth(w)
    localStorage.setItem(W_KEY, String(w))
  }

  // force only when the strip already counted changes and the user accepted losing
  // them; a count that is stale-zero sends no force, and git refuses instead
  const remove = (w: Worktree) => {
    const lines = [`Delete worktree ${tilde(w.path, home)}?`]
    lines.push(w.branch ? `Branch ${w.branch} stays.` : 'Detached HEAD — commits on no branch remain only in the reflog.')
    if (w.changed > 0) lines.push(`${w.changed} uncommitted file${w.changed === 1 ? '' : 's'} will be lost.`)
    if (!confirm(lines.join('\n\n'))) return
    onBusy(api(`/api/worktrees?repo=${encodeURIComponent(repo)}`, jsonInit('POST', { path: w.path, force: w.changed > 0 }))
      .then(onRemoved, (err: Error) => toastErr(`Delete worktree failed:\n${err.message}`)))
  }

  if (!open) {
    return (
      <div className="wt-strip collapsed">
        <button className="wt-toggle" onClick={toggle} title="Show worktrees" aria-label="Show worktrees" aria-expanded={false}>⎇</button>
      </div>
    )
  }
  return (
    <>
      <div className="wt-strip" ref={strip} style={{ width }}>
        <div className="wt-head">
          <span>Worktrees</span>
          <button className="wt-toggle" onClick={toggle} title="Hide worktrees" aria-label="Hide worktrees" aria-expanded>«</button>
        </div>
        {worktrees.map((w, i) => (
          <div key={w.path} className="wt-item">
            <button
              className={`wt-row${w.current ? ' current' : ''}`}
              title={tilde(w.path, home)}
              aria-current={w.current || undefined}
              disabled={w.current}
              onClick={() => onOpen(w.path)}
            >
              <span className="wt-name">{w.branch ?? `detached @ ${w.head.slice(0, 7)}`}</span>
              {w.changed > 0 && <span className="wt-count">{w.changed}</span>}
            </button>
            {/* [0] is the main worktree, which git can't remove; the current one is the tab you're in */}
            {i > 0 && !w.current && (
              <button className="wt-del" onClick={() => remove(w)} title="Delete worktree" aria-label={`Delete worktree ${tilde(w.path, home)}`}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M6 6l1 14h10l1-14" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="splitter" onPointerDown={onDown} onPointerMove={onMove} />
    </>
  )
}
