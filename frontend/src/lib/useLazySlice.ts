import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Long lists drawn a screenful at a time: the first `step` items, then `step` more whenever the sentinel (an element
 * after the last one) comes within `margin` of the scroll box. Starts over when `key` changes (a new search); `atLeast` keeps that many drawn (the picked one, scrolled to).
 */
export function useLazySlice<T>(items: readonly T[], { step = 48, key, root, margin = '600px', atLeast = 0 }: { step?: number; key?: unknown; root?: RefObject<HTMLElement | null>; margin?: string; atLeast?: number } = {}) {
  const [drawn, setCount] = useState(step)
  const count = Math.max(drawn, atLeast)
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => { setCount(step) }, [key, step])
  const more = count < items.length
  useEffect(() => {
    const el = sentinel.current
    if (!el || !more) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setCount(count + step) }, { root: root?.current ?? null, rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [more, step, root, margin, count])
  return { visible: items.slice(0, count), more, sentinel }
}
