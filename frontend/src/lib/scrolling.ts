/**
 * Scrollbars only show while the pointer is over their area (index.css: `.hovering`, set here because Chromium doesn't
 * repaint a custom scrollbar when only :hover changes) — and, like Discord, while the reader is
 * scrolling it some other way (keyboard, touchpad flick, touch): the scrolled box gets `.scrolling` for a second
 * after each scroll the reader caused. Scrolls the app makes itself (following new messages, restoring a position)
 * don't count, so a thumb doesn't flash every time a message arrives.
 */
let lastInput = 0
const INPUT_WINDOW = 400
const SHOW_FOR = 1000
const timers = new WeakMap<Element, number>()

const scrollable = (el: Element) => { const o = getComputedStyle(el); return /(auto|scroll)/.test(o.overflowY + o.overflowX) }
let hovered: Element[] = []

export function installScrollingClass() {
  // Every scroll box under the pointer (the pointer's target and its ancestors) is `.hovering`.
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return
    const now: Element[] = []
    for (let el = e.target instanceof Element ? e.target : null; el && el !== document.documentElement; el = el.parentElement) if (scrollable(el)) now.push(el)
    for (const el of hovered) if (!now.includes(el)) el.classList.remove('hovering')
    for (const el of now) el.classList.add('hovering')
    hovered = now
  }, { passive: true })
  document.documentElement.addEventListener('pointerleave', () => { hovered.forEach((el) => el.classList.remove('hovering')); hovered = [] })

  const mark = () => { lastInput = performance.now() }
  for (const ev of ['wheel', 'touchmove', 'pointerdown'] as const) window.addEventListener(ev, mark, { capture: true, passive: true })
  // Keys that scroll (not typing: sending a message scrolls the chat, and that isn't the reader scrolling).
  const keys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])
  window.addEventListener('keydown', (e) => { if (keys.has(e.key) && !(e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable="true"]'))) mark() }, { capture: true, passive: true })
  document.addEventListener('scroll', (e) => {
    const el = e.target
    if (!(el instanceof Element) || performance.now() - lastInput > INPUT_WINDOW) return
    lastInput = performance.now()
    el.classList.add('scrolling')
    clearTimeout(timers.get(el))
    timers.set(el, window.setTimeout(() => el.classList.remove('scrolling'), SHOW_FOR))
  }, { capture: true, passive: true })
}
