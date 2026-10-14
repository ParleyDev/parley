import { customUrl, parseCustom } from '../lib/emoji'

/** Renders either a unicode emoji or a custom `<:name:id>` token as an inline image. */
export default function Emoji({ value, className = '', size }: { value: string; className?: string; size?: number }) {
  const c = parseCustom(value)
  if (c) {
    return <img src={customUrl(c.id)} alt={`:${c.name}:`} title={`:${c.name}:`} draggable={false} className={`emoji ${className}`} style={size ? { width: size, height: size } : undefined} data-custom-emoji={c.name} />
  }
  return <span className={className} style={size ? { fontSize: size * 0.85, lineHeight: `${size}px` } : undefined}>{value}</span>
}
