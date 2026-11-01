import type { TypingAnimation, TypingIndicator } from '../lib/types'
import Emoji from './Emoji'

export const TYPING_ANIMATIONS: TypingAnimation[] = ['wave', 'bounce', 'pulse', 'spin', 'jiggle', 'none']

/** Picks for Surprise Me: emoji that read well small, and a few things to be doing instead of typing. */
const SURPRISE_EMOJI = ['🤍', '🌱', '✨', '🔥', '🎵', '🎸', '🥁', '🎹', '💭', '💬', '☕', '🍕', '🌮', '🐢', '🐙', '🦊', '🐸', '🌙', '⭐', '🌈', '🍀', '🌸', '🍩', '🧠', '👀', '🫧', '🪐', '⚡', '🎲', '🧃']
const surpriseText = (t: (k: string) => string) => [t('is babbling…'), t('is cooking…'), t('is plotting…'), t('is thinking hard…'), t('is spilling the tea…'), t('is composing a masterpiece…'), t('is choosing words…'), t('is on a roll…')]

/** The emoji (three dots when none are chosen) moving the way the typist picked. */
export function TypingGlyphs({ style, size = 14 }: { style?: TypingIndicator; size?: number }) {
  const emojis = (style?.emojis ?? []).filter(Boolean)
  const anim = style?.animation ?? 'wave'
  if (!emojis.length) {
    return <span className={`flex gap-0.5 typing-anim-${anim}`} data-typing-glyphs="dots">{[0, 1, 2].map((i) => <i key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-text-1 inline-block" />)}</span>
  }
  return (
    <span className={`flex items-center gap-0.5 typing-anim-${anim}`} data-typing-glyphs={anim}>
      {emojis.map((e, i) => <span key={i} className="typing-dot inline-flex leading-none" data-typing-emoji={e}><Emoji value={e} size={size} /></span>)}
    </span>
  )
}

/** A fresh indicator from the Surprise Me picks. */
export function surprise(t: (k: string) => string): Required<TypingIndicator> {
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
  return { emojis: [pick(SURPRISE_EMOJI), pick(SURPRISE_EMOJI), pick(SURPRISE_EMOJI)], animation: pick(TYPING_ANIMATIONS.filter((a) => a !== 'none')), text: pick(surpriseText(t)) }
}
