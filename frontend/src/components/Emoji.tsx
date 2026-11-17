import { customUrl, parseCustom } from '../lib/emoji'
import Twemoji from './Twemoji'

/**
 * Renders either a unicode emoji or a custom `<:name:id>` token as an inline image. Unicode emoji are Twemoji pictures
 * of `size`; `glyph` sets their size exactly instead (the picker's 32px, like Discord's).
 */
export default function Emoji({ value, className = '', size, glyph }: { value: string; className?: string; size?: number; glyph?: number }) {
  const c = parseCustom(value)
  if (c) {
    return <img src={customUrl(c.id)} alt={`:${c.name}:`} title={`:${c.name}:`} draggable={false} className={`emoji ${className}`} style={size ? { width: size, height: size } : undefined} data-custom-emoji={c.name} />
  }
  // Twemoji pictures (lib/twemoji): the same on every device, filling `size` (a glyph only filled about 85% of it).
  const px = glyph ?? size
  return <Twemoji emoji={value} className={`emoji ${className}`} style={px ? { width: px, height: px, verticalAlign: 'middle' } : undefined} />
}
