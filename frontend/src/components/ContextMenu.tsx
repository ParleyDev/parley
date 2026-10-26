import { ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; accent?: boolean; onClick?: () => void; children?: MenuItem[]; disabled?: boolean }
/** 'sep' draws a divider; a React node is rendered as-is (e.g. the quick-reaction row). */
export type MenuEntry = MenuItem | 'sep' | { node: ReactNode }

/** `above`: (x, y) is the bottom-left corner the menu should sit above (a button), instead of the top-left at a cursor. */
export interface MenuState { x: number; y: number; items: MenuEntry[]; above?: boolean }

/**
 * Right-click menu state: `open(e, items)` positions the menu at the cursor, `menu` is what to render.
 *   const ctx = useContextMenu(); <div onContextMenu={(e) => ctx.open(e, items)}>…</div>{ctx.menu && <ContextMenu {...ctx.menu} onClose={ctx.close} />}
 */
export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const open = (e: MouseEvent | { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuEntry[], opts: { above?: boolean } = {}) => {
    e.preventDefault?.(); e.stopPropagation?.()
    if (!items.length) return
    setMenu({ x: e.clientX, y: e.clientY, items, above: opts.above })
  }
  return { menu, open, close: () => setMenu(null) }
}

/** Discord-style context menu rendered in a portal at a viewport point, flipping to stay on screen. */
export default function ContextMenu({ x, y, items, above, onClose, label }: MenuState & { onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const left = x + r.width > window.innerWidth - 8 ? Math.max(8, x - r.width) : x
    const top = above ? Math.max(8, y - r.height) : y + r.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - r.height - 8) : y
    setPos({ left, top })
  }, [x, y, items, above])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <>
      <div className="fixed inset-0 z-[120]" onMouseDown={(e) => { e.stopPropagation(); onClose() }} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div ref={ref} role="menu" aria-label={label} data-context-menu className="pop fixed z-[130] min-w-[200px] max-w-[300px] rounded-md bg-[#111214] border border-white/5 shadow-2xl p-1.5" style={pos}
        onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        {items.map((it, i) => it === 'sep'
          ? <div key={i} className="my-1 h-px bg-white/10" />
          : 'node' in it ? <div key={i}>{it.node}</div>
          : <MenuRow key={i} item={it} onClose={onClose} />)}
      </div>
    </>,
    document.body,
  )
}

function MenuRow({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const subRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (open) { const r = subRef.current?.getBoundingClientRect(); if (r && r.right > window.innerWidth - 8) setFlip(true) } }, [open])
  const tone = item.disabled ? 'text-text-2/50 cursor-not-allowed' : item.danger ? 'text-[#f23f43] hover:bg-[#f23f43] hover:text-white' : item.accent ? 'text-accent hover:bg-accent hover:text-white' : 'text-[#dbdee1] hover:bg-accent hover:text-white'
  if (item.children) {
    return (
      <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`w-full flex items-center justify-between gap-3 rounded px-2 py-1.5 text-sm font-medium text-left ${tone}`} data-menu-item={item.label}>
          <span className="flex items-center gap-2">{item.icon}{item.label}</span><ChevronRight size={16} />
        </button>
        {open && (
          <div ref={subRef} role="menu" className={`pop absolute top-0 z-[140] min-w-[190px] rounded-md bg-[#111214] border border-white/5 shadow-2xl p-1.5 ${flip ? 'right-full mr-1' : 'left-full ml-1'}`}>
            {item.children.map((c, i) => <MenuRow key={i} item={c} onClose={onClose} />)}
          </div>
        )}
      </div>
    )
  }
  return (
    <button type="button" role="menuitem" disabled={item.disabled} onClick={() => { onClose(); item.onClick?.() }} className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-left ${tone}`} data-menu-item={item.label}>
      {item.icon}{item.label}
    </button>
  )
}
