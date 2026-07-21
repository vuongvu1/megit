import { useState } from 'react'

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

export default function TabBar({ repos, active, onSelect, onAdd, onClose, onReorder, onReorderEnd }: {
  repos: string[]
  active: string | null
  onSelect: (r: string) => void
  onAdd: () => void
  onClose: (r: string) => void
  onReorder: (from: number, to: number) => void
  onReorderEnd: () => void
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  return (
    <div className="tabbar">
      <img src="/logo.svg" className="logo" alt="" />
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
          <button className="tab-close" onClick={e => { e.stopPropagation(); onClose(r) }}>×</button>
        </div>
      ))}
      <button className="tab-add" onClick={onAdd}>+</button>
    </div>
  )
}
