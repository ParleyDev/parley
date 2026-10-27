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
  // `fall`: drifts down from the top (snow, confetti); otherwise floats up from the bottom (hearts, bubbles).
  { id: 'sparkles', label: 'Sparkles', glyph: '✨', fall: true }, { id: 'snow', label: 'Snowfall', glyph: '❄️', fall: true }, { id: 'hearts', label: 'Hearts', glyph: '💖', fall: false },
  { id: 'confetti', label: 'Confetti', glyph: '🎊', fall: true }, { id: 'bubbles', label: 'Bubbles', glyph: '🫧', fall: false },
] as const

/** Class for a nameplate background behind a list row ('' = none). */
export const nameplateClass = (id?: string | null) => (id && NAMEPLATES.some((n) => n.id === id) ? `np np-${id}` : '')
/** Class for a profile card frame ('' = none). */
export const frameClass = (id?: string | null) => (id && PROFILE_FRAMES.some((n) => n.id === id) ? `pf pf-${id}` : '')
