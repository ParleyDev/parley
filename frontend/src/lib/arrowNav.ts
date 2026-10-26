/**
 * Arrow-key navigation through lists: servers, channels and DMs, members, messages (Up/Down, Home/End) and the emoji
 * grid (all four arrows). Focus moves between items of the list the focused element belongs to.
 */
const LISTS: { item: string; grid?: boolean }[] = [
  { item: '[data-guild-bar] a[href]' },
  { item: '[data-channel-item] > a[href], aside a[data-dm-row][href], aside a[data-group-row][href]' },
  { item: '[data-member-row]' },
  { item: '[data-message-list] [data-msg-id]' },
  { item: '[data-emoji-grid] [data-emoji-btn]', grid: true },
]

function visible(el: HTMLElement) { return el.offsetParent !== null || el.getClientRects().length > 0 }

export function installArrowNav() {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return
    // The message list itself (focused via Tab or the skip link) enters at the newest message.
    if (t.matches('[data-message-list]') && (e.key === 'ArrowUp' || e.key === 'End' || e.key === 'Home')) {
      const rows = [...t.querySelectorAll<HTMLElement>('[data-msg-id]')].filter(visible)
      const row = e.key === 'Home' ? rows[0] : rows[rows.length - 1]
      if (row) { e.preventDefault(); row.focus(); row.scrollIntoView({ block: 'nearest' }) }
      return
    }
    for (const l of LISTS) {
      const cur = t.closest<HTMLElement>(l.item)
      if (!cur) continue
      if (!l.grid && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      const items = [...document.querySelectorAll<HTMLElement>(l.item)].filter(visible)
      const i = items.indexOf(cur)
      if (i < 0) return
      let next = i
      if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = items.length - 1
      else if (!l.grid) next = e.key === 'ArrowUp' ? i - 1 : i + 1
      else if (e.key === 'ArrowLeft') next = i - 1
      else if (e.key === 'ArrowRight') next = i + 1
      else {
        // Grid: the nearest item in the row above/below by horizontal position.
        const r = cur.getBoundingClientRect()
        const dir = e.key === 'ArrowUp' ? -1 : 1
        const rows = items.map((el, k) => ({ k, rr: el.getBoundingClientRect() })).filter(({ rr }) => dir < 0 ? rr.bottom <= r.top + 1 : rr.top >= r.bottom - 1)
        if (!rows.length) return
        const rowY = dir < 0 ? Math.max(...rows.map((x) => x.rr.top)) : Math.min(...rows.map((x) => x.rr.top))
        const inRow = rows.filter((x) => Math.abs(x.rr.top - rowY) < 2)
        next = inRow.reduce((best, x) => Math.abs(x.rr.left - r.left) < Math.abs(best.rr.left - r.left) ? x : best).k
      }
      if (next < 0 || next >= items.length || next === i) { e.preventDefault(); return }
      e.preventDefault()
      items[next].focus()
      items[next].scrollIntoView({ block: 'nearest' })
      return
    }
  })
}
