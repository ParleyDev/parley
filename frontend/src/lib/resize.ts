import { useCallback, useEffect, useRef, useState } from 'react'
import { STORAGE_PREFIX } from './brand'

/** The edge the handle sits on: 'left' for right-hand panels, 'right' for left-hand ones, 'bottom' for top panels. */
type Edge = 'left' | 'right' | 'bottom'

/**
 * A panel the user can drag at one edge: right-hand panels at their left edge, left-hand panels at their right edge,
 * top panels at their bottom edge. Persisted per key; clamped to [min, min(max, maxFraction × container size)].
 * Returns the size and the props for the handle element.
 */
function useResizable(edge: Edge, key: string, initial: number, min: number, maxFraction: number, max = Infinity) {
  const axis = edge === 'bottom' ? 'y' : 'x'
  const storageKey = `${STORAGE_PREFIX}panel.${key}`
  const [size, setSize] = useState<number>(() => { try { const v = Number(localStorage.getItem(storageKey)); return v >= min ? v : initial } catch { return initial } })
  const containerRef = useRef<HTMLElement | null>(null)
  const drag = useRef<{ start: number; startSize: number } | null>(null)
  const clamp = useCallback((w: number) => {
    const box = containerRef.current?.getBoundingClientRect()
    const maxW = Math.min(max, box ? Math.max(min, (axis === 'x' ? box.width : box.height) * maxFraction) : Infinity)
    return Math.round(Math.min(maxW, Math.max(min, w)))
  }, [axis, min, max, maxFraction])
  const save = (w: number) => { try { localStorage.setItem(storageKey, String(w)) } catch { /* ignore */ } }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return
      const pos = axis === 'x' ? e.clientX : e.clientY
      // Right-hand panels grow as the pointer moves left; left-hand and top panels as it moves right / down.
      setSize(clamp(drag.current.startSize + (edge === 'left' ? drag.current.start - pos : pos - drag.current.start)))
    }
    const up = () => { if (!drag.current) return; drag.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; setSize((w) => { save(w); return w }) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis, edge, clamp, storageKey])
  const cursor = axis === 'x' ? 'col-resize' : 'row-resize'
  const grow = edge === 'left' ? 'ArrowLeft' : edge === 'right' ? 'ArrowRight' : 'ArrowDown'
  const shrink = edge === 'left' ? 'ArrowRight' : edge === 'right' ? 'ArrowLeft' : 'ArrowUp'
  const handleProps = {
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); drag.current = { start: axis === 'x' ? e.clientX : e.clientY, startSize: size }; document.body.style.cursor = cursor; document.body.style.userSelect = 'none' },
    onDoubleClick: () => { setSize(initial); save(initial) },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === grow || e.key === shrink) { e.preventDefault(); const w = clamp(size + (e.key === grow ? 24 : -24)); setSize(w); save(w) } },
    role: 'separator' as const, 'aria-orientation': (axis === 'x' ? 'vertical' : 'horizontal') as 'vertical' | 'horizontal', 'aria-valuenow': size, tabIndex: 0, title: 'Drag to resize · double-click to reset',
    className: edge === 'left'
      ? 'absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-col-resize z-20 hover:bg-accent/40 active:bg-accent/60 phone:hidden'
      : edge === 'right'
        ? 'absolute right-0 top-0 bottom-0 w-2 -mr-1 cursor-col-resize z-30 hover:bg-accent/40 active:bg-accent/60 max-lg:hidden'
        : 'absolute left-0 right-0 bottom-0 h-2 -mb-1 cursor-row-resize z-20 hover:bg-accent/40 active:bg-accent/60 phone:hidden',
    'data-resize-handle': key,
  }
  return { size, setContainer: (el: HTMLElement | null) => { containerRef.current = el }, handleProps }
}

/** Width of a right-hand side panel dragged at its left edge. */
export function useResizablePanel(key: string, initial: number, min = 320, maxFraction = 0.7) {
  const r = useResizable('left', key, initial, min, maxFraction)
  return { width: r.size, setContainer: r.setContainer, handleProps: r.handleProps }
}

/** Height of a top panel dragged at its bottom edge. */
export function useResizableHeight(key: string, initial: number, min = 160, maxFraction = 0.8) {
  const r = useResizable('bottom', key, initial, min, maxFraction)
  return { height: r.size, setContainer: r.setContainer, handleProps: r.handleProps }
}

/** Width of the left channel/DM sidebar, dragged at its right edge (desktop only, where the handle shows). */
export function useResizableSidebar(key: string, initial: number, min: number, max: number) {
  const r = useResizable('right', key, initial, min, 1, max)
  return { width: r.size, handleProps: r.handleProps }
}
