import { PROFILE_EFFECTS } from '../lib/cosmetics'

/** A profile effect: a few glyphs drifting over the card, falling or rising by kind (paused for reduced motion). */
export default function ProfileEffect({ id }: { id?: string | null }) {
  const fx = PROFILE_EFFECTS.find((e) => e.id === id)
  if (!fx) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden rounded-[inherit]" aria-hidden data-profile-effect={fx.id} data-effect-motion={fx.fall ? 'fall' : 'rise'}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`pe-bit absolute text-sm ${fx.fall ? 'pe-fall' : ''}`} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 0.7) % 5}s`, animationDuration: `${4 + (i % 4)}s`, fontSize: `${10 + (i % 3) * 4}px` }}>{fx.glyph}</span>
      ))}
    </div>
  )
}
