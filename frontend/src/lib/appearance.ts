import { useSyncExternalStore } from 'react'
import { STORAGE_PREFIX } from './brand'

export type Theme = 'dark' | 'light' | 'system'
export type Density = 'cozy' | 'compact'
/** Dark palettes (the light theme has one): Discord's Ash / Onyx / Midnight, plus two gradients. */
export type Palette = 'default' | 'ash' | 'onyx' | 'midnight' | 'aurora' | 'sunset'
export const PALETTES: { id: Palette; label: string; swatch: string }[] = [
  { id: 'default', label: 'Parley', swatch: '#1a1b23' },
  { id: 'ash', label: 'Ash', swatch: '#313338' },
  { id: 'onyx', label: 'Onyx', swatch: '#0f0f11' },
  { id: 'midnight', label: 'Midnight', swatch: '#121a2c' },
  { id: 'aurora', label: 'Aurora', swatch: 'linear-gradient(135deg, #2b1a4f, #0f3b46)' },
  { id: 'sunset', label: 'Sunset', swatch: 'linear-gradient(135deg, #4a1c2c, #3b2350)' },
]
/** Spacing around the app (channel, DM and member rows), separate from message density. */
export type UiDensity = 'compact' | 'default' | 'spacious'
export interface Appearance {
  theme: Theme
  /** Chat font scale in percent (80..120); applies to message text and the composer. */
  fontScale: number
  density: Density
  /** Accessibility: cut animations and transitions (the OS "reduce motion" setting is honoured regardless). */
  reducedMotion: boolean
  /** Accessibility: brighter secondary text and borders. */
  highContrast: boolean
  palette: Palette
  uiDensity: UiDensity
}

export const DEFAULT_APPEARANCE: Appearance = { theme: 'dark', fontScale: 100, density: 'cozy', reducedMotion: false, highContrast: false, palette: 'default', uiDensity: 'default' }
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
      reducedMotion: p.reducedMotion === true,
      highContrast: p.highContrast === true,
      palette: PALETTES.some((x) => x.id === p.palette) ? p.palette! : 'default',
      uiDensity: p.uiDensity === 'compact' || p.uiDensity === 'spacious' ? p.uiDensity : 'default',
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
  el.dataset.palette = a.palette
  el.dataset.uiDensity = a.uiDensity
  el.dataset.motion = a.reducedMotion ? 'reduced' : 'normal'
  el.dataset.contrast = a.highContrast ? 'high' : 'normal'
  el.style.setProperty('--font-scale', String(a.fontScale / 100))
  el.style.colorScheme = resolvedTheme(a)
}

export function setAppearance(patch: Partial<Appearance>) {
  current = { ...current, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* ignore */ }
  applyAppearance(current)
  listeners.forEach((l) => l())
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('parley:settings'))
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
