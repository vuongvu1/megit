import { useSyncExternalStore } from 'react'
import darkHl from 'highlight.js/styles/github-dark.css?raw'
import lightHl from 'highlight.js/styles/github.css?raw'

export type Theme = 'dark' | 'light'

let theme: Theme = localStorage.getItem('megit-theme') === 'light' ? 'light' : 'dark'
const listeners = new Set<() => void>()

// Both hljs themes target the same .hljs-* classes, so they can't be
// static-imported together; one managed <style> holds the active one.
const hlStyle = document.createElement('style')
document.head.appendChild(hlStyle)

const apply = () => {
  document.documentElement.dataset.theme = theme
  hlStyle.textContent = theme === 'dark' ? darkHl : lightHl
}
apply()

export const getTheme = () => theme

export const toggleTheme = () => {
  theme = theme === 'dark' ? 'light' : 'dark'
  localStorage.setItem('megit-theme', theme)
  apply()
  listeners.forEach(l => l())
}

window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    toggleTheme()
  }
})

export const useTheme = () =>
  useSyncExternalStore(cb => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, getTheme)
