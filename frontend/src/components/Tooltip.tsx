import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { canHover } from './GuildBar'

/** Hover tooltip rendered in a portal (so it never affects layout), shown below the wrapped element. */
export default function Tooltip({ tip, children, className = '' }: { tip: string; children: ReactNode; className?: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  return (
    <span className={`relative inline-flex ${className}`} onMouseEnter={(e) => { if (canHover()) setRect(e.currentTarget.getBoundingClientRect()) }} onMouseLeave={() => setRect(null)} onTouchStart={() => setRect(null)} data-tip={tip}>
      {children}
      {rect && createPortal(
        <span role="tooltip" className="pointer-events-none fixed z-[150] whitespace-nowrap rounded-lg bg-bg-0 border border-line px-3 py-1.5 text-sm font-semibold text-text-0 shadow-xl pop" style={{ left: rect.left + rect.width / 2, top: rect.bottom + 8, transform: 'translateX(-50%)' }}>{tip}</span>,
        document.body,
      )}
    </span>
  )
}
