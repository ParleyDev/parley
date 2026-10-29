import { customUrl, parseCustom } from '../lib/emoji'

/**
 * Renders either a unicode emoji or a custom `<:name:id>` token as an inline image. Unicode emoji are drawn a little
 * smaller than `size` to sit with text; `glyph` sets their font size exactly (the picker's 32px, like Discord's).
 */
export default function Emoji({ value, className = '', size, glyph }: { value: string; className?: string; size?: number; glyph?: number }) {
  const c = parseCustom(value)
  if (c) {
    return <img src={customUrl(c.id)} alt={`:${c.name}:`} title={`:${c.name}:`} draggable={false} className={`emoji ${className}`} style={size ? { width: size, height: size } : undefined} data-custom-emoji={c.name} />
  }
  return <span className={className} style={glyph ? { fontSize: glyph, lineHeight: `${size ?? glyph}px` } : size ? { fontSize: size * 0.85, lineHeight: `${size}px` } : undefined}>{value}</span>
}
