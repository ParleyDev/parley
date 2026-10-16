import { mentionsMe, useStore, type ReadyPayload } from '../store'
import { effective, shouldNotify, type NotifSetting } from './notify'
import type { Ban, Channel, DmChannel, Emoji, Guild, Member, Message, PrivateUser, Relationship, Role, Sticker, User, VoiceState } from './types'
import { voice } from './voice'

type Ev =
  | { t: 'READY'; d: ReadyPayload }
  | { t: 'RESYNC'; d: unknown }
  | { t: 'PONG'; d: unknown }
  | { t: 'MESSAGE_CREATE' | 'MESSAGE_UPDATE'; d: { message: Message; guild_id: string | null } }
  | { t: 'MESSAGE_DELETE'; d: { id: string; channel_id: string } }
  | { t: 'REACTION_ADD' | 'REACTION_REMOVE'; d: { message_id: string; channel_id: string; user_id: string; emoji: string } }
  | { t: 'TYPING_START'; d: { channel_id: string; user_id: string } }
  | { t: 'PRESENCE_UPDATE'; d: { user_id: string; online: boolean } }
  | { t: 'USER_UPDATE'; d: User }
  | { t: 'GUILD_CREATE'; d: Guild & { channels: Channel[]; roles: Role[] } }
  | { t: 'GUILD_MEMBER_UPDATE'; d: Member }
  | { t: 'ROLE_UPDATE'; d: { guild_id: string; role: Role } }
  | { t: 'ROLE_DELETE'; d: { guild_id: string; id: string } }
  | { t: 'ROLES_SYNC'; d: { guild_id: string; roles: Role[] } }
  | { t: 'RELATIONSHIP_ADD'; d: Relationship }
  | { t: 'RELATIONSHIP_REMOVE'; d: { user_id: string } }
  | { t: 'GUILD_UPDATE'; d: Guild }
  | { t: 'GUILD_EMOJIS_UPDATE'; d: { guild_id: string; emojis: Emoji[] } }
  | { t: 'INSTANCE_UPDATE'; d: { registration_enabled: boolean; announcement: string } }
  | { t: 'SESSION_REVOKED'; d: { reason: string } }
  | { t: 'NOTIFICATION_SETTINGS_UPDATE'; d: NotifSetting & { deleted?: boolean } }
  | { t: 'GUILD_STICKERS_UPDATE'; d: { guild_id: string; stickers: Sticker[] } }
  | { t: 'GUILD_DELETE'; d: { id: string } }
  | { t: 'GUILD_MEMBER_ADD'; d: Member }
  | { t: 'GUILD_MEMBER_REMOVE'; d: { guild_id: string; user_id: string } }
  | { t: 'GUILD_BAN_ADD'; d: Ban }
  | { t: 'GUILD_BAN_REMOVE'; d: { guild_id: string; user_id: string } }
  | { t: 'CHANNEL_CREATE' | 'CHANNEL_UPDATE'; d: Channel | DmChannel }
  | { t: 'CHANNEL_DELETE'; d: { id: string; guild_id: string | null } }
  | { t: 'READ_STATE_UPDATE'; d: { channel_id: string; last_read_msg: string } }
  | { t: 'VOICE_STATE_UPDATE'; d: VoiceState }
  | { t: 'VOICE_SIGNAL'; d: { from: string; channel_id: string; data: SignalData } }
  | { t: 'VOICE_ERROR'; d: { message: string } }

export type SignalData = { type: 'offer' | 'answer'; sdp: string } | { type: 'candidate'; candidate: RTCIceCandidateInit | null }

let socket: WebSocket | null = null
let retry = 0
let closedByUser = false
let pingTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

export function connectSocket() {
  const token = useStore.getState().token
  if (!token || socket) return
  closedByUser = false
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
  socket = ws

  ws.onopen = () => {
    retry = 0
    pingTimer = setInterval(() => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op: 'ping' })) }, 25000)
  }
  ws.onmessage = (e) => {
    let ev: Ev
    try { ev = JSON.parse(e.data) } catch { return }
    handle(ev)
  }
  ws.onclose = () => {
    if (pingTimer) clearInterval(pingTimer)
    socket = null
    useStore.getState().setConnected(false)
    voice.onSocketLost()
    if (closedByUser) return
    const delay = Math.min(30000, 1000 * 2 ** retry++)
    reconnectTimer = setTimeout(async () => {
      // A rejected upgrade closes with an opaque code; probe the API to tell "server down" from "token expired".
      try {
        const r = await fetch('/api/users/@me', { headers: { Authorization: `Bearer ${useStore.getState().token}` } })
        if (r.status === 401) { useStore.getState().logout(); return }
      } catch { /* network down: keep retrying */ }
      connectSocket()
    }, delay)
  }
  ws.onerror = () => { /* onclose will fire */ }
}

export function disconnectSocket() {
  closedByUser = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (pingTimer) clearInterval(pingTimer)
  socket?.close()
  socket = null
}

export function sendOp(payload: Record<string, unknown>): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(payload))
  return true
}

export function sendTyping(channelId: string) {
  sendOp({ op: 'typing', channel_id: channelId })
}

function handle(ev: Ev) {
  const s = useStore.getState()
  switch (ev.t) {
    case 'READY': s.applyReady(ev.d); voice.onReconnect(); break
    case 'RESYNC': socket?.close(); break
    case 'PONG': break
    case 'MESSAGE_CREATE': {
      s.addMessage(ev.d.message)
      const me = s.user?.id
      if (ev.d.message.author.id !== me && document.visibilityState !== 'visible' && s.relationships[ev.d.message.author.id]?.kind !== 'blocked') {
        const ch = s.channels[ev.d.message.channel_id] ?? s.dms[ev.d.message.channel_id]
        if (shouldNotify(effective(s.notifSettings, ch), mentionsMe(s, ev.d.message), ev.d.message, !!ch && ch.guild_id === null)) notify(ev.d.message)
      }
      break
    }
    case 'MESSAGE_UPDATE': s.updateMessage(ev.d.message); break
    case 'MESSAGE_DELETE': s.removeMessage(ev.d.channel_id, ev.d.id); break
    case 'REACTION_ADD': s.applyReaction(ev.d.channel_id, ev.d.message_id, ev.d.emoji, ev.d.user_id, true); break
    case 'REACTION_REMOVE': s.applyReaction(ev.d.channel_id, ev.d.message_id, ev.d.emoji, ev.d.user_id, false); break
    case 'TYPING_START': if (ev.d.user_id !== s.user?.id) s.setTyping(ev.d.channel_id, ev.d.user_id); break
    case 'PRESENCE_UPDATE': s.setPresence(ev.d.user_id, ev.d.online); break
    case 'USER_UPDATE': s.upsertUser(ev.d); if (ev.d.id === s.user?.id && s.token) s.setAuth(s.token, { ...s.user, ...(ev.d as object) } as PrivateUser); break
    case 'GUILD_CREATE': s.upsertGuild(ev.d); break
    case 'GUILD_UPDATE': s.upsertGuild(ev.d); break
    case 'GUILD_EMOJIS_UPDATE': s.setGuildEmojis(ev.d.guild_id, ev.d.emojis); break
    case 'INSTANCE_UPDATE': s.setInstance(ev.d); break
    case 'SESSION_REVOKED': s.pushToast(ev.d.reason, 'error'); s.logout(); break
    case 'NOTIFICATION_SETTINGS_UPDATE': s.setNotifSetting(ev.d); break
    case 'GUILD_STICKERS_UPDATE': s.setGuildStickers(ev.d.guild_id, ev.d.stickers); break
    case 'GUILD_DELETE': s.removeGuild(ev.d.id); break
    case 'GUILD_MEMBER_ADD': s.upsertMember(ev.d); break
    case 'GUILD_MEMBER_UPDATE': s.upsertMember(ev.d); break
    case 'GUILD_BAN_ADD': s.upsertBan(ev.d); break
    case 'GUILD_BAN_REMOVE': s.removeBan(ev.d.guild_id, ev.d.user_id); break
    case 'ROLE_UPDATE': s.upsertRole(ev.d.role); break
    case 'ROLE_DELETE': s.removeRole(ev.d.guild_id, ev.d.id); break
    case 'ROLES_SYNC': s.setRoles(ev.d.guild_id, ev.d.roles); break
    case 'RELATIONSHIP_ADD': {
      const prev = s.relationships[ev.d.user.id]?.kind
      s.upsertRelationship(ev.d)
      if (ev.d.kind === 'incoming' && prev !== 'incoming') s.pushToast(`${ev.d.user.display_name} sent you a friend request`)
      break
    }
    case 'RELATIONSHIP_REMOVE': s.removeRelationship(ev.d.user_id); break
    case 'GUILD_MEMBER_REMOVE':
      if (ev.d.user_id === s.user?.id) s.removeGuild(ev.d.guild_id)
      else s.removeMember(ev.d.guild_id, ev.d.user_id)
      break
    case 'CHANNEL_CREATE':
    case 'CHANNEL_UPDATE': s.upsertChannel(ev.d); break
    case 'CHANNEL_DELETE': s.removeChannel(ev.d.id); break
    case 'READ_STATE_UPDATE': s.setReadState(ev.d.channel_id, ev.d.last_read_msg); break
    case 'VOICE_STATE_UPDATE': s.applyVoiceState(ev.d); voice.onVoiceState(ev.d); break
    case 'VOICE_SIGNAL': voice.onSignal(ev.d.from, ev.d.channel_id, ev.d.data); break
    case 'VOICE_ERROR': s.pushToast(ev.d.message, 'error'); voice.leave(); break
  }
}

function notify(m: Message) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const body = m.content ? m.content.slice(0, 120) : m.attachments?.length ? `Sent ${m.attachments.length === 1 ? 'an attachment' : `${m.attachments.length} attachments`}` : ''
      new Notification(m.author.display_name, { body })
    }
  } catch { /* ignore */ }
}

setInterval(() => useStore.getState().pruneTyping(), 2000)
