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
