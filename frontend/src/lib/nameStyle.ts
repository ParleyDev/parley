import type { CSSProperties } from 'react'
import { t } from './i18n'

/**
 * Name styles for users and roles (free for everyone): a font, an effect and its colours. Fonts are bundled
 * typefaces (lib/nameFonts.ts); effects are CSS classes in index.css (.ne-*) driven by --n1, --n2 and --ngrad.
 * Toon, Gummy and Wave move letter by letter: NameText splits the name into .ne-l spans for them.
 */
export type NameFont = 'default' | 'slab' | 'bubbly' | 'retro' | 'modern' | 'medieval' | 'pixel' | 'vampire' | 'playful' | 'tech' | 'metal' | 'handwritten' | 'poster' | 'typewriter'
export type NameEffect = 'solid' | 'gradient' | 'neon' | 'toon' | 'pop' | 'gummy' | 'rainbow' | 'glitch' | 'wave' | 'chrome'
export interface NameStyle { font?: NameFont; effect?: NameEffect; colors?: string[] }
/** What the colour picker shows: one swatch, a 2-stop gradient bar, three letter colours, or a 5-stop bar. */
export type ColorMode = 'one' | 'two' | 'stripes' | 'five'

export const FONTS: { id: NameFont; label: string }[] = [
  { id: 'default', get label() { return t('Default') } }, { id: 'slab', get label() { return t('Slab') } }, { id: 'bubbly', get label() { return t('Bubbly') } }, { id: 'retro', get label() { return t('Retro') } },
  { id: 'modern', get label() { return t('Modern') } }, { id: 'medieval', get label() { return t('Medieval') } }, { id: 'pixel', get label() { return t('Pixel') } }, { id: 'vampire', get label() { return t('Vampire') } },
  { id: 'playful', get label() { return t('Playful') } }, { id: 'tech', get label() { return t('Tech') } }, { id: 'metal', get label() { return t('Metal') } }, { id: 'handwritten', get label() { return t('Handwritten') } },
  { id: 'poster', get label() { return t('Poster') } }, { id: 'typewriter', get label() { return t('Typewriter') } },
]
export const EFFECTS: { id: NameEffect; label: string; mode: ColorMode }[] = [
  { id: 'solid', get label() { return t('Solid') }, mode: 'one' }, { id: 'gradient', get label() { return t('Gradient') }, mode: 'two' }, { id: 'neon', get label() { return t('Neon') }, mode: 'one' },
  { id: 'toon', get label() { return t('Toon') }, mode: 'one' }, { id: 'pop', get label() { return t('Pop') }, mode: 'two' }, { id: 'gummy', get label() { return t('Gummy') }, mode: 'stripes' },
  { id: 'rainbow', get label() { return t('Rainbow') }, mode: 'five' }, { id: 'glitch', get label() { return t('Glitch') }, mode: 'one' }, { id: 'wave', get label() { return t('Wave') }, mode: 'one' },
  { id: 'chrome', get label() { return t('Chrome') }, mode: 'one' },
]
/** Effects that animate letter by letter (NameText wraps each letter for them). */
export const LETTER_EFFECTS = new Set<NameEffect>(['toon', 'gummy', 'wave'])

/** Fonts and effects from before the 2026-11 rework, as stored styles (and older clients) may still name them. */
export const LEGACY_FONTS: Record<string, NameFont> = {
  serif: 'slab', mono: 'typewriter', rounded: 'bubbly', display: 'poster', script: 'retro', smallcaps: 'default',
  condensed: 'poster', wide: 'default', italic: 'default',
}
export const LEGACY_EFFECTS: Record<string, NameEffect> = { prism: 'rainbow', holographic: 'rainbow' }
/** The pastel palette Holographic names became (a Rainbow preset). */
export const HOLO_COLORS = ['#8fb8ff', '#ffa8e4', '#d9c8ff', '#a8f0d4', '#8fb8ff']

export const NAME_COLORS = ['#57f287', '#3b9bff', '#c94bff', '#f04172', '#ff5c3b', '#d8a21e', '#1abc9c', '#f2f3f7']
export const GRADIENT_PRESETS: string[][] = [['#2ee6a6', '#f6c86b'], ['#3b9bff', '#c94bff'], ['#ff7ad9', '#ffb86b'], ['#ff5c3b', '#f6c86b'], ['#57f287', '#3b9bff'], ['#f04172', '#ff9f43']]
export const GUMMY_PRESETS: string[][] = [['#ff7eb6', '#ffd166', '#6ee7b7'], ['#8cf2c6', '#9fd4ff', '#bba6ff'], ['#ffb3a7', '#ffd59e', '#ff9aa2'], ['#b6f2a1', '#7fe0a0', '#c8ff9e'], ['#a6d8ff', '#86c5ff', '#c7e6ff'], ['#d9a6ff', '#efc8ff', '#c48cff']]
export const RAINBOW_PRESETS: string[][] = [['#ff5c3b', '#f6c86b', '#57f287', '#3b9bff', '#c94bff'], HOLO_COLORS, ['#f04172', '#ff9f43', '#f6c86b', '#2ee6a6', '#3b9bff'], ['#ff2d55', '#ff9500', '#ffcc00', '#ff2d55', '#ff9500'], ['#2ee6a6', '#3b9bff', '#c94bff', '#2ee6a6', '#3b9bff'], ['#ff7ad9', '#c94bff', '#3b9bff', '#2ee6a6', '#f6c86b']]

export const modeOf = (effect: NameEffect | string | undefined): ColorMode => EFFECTS.find((e) => e.id === effect)?.mode ?? 'one'
export const colourCount = (mode: ColorMode) => (mode === 'one' ? 1 : mode === 'two' ? 2 : mode === 'stripes' ? 3 : 5)
/** Default colours for an effect when switching to it (reuse what fits, fill from presets). */
export function defaultColors(effect: NameEffect, prev: string[]): string[] {
  const m = modeOf(effect)
  if (m === 'one') return [prev[0] ?? NAME_COLORS[0]]
  if (m === 'two') return prev.length >= 2 ? prev.slice(0, 2) : [prev[0] ?? GRADIENT_PRESETS[0][0], GRADIENT_PRESETS[0][1]]
  if (m === 'stripes') return prev.length >= 3 ? prev.slice(0, 3) : GUMMY_PRESETS[0]
  return prev.length >= 5 ? prev.slice(0, 5) : RAINBOW_PRESETS[0]
}

/** The CSS gradient a multi-colour effect paints with (also the swatch of a preset). */
export function gradientFor(effect: NameEffect | string, colors: string[]): string {
  if (effect === 'gummy') { const n = colors.length || 1; const w = 100 / n; return `repeating-linear-gradient(90deg, ${colors.map((c, i) => `${c} ${(i * w).toFixed(1)}% ${((i + 1) * w).toFixed(1)}%`).join(', ')})` }
  if (effect === 'rainbow') return `linear-gradient(90deg, ${[...colors, colors[0]].join(', ')})`
  return `linear-gradient(90deg, ${colors[0]}, ${colors[1] ?? colors[0]})`
}

export interface NameLook {
  className: string
  style: CSSProperties
  /** Letter colours when the effect animates letter by letter (Toon, Gummy, Wave); NameText splits the name. */
  letters?: string[]
}
export type NameLike = { name_primary?: string | null; name_accent?: string | null; name_style?: { font?: string; effect?: string; colors?: string[] } | null }

/** A stored font or effect id as it is today (older ids map to their replacement; unknown ones to the default). */
export const fontOf = (id: string | undefined): NameFont => { const f = id && (LEGACY_FONTS[id] ?? id); return FONTS.some((x) => x.id === f) ? f as NameFont : 'default' }
export const effectOf = (id: string | undefined): NameEffect | undefined => { const e = id && (LEGACY_EFFECTS[id] ?? id); return EFFECTS.some((x) => x.id === e) ? e as NameEffect : undefined }

/** Colours of a style, falling back to the classic primary/accent fields. Holographic names get the Holo palette. */
export function colorsOf(u: NameLike | undefined): string[] {
  if (u?.name_style?.effect === 'holographic') return HOLO_COLORS
  const c = u?.name_style?.colors?.filter((x) => /^#[0-9a-f]{6}$/i.test(x)) ?? []
  if (c.length) return c
  return [u?.name_primary, u?.name_accent].filter((x): x is string => !!x)
}

/** Class + CSS variables for a name. No colour at all → plain text. */
export function nameLook(u: NameLike | undefined): NameLook {
  const font = fontOf(u?.name_style?.font)
  const colors = colorsOf(u)
  const effect = effectOf(u?.name_style?.effect) ?? (colors.length > 1 ? 'gradient' : 'solid')
  if (!colors.length) return { className: font !== 'default' ? `nf-${font}` : '', style: {} }
  const style: Record<string, string> = { '--n1': colors[0], '--n2': colors[1] ?? colors[0] }
  if (modeOf(effect) !== 'one') style['--ngrad'] = gradientFor(effect, colors)
  const look: NameLook = { className: [font !== 'default' ? `nf-${font}` : '', `ne-${effect}`].filter(Boolean).join(' '), style: style as CSSProperties }
  if (LETTER_EFFECTS.has(effect)) look.letters = effect === 'gummy' ? colors : [colors[0]]
  return look
}

/** A random combination for "Surprise me". */
export function surpriseStyle(): Required<NameStyle> {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
  const effect = pick(EFFECTS).id
  const m = modeOf(effect)
  const colors = m === 'one' ? [pick(NAME_COLORS.slice(0, 7))] : m === 'two' ? pick(GRADIENT_PRESETS) : m === 'stripes' ? pick(GUMMY_PRESETS) : pick(RAINBOW_PRESETS)
  return { font: pick(FONTS).id, effect, colors }
}
