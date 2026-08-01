import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from './theme'

// this module is React.lazy-loaded — xterm.js stays out of the main bundle
// and only downloads the first time a terminal is opened

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

// xterm's built-in ANSI palette assumes a dark background — brightWhite (#fff) and
// brightYellow (#ff0) are unreadable on the light theme. GitHub Primer light ANSI:
const lightAnsi = {
  black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00',
  blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
  brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01',
  brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
}

const xtermTheme = () => ({
  background: cssVar('--bg'),
  foreground: cssVar('--fg'),
  cursor: cssVar('--fg'),
  selectionBackground: cssVar('--bg-selected'),
  ...(document.documentElement.dataset.theme === 'light' ? lightAnsi : null),
})

// Mirrors MAX_PANES in server/term.ts — the server rejects a higher pane index, so
// raising this alone just makes ⌘D open a socket that gets destroyed.
const MAX_PANES = 4

// Split layout survives RepoView remounts (tab switches) like termOpenByRepo does;
// the shells are alive server-side, so the panes must come back with them.
const panesByRepo = new Map<string, number[]>()

function TermPane({ repo, pane, closable, onExit, onSplit }: {
  repo: string
  pane: number
  closable: boolean
  onExit: () => void
  onSplit: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const killRef = useRef<() => void>(() => {})
  const theme = useTheme()

  // the effect owns the socket and must not re-run when a callback identity changes —
  // that would kill and respawn the shell on every parent render
  const cbs = useRef({ onExit, onSplit })
  cbs.current = { onExit, onSplit }

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
    const ws = new WebSocket(`${proto}://${location.host}/api/term?repo=${encodeURIComponent(repo)}&pane=${pane}`)
    let unmounted = false
    killRef.current = () => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'k' })) }
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'r', cols: term.cols, rows: term.rows }))
      term.focus()
    }
    ws.onmessage = e => term.write(String(e.data))
    ws.onclose = e => {
      if (unmounted) return
      // 4000 = the shell exited (`exit`, ⌃D, or this pane's ✕): drop the pane.
      // Any other close is the server going away — the shell may still be there.
      if (e.code === 4000) cbs.current.onExit()
      else term.write('\r\n[disconnected — reopen the panel to reconnect]\r\n')
    }
    term.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown' || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return true
      // Cmd+K clears like a native macOS terminal; server ring buffer must clear
      // too or the wiped scrollback replays on the next reattach. Ctrl+K stays
      // with the shell (readline kill-line).
      if (e.code === 'KeyK') {
        e.preventDefault()
        term.clear()
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'c' }))
        return false
      }
      // Cmd+D splits. xterm only sees keys while focused, so this always splits
      // off the pane the user is typing in — no focus tracking needed.
      if (e.code === 'KeyD') {
        e.preventDefault()
        cbs.current.onSplit()
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
  }, [repo, pane])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme()
  }, [theme])

  return (
    <div className="term-pane">
      {closable && (
        <button className="term-pane-kill" onClick={() => killRef.current()}
          title="Kill this pane" aria-label={`Kill terminal pane ${pane + 1}`}>✕</button>
      )}
      <div className="term-host" ref={hostRef} />
    </div>
  )
}

export default function TerminalPanel({ repo, onClose }: { repo: string; onClose: () => void }) {
  const [height, setHeight] = useState(() => Number(localStorage.getItem('megit-term-h')) || 220)
  const [panes, setPanes] = useState<number[]>(() => panesByRepo.get(repo) ?? [0])

  const split = () => setPanes(prev => {
    if (prev.length >= MAX_PANES) return prev
    // lowest free index, so closing the middle pane and splitting again reuses it
    const id = Array.from({ length: MAX_PANES }, (_, i) => i).find(i => !prev.includes(i))!
    const next = [...prev, id].sort((a, b) => a - b)
    panesByRepo.set(repo, next)
    return next
  })

  // read the live layout, not the render's copy: two shells can exit before React
  // re-renders, and the second removal would otherwise resurrect the first pane
  const closePane = (pane: number) => {
    const next = (panesByRepo.get(repo) ?? panes).filter(p => p !== pane)
    if (!next.length) { panesByRepo.delete(repo); onClose(); return }
    panesByRepo.set(repo, next)
    setPanes(next)
  }

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

  return (
    <div className="term-panel" style={{ height }}>
      <div className="term-resizer" onPointerDown={onResizeDown} onPointerMove={onResizeMove} />
      <div className="term-head">
        <span className="term-title">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 17l6-5-6-5" />
            <path d="M12 19h8" />
          </svg>
          Terminal
        </span>
        <span className="term-head-actions">
          <button className="term-close" onClick={split} disabled={panes.length >= MAX_PANES}
            title="Split terminal (⌘D)" aria-label="Split terminal">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="1.7" y="2.7" width="12.6" height="10.6" rx="1.5" />
              <path d="M8 2.7v10.6" />
            </svg>
          </button>
          <button className="term-close" onClick={onClose} title="Close terminal (⌘J)" aria-label="Close terminal">✕</button>
        </span>
      </div>
      <div className="term-panes">
        {panes.map(p => (
          <TermPane key={p} repo={repo} pane={p} closable={panes.length > 1}
            onExit={() => closePane(p)} onSplit={split} />
        ))}
      </div>
    </div>
  )
}
