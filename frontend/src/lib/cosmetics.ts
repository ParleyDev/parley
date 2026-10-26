/** Profile cosmetics drawn in CSS (index.css): ids must match the server's lists in routes/users.rs. */
export const PROFILE_FRAMES = [
  { id: 'gold', label: 'Gilded' }, { id: 'neon', label: 'Neon' }, { id: 'vines', label: 'Vines' },
  { id: 'pixel', label: 'Pixel' }, { id: 'frost', label: 'Frost' }, { id: 'ember', label: 'Ember' },
] as const
export const NAMEPLATES = [
  { id: 'dusk', label: 'Dusk' }, { id: 'ocean', label: 'Ocean' }, { id: 'forest', label: 'Forest' },
  { id: 'candy', label: 'Candy' }, { id: 'aurora', label: 'Aurora' }, { id: 'mono', label: 'Mono' },
] as const
export const PROFILE_EFFECTS = [
  { id: 'sparkles', label: 'Sparkles', glyph: '✨' }, { id: 'snow', label: 'Snowfall', glyph: '❄️' }, { id: 'hearts', label: 'Hearts', glyph: '💖' },
  { id: 'confetti', label: 'Confetti', glyph: '🎊' }, { id: 'bubbles', label: 'Bubbles', glyph: '🫧' },
] as const

/** Class for a nameplate background behind a list row ('' = none). */
export const nameplateClass = (id?: string | null) => (id && NAMEPLATES.some((n) => n.id === id) ? `np np-${id}` : '')
/** Class for a profile card frame ('' = none). */
export const frameClass = (id?: string | null) => (id && PROFILE_FRAMES.some((n) => n.id === id) ? `pf pf-${id}` : '')
