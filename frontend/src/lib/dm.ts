import type { DmChannel, User } from './types'

export const isGroup = (d: Pick<DmChannel, 'kind'>) => d.kind === 'group'

/** Display name for a DM row/header: the other person, or the group's name (custom or the members' names). */
export function dmName(d: DmChannel, users: Record<string, User>): string {
  const rec = d.recipients.map((r) => users[r.id] ?? r)
  if (!isGroup(d)) return rec[0]?.display_name ?? 'Unknown'
  if (d.name) return d.name
  return rec.length ? rec.map((r) => r.display_name).join(', ') : 'Unnamed Group'
}

/** Last visited channel per server, so returning to a server lands where you left it. */
const LAST_KEY = 'parley.lastChannel'
function loadLast(): Record<string, string> { try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') } catch { return {} } }
export function rememberChannel(guildId: string, channelId: string) {
  try { const m = loadLast(); if (m[guildId] !== channelId) { m[guildId] = channelId; localStorage.setItem(LAST_KEY, JSON.stringify(m)) } } catch { /* ignore */ }
}
export function lastChannel(guildId: string): string | undefined { return loadLast()[guildId] }
