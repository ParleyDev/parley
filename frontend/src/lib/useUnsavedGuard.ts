import { useEffect, useRef, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'

/** Asks whether to leave; calls `proceed` to go on or `cancel` to stay. */
export type AskLeave = (proceed: () => void, cancel: () => void) => void

const historyIdx = (): number | null => {
  const s = window.history.state as { idx?: unknown } | null
  return s && typeof s.idx === 'number' ? s.idx : null
}

// The router listens for popstate on window too, and listeners on one target run in the order they were added. This
// one is added when the module loads (before the router mounts), so a Back press reaches the guard first and can
// keep the router from following it. It does nothing unless a guard is active.
let onPop: ((e: PopStateEvent) => void) | null = null
if (typeof window !== 'undefined') window.addEventListener('popstate', (e) => onPop?.(e), true)

/**
 * While `active` (there are unsaved changes), ask before the page is left: in-app links (clicks on same-origin
 * anchors outside `root`), the browser's Back and Forward buttons, and closing or reloading the tab. Nothing is pushed
 * onto the history; a Back press is taken back with history.go and handed to the router only once the member agrees.
 * Programmatic navigation started by the page itself is not intercepted (guard it where it starts).
 */
export function useUnsavedGuard(active: boolean, root: RefObject<HTMLElement | null>, ask: AskLeave): void {
  const navigate = useNavigate()
  const askRef = useRef(ask)
  askRef.current = ask

  useEffect(() => {
    if (!active) return
    let asking = false
    let ignoreNext = false
    let released = false
    const at = historyIdx()

    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }

    const click = (e: MouseEvent) => {
      if (released || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || root.current?.contains(a) || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      e.preventDefault(); e.stopPropagation()
      if (asking) return
      asking = true
      askRef.current(() => { asking = false; released = true; navigate(url.pathname + url.search + url.hash); useStore.getState().setMobilePane('content') }, () => { asking = false })
    }

    const pop = (e: PopStateEvent) => {
      if (released) return
      if (ignoreNext) { ignoreNext = false; e.stopImmediatePropagation(); return }
      const now = historyIdx()
      // Without an index in the history state assume Back, the usual case.
      const delta = at !== null && now !== null ? now - at : -1
      if (delta === 0) return
      e.stopImmediatePropagation()
      if (asking) return
      asking = true
      askRef.current(
        // The browser is already at the other entry: let the router follow it.
        () => { asking = false; released = true; window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })) },
        () => {
          asking = false
          const back = at !== null && historyIdx() !== null ? at - (historyIdx() as number) : -delta
          if (back !== 0) { ignoreNext = true; window.history.go(back) }
        },
      )
    }

    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)
    onPop = pop
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', click, true)
      if (onPop === pop) onPop = null
    }
  }, [active, root, navigate])
}
