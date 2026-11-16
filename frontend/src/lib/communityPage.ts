/** Pure helpers for a community's page (address, link display). No store or React imports. */

/** The page's address within a server. */
export function communityPath(guildId: string, slug: string): string {
  return `/channels/${guildId}/c/${slug}`
}

// Same rule as a community's address on the server: lower-case letters, digits and dashes, starting with a letter or digit, up to 63.
const PAGE = /^\/channels\/([^/@][^/]*)\/c\/([a-z0-9][a-z0-9-]{0,62})\/?$/

/** The server and community address of a page path, or null for any other path (`@me` is not a server). */
export function parseCommunityPath(pathname: string): { guildId: string; slug: string } | null {
  const m = PAGE.exec(pathname)
  return m ? { guildId: m[1], slug: m[2] } : null
}

/** The link itself when it is a plain web address; anything else (script, data, other schemes) is not safe to render as a link. */
export function safeLink(url: string): string | null {
  // `https:/x` and `https:x` parse as web addresses but a browser on an https page resolves them as relative URLs.
  if (!/^https?:\/\//i.test(url.trim())) return null
  try { const u = new URL(url.trim()); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null } catch { return null }
}

/** The host of a link (as `safeLink` normalises it) without a leading `www.`; empty when it is not a safe link. */
export function linkHost(url: string): string {
  const href = safeLink(url)
  if (!href) return ''
  try { return new URL(href).host.replace(/^www\./, '') } catch { return '' }
}

export interface PageDraft { name: string; slug: string; description: string; about: string; links: { label: string; url: string }[] }

export const MAX_LINKS = 10
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/
const len = (s: string) => [...s].length

/**
 * What is wrong with a page being edited, keyed by field (`name`, `slug`, `description`, `about`, `links`, `links.<index>`).
 * The same limits the server enforces; an empty object means valid. `t` translates the messages (identity by default).
 */
export function validatePage(d: PageDraft, t: (key: string) => string = (k) => k): Record<string, string> {
  const e: Record<string, string> = {}
  const name = len(d.name.trim())
  if (name < 1 || name > 100) e.name = t('Name must be 1 to 100 characters.')
  if (!SLUG.test(d.slug)) e.slug = t('Use lower-case letters, digits and hyphens, up to 63 characters.')
  if (len(d.description) > 300) e.description = t('Description can be at most 300 characters.')
  if (len(d.about.trimEnd()) > 4000) e.about = t('About can be at most 4,000 characters.')
  if (d.links.length > MAX_LINKS) e.links = t('A page can have at most 10 links.')
  d.links.forEach((l, i) => {
    const label = len(l.label.trim())
    if (label < 1 || label > 80) e[`links.${i}`] = t('A link needs a label of 1 to 80 characters.')
    else if (len(l.url) > 500 || /\s/.test(l.url) || !safeLink(l.url) || !linkHost(l.url)) e[`links.${i}`] = t('A link must be a web address starting with http:// or https://.')
  })
  return e
}

/** The editable fields of a page as the editor holds them (images by URL, `null` for none). */
export interface PageEdits extends PageDraft { icon: string | null; banner: string | null }
/** The same fields as the server last reported them. */
export interface PageBase { name: string; slug: string; description: string; about: string; links: { label: string; url: string }[]; icon_url: string | null; banner_url: string | null }

/** The links as they would be saved: labels trimmed. */
export const savedLinks = (links: { label: string; url: string }[]) => links.map((l) => ({ label: l.label.trim(), url: l.url }))

/**
 * The PATCH body for an edit: only the fields that differ from the page as it was. Trailing whitespace in About does
 * not count (the server trims it); a cleared image is sent as an empty string.
 */
export function pageChanges(d: PageEdits, base: PageBase): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (d.name.trim() !== base.name) body.name = d.name.trim()
  if (d.slug !== base.slug) body.slug = d.slug
  if (d.description !== base.description) body.description = d.description
  if (d.about.trimEnd() !== base.about.trimEnd()) body.about = d.about
  if (JSON.stringify(savedLinks(d.links)) !== JSON.stringify(savedLinks(base.links))) body.links = savedLinks(d.links)
  if ((d.icon ?? '') !== (base.icon_url ?? '')) body.icon_url = d.icon ?? ''
  if ((d.banner ?? '') !== (base.banner_url ?? '')) body.banner_url = d.banner ?? ''
  return body
}

/**
 * Moving one channel of a community a step up or down. `rows` are the community's channels in display order with their
 * stored positions. Returns the new order and the positions to save: just the two swapped channels when every stored
 * position is distinct, otherwise the whole list renumbered from its lowest position so the order cannot depend on a
 * tie-break. `null` at the ends or for an unknown channel.
 */
export function moveChannel(rows: { id: string; position: number }[], id: string, dir: -1 | 1): { order: string[]; items: { id: string; position: number }[] } | null {
  const i = rows.findIndex((r) => r.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= rows.length) return null
  const next = rows.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  const order = next.map((r) => r.id)
  if (new Set(rows.map((r) => r.position)).size === rows.length) {
    return { order, items: [{ id: rows[i].id, position: rows[j].position }, { id: rows[j].id, position: rows[i].position }] }
  }
  const base = Math.min(...rows.map((r) => r.position))
  const stored = new Map(rows.map((r) => [r.id, r.position]))
  return { order, items: order.map((rid, k) => ({ id: rid, position: base + k })).filter((it) => stored.get(it.id) !== it.position) }
}
