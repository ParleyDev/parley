import { publicOrigin } from '../components/InviteCard'
import { locale } from './i18n'
import type { Invite } from './types'

/** Invite lifetimes the server accepts, in seconds; 0 never expires. */
export const EXPIRY: { s: number; label: string }[] = [
  { s: 1800, label: '30 minutes' }, { s: 3600, label: '1 hour' }, { s: 6 * 3600, label: '6 hours' }, { s: 12 * 3600, label: '12 hours' },
  { s: 86400, label: '1 day' }, { s: 7 * 86400, label: '7 days' }, { s: 30 * 86400, label: '30 days' }, { s: 0, label: 'Never' },
]
/** Use limits the server accepts; 0 is no limit. */
export const USES: { n: number; label: string }[] = [
  { n: 0, label: 'No limit' }, { n: 1, label: '1 use' }, { n: 5, label: '5 uses' }, { n: 10, label: '10 uses' },
  { n: 25, label: '25 uses' }, { n: 50, label: '50 uses' }, { n: 100, label: '100 uses' },
]
export const MAX_VANITY = 3
/** Same rule as the server: 3–32 lowercase letters, digits and hyphens, no hyphen at either end. */
export const VANITY_RE = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/

/** "in 6 hours", "in 3 days", or "Never" for an invite that doesn't expire. */
export function expiresIn(inv: Pick<Invite, 'expires_at'>, now = Date.now()): string {
  if (!inv.expires_at) return 'Never'
  const secs = Math.max(0, (new Date(inv.expires_at).getTime() - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'always' })
  if (Math.round(secs / 60) < 60) return rtf.format(Math.max(1, Math.round(secs / 60)), 'minute')
  if (Math.round(secs / 3600) < 24) return rtf.format(Math.round(secs / 3600), 'hour')
  return rtf.format(Math.round(secs / 86400), 'day')
}

/** The lifetime an invite was created with (the closest EXPIRY option), 0 when it never expires. */
export function maxAgeOf(inv: Pick<Invite, 'expires_at' | 'created_at'>): number {
  if (!inv.expires_at) return 0
  const secs = (new Date(inv.expires_at).getTime() - new Date(inv.created_at).getTime()) / 1000
  return EXPIRY.filter((e) => e.s).reduce((best, e) => (Math.abs(e.s - secs) < Math.abs(best - secs) ? e.s : best), EXPIRY[0].s)
}

/** The sentence under an invite link: "Your invite link expires in 7 days and can be used 5 times." */
export function describeInvite(maxAge: number, maxUses: number): string {
  const age = EXPIRY.find((e) => e.s === maxAge)?.label ?? 'Never'
  const exp = maxAge ? `expires in ${age}` : 'never expires'
  const uses = maxUses ? ` and can be used ${maxUses === 1 ? 'once' : `${maxUses} times`}` : ''
  return `Your invite link ${exp}${uses}.`
}

export type BadgeStyle = 'flat' | 'flat-square' | 'for-the-badge'
export const BADGE_STYLES: { id: BadgeStyle; label: string }[] = [
  { id: 'flat', label: 'Flat' }, { id: 'flat-square', label: 'Flat square' }, { id: 'for-the-badge', label: 'For the badge' },
]
/** The public badge image for an invite (served by the API, no login needed). */
export function badgeUrl(code: string, style: BadgeStyle): string {
  return `${publicOrigin()}/api/invites/${encodeURIComponent(code)}/badge.svg${style === 'flat' ? '' : `?style=${style}`}`
}
const inviteUrl = (code: string) => `${publicOrigin()}/invite/${code}`
/** README Markdown: the badge, linking to the invite. */
export function badgeMarkdown(code: string, style: BadgeStyle, guild: string): string {
  return `[![Join ${guild.replace(/[[\]\\]/g, '')} on Parley](${badgeUrl(code, style)})](${inviteUrl(code)})`
}
export function badgeHtml(code: string, style: BadgeStyle, guild: string): string {
  const alt = `Join ${guild} on Parley`.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<a href="${inviteUrl(code)}"><img src="${badgeUrl(code, style)}" alt="${alt}"></a>`
}
