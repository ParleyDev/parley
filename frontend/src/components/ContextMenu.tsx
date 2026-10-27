import { useT } from '../lib/i18n'
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

/** Touch phones get menus as a bottom sheet (Discord mobile's long-press sheet) instead of a cursor popup. */
const sheetMode = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches

/** Discord-style context menu rendered in a portal at a viewport point, flipping to stay on screen. */
export default function ContextMenu({ x, y, items, above, onClose, label }: MenuState & { onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [sheet] = useState(sheetMode)
  // The finger that long-pressed is still down when the sheet opens: its click (and Android's late contextmenu)
  // would hit whatever is now under it. Only clicks from a touch that began after the sheet opened count.
  const armed = useRef(false)
  const guard = { onPointerDownCapture: () => { armed.current = true }, onClickCapture: (e: MouseEvent) => { if (!armed.current) { e.preventDefault(); e.stopPropagation() } } }
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || sheet) return
    const left = x + r.width > window.innerWidth - 8 ? Math.max(8, x - r.width) : x
    const top = above ? Math.max(8, y - r.height) : y + r.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - r.height - 8) : y
    setPos({ left, top })
  }, [x, y, items, above, sheet])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  if (sheet) return createPortal(
    <div {...guard}>
      <div className="fixed inset-0 z-[120] bg-black/50" onClick={onClose} onContextMenu={(e) => e.preventDefault()} data-menu-sheet-backdrop />
      <div ref={ref} role="menu" aria-label={label} data-context-menu data-menu-sheet className="pop fixed inset-x-0 bottom-0 z-[130] max-h-[75vh] overflow-y-auto rounded-t-2xl bg-[#111214] border-t border-white/5 shadow-2xl px-2 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] sheet-up"
        onContextMenu={(e) => e.preventDefault()}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20" aria-hidden />
        {items.map((it, i) => it === 'sep'
          ? <div key={i} className="my-1 h-px bg-white/10" />
          : 'node' in it ? <div key={i} className="px-1 py-1">{it.node}</div>
          : <MenuRow key={i} item={it} onClose={onClose} sheet />)}
      </div>
    </div>,
    document.body,
  )
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

function MenuRow({ item, onClose, sheet }: { item: MenuItem; onClose: () => void; sheet?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const subRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (open) { const r = subRef.current?.getBoundingClientRect(); if (r && r.right > window.innerWidth - 8) setFlip(true) } }, [open])
  const tone = item.disabled ? 'text-text-2/50 cursor-not-allowed' : item.danger ? 'text-[#f23f43] hover:bg-[#f23f43] hover:text-white' : item.accent ? 'text-accent hover:bg-accent hover:text-white' : 'text-[#dbdee1] hover:bg-accent hover:text-white'
  const size = sheet ? 'px-3 py-3 text-[15px]' : 'px-2 py-1.5 text-sm'
  if (item.children && sheet) {
    // No room for flyouts: submenus open in place.
    return (
      <div>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`w-full flex items-center justify-between gap-3 rounded-lg ${size} font-medium text-left ${tone}`} data-menu-item={item.label}>
          <span className="flex items-center gap-3">{item.icon}{t(item.label)}</span><ChevronRight size={16} className={open ? 'rotate-90' : ''} />
        </button>
        {open && <div role="menu" className="ml-4 border-l border-white/10 pl-1">{item.children.map((c, i) => <MenuRow key={i} item={c} onClose={onClose} sheet />)}</div>}
      </div>
    )
  }
  if (item.children) {
    return (
      <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`w-full flex items-center justify-between gap-3 rounded px-2 py-1.5 text-sm font-medium text-left ${tone}`} data-menu-item={item.label}>
          <span className="flex items-center gap-2">{item.icon}{t(item.label)}</span><ChevronRight size={16} />
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
    <button type="button" role="menuitem" disabled={item.disabled} onClick={() => { onClose(); item.onClick?.() }} className={`w-full flex items-center ${sheet ? 'gap-3 rounded-lg' : 'gap-2 rounded'} ${size} font-medium text-left ${tone}`} data-menu-item={item.label}>
      {item.icon}{t(item.label)}
    </button>
  )
}
