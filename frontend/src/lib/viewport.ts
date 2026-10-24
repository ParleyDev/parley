/**
 * Keep the app the size of what is actually visible. Phone browsers (and the app's WebView) leave the page at full
 * height when the on-screen keyboard opens and scroll it up to reveal the text box, which pushes the header (which
 * DM or channel you are in) off the top. Instead the app follows the visual viewport: when the keyboard opens the
 * app shrinks to the space above it, the browser's scroll is undone, and the messages area takes the difference.
 *
 * Sets --app-height (read by #root) and data-keyboard="open" on <html> while the keyboard is up, which also drops
 * the bottom safe-area padding there is no point keeping above a keyboard. Pinch zoom is left alone.
 */

let started = false

export function initViewport() {
  if (started || typeof window === 'undefined' || !window.visualViewport) return
  started = true
  const vv = window.visualViewport
  const root = document.documentElement
  const sync = () => {
    if (vv.scale > 1.01) return // the user is zoomed in: don't fight it
    root.style.setProperty('--app-height', `${Math.round(vv.height)}px`)
    // A keyboard (or similar) takes more than a toolbar's worth of the window's height.
    if (window.innerHeight - vv.height > 120) root.dataset.keyboard = 'open'
    else delete root.dataset.keyboard
    // iOS scrolls the whole page to keep the caret in view; the app already fits, so put it back at the top.
    if (window.scrollY !== 0 || vv.offsetTop !== 0) window.scrollTo(0, 0)
  }
  vv.addEventListener('resize', sync)
  vv.addEventListener('scroll', sync)
  sync()
}
