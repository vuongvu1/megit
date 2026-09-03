import { useEffect } from 'react'
import ThemeSwitch from './ThemeSwitch'
import { useSettings, setSetting } from './settingsStore'
import { ZOOM_PRESETS, nearestPreset } from './settings'
import { GROUPS, SHORTCUTS, renderKeys } from './shortcuts'

// navigator.platform is deprecated but still the only synchronous way to tell;
// getting this wrong costs a wrong glyph in a reference table, nothing more.
const MAC = /Mac|iPhone|iPad/.test(navigator.platform)

// ui-monospace already resolves to each platform's best mono, so SF Mono, Menlo
// and Consolas would be three more rows doing the same job worse.
const FONTS = [
  { label: 'Ubuntu Mono (bundled)', value: '' },
  { label: 'System monospace', value: 'ui-monospace, monospace' },
  { label: 'System UI', value: 'system-ui, sans-serif' },
]

// Reuses .modal-backdrop / .modal, and DirBrowser's Escape-to-close effect.
export default function Settings({ onClose }: { onClose: () => void }) {
  const s = useSettings()
  const zoomId = nearestPreset(s.zoom).id

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Settings" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-path"><b>Settings</b></span>
          {/* Icon-only: an aria-label is required here, where on a button with
              visible text it would override that text and break voice control. */}
          <button className="settings-close" onClick={onClose} aria-label="Close settings">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
            </svg>
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-group">
            <div className="settings-h">Appearance</div>
            <div className="settings-row">
              <label>Theme</label>
              {/* The same switch as the toolbar, bound to the same theme.ts store,
                  so the two can never disagree. */}
              <ThemeSwitch />
            </div>
            <div className="settings-row">
              <label>Text size</label>
              <div className="zoom-presets">
                {ZOOM_PRESETS.map(p => (
                  <button
                    key={p.id}
                    data-z={p.id}
                    className={p.id === zoomId ? 'active' : ''}
                    aria-pressed={p.id === zoomId}
                    title={`${Math.round(p.zoom * 100)}%`}
                    onClick={() => setSetting('zoom', p.zoom)}
                  >aA</button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <label htmlFor="set-font">Font</label>
              <select id="set-font" value={s.fontFamily} onChange={e => setSetting('fontFamily', e.target.value)}>
                {FONTS.map(f => <option key={f.label} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>
          <div className="settings-group">
            <div className="settings-h">Behaviour</div>
            <div className="settings-row">
              <label htmlFor="set-avatars">Author avatars</label>
              <input
                id="set-avatars"
                type="checkbox"
                checked={s.avatars}
                onChange={e => setSetting('avatars', e.target.checked)}
              />
            </div>
            <div className="settings-warn">
              Fetches author photos from GitHub and gravatar.com. Off shows initials and makes no
              outbound requests.
            </div>
            <div className="settings-row">
              <label htmlFor="set-diff">Diff view</label>
              <select id="set-diff" value={s.diffSplit ? 'split' : 'unified'} onChange={e => setSetting('diffSplit', e.target.value === 'split')}>
                <option value="unified">Unified</option>
                <option value="split">Split</option>
              </select>
            </div>
          </div>
          <div className="settings-group">
            <div className="settings-h">Shortcuts</div>
            {GROUPS.map(g => (
              <div key={g} className="sc-group">
                <div className="sc-group-name">{g}</div>
                {SHORTCUTS.filter(sc => sc.group === g).map(sc => (
                  <div key={sc.keys} className="sc-row">
                    <div className="sc-keys">
                      {renderKeys(sc.keys, MAC).map((alt, i) => (
                        <span key={i} className="sc-alt">
                          {alt.map((k, j) => (
                            <span key={k}>
                              {j > 0 && (
                                <svg className="sc-plus" viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
                                  <path d="M4 1.5v5M1.5 4h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                </svg>
                              )}
                              <kbd>{k}</kbd>
                            </span>
                          ))}
                        </span>
                      ))}
                    </div>
                    <span className="sc-label">{sc.label}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="settings-foot">
            megit v{__VERSION__} — by{' '}
            <a href="https://github.com/vuongvu1/megit" target="_blank" rel="noreferrer">Hoang Vuong Vu</a>
          </div>
        </div>
      </div>
    </div>
  )
}
