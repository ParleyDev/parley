import { useSyncExternalStore } from 'react'
import { STORAGE_PREFIX } from './brand'

export type Theme = 'dark' | 'light' | 'system'
export type Density = 'cozy' | 'compact'
export interface Appearance {
  theme: Theme
  /** Chat font scale in percent (80..120); applies to message text and the composer. */
  fontScale: number
  density: Density
}

export const DEFAULT_APPEARANCE: Appearance = { theme: 'dark', fontScale: 100, density: 'cozy' }
export const FONT_SCALES = [80, 90, 100, 110, 120]
const KEY = `${STORAGE_PREFIX}appearance`

let current: Appearance = load()
const listeners = new Set<() => void>()

function load(): Appearance {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_APPEARANCE }
    const p = JSON.parse(raw) as Partial<Appearance>
    return {
      theme: p.theme === 'light' || p.theme === 'system' ? p.theme : 'dark',
      fontScale: FONT_SCALES.includes(Number(p.fontScale)) ? Number(p.fontScale) : 100,
      density: p.density === 'compact' ? 'compact' : 'cozy',
    }
  } catch { return { ...DEFAULT_APPEARANCE } }
}

const media = typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia('(prefers-color-scheme: light)') : null

/** Resolved theme after honouring "system". */
export const resolvedTheme = (a: Appearance = current): 'dark' | 'light' => (a.theme === 'system' ? (media?.matches ? 'light' : 'dark') : a.theme)

/** Push the current settings onto <html>: data-theme, data-density and --font-scale. */
export function applyAppearance(a: Appearance = current) {
  const el = document.documentElement
  el.dataset.theme = resolvedTheme(a)
  el.dataset.themeSetting = a.theme
  el.dataset.density = a.density
  el.style.setProperty('--font-scale', String(a.fontScale / 100))
  el.style.colorScheme = resolvedTheme(a)
}

export function setAppearance(patch: Partial<Appearance>) {
  current = { ...current, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* ignore */ }
  applyAppearance(current)
  listeners.forEach((l) => l())
}

export function getAppearance(): Appearance { return current }

export function useAppearance(): Appearance {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, getAppearance)
}

/** Call once at boot: apply saved settings and follow the OS when set to "system". */
export function initAppearance() {
  applyAppearance(current)
  media?.addEventListener?.('change', () => { if (current.theme === 'system') { applyAppearance(current); listeners.forEach((l) => l()) } })
}
