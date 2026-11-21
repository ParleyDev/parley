import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One click and a double click on the same thing, without the double click also firing the single one twice: the
 * single action waits a moment to see whether a second click follows.
 */
export function useClickOrDouble(delay = 220) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const click = useCallback((single: () => void) => {
    if (timer.current) return // the second click of a double click
    timer.current = setTimeout(() => { timer.current = null; single() }, delay)
  }, [delay])
  const double = useCallback((action: () => void) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    action()
  }, [])
  return { click, double }
}

/** How long the call's controls stay after the pointer last moved in fullscreen. */
export const CHROME_IDLE_MS = 2500

/**
 * Fullscreen for a whole call (its stage and its controls, not one tile). The page itself goes fullscreen and the call
 * view covers it (the caller styles the element `ref` is on while `on`), so everything drawn over the app keeps
 * working there: menus, notices, an incoming call, settings. While it is on, `idle` turns true once the pointer has
 * rested, so the controls can step aside; they return on any pointer movement or key, and never leave while one of
 * their menus is open. Escape, the browser's own way out, ends it like the button does.
 */
export function useCallFullscreen<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const mine = useRef(false)
  const [on, setOn] = useState(false)
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    const sync = () => { if (!document.fullscreenElement) mine.current = false; setOn(mine.current && !!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', sync)
    // Leaving the page that asked for it (another channel, the call ending) leaves fullscreen too.
    return () => { document.removeEventListener('fullscreenchange', sync); if (mine.current && document.fullscreenElement) document.exitFullscreen().catch(() => {}) }
  }, [])
  useEffect(() => {
    if (!on) { setIdle(false); return }
    const el = ref.current
    let timer: ReturnType<typeof setTimeout>
    const rest = () => {
      // A menu opened from the controls keeps them (and itself) in view.
      if (document.querySelector('[data-call-menu], [data-soundboard], [data-context-menu]')) { timer = setTimeout(rest, CHROME_IDLE_MS); return }
      setIdle(true)
    }
    const wake = () => { setIdle(false); clearTimeout(timer); timer = setTimeout(rest, CHROME_IDLE_MS) }
    wake()
    el?.addEventListener('mousemove', wake); el?.addEventListener('mousedown', wake); window.addEventListener('keydown', wake)
    return () => { clearTimeout(timer); el?.removeEventListener('mousemove', wake); el?.removeEventListener('mousedown', wake); window.removeEventListener('keydown', wake) }
  }, [on])
  const toggle = useCallback(() => {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return }
    mine.current = true
    document.documentElement.requestFullscreen?.().catch(() => { mine.current = false })
  }, [])
  const exit = useCallback(() => { if (mine.current && document.fullscreenElement) document.exitFullscreen().catch(() => {}) }, [])
  return { ref, on, idle, toggle, exit }
}

/** The size of an element's content box, kept current; null until it is measured. */
export function useBoxSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => { const cs = getComputedStyle(el); setSize({ w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) }) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return { setEl, size }
}
