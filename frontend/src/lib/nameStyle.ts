import type { CSSProperties } from 'react'

/**
 * Display name styles (free for everyone): a font, an effect and one or two colours. Fonts are system font
 * stacks (nothing to download); effects are CSS classes in index.css (.ne-*) driven by --n1 / --n2.
 */
export type NameFont = 'default' | 'serif' | 'mono' | 'rounded' | 'display' | 'script' | 'smallcaps' | 'condensed' | 'wide' | 'italic' | 'slab' | 'pixel'
export type NameEffect = 'solid' | 'gradient' | 'neon' | 'toon' | 'pop' | 'gummy' | 'prism' | 'glitch' | 'wave'
export interface NameStyle { font?: NameFont; effect?: NameEffect }

export const FONTS: { id: NameFont; label: string }[] = [
  { id: 'default', label: 'Default' }, { id: 'serif', label: 'Serif' }, { id: 'mono', label: 'Mono' }, { id: 'rounded', label: 'Rounded' },
  { id: 'display', label: 'Display' }, { id: 'script', label: 'Script' }, { id: 'smallcaps', label: 'Small caps' }, { id: 'condensed', label: 'Condensed' },
  { id: 'wide', label: 'Wide' }, { id: 'italic', label: 'Italic' }, { id: 'slab', label: 'Slab' }, { id: 'pixel', label: 'Pixel' },
]
export const EFFECTS: { id: NameEffect; label: string; animated: boolean; twoColours: boolean }[] = [
  { id: 'solid', label: 'Solid', animated: false, twoColours: false }, { id: 'gradient', label: 'Gradient', animated: true, twoColours: true },
  { id: 'neon', label: 'Neon', animated: true, twoColours: false }, { id: 'toon', label: 'Toon', animated: true, twoColours: true },
  { id: 'pop', label: 'Pop', animated: true, twoColours: true }, { id: 'gummy', label: 'Gummy', animated: true, twoColours: false },
  { id: 'prism', label: 'Prism', animated: true, twoColours: false }, { id: 'glitch', label: 'Glitch', animated: true, twoColours: true },
  { id: 'wave', label: 'Wave', animated: true, twoColours: true },
]
export const NAME_COLORS = ['#57f287', '#3b9bff', '#c94bff', '#f04172', '#ff5c3b', '#d8a21e', '#1abc9c', '#f2f3f7']

export interface NameLook { className: string; style: CSSProperties }

/** Class + CSS variables for a user's display name. No colour at all → plain text. */
export type NameLike = { name_primary?: string | null; name_accent?: string | null; name_style?: { font?: string; effect?: string } | null }
const FONT_IDS = new Set<string>(FONTS.map((f) => f.id)); const EFFECT_IDS = new Set<string>(EFFECTS.map((e) => e.id))
export function nameLook(u: NameLike | undefined): NameLook {
  const font = u?.name_style?.font && FONT_IDS.has(u.name_style.font) ? u.name_style.font : 'default'
  const effect = u?.name_style?.effect && EFFECT_IDS.has(u.name_style.effect) ? u.name_style.effect : (u?.name_accent ? 'gradient' : 'solid')
  const n1 = u?.name_primary ?? null
  const n2 = u?.name_accent ?? n1
  const cls = [font !== 'default' ? `nf-${font}` : '', n1 ? `ne-${effect}` : ''].filter(Boolean).join(' ')
  const style: CSSProperties = n1 ? ({ ['--n1' as string]: n1, ['--n2' as string]: n2 } as CSSProperties) : {}
  return { className: cls, style }
}

/** A random combination for "Surprise me". */
export function surpriseLook(): { font: NameFont; effect: NameEffect; primary: string; accent: string } {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
  const primary = pick(NAME_COLORS.slice(0, 7)); let accent = pick(NAME_COLORS.slice(0, 7)); if (accent === primary) accent = NAME_COLORS[(NAME_COLORS.indexOf(primary) + 3) % 7]
  return { font: pick(FONTS).id, effect: pick(EFFECTS).id, primary, accent }
}
