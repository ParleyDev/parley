import { useEffect, useRef, type RefObject } from 'react'
import { dismissKeyboard, tapFeedback } from './native'

type Pane = 'nav' | 'content'
interface Opts {
  enabled: boolean
  pane: Pane
  onPane: (p: Pane) => void
  /** A left swipe on the chat that isn't a message's own (the member list). */
  onLeft?: () => void
  /** Overrides the drag: a right swipe just calls this (closing the member list). */
  onRightInstead?: () => void
}

/** Started on something that scrolls sideways (image strips, tab bars), or in a field: not ours. */
function skipTarget(el: Element | null): boolean {
  if (!el) return true
  if (el.closest('input, textarea, select, [contenteditable="true"], [data-no-swipe], [role="slider"], input[type="range"]')) return true
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n)
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 2) return true
  }
  return false
}

/**
 * Phones: drag between the navigation pane and the content, like Discord. A right swipe on the content slides it
 * off with the finger, revealing the server/channel list that stays put underneath (a peek before committing); a
 * left swipe on the list slides the content back over it. Let go past a third of the way (or flick) to finish, otherwise it springs back. The container gets
 * `data-pane-drag` and `--pane-p` (0 = content, 1 = navigation) while a finger or the settle animation moves it;
 * index.css shows `[data-layer="md"]` and moves `[data-pane-content]` from those. Messages mark their own left swipes
 * (reply) with `__parleySwipe`, which this leaves alone.
 */
export function usePaneDrag(ref: RefObject<HTMLElement | null>, opts: Opts) {
  const o = useRef(opts)
  o.current = opts
  useEffect(() => {
    if (!opts.enabled) return
    let s: { x: number; y: number; t: number; msg: boolean } | null = null
    let mode: 'none' | 'drag' | 'left' | 'right' | 'off' = 'none'
    let from = 0, p = 0, w = 1
    let last: { x: number; t: number }[] = []
    let ticked = false
    const box = () => ref.current
    const set = (v: number) => { p = Math.max(0, Math.min(1, v)); box()?.style.setProperty('--pane-p', String(p)) }
    const clear = () => { const el = box(); if (!el) return; delete el.dataset.paneDrag; delete el.dataset.paneAnim; el.style.removeProperty('--pane-p') }

    const start = (e: TouchEvent) => {
      s = null; mode = 'none'
      const el = box(), tch = e.touches[0]
      const target = e.target as Element
      // Only on the panes themselves: not dialogs, sheets or menus that happen to render inside the container.
      const onPane = target.closest?.('[data-pane-content], [data-layer="md"]')
      if (e.touches.length !== 1 || !el || !tch || el.dataset.paneAnim || !onPane || onPane.parentElement !== el
        || target.closest('[aria-modal], [role="dialog"], [role="menu"], [data-menu-sheet], .pop') || skipTarget(target)) return
      s = { x: tch.clientX, y: tch.clientY, t: Date.now(), msg: !!(e as TouchEvent & { __parleySwipe?: boolean }).__parleySwipe }
      last = [{ x: tch.clientX, t: s.t }]
    }
    const move = (e: TouchEvent) => {
      const tch = e.touches[0]
      if (!s || !tch || mode === 'off') return
      const dx = tch.clientX - s.x, dy = tch.clientY - s.y
      if (mode === 'none') {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        if (Math.abs(dx) < Math.abs(dy) * 1.2) { mode = 'off'; return }
        const { pane, onRightInstead } = o.current
        if (dx > 0 && onRightInstead) mode = 'right'
        else if (dx > 0 && pane === 'content') mode = 'drag'
        else if (dx < 0 && pane === 'nav') mode = 'drag'
        else if (dx < 0 && pane === 'content' && !s.msg) mode = 'left'
        else { mode = 'off'; return }
        if (mode === 'drag') {
          const el = box()!
          w = el.getBoundingClientRect().width || window.innerWidth
          from = pane === 'nav' ? 1 : 0; ticked = false
          el.dataset.paneDrag = ''; set(from)
          // Peeking at the list puts the keyboard away, like leaving the chat.
          if (pane === 'content') dismissKeyboard()
        }
      }
      if (mode !== 'drag') return
      if (e.cancelable) e.preventDefault()
      set(from + dx / w)
      const done = from === 0 ? p > 0.35 : p < 0.65
      if (done && !ticked) { ticked = true; tapFeedback() } else if (!done) ticked = false
      last.push({ x: tch.clientX, t: Date.now() }); if (last.length > 5) last.shift()
    }
    const end = (e: TouchEvent) => {
      const st = s; s = null
      const m = mode; mode = 'none'
      if (!st) return
      const tch = e.changedTouches[0]
      const dx = tch ? tch.clientX - st.x : 0
      if (m === 'left' || m === 'right') { if (Math.abs(dx) >= 60) (m === 'left' ? o.current.onLeft : o.current.onRightInstead)?.(); return }
      if (m !== 'drag') return
      const a = last[0], b = last[last.length - 1]
      const v = a && b && b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0   // px/ms, + to the right
      const toNav = from === 0 ? p > 0.35 || v > 0.45 : !(p < 0.65 || v < -0.45)
      const el = box()
      if (!el) return
      el.dataset.paneAnim = ''
      set(toNav ? 1 : 0)
      window.setTimeout(() => {
        const target: Pane = toNav ? 'nav' : 'content'
        if (target !== o.current.pane) o.current.onPane(target)
        // The pane class takes over on the next paint: then drop the drag styles.
        requestAnimationFrame(() => requestAnimationFrame(clear))
      }, 210)
    }
    window.addEventListener('touchstart', start, { passive: true })
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('touchend', end, { passive: true })
    window.addEventListener('touchcancel', end, { passive: true })
    return () => {
      window.removeEventListener('touchstart', start); window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', end); window.removeEventListener('touchcancel', end)
      clear()
    }
  }, [opts.enabled, ref])
}

/**
 * Phones: swipe right on a full-screen page to go back (iOS's back gesture). The page follows the finger; past a
 * third of the way (or a flick) it slides off and `onBack` runs, otherwise it springs back.
 */
export function useSwipeBack(ref: RefObject<HTMLElement | null>, enabled: boolean, onBack: () => void) {
  const back = useRef(onBack)
  back.current = onBack
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    let s: { x: number; y: number } | null = null
    let mode: 'none' | 'drag' = 'none'
    let dx = 0, w = 1
    let last: { x: number; t: number }[] = []
    const put = (x: number, anim: boolean) => { el.style.transition = anim ? 'transform .2s cubic-bezier(.2,.8,.2,1)' : ''; el.style.transform = x ? `translate3d(${x}px,0,0)` : '' }
    const start = (e: TouchEvent) => {
      s = null; mode = 'none'
      const t = e.touches[0]
      if (e.touches.length !== 1 || !t || skipTarget(e.target as Element)) return
      s = { x: t.clientX, y: t.clientY }; last = [{ x: t.clientX, t: Date.now() }]
    }
    const move = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!s || !t) return
      const ddx = t.clientX - s.x, ddy = t.clientY - s.y
      if (mode === 'none') {
        if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return
        if (ddx > 0 && ddx > Math.abs(ddy) * 1.2) { mode = 'drag'; w = el.getBoundingClientRect().width || window.innerWidth } else { s = null; return }
      }
      if (e.cancelable) e.preventDefault()
      dx = Math.max(0, ddx); put(dx, false)
      last.push({ x: t.clientX, t: Date.now() }); if (last.length > 5) last.shift()
    }
    const end = () => {
      if (mode === 'drag') {
        const a = last[0], b = last[last.length - 1]
        const v = a && b && b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0
        if (dx > w * 0.35 || v > 0.45) { put(w, true); window.setTimeout(() => { put(0, false); back.current() }, 200) } else put(0, true)
      }
      s = null; mode = 'none'
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end, { passive: true })
    el.addEventListener('touchcancel', end, { passive: true })
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end); put(0, false) }
  }, [enabled, ref])
}
