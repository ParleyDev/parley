import { useSyncExternalStore } from 'react'
import { api } from './api'

/**
 * Colour themes, like Discord's: a gradient (angle and 2-5 colour stops) behind the whole app, on a light or dark base.
 * The surfaces (server bar, sidebars, chat, panels) become partly see-through so the gradient tints them; the midpoint
 * sets how strongly (lower is subtler). Text is checked against every tinted surface and nudged until it passes WCAG AA.
 * Everything is expressed through the same CSS variables the base themes use, so every screen follows.
 *
 * The list comes from the server (admins manage it); a user's choice, their own custom theme, a server's theme and a
 * temporary preview are resolved here into the one look that is applied (see appearance.applyAppearance).
 */
export interface Stop { color: string; pos: number }
export interface Look { base: 'light' | 'dark'; angle: number; midpoint: number; stops: Stop[] }
export interface ColorTheme extends Look { id: string; name: string; slug: string; sort_order: number; enabled: boolean; builtin: boolean }

let themes: ColorTheme[] = []
let loaded = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export const subscribeThemes = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const getThemes = () => themes
export const themesLoaded = () => loaded
export function useColorThemes(): ColorTheme[] { return useSyncExternalStore(subscribeThemes, getThemes, getThemes) }
export function setThemes(list: ColorTheme[]) { themes = list; loaded = true; emit() }
export async function loadThemes() { try { setThemes(await api.get<ColorTheme[]>('/themes')) } catch { /* keep what we have */ } }

// Overrides that sit above the user's own choice: a server's theme while inside it, and a preview being tried on.
let guildLook: Look | null = null
let preview: { look: Look; name: string; id?: string } | null = null
export const getGuildLook = () => guildLook
export const getPreview = () => preview
export function setGuildLook(l: Look | null) { if (JSON.stringify(l) === JSON.stringify(guildLook)) return; guildLook = l; emit() }
export function setPreview(p: { look: Look; name: string; id?: string } | null) { preview = p; emit() }
export function usePreview() { return useSyncExternalStore(subscribeThemes, getPreview, getPreview) }

export const gradientCss = (l: Pick<Look, 'angle' | 'stops'>) => `linear-gradient(${l.angle}deg, ${[...l.stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${s.pos}%`).join(', ')})`

// --- colour maths ------------------------------------------------------------------------------------------------
type RGB = [number, number, number]
export const hex = (h: string): RGB => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const toHex = (c: RGB) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const lum = (c: RGB) => { const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
export const contrast = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

/** The base surfaces and text a theme starts from (Discord's Ash for dark, its light theme for light). */
const BASES = {
  dark: { bg: ['#1e1f22', '#2b2d31', '#313338'], text: ['#f2f3f5', '#dbdee1', '#949ba4'], line: '#3f4147', float: '#232428', sheen: '255 255 255' },
  light: { bg: ['#e3e5e8', '#f2f3f5', '#ffffff'], text: ['#060607', '#313338', '#5c5e66'], line: '#d7d9de', float: '#ffffff', sheen: '0 0 0' },
} as const

/**
 * The CSS variables for a look: see-through surfaces (base colour over the gradient), text that keeps WCAG AA (4.5:1
 * for body and secondary text) against every tinted surface, and solid colours for things that float above (menus,
 * dialogs, popouts), which would be unreadable over the gradient.
 */
export function themeVars(l: Look): { vars: Record<string, string>; adjusted: string[]; surface: string } {
  const b = BASES[l.base]
  // Tint strength: how much of the gradient shows through the main chat surface.
  let tint = 0.16 + 0.5 * Math.min(100, Math.max(0, l.midpoint)) / 100
  const layers = [0.55, 0.8, 1] // server bar and sidebars a little more opaque than the chat
  const stops = l.stops.map((s) => hex(s.color))
  const avg: RGB = stops.reduce((acc, c) => [acc[0] + c[0] / stops.length, acc[1] + c[1] / stops.length, acc[2] + c[2] / stops.length], [0, 0, 0] as RGB)
  const shown = (tintNow: number) => b.bg.flatMap((bg, i) => stops.map((s) => mix(hex(bg), s, tintNow * layers[i])))
  const adjusted: string[] = []
  // Body text must pass everywhere: if a strong stop breaks it, back the tint off until it doesn't.
  while (tint > 0.05 && shown(tint).some((bg) => contrast(hex(b.text[0]), bg) < 4.5 || contrast(hex(b.text[1]), bg) < 4.5)) { tint -= 0.02; if (!adjusted.includes('tint')) adjusted.push('tint') }
  const surfaces = shown(tint)
  // Secondary text: towards the body text colour until it passes 4.5:1 on every surface.
  let t2 = hex(b.text[2])
  for (let i = 0; i <= 20 && surfaces.some((bg) => contrast(t2, bg) < 4.5); i++) { t2 = mix(hex(b.text[2]), hex(b.text[1]), i / 20); if (i === 1) adjusted.push('text-2') }
  const a = (i: number) => (1 - tint * layers[i]).toFixed(3)
  const rgb = (h: string) => hex(h).join(' ')
  const float = mix(hex(b.float), avg, tint * 0.35)
  const float2 = mix(hex(b.float), avg, tint * 0.5)
  const surface = toHex(mix(hex(b.bg[1]), stops[0], tint * layers[1]))
  return {
    adjusted,
    surface,
    vars: {
      '--app-gradient': gradientCss(l),
      '--color-bg-0': `rgb(${rgb(b.bg[0])} / ${a(0)})`,
      '--color-bg-1': `rgb(${rgb(b.bg[1])} / ${a(1)})`,
      '--color-bg-2': `rgb(${rgb(b.bg[2])} / ${a(2)})`,
      '--color-bg-3': `rgb(${b.sheen} / ${l.base === 'dark' ? 0.08 : 0.06})`,
      '--color-bg-4': `rgb(${b.sheen} / ${l.base === 'dark' ? 0.13 : 0.1})`,
      '--color-line': `rgb(${b.sheen} / ${l.base === 'dark' ? 0.1 : 0.12})`,
      '--color-text-0': b.text[0],
      '--color-text-1': b.text[1],
      '--color-text-2': toHex(t2),
      '--color-float': toHex(float),
      '--color-float-2': toHex(float2),
      '--scrollbar-thumb': `rgb(${b.sheen} / 0.25)`,
    },
  }
}

/** The worst text contrast a look gives (for the editor's warnings and the tests). */
export function lookContrast(l: Look): { text0: number; text1: number; text2: number } {
  const { vars } = themeVars(l)
  const b = BASES[l.base]
  const parse = (v: string, base: string): RGB[] => { const al = Number(/\/ ([\d.]+)\)/.exec(v)?.[1] ?? 1); return l.stops.map((s) => mix(hex(s.color), hex(base), al)) }
  const bgs = [...parse(vars['--color-bg-0'], b.bg[0]), ...parse(vars['--color-bg-1'], b.bg[1]), ...parse(vars['--color-bg-2'], b.bg[2])]
  const worst = (c: string) => Math.min(...bgs.map((bg) => contrast(hex(c), bg)))
  return { text0: worst(vars['--color-text-0']), text1: worst(vars['--color-text-1']), text2: worst(vars['--color-text-2']) }
}

/** Plain look of a theme or server theme value ({id} or {custom}). */
export function lookOf(v: { id?: string; custom?: Look } | null | undefined): Look | null {
  if (!v) return null
  if (v.custom) return v.custom
  const t = v.id ? themes.find((x) => x.id === v.id && x.enabled) : undefined
  return t ? { base: t.base, angle: t.angle, midpoint: t.midpoint, stops: t.stops } : null
}

let appliedVars: string[] = []
/** Put a look (or none) onto <html>: data-color-theme and its variables. Returns the solid surface colour for the shells. */
export function applyLook(l: Look | null, key: string): string | null {
  const el = document.documentElement
  for (const k of appliedVars) el.style.removeProperty(k)
  appliedVars = []
  if (!l) { delete el.dataset.colorTheme; return null }
  const { vars, surface } = themeVars(l)
  for (const [k, v] of Object.entries(vars)) { el.style.setProperty(k, v); appliedVars.push(k) }
  el.dataset.colorTheme = key
  return surface
}
