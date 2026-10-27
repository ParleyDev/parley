import { useStore } from '../store'
import { getNotifPrefs } from './notifPrefs'
import { appNavigate } from './native'
import { desktop } from './desktop'
import type { DmChannel, Message } from './types'

/** Message text as it reads in the app: mentions, channels, roles and custom emoji by name; markdown marks dropped. */
export function notificationText(content: string, guildId: string | null): string {
  const s = useStore.getState()
  return content
    .replace(/<@!?([0-9a-f-]{36})>/g, (_, id) => `@${(guildId && s.members[guildId]?.[id]?.nickname) || s.users[id]?.display_name || 'someone'}`)
    .replace(/<@&([0-9a-f-]{36})>/g, (_, id) => `@${(guildId && s.roles[guildId]?.[id]?.name) || 'role'}`)
    .replace(/<#([0-9a-f-]{36})>/g, (_, id) => `#${s.channels[id]?.name ?? 'channel'}`)
    .replace(/<a?:([\w~-]+):[0-9a-f-]+>/g, ':$1:')
    .replace(/<t:(-?\d+)(?::\w)?>/g, (_, t) => new Date(Number(t) * 1000).toLocaleString())
    .replace(/\|\|[\s\S]*?\|\|/g, '(spoiler)')
    .replace(/```[\s\S]*?```/g, '(code)')
    .replace(/(\*\*|__|~~|`)/g, '')
    .trim()
}

/** A desktop notification that jumps to `path` when clicked (and brings the window forward). Same `tag` replaces. */
export function desktopNotify(title: string, body: string, opts: { icon?: string | null; tag?: string; path?: string } = {}) {
  try {
    if (!getNotifPrefs().desktop || !('Notification' in window) || Notification.permission !== 'granted') return
    const n = new Notification(title, { body, icon: opts.icon ?? undefined, tag: opts.tag, renotify: !!opts.tag } as NotificationOptions)
    n.onclick = () => { window.focus(); if (opts.path) appNavigate(opts.path); n.close() }
    desktop.flash()
    ;(window as unknown as { __parleyNotes?: { title: string; body: string; tag?: string; path?: string }[] }).__parleyNotes?.push({ title, body, tag: opts.tag, path: opts.path })
  } catch { /* ignore */ }
}

/** A message notification: "<author> (#channel, Server)" or the group/DM, with the text rendered, grouped per channel. */
export function notifyMessage(m: Message, guildId: string | null) {
  const s = useStore.getState()
  const ch = s.channels[m.channel_id] ?? s.dms[m.channel_id]
  const where = guildId ? `#${ch?.name ?? 'channel'}, ${s.guilds[guildId]?.name ?? 'server'}` : ch && !ch.guild_id && (ch as DmChannel).recipients?.length > 1 ? (ch.name || 'Group') : ''
  const author = (guildId && s.members[guildId]?.[m.author.id]?.nickname) || m.author.display_name
  const text = m.content ? notificationText(m.content, guildId) : m.attachments?.length ? `Sent ${m.attachments.length === 1 ? 'an attachment' : `${m.attachments.length} attachments`}` : m.poll ? `Poll: ${m.poll.question}` : ''
  desktopNotify(where ? `${author} (${where})` : author, text.slice(0, 160), { icon: m.author.avatar_url, tag: m.channel_id, path: `/channels/${guildId ?? '@me'}/${m.channel_id}?message=${m.id}` })
}
