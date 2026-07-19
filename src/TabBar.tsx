const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

export default function TabBar({ repos, active, onSelect, onAdd, onClose }: {
  repos: string[]
  active: string | null
  onSelect: (r: string) => void
  onAdd: () => void
  onClose: (r: string) => void
}) {
  return (
    <div className="tabbar">
      {repos.map(r => (
        <div key={r} className={`tab${r === active ? ' active' : ''}`} title={r} onClick={() => onSelect(r)}>
          {base(r)}
          <button className="tab-close" onClick={e => { e.stopPropagation(); onClose(r) }}>×</button>
        </div>
      ))}
      <button className="tab-add" onClick={onAdd}>+</button>
    </div>
  )
}
