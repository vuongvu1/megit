import { toggleTheme, useTheme } from './theme'

const Sun = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
  </svg>
)

const Moon = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

export default function ThemeSwitch() {
  return (
    <label className="theme-switch" title="Toggle light/dark theme">
      <input type="checkbox" checked={useTheme() === 'light'} onChange={toggleTheme} />
      <Sun />
      <Moon />
      <span className="knob" />
    </label>
  )
}
