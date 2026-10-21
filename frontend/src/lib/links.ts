import { useStore } from '../store'
import { getPrefs, setPrefs } from './prefs'
import { isDesktop, openExternal } from './native'
import { publicOrigin } from '../components/InviteCard'

/**
 * External links never open silently: a capture-phase click handler turns any link to another origin into the
 * "Leaving Parley" dialog, which shows the REAL destination (the text of a link can say anything). Hosts the
 * user trusts are remembered; the instance's own addresses are never external.
 */
export function isOwnOrigin(url: URL): boolean {
  const own = new Set([location.origin, publicOrigin()])
  return own.has(url.origin)
}

/** The destination of an anchor if it leaves the app, else null. */
export function externalTarget(a: HTMLAnchorElement): URL | null {
  const href = a.getAttribute('href') ?? ''
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return null
  let url: URL
  try { url = new URL(href, location.href) } catch { return null }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return null
  if (url.protocol.startsWith('http') && isOwnOrigin(url)) return null
  return url
}

export const hostOf = (url: URL) => (url.protocol.startsWith('http') ? url.host : url.protocol.replace(':', ''))
export const isTrusted = (url: URL) => getPrefs().trustedHosts.includes(hostOf(url).toLowerCase())
export function trustHost(url: URL) { const h = hostOf(url).toLowerCase(); const cur = getPrefs().trustedHosts; if (!cur.includes(h)) setPrefs({ trustedHosts: [...cur, h] }) }
export function untrustHost(h: string) { setPrefs({ trustedHosts: getPrefs().trustedHosts.filter((x) => x !== h) }) }

/** Does the link's visible text look like a URL whose host differs from the real one (spoofing)? */
export function spoofedHost(text: string | undefined, url: URL): string | null {
  const t = (text ?? '').trim()
  if (!t) return null
  const m = /^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(?:[/:?#]|$)/i.exec(t)
  if (!m) return null
  const shown = m[1].toLowerCase()
  const real = url.hostname.toLowerCase()
  return shown === real || real.endsWith(`.${shown}`) ? null : shown
}

/** Show the dialog, or open at once when the host is trusted. */
export function openLink(url: URL, text?: string) {
  if (isTrusted(url) && !spoofedHost(text, url)) { openExternal(url.href); return }
  useStore.getState().openModal({ kind: 'leaveLink', url: url.href, text })
}

/**
 * Install the global click guard once; returns the uninstaller. In the desktop shell there are no tabs, and
 * WebKitGTK silently drops `target="_blank"` navigations, so every new-tab link is resolved here instead:
 * in-app pages stay in the window, other same-site URLs (files, API links) go to the OS browser.
 */
export function installLinkGuard(): () => void {
  const desktop = isDesktop()
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0) return
    if (!desktop && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a) return
    const newTab = a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey
    if (a.dataset.noLeave !== undefined) {
      if (desktop && newTab && /^https?:/.test(a.href)) { e.preventDefault(); openExternal(a.href) }
      return
    }
    const url = externalTarget(a)
    if (!url) {
      if (!desktop || !newTab) return
      let own: URL
      try { own = new URL(a.href) } catch { return }
      if (!own.protocol.startsWith('http')) return
      e.preventDefault(); e.stopPropagation()
      if (/^\/(channels|invite|login|register)(\/|$)/.test(own.pathname)) location.assign(own.href)
      else openExternal(own.href)
      return
    }
    e.preventDefault(); e.stopPropagation()
    openLink(url, a.textContent ?? undefined)
  }
  document.addEventListener('click', onClick, true)
  // The desktop shell calls this when something asks for a new window (window.open, a link the guard missed).
  const w = window as unknown as { __parleyOpenLink?: (u: string, text?: string) => void }
  w.__parleyOpenLink = (u, text) => { try { openLink(new URL(u), text) } catch { /* not a URL */ } }
  return () => { document.removeEventListener('click', onClick, true); delete w.__parleyOpenLink }
}
