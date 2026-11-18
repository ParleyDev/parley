import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type HTMLAttributes, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { STORAGE_PREFIX } from '../lib/brand'

type Pos = { x: number; y: number }
const key = (id: string) => `${STORAGE_PREFIX}window.${id}`
/**
 * Stacking among the open windows: the one last pressed is on top. Each sits at z-50 plus its place in that order, so
 * a handful of windows stay below menus and dialogs (z-70 and up).
 */
let order: string[] = []
const stackers = new Set<() => void>()
const restack = (next: string[]) => { order = next; stackers.forEach((f) => f()) }
function useStacking() {
  const me = useId()
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    stackers.add(f); restack([...order.filter((x) => x !== me), me])
    return () => { stackers.delete(f); restack(order.filter((x) => x !== me)) }
  }, [me])
  const at = order.indexOf(me)
  return { z: 50 + Math.max(0, Math.min(at, 15)), raise: () => { if (order[order.length - 1] !== me) restack([...order.filter((x) => x !== me), me]) } }
}
const clamp = (p: Pos, w: number, h: number): Pos => ({ x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - w - 8)), y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - Math.min(h, 120))) })

/**
 * A floating window like a plug-in's in a desktop DAW: dragged anywhere by its title bar, kept on screen, and opened
 * again where it was last left (per kind of window, in this browser). Solid in see-through themes (.pop). Several can
 * be open at once: pressing one brings it to the front, and `cascade` steps a new one down and left of the others.
 */
export default function FloatWindow({ id, title, icon, width: want = 320, cascade = 0, headerExtra, onClose, children, className = '', bodyClass = 'p-3', ...rest }: { id: string; title: ReactNode; icon?: ReactNode; width?: number; cascade?: number; headerExtra?: ReactNode; onClose: () => void; children: ReactNode; className?: string; bodyClass?: string } & Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children' | 'className'>) {
  const box = useRef<HTMLDivElement>(null)
  const width = Math.min(want, window.innerWidth - 16)
  const { z, raise } = useStacking()
  const [pos, setPos] = useState<Pos>(() => {
    try { const v = JSON.parse(localStorage.getItem(key(id)) ?? 'null') as Pos | null; if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return clamp(v, width, 200) } catch { /* default */ }
    return clamp({ x: window.innerWidth - width - 32 - cascade * 28, y: 140 + cascade * 28 }, width, 200)
  })
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const last = useRef(pos)
  last.current = pos
  useEffect(() => {
    const fit = () => setPos((p) => clamp(p, box.current?.offsetWidth ?? width, box.current?.offsetHeight ?? 200))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [width])
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, textarea, a')) return
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => { if (!drag.current) return; const p = clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, box.current?.offsetWidth ?? width, box.current?.offsetHeight ?? 200); last.current = p; setPos(p) }
  const up = () => { if (!drag.current) return; drag.current = null; try { localStorage.setItem(key(id), JSON.stringify(last.current)) } catch { /* ignore */ } }
  return (
    <div ref={box} role="dialog" aria-label={typeof title === 'string' ? title : undefined} className={`pop fixed flex max-h-[calc(100vh-16px)] flex-col overflow-hidden rounded-lg border border-line bg-bg-1 shadow-2xl ${className}`} style={{ left: pos.x, top: pos.y, width, zIndex: z }} onPointerDownCapture={raise} data-float-window={id} {...rest}>
      <div className="flex shrink-0 cursor-move select-none items-center gap-2 border-b border-line bg-bg-2 px-3 py-1.5 text-sm font-bold" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-float-window-handle>
        {icon}<span className="min-w-0 flex-1 truncate">{title}</span>
        {headerExtra}
        <button type="button" onClick={onClose} className="text-text-2 hover:text-text-0" aria-label="Close" data-float-window-close><X size={15} /></button>
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClass}`}>{children}</div>
    </div>
  )
}
