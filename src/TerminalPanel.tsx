import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from './theme'

// this module is React.lazy-loaded — xterm.js stays out of the main bundle
// and only downloads the first time a terminal is opened

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const xtermTheme = () => ({
  background: cssVar('--bg'),
  foreground: cssVar('--fg'),
  cursor: cssVar('--fg'),
  selectionBackground: cssVar('--bg-selected'),
})

export default function TerminalPanel({ repo, onClose }: { repo: string; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const theme = useTheme()
  const [height, setHeight] = useState(() => Number(localStorage.getItem('megit-term-h')) || 220)

  // same pointer-capture drag as RepoView's splitters; panel is bottom-anchored,
  // so height = viewport bottom minus pointer, clamped to 120px…80% of the window
  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const h = Math.min(Math.round(window.innerHeight * 0.8), Math.max(120, window.innerHeight - e.clientY))
    setHeight(h)
    localStorage.setItem('megit-term-h', String(h))
  }

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'Ubuntu Mono', ui-monospace, monospace",
      fontSize: 14,
      theme: xtermTheme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    fit.fit()
    termRef.current = term

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/term?repo=${encodeURIComponent(repo)}`)
    let unmounted = false
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'r', cols: term.cols, rows: term.rows }))
      term.focus()
    }
    ws.onmessage = e => term.write(String(e.data))
    ws.onclose = () => { if (!unmounted) term.write('\r\n[disconnected — reopen the panel to reconnect]\r\n') }
    term.attachCustomKeyEventHandler(e => {
      // Cmd+K clears like a native macOS terminal; server ring buffer must clear
      // too or the wiped scrollback replays on the next reattach. Ctrl+K stays
      // with the shell (readline kill-line).
      if (e.type === 'keydown' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
        e.preventDefault()
        term.clear()
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'c' }))
        return false
      }
      return true
    })
    const onData = term.onData(d => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'i', d }))
    })
    const onResize = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'r', cols, rows }))
    })
    const ro = new ResizeObserver(() => fit.fit())
    ro.observe(hostRef.current!)

    return () => {
      unmounted = true
      ro.disconnect()
      onData.dispose()
      onResize.dispose()
      ws.close() // detaches only — the shell keeps running server-side
      term.dispose()
    }
  }, [repo])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme()
  }, [theme])

  return (
    <div className="term-panel" style={{ height }}>
      <div className="term-resizer" onPointerDown={onResizeDown} onPointerMove={onResizeMove} />
      <button className="term-close" onClick={onClose} title="Close terminal (⌘J)" aria-label="Close terminal">✕</button>
      <div className="term-host" ref={hostRef} />
    </div>
  )
}
