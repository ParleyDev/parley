import { useCallback, useEffect, useRef, useState } from 'react'
import { STORAGE_PREFIX } from './brand'

type Axis = 'x' | 'y'

/**
 * A panel the user can drag at one edge. Horizontal panels (axis 'x') hang on the right and are dragged at their
 * left edge; vertical panels (axis 'y') hang at the top and are dragged at their bottom edge. Persisted per key;
 * clamped to [min, maxFraction × container size]. Returns the size and the props for the handle element.
 */
function useResizable(axis: Axis, key: string, initial: number, min: number, maxFraction: number) {
  const storageKey = `${STORAGE_PREFIX}panel.${key}`
  const [size, setSize] = useState<number>(() => { try { const v = Number(localStorage.getItem(storageKey)); return v >= min ? v : initial } catch { return initial } })
  const containerRef = useRef<HTMLElement | null>(null)
  const drag = useRef<{ start: number; startSize: number } | null>(null)
  const clamp = useCallback((w: number) => {
    const box = containerRef.current?.getBoundingClientRect()
    const maxW = box ? Math.max(min, (axis === 'x' ? box.width : box.height) * maxFraction) : Infinity
    return Math.round(Math.min(maxW, Math.max(min, w)))
  }, [axis, min, maxFraction])
  const save = (w: number) => { try { localStorage.setItem(storageKey, String(w)) } catch { /* ignore */ } }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return
      const pos = axis === 'x' ? e.clientX : e.clientY
      // Right-hand panels grow as the pointer moves left; top panels grow as it moves down.
      setSize(clamp(drag.current.startSize + (axis === 'x' ? drag.current.start - pos : pos - drag.current.start)))
    }
    const up = () => { if (!drag.current) return; drag.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; setSize((w) => { save(w); return w }) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis, clamp, storageKey])
  const cursor = axis === 'x' ? 'col-resize' : 'row-resize'
  const grow = axis === 'x' ? 'ArrowLeft' : 'ArrowDown'
  const shrink = axis === 'x' ? 'ArrowRight' : 'ArrowUp'
  const handleProps = {
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); drag.current = { start: axis === 'x' ? e.clientX : e.clientY, startSize: size }; document.body.style.cursor = cursor; document.body.style.userSelect = 'none' },
    onDoubleClick: () => { setSize(initial); save(initial) },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === grow || e.key === shrink) { e.preventDefault(); const w = clamp(size + (e.key === grow ? 24 : -24)); setSize(w); save(w) } },
    role: 'separator' as const, 'aria-orientation': (axis === 'x' ? 'vertical' : 'horizontal') as 'vertical' | 'horizontal', 'aria-valuenow': size, tabIndex: 0, title: 'Drag to resize · double-click to reset',
    className: axis === 'x'
      ? 'absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-col-resize z-20 hover:bg-accent/40 active:bg-accent/60 max-md:hidden'
      : 'absolute left-0 right-0 bottom-0 h-2 -mb-1 cursor-row-resize z-20 hover:bg-accent/40 active:bg-accent/60 max-md:hidden',
    'data-resize-handle': key,
  }
  return { size, setContainer: (el: HTMLElement | null) => { containerRef.current = el }, handleProps }
}

/** Width of a right-hand side panel dragged at its left edge. */
export function useResizablePanel(key: string, initial: number, min = 320, maxFraction = 0.7) {
  const r = useResizable('x', key, initial, min, maxFraction)
  return { width: r.size, setContainer: r.setContainer, handleProps: r.handleProps }
}

/** Height of a top panel dragged at its bottom edge. */
export function useResizableHeight(key: string, initial: number, min = 160, maxFraction = 0.8) {
  const r = useResizable('y', key, initial, min, maxFraction)
  return { height: r.size, setContainer: r.setContainer, handleProps: r.handleProps }
}
