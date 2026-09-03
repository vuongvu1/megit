import { useState } from 'react'

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

export default function TabBar({ repos, active, onSelect, onAdd, onClose, onReorder, onReorderEnd, onSettings }: {
  repos: string[]
  active: string | null
  onSelect: (r: string) => void
  onAdd: () => void
  onClose: (r: string) => void
  onReorder: (from: number, to: number) => void
  onReorderEnd: () => void
  onSettings: () => void
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  return (
    <div className="tabbar">
      {/* One flex box so the version sits on the logo's bottom edge by construction,
          rather than by a margin tuned to the tab bar's current height. */}
      <div className="brand">
        <img src="/logo.svg" className="logo" alt="" />
        <span className="build-tag">{import.meta.env.DEV ? '[DEV]' : `v${__VERSION__}`}</span>
      </div>
      {repos.map((r, i) => (
        <div
          key={r}
          className={`tab${r === active ? ' active' : ''}${i === dragIdx ? ' dragging' : ''}`}
          title={r}
          draggable
          onClick={() => onSelect(r)}
          onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r); setDragIdx(i) }}
          onDragOver={e => {
            if (dragIdx === null) return
            e.preventDefault()
            if (dragIdx === i) return
            const { left, width } = e.currentTarget.getBoundingClientRect()
            const past = (e.clientX - left) / width
            if (dragIdx < i ? past > 0.5 : past < 0.5) {
              onReorder(dragIdx, i)
              setDragIdx(i)
            }
          }}
          onDragEnd={() => { setDragIdx(null); onReorderEnd() }}
        >
          {base(r)}
          <button className="tab-close" title={`Close ${base(r)}`} aria-label={`Close ${base(r)}`} onClick={e => { e.stopPropagation(); onClose(r) }}>
            {/* SVG, not a × glyph: a text glyph is placed by the font's baseline, so flex centering
                centers its line box and leaves the visible ink off-centre. This cross is symmetric
                about the viewBox centre, and as a flex item it has no baseline to fight. */}
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
      <button className="tab-add" onClick={onAdd}>+</button>
      <button className="tab-cog" onClick={onSettings} title="Settings" aria-label="Settings">
        {/* Inline SVG, not an icon package — runtime dependencies stay at ws. */}
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.6.65 1.04 1.27 1.09H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  )
}
