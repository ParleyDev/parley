/**
 * Floating UI (tooltips, menus, popovers, dropdowns) is placed next to whatever opened it, which near a window edge
 * puts part of it outside the window, where the desktop app (and a browser) simply cuts it off. Whenever one appears,
 * this nudges it back inside with the CSS `translate` property, which leaves its own transform and open animation
 * alone. Elements that position themselves (context menus) are already inside, so nothing moves.
 */
const SELECTOR = '.pop, [role="tooltip"], [role="menu"], [data-context-menu], [data-keep-in-view]'
const MARGIN = 8

function fit(el: HTMLElement) {
  el.style.translate = ''
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return
  const W = window.innerWidth, H = window.innerHeight
  let dx = 0, dy = 0
  // Only what actually crosses an edge moves (sheets docked flush to the bottom stay put), and then a little clear.
  if (r.right > W + 0.5) dx = Math.min(0, W - MARGIN - r.right)
  if (r.left + dx < -0.5) dx = MARGIN - r.left
  if (r.bottom > H + 0.5) dy = Math.min(0, H - MARGIN - r.bottom)
  if (r.top + dy < -0.5) dy = MARGIN - r.top
  if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`
}

function check(node: Node) {
  if (!(node instanceof HTMLElement)) return
  const found = node.matches(SELECTOR) ? [node] : []
  found.push(...node.querySelectorAll<HTMLElement>(SELECTOR))
  // After layout, again once the open animation has settled, and whenever it changes size (a list loading in).
  if (found.length) requestAnimationFrame(() => { found.forEach((el) => { fit(el); resized?.observe(el) }); setTimeout(() => found.forEach(fit), 160) })
}

const resized = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver((entries) => { for (const e of entries) { const el = e.target as HTMLElement; if (el.isConnected) fit(el); else resized?.unobserve(el) } })
  : null

export function installKeepInView() {
  if (typeof MutationObserver === 'undefined') return
  new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach(check) }).observe(document.body, { childList: true, subtree: true })
}
