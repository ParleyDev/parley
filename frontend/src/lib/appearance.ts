import { useSyncExternalStore } from 'react'
import { STORAGE_PREFIX } from './brand'
import { t } from './i18n'
import { applyLook, getGuildLook, getPreview, getThemes, lookOf, subscribeThemes, type Look } from './colorThemes'
import { themeShells } from './themeShells'

export type Theme = 'dark' | 'light' | 'system'
export type Density = 'cozy' | 'compact'
/** Dark palettes (the light theme has one): Discord's Ash / Onyx / Midnight, plus two gradients. */
export type Palette = 'default' | 'ash' | 'onyx' | 'midnight' | 'aurora' | 'sunset'
export const PALETTES: { id: Palette; label: string; swatch: string }[] = [
  { id: 'default', label: 'Parley', swatch: '#1a1b23' },
  { id: 'ash', get label() { return t('Ash') }, swatch: '#313338' },
  { id: 'onyx', get label() { return t('Onyx') }, swatch: '#0f0f11' },
  { id: 'midnight', get label() { return t('Midnight') }, swatch: '#121a2c' },
  { id: 'aurora', get label() { return t('Aurora') }, swatch: 'linear-gradient(135deg, #2b1a4f, #0f3b46)' },
  { id: 'sunset', get label() { return t('Sunset') }, swatch: 'linear-gradient(135deg, #4a1c2c, #3b2350)' },
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
  /** Colour theme: a theme id from the server's list, 'custom' for your own, or null for none (the base theme). */
  colorTheme: string | null
  /** Your own colour theme (the builder in Appearance), saved with your settings. */
  customTheme: Look | null
  /** Sync the theme (base, palette, colour theme) across devices; off keeps this device's own. */
  syncTheme: boolean
  /** Show other people's profile themes (colours on their profile cards). */
  profileThemes: boolean
  /** Inside a server with its own theme: use the server's, or keep mine. */
  serverThemes: 'server' | 'mine'
  /** Follow the device's contrast settings (prefers-contrast: more / forced-colors) for high contrast. */
  syncContrast: boolean
}

export const DEFAULT_APPEARANCE: Appearance = { theme: 'dark', fontScale: 100, density: 'cozy', reducedMotion: false, highContrast: false, palette: 'default', uiDensity: 'default', colorTheme: null, customTheme: null, syncTheme: true, profileThemes: true, serverThemes: 'server', syncContrast: false }
/** The theme fields "Sync theme across my devices" covers. */
export const THEME_KEYS: (keyof Appearance)[] = ['theme', 'palette', 'colorTheme', 'customTheme']
const validLook = (l: unknown): Look | null => {
  const x = l as Look | null
  return x && (x.base === 'light' || x.base === 'dark') && Number.isFinite(x.angle) && Number.isFinite(x.midpoint) && Array.isArray(x.stops) && x.stops.length >= 2 && x.stops.length <= 5 && x.stops.every((s) => /^#[0-9a-f]{6}$/i.test(s.color) && Number.isFinite(s.pos)) ? x : null
}
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
      colorTheme: typeof p.colorTheme === 'string' ? p.colorTheme : null,
      customTheme: validLook(p.customTheme),
      syncTheme: p.syncTheme !== false,
      profileThemes: p.profileThemes !== false,
      serverThemes: p.serverThemes === 'mine' ? 'mine' : 'server',
      syncContrast: p.syncContrast === true,
    }
  } catch { return { ...DEFAULT_APPEARANCE } }
}

const media = typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia('(prefers-color-scheme: light)') : null

/** Resolved theme after honouring "system". */
export const resolvedTheme = (a: Appearance = current): 'dark' | 'light' => (a.theme === 'system' ? (media?.matches ? 'light' : 'dark') : a.theme)

const contrastMedia = typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia('(prefers-contrast: more), (forced-colors: active)') : null
/** High contrast as applied: the setting, or the device's when "Sync contrast settings" is on. */
export const effectiveHighContrast = (a: Appearance = current) => a.highContrast || (a.syncContrast && !!contrastMedia?.matches)

/** The colour theme showing now: a preview being tried, else the server's (unless you keep yours), else your own. High
 *  contrast and reduced motion turn gradients off. */
export function activeLook(a: Appearance = current): { look: Look; key: string } | null {
  if (effectiveHighContrast(a) || a.reducedMotion) return null
  const pv = getPreview(); if (pv) return { look: pv.look, key: 'preview' }
  const g = a.serverThemes === 'server' ? getGuildLook() : null; if (g) return { look: g, key: 'server' }
  if (a.colorTheme === 'custom') return a.customTheme ? { look: a.customTheme, key: 'custom' } : null
  const l = lookOf(a.colorTheme ? { id: a.colorTheme } : null)
  return l ? { look: l, key: a.colorTheme! } : null
}

/** Push the current settings onto <html>: data-theme, data-density, --font-scale and the colour theme. */
export function applyAppearance(a: Appearance = current) {
  const el = document.documentElement
  const active = activeLook(a)
  const base = active ? active.look.base : resolvedTheme(a)
  el.dataset.theme = base
  el.dataset.themeSetting = a.theme
  el.dataset.density = a.density
  // A colour theme brings its own surfaces: the dark palettes step aside.
  el.dataset.palette = active ? 'default' : a.palette
  el.dataset.uiDensity = a.uiDensity
  el.dataset.motion = a.reducedMotion ? 'reduced' : 'normal'
  el.dataset.contrast = effectiveHighContrast(a) ? 'high' : 'normal'
  el.style.setProperty('--font-scale', String(a.fontScale / 100))
  el.style.colorScheme = base
  const surface = applyLook(active?.look ?? null, active?.key ?? '')
  const seeThrough = !!active || (base === 'dark' && (a.palette === 'aurora' || a.palette === 'sunset'))
  if (seeThrough) el.dataset.seeThrough = ''; else delete el.dataset.seeThrough
  themeShells(base, surface ?? getComputedStyle(el).getPropertyValue('--color-bg-1').trim())
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
  contrastMedia?.addEventListener?.('change', () => { if (current.syncContrast) { applyAppearance(current); listeners.forEach((l) => l()) } })
  // The theme list arriving or changing, a server's theme, a preview: re-resolve what shows. The old Aurora and Sunset
  // dark palettes became colour themes of the same names: move anyone still on them across once the list is in.
  subscribeThemes(() => {
    if (current.palette === 'aurora' || current.palette === 'sunset') {
      const th = getThemes().find((x) => x.slug === current.palette)
      if (th) { setAppearance({ palette: 'default', colorTheme: current.colorTheme ?? th.id }); return }
    }
    applyAppearance(current)
  })
}
