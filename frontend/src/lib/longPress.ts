import { useRef, type PointerEvent } from 'react'
import { haptic } from './native'

/**
 * Touch long-press (iOS Safari never fires `contextmenu`, and Android's comes late and also selects text).
 * Spread `bind` on the element; call `fired()` in its click handler to swallow the click that ends a long-press.
 */
export function useLongPress(onLong: (at: { clientX: number; clientY: number }) => void, ms = 450) {
  const timer = useRef<number | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const didFire = useRef(false)
  const touch = useRef(false)
  const cancel = () => { window.clearTimeout(timer.current); start.current = null }
  return {
    /** True once after a long-press (and resets). */
    fired: () => { const f = didFire.current; didFire.current = false; return f },
    /** The last pointer on this element was a finger: leave `contextmenu` to the long-press. */
    isTouch: () => touch.current,
    bind: {
      onPointerDown: (e: PointerEvent) => {
        touch.current = e.pointerType === 'touch'
        if (!touch.current || (e.target as HTMLElement).closest('textarea, input')) return
        didFire.current = false
        const at = { clientX: e.clientX, clientY: e.clientY }
        start.current = { x: e.clientX, y: e.clientY }
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => { start.current = null; didFire.current = true; haptic('medium'); try { navigator.vibrate?.(10) } catch { /* ignore */ } onLong(at) }, ms)
      },
      onPointerMove: (e: PointerEvent) => { if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel() },
      onPointerUp: cancel,
      onPointerCancel: cancel,
    },
  }
}
