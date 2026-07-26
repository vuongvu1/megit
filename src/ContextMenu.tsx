import { useEffect, useLayoutEffect, useRef } from 'react'

export type MenuItem = { label: string; danger?: boolean; sep?: boolean; onClick: () => void }

// popover for the top layer only (the menu escapes row overflow and the graph's
// stacking context), and `manual` rather than `auto`: on macOS `contextmenu` fires
// on mousedown, so an auto popover opened here is light-dismissed by the mouseup
// that follows it. Dismissal is handled below instead, registered one render after
// the event that opened the menu — so that same interaction can't close it.
export default function ContextMenu({ x, y, items, onClose }: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.showPopover()
    // clamp before paint, once the menu has a measurable size
    const { width, height } = el.getBoundingClientRect()
    if (x + width > innerWidth) el.style.left = `${Math.max(4, innerWidth - width - 4)}px`
    if (y + height > innerHeight) el.style.top = `${Math.max(4, innerHeight - height - 4)}px`
  }, [x, y])
  useEffect(() => {
    // mousedown covers right-clicks too (they never produce a click event); a
    // right-click on another row closes this menu, then that row reopens it
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const close = () => onClose()
    document.addEventListener('mousedown', away, true)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', close, true) // capture: scrolling panes, not just the window
    return () => {
      document.removeEventListener('mousedown', away, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', close, true)
    }
  }, [onClose])
  return (
    <div ref={ref} popover="manual" className="ctx-menu" style={{ left: x, top: y }}>
      {items.map(it => (
        <button
          key={it.label}
          className={`ctx-item${it.danger ? ' danger' : ''}${it.sep ? ' sep' : ''}`}
          onClick={() => { onClose(); it.onClick() }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
