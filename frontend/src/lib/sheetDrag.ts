import { useRef, type RefObject, type TouchEvent } from 'react'

/**
 * Swipe down to dismiss a phone sheet. A pull starts only when what's under the finger is scrolled to the top, so
 * scrolling the sheet's content works as usual; the sheet follows the finger down and, past a threshold or after a
 * quick flick, slides off and `onDismiss` runs. A short pull springs back. Spread the returned handlers on the sheet.
 */
export function useSwipeDismiss(sheet: RefObject<HTMLElement | null>, onDismiss: () => void) {
  const drag = useRef<{ x: number; y: number; t: number; dy: number; on: boolean } | null>(null)
  const scrolled = (target: EventTarget | null) => {
    for (let el = target as HTMLElement | null; el && el !== sheet.current?.parentElement; el = el.parentElement) {
      if (el.scrollTop > 0) return true
    }
    return false
  }
  const onTouchStart = (e: TouchEvent) => {
    const t = e.target as HTMLElement
    drag.current = e.touches.length === 1 && !scrolled(t) && !t.closest('input, textarea, [contenteditable="true"], [data-no-sheet-drag]')
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dy: 0, on: false } : null
  }
  const onTouchMove = (e: TouchEvent) => {
    const d = drag.current, el = sheet.current
    if (!d || !el) return
    const dx = e.touches[0].clientX - d.x, dy = e.touches[0].clientY - d.y
    // Decide once it's clearly a downward pull; sideways or upward is a scroll, and the sheet stays.
    if (!d.on) {
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return
      if (dy <= 0 || Math.abs(dx) > dy || scrolled(e.target)) { drag.current = null; return }
      d.on = true
    }
    d.dy = Math.max(0, dy)
    el.style.transition = 'none'
    el.style.transform = `translateY(${d.dy}px)`
  }
  const onTouchEnd = () => {
    const d = drag.current, el = sheet.current
    drag.current = null
    if (!d?.on || !el) return
    const fast = d.dy > 40 && d.dy / Math.max(1, Date.now() - d.t) > 0.5
    if (d.dy > 120 || fast) {
      el.style.transition = 'transform .2s ease-in'
      el.style.transform = 'translateY(100%)'
      window.setTimeout(onDismiss, 200)
    } else {
      el.style.transition = 'transform .2s ease-out'
      el.style.transform = ''
    }
  }
  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd }
}
