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

/** The host of a link without a leading `www.`; empty when the link does not parse. */
export function linkHost(url: string): string {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return '' }
}

/** The link itself when it is a plain web address; anything else (script, data, other schemes) is not safe to render as a link. */
export function safeLink(url: string): string | null {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:' ? url : null } catch { return null }
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
