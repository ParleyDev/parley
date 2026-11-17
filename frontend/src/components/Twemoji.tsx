import { useState, type CSSProperties } from 'react'
import { twemojiFile, twemojiSrc } from '../lib/twemoji'

/**
 * A unicode emoji as its Twemoji picture (lib/twemoji). The alt text is the emoji itself, so copying a message keeps it.
 * If there is no picture (something newer than the set, or an odd sequence) it tries the file's other spelling, then
 * falls back to the device's own glyph.
 */
export default function Twemoji({ emoji, className = 'emoji', style, title, ...data }: { emoji: string; className?: string; style?: CSSProperties; title?: string } & { [k: `data-${string}`]: string | undefined }) {
  const [tries, setTries] = useState(0)
  if (tries > 1) return <span className={className.replace(/\bemoji\b/, 'emoji-text')} style={style} title={title} {...data}>{emoji}</span>
  return <img src={twemojiSrc(emoji, tries === 1)} alt={emoji} title={title} draggable={false} loading="lazy" decoding="async" className={className} style={style} onError={() => setTries((n) => (n === 0 && twemojiFile(emoji, true) !== twemojiFile(emoji) ? 1 : 2))} {...data} />
}
