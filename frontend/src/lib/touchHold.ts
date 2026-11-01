import { haptic } from './native'

const HOLD_MS = 450
const editable = (el: EventTarget | null) => el instanceof Element && !!el.closest('input, textarea, select, [contenteditable="true"]')

/**
 * Touch long-press opens context menus app-wide, like a native app. iOS Safari never fires `contextmenu` (it selects
 * text or shows its link/image callout instead) and Android fires it late, after selecting text. A finger held still
 * on anything sends it a `contextmenu` of our own, so every `onContextMenu` handler works on phones as it does with a
 * right click; the browser's own one from a touch is dropped, and the click that ends the hold is swallowed. Elements
 * using `useLongPress` (messages, channels) handle the hold themselves and mark the event so this leaves them alone.
 */
export function installTouchHold() {
  if (typeof window === 'undefined') return
  let timer: number | undefined
  let start: { x: number; y: number } | null = null
  let lastTouch = 0
  let swallowUntil = 0
  const cancel = () => { window.clearTimeout(timer); start = null }

  window.addEventListener('pointerdown', (e) => {
    cancel()
    if (e.pointerType !== 'touch') return
    lastTouch = Date.now()
    if ((e as PointerEvent & { __parleyHold?: boolean }).__parleyHold || editable(e.target)) return
    const target = e.target as Element
    const at = { x: e.clientX, y: e.clientY }
    start = at
    timer = window.setTimeout(() => {
      start = null
      if (!target.isConnected) return
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: at.x, clientY: at.y, view: window })
      target.dispatchEvent(ev)
      // Only something with a menu takes the hold (it calls preventDefault); anywhere else nothing happens.
      if (!ev.defaultPrevented) return
      swallowUntil = Date.now() + 1000
      haptic('medium'); try { navigator.vibrate?.(10) } catch { /* ignore */ }
    }, HOLD_MS)
  })
  window.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel() })
  window.addEventListener('pointerup', cancel)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('scroll', cancel, { capture: true, passive: true })
  // The browser's own long-press menu (Android, and iOS in some web views): ours has already been sent.
  window.addEventListener('contextmenu', (e) => {
    if (e.isTrusted && Date.now() - lastTouch < 2000 && !editable(e.target)) { e.preventDefault(); e.stopPropagation() }
  }, true)
  window.addEventListener('click', (e) => {
    if (Date.now() < swallowUntil) { swallowUntil = 0; e.preventDefault(); e.stopPropagation() }
  }, true)
}
