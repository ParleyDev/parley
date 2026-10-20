import { useEffect } from 'react'

/**
 * Horizontal swipe detection for phones: a quick, mostly horizontal touch of at least 70px.
 * Swipes that start on a horizontally scrollable element (image strips, tab bars) are ignored.
 */
export function useSwipe(handlers: { onLeft?: () => void; onRight?: () => void }, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    let start: { x: number; y: number; t: number; skip: boolean } | null = null
    const scrollsX = (el: Element | null): boolean => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 2) return true
      }
      return false
    }
    const onStart = (e: TouchEvent) => { const t = e.touches[0]; if (!t) return; start = { x: t.clientX, y: t.clientY, t: Date.now(), skip: scrollsX(e.target as Element) } }
    const onEnd = (e: TouchEvent) => {
      const s = start; start = null
      const t = e.changedTouches[0]
      if (!s || !t || s.skip || Date.now() - s.t > 600) return
      const dx = t.clientX - s.x, dy = t.clientY - s.y
      if (Math.abs(dx) < 70 || Math.abs(dy) > 50 || Math.abs(dy) > Math.abs(dx) * 0.6) return
      if (dx > 0) handlers.onRight?.(); else handlers.onLeft?.()
    }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    return () => { window.removeEventListener('touchstart', onStart); window.removeEventListener('touchend', onEnd) }
  }, [enabled, handlers])
}

/** Media query as React state (phones: max-width 767px). */
export const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
