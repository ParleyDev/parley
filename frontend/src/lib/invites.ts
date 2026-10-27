import { publicOrigin } from '../components/InviteCard'
import { locale, t } from './i18n'
import type { Invite } from './types'

/** Invite lifetimes the server accepts, in seconds; 0 never expires. */
export const EXPIRY: { s: number; label: string }[] = [
  { s: 1800, get label() { return t('30 minutes') } }, { s: 3600, get label() { return t('1 hour') } }, { s: 6 * 3600, get label() { return t('6 hours') } }, { s: 12 * 3600, get label() { return t('12 hours') } },
  { s: 86400, get label() { return t('1 day') } }, { s: 7 * 86400, get label() { return t('7 days') } }, { s: 30 * 86400, get label() { return t('30 days') } }, { s: 0, get label() { return t('Never') } },
]
/** Use limits the server accepts; 0 is no limit. */
export const USES: { n: number; label: string }[] = [
  { n: 0, get label() { return t('No limit') } }, { n: 1, get label() { return t('1 use') } }, { n: 5, get label() { return t('5 uses') } }, { n: 10, get label() { return t('10 uses') } },
  { n: 25, get label() { return t('25 uses') } }, { n: 50, get label() { return t('50 uses') } }, { n: 100, get label() { return t('100 uses') } },
]
export const MAX_VANITY = 3
/** Same rule as the server: 3–32 lowercase letters, digits and hyphens, no hyphen at either end. */
export const VANITY_RE = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/

/** "in 6 hours", "in 3 days", or "Never" for an invite that doesn't expire. */
export function expiresIn(inv: Pick<Invite, 'expires_at'>, now = Date.now()): string {
  if (!inv.expires_at) return t('Never')
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
  const age = EXPIRY.find((e) => e.s === maxAge)?.label ?? t('Never')
  if (maxAge) return maxUses === 0 ? t('Your invite link expires in {age}.', { age }) : maxUses === 1 ? t('Your invite link expires in {age} and can be used once.', { age }) : t('Your invite link expires in {age} and can be used {n} times.', { age, n: maxUses })
  return maxUses === 0 ? t('Your invite link never expires.') : maxUses === 1 ? t('Your invite link never expires and can be used once.') : t('Your invite link never expires and can be used {n} times.', { n: maxUses })
}

export type BadgeStyle = 'flat' | 'flat-square' | 'for-the-badge'
export const BADGE_STYLES: { id: BadgeStyle; label: string }[] = [
  { id: 'flat', get label() { return t('Flat') } }, { id: 'flat-square', get label() { return t('Flat square') } }, { id: 'for-the-badge', get label() { return t('For the badge') } },
]
export type BadgeShow = 'both' | 'members' | 'online'
export const BADGE_SHOW: { id: BadgeShow; label: string }[] = [
  { id: 'both', get label() { return t('Online and members') } }, { id: 'members', get label() { return t('Members only') } }, { id: 'online', get label() { return t('Online only') } },
]
/** A server's README badge settings (Server Settings › Badge); an empty label or colour means the default. */
export interface BadgeSettings { enabled: boolean; label: string; color: string; show: BadgeShow; style: BadgeStyle }
export const BADGE_COLOR = '#6d5dfc'
/** Shields.io's familiar colours, after Parley purple. */
export const BADGE_COLORS = ['#6d5dfc', '#007ec6', '#44cc11', '#97ca00', '#dfb317', '#fe7d37', '#e05d44', '#555555']
/** The public badge image for an invite (served by the API, no login needed). Without a style it uses the server's. */
export function badgeUrl(code: string, style?: BadgeStyle): string {
  return `${publicOrigin()}/api/invites/${encodeURIComponent(code)}/badge.svg${style ? `?style=${style}` : ''}`
}
const inviteUrl = (code: string) => `${publicOrigin()}/invite/${code}`
/** README Markdown: the badge, linking to the invite. */
export function badgeMarkdown(code: string, style: BadgeStyle | undefined, guild: string): string {
  return `[![Join ${guild.replace(/[[\]\\]/g, '')} on Parley](${badgeUrl(code, style)})](${inviteUrl(code)})`
}
export function badgeHtml(code: string, style: BadgeStyle | undefined, guild: string): string {
  const alt = `Join ${guild} on Parley`.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<a href="${inviteUrl(code)}"><img src="${badgeUrl(code, style)}" alt="${alt}"></a>`
}
