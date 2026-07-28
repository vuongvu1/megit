import { useEffect, useRef } from 'react'

// The find-bar from the GitKraken reference: magnifier, input, counter, then the
// deep-search globe and the prev/next/close controls.
//
// Rendered as a SIBLING of .graphview, never a child: GraphView's arrow-key handler
// bails unless the event target is document.body or inside .graphview
// (GraphView.tsx:485), so this placement keeps ↑/↓ as ordinary text-cursor movement
// in the input without adding a second guard there.
export default function SearchBar({
  seq, value, count, deep, onChange, onDeep, onPrev, onNext, onClose,
}: {
  seq: number
  value: string
  count: string
  deep: boolean
  onChange: (v: string) => void
  onDeep: () => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  // seq, not a mount-only effect: ⌘F while the bar is already open must re-focus and
  // select, so the next query replaces the last one instead of appending to it.
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [seq])

  return (
    <div className="searchbar" role="search">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4.5-4.5" />
      </svg>
      <input
        ref={ref}
        value={value}
        placeholder="Search commits"
        aria-label="Search commits"
        onChange={e => onChange(e.target.value)}
        // Enter lives on the input rather than the window listener: it must only step
        // matches while the bar has focus, and it must not fight the commit-message form.
        onKeyDown={e => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (e.shiftKey) onPrev()
          else onNext()
        }}
      />
      <span className="count">{count}</span>
      <button className={`deep${deep ? ' active' : ''}`} onClick={onDeep} title="Search all history" aria-label="Search all history">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
        </svg>
      </button>
      <button onClick={onPrev} title="Previous match (⇧⏎)" aria-label="Previous match">↑</button>
      <button onClick={onNext} title="Next match (⏎)" aria-label="Next match">↓</button>
      <button onClick={onClose} title="Close (Esc)" aria-label="Close search">✕</button>
    </div>
  )
}
