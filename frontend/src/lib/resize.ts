import { useCallback, useEffect, useRef, useState } from 'react'
import { STORAGE_PREFIX } from './brand'

/**
 * Width of a right-hand side panel the user can drag at its left edge. Persisted per key; clamped to
 * [min, maxFraction × container width]. Returns the width and the props for the handle element.
 */
export function useResizablePanel(key: string, initial: number, min = 320, maxFraction = 0.7) {
  const storageKey = `${STORAGE_PREFIX}panel.${key}`
  const [width, setWidth] = useState<number>(() => { try { const v = Number(localStorage.getItem(storageKey)); return v >= min ? v : initial } catch { return initial } })
  const containerRef = useRef<HTMLElement | null>(null)
  const drag = useRef<{ startX: number; startW: number } | null>(null)
  const clamp = useCallback((w: number) => { const maxW = containerRef.current ? Math.max(min, containerRef.current.getBoundingClientRect().width * maxFraction) : Infinity; return Math.round(Math.min(maxW, Math.max(min, w))) }, [min, maxFraction])
  useEffect(() => {
    const move = (e: PointerEvent) => { if (!drag.current) return; setWidth(clamp(drag.current.startW + (drag.current.startX - e.clientX))) }
    const up = () => { if (!drag.current) return; drag.current = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; setWidth((w) => { try { localStorage.setItem(storageKey, String(w)) } catch { /* ignore */ } return w }) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [clamp, storageKey])
  const handleProps = {
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); drag.current = { startX: e.clientX, startW: width }; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none' },
    onDoubleClick: () => { setWidth(initial); try { localStorage.setItem(storageKey, String(initial)) } catch { /* ignore */ } },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const w = clamp(width + (e.key === 'ArrowLeft' ? 24 : -24)); setWidth(w); try { localStorage.setItem(storageKey, String(w)) } catch { /* ignore */ } } },
    role: 'separator' as const, 'aria-orientation': 'vertical' as const, 'aria-valuenow': width, tabIndex: 0, title: 'Drag to resize · double-click to reset',
    className: 'absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-col-resize z-20 hover:bg-accent/40 active:bg-accent/60 max-md:hidden',
    'data-resize-handle': key,
  }
  return { width, setContainer: (el: HTMLElement | null) => { containerRef.current = el }, handleProps }
}
