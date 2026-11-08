import { sourceText, useT } from '../lib/i18n'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { useSwipeDismiss } from '../lib/sheetDrag'

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
const sheetMode = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px) and (pointer: coarse), (max-height: 500px) and (pointer: coarse)').matches

/** Discord-style context menu rendered in a portal at a viewport point, flipping to stay on screen. */
export default function ContextMenu({ x, y, items, above, onClose, label }: MenuState & { onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [sheet] = useState(sheetMode)
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
  if (sheet) return <MenuSheet items={items} onClose={onClose} label={label} />
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

type Block = { node: ReactNode } | MenuItem[]
/** The entries as Discord mobile lays them out: nodes (the quick reactions) on their own, the rest as cards of rows
 *  split where the menu has a divider. */
function blocks(items: MenuEntry[]): Block[] {
  const out: Block[] = []
  let card: MenuItem[] = []
  const flush = () => { if (card.length) out.push(card); card = [] }
  for (const it of items) {
    if (it === 'sep') flush()
    else if ('node' in it) { flush(); out.push(it) }
    else card.push(it)
  }
  flush()
  return out
}

/**
 * Touch phones: the menu as a bottom sheet, like Discord mobile's. Rows come in rounded cards, icons in one column;
 * a submenu opens as its own page with a way back. The sheet starts at most about half the screen (pull it up for
 * the rest), and closes with a swipe down, a tap outside, Escape or the Android back button.
 */
function MenuSheet({ items, onClose, label }: { items: MenuEntry[]; onClose: () => void; label?: string }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<MenuItem | null>(null)
  const [tall, setTall] = useState(false)
  const [closing, setClosing] = useState(false)
  const dismiss = useCallback(() => { setClosing(true); window.setTimeout(onClose, 200) }, [onClose])
  const swipe = useSwipeDismiss(ref, onClose)
  // The finger that long-pressed is still down when the sheet opens: its click (and Android's late contextmenu)
  // would hit whatever is now under it. Only clicks from a touch that began after the sheet opened count.
  const armed = useRef(false)
  const guard = { onPointerDownCapture: () => { armed.current = true }, onClickCapture: (e: MouseEvent) => { if (!armed.current) { e.preventDefault(); e.stopPropagation() } } }
  useEffect(() => {
    const onBack = (e: Event) => { e.preventDefault(); if (page) setPage(null); else dismiss() }
    window.addEventListener('parley:back', onBack)
    return () => window.removeEventListener('parley:back', onBack)
  }, [page, dismiss])
  // Pulling up a sheet with more in it than fits grows it to nearly the whole screen first.
  const startY = useRef<number | null>(null)
  const onTouchStart = (e: TouchEvent) => { startY.current = e.touches[0]?.clientY ?? null; swipe.onTouchStart(e) }
  const onTouchMove = (e: TouchEvent) => {
    const el = ref.current
    if (!tall && el && startY.current !== null && startY.current - e.touches[0].clientY > 12 && el.scrollHeight > el.clientHeight + 1) setTall(true)
    swipe.onTouchMove(e)
  }
  const row = (item: MenuItem, i: number, icons: boolean) => (
    <button key={i} type="button" role="menuitem" disabled={item.disabled} aria-haspopup={item.children ? 'menu' : undefined}
      onClick={() => { if (item.children) setPage(item); else { onClose(); item.onClick?.() } }}
      className={`flex min-h-[52px] w-full items-center gap-3.5 px-4 text-left text-[16px] font-medium active:bg-bg-4 ${item.disabled ? 'opacity-40' : item.danger ? 'text-[#f23f43]' : item.accent ? 'text-accent' : 'text-text-0'}`}
      data-menu-item={sourceText(item.label)}>
      {icons && <span className={`flex w-5 shrink-0 justify-center ${item.danger || item.accent ? '' : 'text-text-1'}`} aria-hidden>{item.icon}</span>}
      <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
      {item.children && <ChevronRight size={18} className="shrink-0 text-text-2" aria-hidden />}
    </button>
  )
  const card = (rows: MenuItem[], key: number | string) => (
    <div key={key} className="sheet-card divide-y divide-line overflow-hidden rounded-2xl" role="group">{rows.map((r, i) => row(r, i, rows.some((x) => x.icon)))}</div>
  )
  return createPortal(
    <div {...guard}>
      <div className={`fixed inset-0 z-[120] bg-black/50 transition-opacity duration-200 ${closing ? 'opacity-0' : ''}`} onClick={dismiss} onContextMenu={(e) => e.preventDefault()} data-menu-sheet-backdrop />
      <div ref={ref} role="menu" aria-label={label} data-context-menu data-menu-sheet data-closing={closing || undefined}
        className={`sheet-rise fixed inset-x-0 bottom-0 z-[130] overflow-y-auto overscroll-contain rounded-t-3xl bg-bg-1 px-3 pb-[max(16px,env(safe-area-inset-bottom))] shadow-2xl transition-[max-height] duration-300 ${tall ? 'max-h-[88dvh]' : 'max-h-[55dvh]'}`}
        onContextMenu={(e) => e.preventDefault()} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={swipe.onTouchEnd} onTouchCancel={swipe.onTouchCancel}>
        <div className="sticky top-0 z-10 -mx-3 bg-bg-1 px-3 pb-2 pt-2.5">
          <div className="mx-auto h-1 w-10 rounded-full bg-text-2/40" aria-hidden data-sheet-handle />
        </div>
        {page ? (
          <div className="flex flex-col gap-3" data-menu-page={sourceText(page.label)}>
            <button type="button" onClick={() => setPage(null)} className="flex items-center gap-1 self-start rounded-lg py-1 pr-2 text-[15px] font-semibold text-text-1 active:text-text-0" data-menu-back>
              <ChevronLeft size={20} />{t(page.label)}
            </button>
            {card(page.children ?? [], 'page')}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {blocks(items).map((b, i) => Array.isArray(b) ? card(b, i) : <div key={i} className="sheet-node">{b.node}</div>)}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function MenuRow({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const subRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (open) { const r = subRef.current?.getBoundingClientRect(); if (r && r.right > window.innerWidth - 8) setFlip(true) } }, [open])
  const tone = item.disabled ? 'text-text-2/50 cursor-not-allowed' : item.danger ? 'text-[#f23f43] hover:bg-[#f23f43] hover:text-white' : item.accent ? 'text-accent hover:bg-accent hover:text-white' : 'text-[#dbdee1] hover:bg-accent hover:text-white'
  if (item.children) {
    return (
      <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`w-full flex items-center justify-between gap-3 rounded px-2 py-1.5 text-sm font-medium text-left ${tone}`} data-menu-item={sourceText(item.label)}>
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
    <button type="button" role="menuitem" disabled={item.disabled} onClick={() => { onClose(); item.onClick?.() }} className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm font-medium text-left ${tone}`} data-menu-item={sourceText(item.label)}>
      {item.icon}{t(item.label)}
    </button>
  )
}
