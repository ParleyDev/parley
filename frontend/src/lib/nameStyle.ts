import type { CSSProperties } from 'react'

/**
 * Name styles for users and roles (free for everyone): a font, an effect and its colours. Fonts are system
 * font stacks; effects are CSS classes in index.css (.ne-*) driven by --n1, --n2 and --ngrad.
 */
export type NameFont = 'default' | 'serif' | 'mono' | 'rounded' | 'display' | 'script' | 'smallcaps' | 'condensed' | 'wide' | 'italic' | 'slab' | 'pixel'
export type NameEffect = 'solid' | 'gradient' | 'neon' | 'toon' | 'pop' | 'gummy' | 'prism' | 'glitch' | 'wave'
export interface NameStyle { font?: NameFont; effect?: NameEffect; colors?: string[] }
/** What the colour picker shows: one swatch, a 2-stop gradient bar, striped palettes, or a 5-stop bar. */
export type ColorMode = 'one' | 'two' | 'stripes' | 'five'

export const FONTS: { id: NameFont; label: string }[] = [
  { id: 'default', label: 'Default' }, { id: 'serif', label: 'Serif' }, { id: 'mono', label: 'Mono' }, { id: 'rounded', label: 'Rounded' },
  { id: 'display', label: 'Display' }, { id: 'script', label: 'Script' }, { id: 'smallcaps', label: 'Small caps' }, { id: 'condensed', label: 'Condensed' },
  { id: 'wide', label: 'Wide' }, { id: 'italic', label: 'Italic' }, { id: 'slab', label: 'Slab' }, { id: 'pixel', label: 'Pixel' },
]
export const EFFECTS: { id: NameEffect; label: string; mode: ColorMode }[] = [
  { id: 'solid', label: 'Solid', mode: 'one' }, { id: 'gradient', label: 'Gradient', mode: 'two' }, { id: 'neon', label: 'Neon', mode: 'one' },
  { id: 'toon', label: 'Toon', mode: 'one' }, { id: 'pop', label: 'Pop', mode: 'one' }, { id: 'gummy', label: 'Gummy', mode: 'stripes' },
  { id: 'prism', label: 'Prism', mode: 'five' }, { id: 'glitch', label: 'Glitch', mode: 'one' }, { id: 'wave', label: 'Wave', mode: 'one' },
]
export const NAME_COLORS = ['#57f287', '#3b9bff', '#c94bff', '#f04172', '#ff5c3b', '#d8a21e', '#1abc9c', '#f2f3f7']
export const GRADIENT_PRESETS: string[][] = [['#2ee6a6', '#f6c86b'], ['#3b9bff', '#c94bff'], ['#ff7ad9', '#ffb86b'], ['#ff5c3b', '#f6c86b'], ['#57f287', '#3b9bff'], ['#f04172', '#ff9f43']]
export const GUMMY_PRESETS: string[][] = [['#8cf2c6', '#9fd4ff', '#bba6ff'], ['#ff9ad5', '#ffd1e8', '#ff9ad5'], ['#ffb3a7', '#ffd59e', '#ff9aa2'], ['#b6f2a1', '#7fe0a0', '#c8ff9e'], ['#a6d8ff', '#86c5ff', '#c7e6ff'], ['#d9a6ff', '#efc8ff', '#c48cff']]
export const PRISM_PRESETS: string[][] = [['#ff5c3b', '#f6c86b', '#57f287', '#3b9bff', '#c94bff'], ['#f04172', '#ff9f43', '#f6c86b', '#2ee6a6', '#3b9bff'], ['#ff2d55', '#ff9500', '#ffcc00', '#ff2d55', '#ff9500'], ['#2ee6a6', '#3b9bff', '#c94bff', '#2ee6a6', '#3b9bff'], ['#ff7ad9', '#c94bff', '#3b9bff', '#2ee6a6', '#f6c86b'], ['#f6c86b', '#ff5c3b', '#f04172', '#c94bff', '#3b9bff']]

export const modeOf = (effect: NameEffect | string | undefined): ColorMode => EFFECTS.find((e) => e.id === effect)?.mode ?? 'one'
export const colourCount = (mode: ColorMode) => (mode === 'one' ? 1 : mode === 'two' ? 2 : mode === 'stripes' ? 3 : 5)
/** Default colours for an effect when switching to it (reuse what fits, fill from presets). */
export function defaultColors(effect: NameEffect, prev: string[]): string[] {
  const m = modeOf(effect)
  if (m === 'one') return [prev[0] ?? NAME_COLORS[0]]
  if (m === 'two') return prev.length >= 2 ? prev.slice(0, 2) : [prev[0] ?? GRADIENT_PRESETS[0][0], GRADIENT_PRESETS[0][1]]
  if (m === 'stripes') return prev.length >= 3 ? prev.slice(0, 3) : GUMMY_PRESETS[0]
  return prev.length >= 5 ? prev.slice(0, 5) : PRISM_PRESETS[0]
}

/** The CSS gradient a multi-colour effect paints with. */
export function gradientFor(effect: NameEffect | string, colors: string[]): string {
  if (effect === 'gummy') { const n = colors.length || 1; const w = 100 / n; return `repeating-linear-gradient(90deg, ${colors.map((c, i) => `${c} ${(i * w).toFixed(1)}% ${((i + 1) * w).toFixed(1)}%`).join(', ')})` }
  if (effect === 'prism') return `linear-gradient(90deg, ${[...colors, colors[0]].join(', ')})`
  return `linear-gradient(90deg, ${colors[0]}, ${colors[1] ?? colors[0]}, ${colors[0]})`
}

export interface NameLook { className: string; style: CSSProperties }
export type NameLike = { name_primary?: string | null; name_accent?: string | null; name_style?: { font?: string; effect?: string; colors?: string[] } | null }
const FONT_IDS = new Set<string>(FONTS.map((f) => f.id)); const EFFECT_IDS = new Set<string>(EFFECTS.map((e) => e.id))

/** Colours of a style, falling back to the classic primary/accent fields. */
export function colorsOf(u: NameLike | undefined): string[] {
  const c = u?.name_style?.colors?.filter((x) => /^#[0-9a-f]{6}$/i.test(x)) ?? []
  if (c.length) return c
  return [u?.name_primary, u?.name_accent].filter((x): x is string => !!x)
}

/** Class + CSS variables for a name. No colour at all → plain text. */
export function nameLook(u: NameLike | undefined): NameLook {
  const font = u?.name_style?.font && FONT_IDS.has(u.name_style.font) ? u.name_style.font : 'default'
  const colors = colorsOf(u)
  const effect = u?.name_style?.effect && EFFECT_IDS.has(u.name_style.effect) ? u.name_style.effect : (colors.length > 1 ? 'gradient' : 'solid')
  if (!colors.length) return { className: font !== 'default' ? `nf-${font}` : '', style: {} }
  const style: Record<string, string> = { '--n1': colors[0], '--n2': colors[1] ?? colors[0] }
  if (modeOf(effect) !== 'one') style['--ngrad'] = gradientFor(effect, colors)
  return { className: [font !== 'default' ? `nf-${font}` : '', `ne-${effect}`].filter(Boolean).join(' '), style: style as CSSProperties }
}

/** A random combination for "Surprise me". */
export function surpriseStyle(): Required<NameStyle> {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
  const effect = pick(EFFECTS).id
  const m = modeOf(effect)
  const colors = m === 'one' ? [pick(NAME_COLORS.slice(0, 7))] : m === 'two' ? pick(GRADIENT_PRESETS) : m === 'stripes' ? pick(GUMMY_PRESETS) : pick(PRISM_PRESETS)
  return { font: pick(FONTS).id, effect, colors }
}
