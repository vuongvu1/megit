// Reference only — the dialog renders this, nothing dispatches from it. The six
// handlers keep their own inline key checks (theme.ts, RepoView.tsx,
// GraphView.tsx, TerminalPanel.tsx, CommitPanel.tsx); each carries a comment
// pointing back here. Rebinding was considered and rejected: a runtime matcher
// would have to sit in TerminalPanel's ⌘-passthrough filter, which decides what
// reaches the shell.
export type Shortcut = { keys: string; label: string; group: string }

// 'Mod' is ⌘ on mac, Ctrl elsewhere — the handler accepts either. 'Meta' is ⌘
// only: TerminalPanel's filter requires metaKey and excludes ctrlKey on purpose,
// so Ctrl+K stays with the shell's readline kill-line. Letter case here is
// display-only — 'r' is bound unshifted but reads better as R.
export const SHORTCUTS: Shortcut[] = [
  { group: 'Graph', keys: '↑ ↓', label: 'Select previous / next row' },
  { group: 'Graph', keys: 'Home End', label: 'Jump to first / last row' },
  { group: 'Search', keys: 'Mod+F', label: 'Open search' },
  { group: 'Search', keys: 'Enter', label: 'Next match' },
  { group: 'Search', keys: 'Shift+Enter', label: 'Previous match' },
  { group: 'Search', keys: 'Escape', label: 'Close search' },
  { group: 'Terminal', keys: 'Mod+J', label: 'Toggle terminal' },
  { group: 'Terminal', keys: 'Meta+K', label: 'Clear terminal' },
  { group: 'Terminal', keys: 'Meta+D', label: 'Split terminal pane' },
  { group: 'Commit', keys: 'Mod+Enter', label: 'Commit, or save an edited message' },
  { group: 'Commit', keys: 'Escape', label: 'Cancel message edit' },
  { group: 'View', keys: 'r', label: 'Refresh (outside a text field)' },
  { group: 'View', keys: 'Mod+Shift+0', label: 'Toggle light / dark theme' },
  { group: 'Dialogs', keys: 'Escape', label: 'Close dialog' },
]

export const GROUPS = [...new Set(SHORTCUTS.map(s => s.group))]

const MAC: Record<string, string> = { Mod: '⌘', Meta: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↵', Escape: 'Esc' }
const PC: Record<string, string> = { Mod: 'Ctrl', Meta: 'Meta', Shift: 'Shift', Alt: 'Alt', Enter: 'Enter', Escape: 'Esc' }

// Two separators, two meanings: '+' joins keys pressed together, a space lists
// alternatives ('↑ ↓' is either arrow, not both). Returning the structure rather
// than a joined string lets the dialog put each key in its own chip — which also
// fixes an alignment problem, since ⌘ and ↵ have very different vertical metrics
// from letters and a chip mixing them looks crooked.
export function renderKeys(keys: string, mac: boolean): string[][] {
  const map = mac ? MAC : PC
  return keys.split(' ').map(alt =>
    alt.split('+').map(t => map[t] ?? (t.length === 1 ? t.toUpperCase() : t)),
  )
}
