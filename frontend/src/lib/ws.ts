import { mentionsMe, useStore, type ReadyPayload } from '../store'
import { effective, shouldNotify, type NotifSetting } from './notify'
import type { VoiceInvite } from '../store'
import type { Ban, Channel, DmChannel, Emoji, Guild, Member, Message, Poll, PrivateUser, Relationship, Role, Sound, Sticker, ThreadInfo, User, VoiceState } from './types'
import { voice } from './voice'
import type { E2eeSignal } from './e2ee'
import { playSfx } from './sfx'
import { getNotifPrefs } from './notifPrefs'
import { getPrefs, streamerHides } from './prefs'
import { log } from './log'
import { studio } from './studio'
import { isNative, registerPush } from './native'
import { markJoined } from './welcome'
import { desktopNotify, notifyMessage } from './desktopNotify'
import { emitCallReaction } from './callReactions'

type Ev = { s?: number; i?: string } & (
  | { t: 'READY'; d: ReadyPayload }
  | { t: 'RESUMED'; d: { replayed: number; from: number } }
  | { t: 'RESYNC'; d: unknown }
  | { t: 'PONG'; d: unknown }
  | { t: 'MESSAGE_CREATE' | 'MESSAGE_UPDATE'; d: { message: Message; guild_id: string | null } }
  | { t: 'MESSAGE_DELETE'; d: { id: string; channel_id: string } }
  | { t: 'MESSAGE_DELETE_BULK'; d: { ids: string[]; channel_id: string } }
  | { t: 'REACTION_ADD' | 'REACTION_REMOVE'; d: { message_id: string; channel_id: string; user_id: string; emoji: string } }
  | { t: 'BOOKMARK_REMINDER'; d: { message: Message; guild_id: string | null; channel_name: string } }
  | { t: 'POLL_UPDATE'; d: { channel_id: string; message_id: string; poll: Poll } }
  | { t: 'THREAD_UPDATE'; d: ThreadInfo }
  | { t: 'TYPING_START'; d: { channel_id: string; user_id: string } }
  | { t: 'PRESENCE_UPDATE'; d: { user_id: string; online: boolean; platforms?: string[]; idle?: boolean } }
  | { t: 'USER_UPDATE'; d: User }
  | { t: 'USER_SETTINGS_UPDATE'; d: Partial<PrivateUser> }
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
  | { t: 'READ_RECEIPT'; d: { channel_id: string; user_id: string; message_id: string } }
  | { t: 'VOICE_LISTENED'; d: { channel_id: string; message_id: string; attachment_id: string; user_id: string } }
  | { t: 'SOUNDBOARD_PLAY'; d: { channel_id: string; guild_id: string; user_id: string; sound: Sound } }
  | { t: 'SOUNDBOARD_UPDATE'; d: { guild_id: string; sounds: Sound[] } }
  | { t: 'EVENT_UPDATE'; d: { guild_id: string } }
  | { t: 'STUDIO_UPDATE'; d: { channel_id: string } }
  | { t: 'STUDIO_SESSION'; d: { channel_id: string; action: 'start' | 'stop'; session_id: string; name?: string; started_at?: string } }
  | { t: 'VOICE_STATE_UPDATE'; d: VoiceState }
  | { t: 'VOICE_SIGNAL'; d: { from: string; channel_id: string; data: SignalData } }
  | { t: 'VOICE_ERROR'; d: { message: string } }
  | { t: 'VOICE_MOVE'; d: { guild_id: string; channel_id: string } }
  | { t: 'VOICE_DISCONNECT'; d: { guild_id: string } }
  | { t: 'MEMBER_WARNING'; d: { id: string; guild_id: string; guild_name: string; reason: string } }
  | { t: 'VOICE_REACTION'; d: { channel_id: string; user_id: string; emoji: string } }
  | { t: 'VOICE_INVITE'; d: VoiceInvite })

export type SignalData = { type: 'offer' | 'answer'; sdp: string } | { type: 'candidate'; candidate: RTCIceCandidateInit | null }
  /** Mesh: ask a streamer to start (on) or stop sending us their screen share. */
  | { type: 'watch'; on: boolean }
  /** End-to-end encrypted calls: key agreement (lib/e2ee.ts). */
  | E2eeSignal

let socket: WebSocket | null = null
/** Where this client runs, for the presence indicator: the native apps say so; VR browsers by user agent; else web. */
export function clientPlatform(): 'web' | 'desktop' | 'mobile' | 'vr' {
  if (isNative()) return 'mobile'
  const ua = navigator.userAgent
  if (/ParleyDesktop|Electron|Tauri/i.test(ua)) return 'desktop'
  if (/OculusBrowser|Quest|Pico|VR|HorizonOS|WolvicBrowser/i.test(ua)) return 'vr'
  return 'web'
}

/** Highest event sequence number seen; sent back on reconnect so the server can replay the gap. */
let lastSeq = 0
/** Backend instance that numbered lastSeq; a resume is only valid against the same one. */
let instanceId: string | null = null
/** Debug counters (also handy for tests): how often we resumed vs. got a fresh READY. */
export const wsStats = { resumed: 0, ready: 0, replayed: 0, /** No input for this long counts as away (tests shorten it). */ idleAfter: 10 * 60_000, /** Re-check away now (tests). */ checkIdle: () => checkIdle(), /** Drop the socket as a network blip would (debugging/tests); it reconnects and resumes. */ drop: () => { socket?.close() }, /** Drop and forget the sequence: the next connect is a full READY (as after a server restart). */ resync: () => { lastSeq = 0; instanceId = null; socket?.close() } }
let retry = 0
let closedByUser = false
let pingTimer: ReturnType<typeof setInterval> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

export function connectSocket() {
  const token = useStore.getState().token
  if (!token || socket) return
  closedByUser = false
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const resume = lastSeq > 0 && useStore.getState().ready ? `&seq=${lastSeq}${instanceId ? `&instance=${instanceId}` : ''}` : ''
  reportedIdle = isAway()
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}&platform=${clientPlatform()}${reportedIdle ? '&idle=1' : ''}${resume}`)
  socket = ws

  ws.onopen = () => {
    log('info', 'ws open', resume ? 'resume' : 'fresh')
    retry = 0
    lastActivity = 0; activity()
    pingTimer = setInterval(() => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ op: 'ping' })) }, 25000)
  }
  ws.onmessage = (e) => {
    let ev: Ev
    try { ev = JSON.parse(e.data) } catch { return }
    if (typeof ev.s === 'number' && ev.s > lastSeq) lastSeq = ev.s
    if (typeof ev.i === 'string') instanceId = ev.i
    handle(ev)
  }
  ws.onclose = () => {
    log('info', 'ws closed', closedByUser ? 'by user' : 'unexpected')
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
    case 'READY': wsStats.ready++; if (typeof ev.s === 'number') lastSeq = ev.s; s.applyReady(ev.d); void s.loadNotes(); void registerPush(); voice.onReconnect(); break
    // The server replayed everything we missed; state is already current, no need to rebuild it.
    case 'RESUMED': wsStats.resumed++; wsStats.replayed += ev.d.replayed; s.setConnected(true); voice.onReconnect(); break
    case 'RESYNC': lastSeq = 0; instanceId = null; socket?.close(); break
    case 'PONG': break
    case 'MESSAGE_CREATE': {
      s.addMessage(ev.d.message)
      // A new message brings a closed DM back into the list.
      { const dm = s.dms[ev.d.message.channel_id]; if (dm?.closed) s.upsertChannel({ ...dm, closed: false }) }
      const me = s.user?.id
      if (ev.d.message.author.id !== me && s.relationships[ev.d.message.author.id]?.kind !== 'blocked' && !s.user?.ignored_users?.includes(ev.d.message.author.id) && (!ev.d.message.kind || ev.d.message.kind === 'default')) {
        const ch = s.channels[ev.d.message.channel_id] ?? s.dms[ev.d.message.channel_id]
        const dmReq = s.dms[ev.d.message.channel_id]?.request_state
        if (dmReq && dmReq !== 'accepted') break // message requests wait quietly
        const mentioned = mentionsMe(s, ev.d.message)
        const hidden = document.visibilityState !== 'visible'
        if (!streamerHides('notifications') && shouldNotify(effective(s.notifSettings, ch, s.guilds), mentioned, ev.d.message, !!ch && ch.guild_id === null)) {
          if (hidden) notifyMessage(ev.d.message, ev.d.guild_id)
          // A sound unless you are looking right at that channel in a focused window.
          if (hidden || !document.hasFocus() || s.activeChannelId !== ev.d.message.channel_id) playSfx(mentioned ? 'mention' : 'message')
          speak(ev.d.message, s.activeChannelId === ev.d.message.channel_id)
        }
      }
      break
    }
    case 'MESSAGE_UPDATE': s.updateMessage(ev.d.message); break
    case 'MESSAGE_DELETE': s.removeMessage(ev.d.channel_id, ev.d.id); break
    case 'MESSAGE_DELETE_BULK': for (const id of ev.d.ids) s.removeMessage(ev.d.channel_id, id); break
    case 'REACTION_ADD': s.applyReaction(ev.d.channel_id, ev.d.message_id, ev.d.emoji, ev.d.user_id, true); break
    case 'REACTION_REMOVE': s.applyReaction(ev.d.channel_id, ev.d.message_id, ev.d.emoji, ev.d.user_id, false); break
    case 'BOOKMARK_REMINDER': {
      // A "Remind me" bookmark came due: toast, sound, and a desktop notification when Parley is in the background.
      const m = ev.d.message
      const where = ev.d.guild_id ? `#${ev.d.channel_name}` : 'a DM'
      const body = `${m.author.display_name}: ${m.content || 'a message'}`.slice(0, 140)
      s.pushToast(`Reminder (${where}) — ${body}`)
      playSfx('mention')
      if (document.visibilityState !== 'visible') desktopNotify(`Reminder from ${where}`, body, { icon: m.author.avatar_url, tag: `reminder:${m.id}`, path: `/channels/${ev.d.guild_id ?? '@me'}/${m.channel_id}?message=${m.id}` })
      break
    }
    case 'POLL_UPDATE': s.applyPollUpdate(ev.d.channel_id, ev.d.message_id, ev.d.poll); break
    case 'THREAD_UPDATE': s.upsertThread(ev.d); break
    case 'TYPING_START': if (ev.d.user_id !== s.user?.id) s.setTyping(ev.d.channel_id, ev.d.user_id); break
    case 'PRESENCE_UPDATE': {
      // Friend-online alerts: only on the offline → online edge.
      const cameOnline = ev.d.online && !s.online[ev.d.user_id]
      s.setPresence(ev.d.user_id, ev.d.online, ev.d.platforms ?? [], ev.d.idle)
      if (cameOnline && s.user?.online_alerts?.includes(ev.d.user_id) && s.relationships[ev.d.user_id]?.kind === 'friend') {
        const name = s.notes[ev.d.user_id]?.nickname || s.users[ev.d.user_id]?.display_name || s.relationships[ev.d.user_id].user.display_name
        s.pushToast(`${name} is now online`)
        if (document.visibilityState !== 'visible') desktopNotify(`${name} is now online`, '', { icon: s.users[ev.d.user_id]?.avatar_url, tag: `online:${ev.d.user_id}`, path: '/channels/@me' })
      }
      break
    }
    case 'USER_SETTINGS_UPDATE': if (s.user && s.token) s.setAuth(s.token, { ...s.user, ...ev.d } as PrivateUser); break
    case 'USER_UPDATE': s.upsertUser(ev.d); if (ev.d.id === s.user?.id && s.token) s.setAuth(s.token, { ...s.user, ...(ev.d as object) } as PrivateUser); break
    // A server we weren't in yet (joined from any device or link): its welcome screen is owed.
    case 'GUILD_CREATE': if (!s.guilds[ev.d.id] && ev.d.owner_id !== s.user?.id) markJoined(ev.d.id); s.upsertGuild(ev.d); break
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
      if (ev.d.kind === 'incoming' && prev !== 'incoming' && !s.user?.ignored_users?.includes(ev.d.user.id)) {
        s.pushToast(`${ev.d.user.display_name} sent you a friend request`)
        playSfx('message')
        // A desktop notification when Parley isn't in front, like messages.
        if (document.visibilityState !== 'visible') desktopNotify(`${ev.d.user.display_name} sent you a friend request`, ev.d.note ?? 'Open Friends to accept it.', { icon: ev.d.user.avatar_url, tag: `friend:${ev.d.user.id}`, path: '/channels/@me' })
      }
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
    case 'READ_RECEIPT': if (ev.d.user_id !== s.user?.id) s.applyReceipt(ev.d.channel_id, ev.d.user_id, ev.d.message_id); break
    case 'VOICE_LISTENED': s.applyListened(ev.d.channel_id, ev.d.message_id, ev.d.attachment_id, ev.d.user_id); break
    case 'VOICE_STATE_UPDATE': voiceSfx(s, ev.d); s.applyVoiceState(ev.d); voice.onVoiceState(ev.d); break
    case 'SOUNDBOARD_PLAY': if (s.myVoiceChannelId === ev.d.channel_id) voice.playSound(ev.d.sound.url, ev.d.sound.volume, ev.d.sound.id); break
    case 'SOUNDBOARD_UPDATE': s.setSounds(ev.d.guild_id, ev.d.sounds); break
    case 'EVENT_UPDATE': if (s.events[ev.d.guild_id]) void s.loadEvents(ev.d.guild_id); break
    case 'STUDIO_UPDATE': void s.loadStudio(ev.d.channel_id); break
    case 'STUDIO_SESSION': studio.onSession(ev.d); void s.loadStudio(ev.d.channel_id); break
    case 'VOICE_SIGNAL': voice.onSignal(ev.d.from, ev.d.channel_id, ev.d.data); break
    case 'VOICE_ERROR': s.pushToast(ev.d.message, 'error'); voice.leave(true); break
    case 'VOICE_MOVE': if (s.myVoiceChannelId) { s.pushToast('A moderator moved you to another voice channel'); voice.join(ev.d.channel_id) } break
    case 'MEMBER_WARNING': if (!s.modal) s.openModal({ kind: 'warning', guildName: ev.d.guild_name, reason: ev.d.reason }); else s.pushToast(`Warning from ${ev.d.guild_name}: ${ev.d.reason}`, 'error'); break
    case 'VOICE_REACTION': if (s.myVoiceChannelId === ev.d.channel_id) emitCallReaction(ev.d.user_id, ev.d.emoji); break
    case 'VOICE_INVITE': if (!s.user?.ignored_users?.includes(ev.d.from.id)) { s.setVoiceInvite(ev.d); playSfx('invite_speak') } break
    case 'VOICE_DISCONNECT': if (s.myVoiceChannelId) { s.pushToast('A moderator disconnected you from voice'); voice.leave(true) } break
  }
}

/** Join/leave sounds for other people entering or leaving the call you are in; a chime when a stage moderator lifts you up. */
function voiceSfx(s: ReturnType<typeof useStore.getState>, v: VoiceState) {
  const me = s.user?.id
  const mine = s.myVoiceChannelId
  if (!me || !mine) return
  const was = s.voiceStates[v.user_id]
  if (v.user_id === me) {
    if (was?.suppress && !v.suppress && v.channel_id === mine && s.channels[mine]?.kind === 'stage') playSfx('invite_speak')
    return
  }
  if (v.channel_id === mine && was?.channel_id === mine && v.self_video && !was.self_video) playSfx('camera_on')
  if (v.channel_id === mine && (was?.channel_id ?? null) !== mine) playSfx('user_join')
  else if (was?.channel_id === mine && v.channel_id !== mine) playSfx('user_leave')
}

/** Text-to-speech notifications: never / only the channel you are looking at / all. */
function speak(m: Message, current: boolean) {
  const mode = getNotifPrefs().tts
  if (mode === 'never' || (mode === 'current' && !current) || useStore.getState().selfDeaf) return
  const text = `${m.author.display_name} said ${m.content ? m.content.slice(0, 200) : 'sent an attachment'}`
  ;(window.__parleyTts ??= []).push(text)
  try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(text); u.rate = getPrefs().ttsRate; speechSynthesis.speak(u) } } catch { /* ignore */ }
}

// Activity pings: tell the server we are at the keyboard (at most once a minute) so push notifications wait
// for the inactive timeout instead of firing while we are reading.
let lastActivity = 0
function activity() {
  if (document.visibilityState !== 'visible') return
  const now = Date.now()
  if (now - lastActivity < 60_000) return
  lastActivity = now
  sendOp({ op: 'activity' })
}
if (typeof window !== 'undefined') {
  for (const ev of ['keydown', 'pointerdown', 'focus']) window.addEventListener(ev, activity, { passive: true })
  document.addEventListener('visibilitychange', activity)
}

// Automatic idle: this client reports the user away after a stretch with no input, or as soon as the mobile app goes
// to the background (it may keep its connection there). The server shows them Idle once every device is away, and a
// status they picked (Idle, Do Not Disturb, Invisible) always wins over this.
let lastInput = Date.now()
let reportedIdle = false
function isAway(): boolean {
  if (useStore.getState().myVoiceChannelId) return false // listening in a call counts as being here
  if (isNative() && document.visibilityState !== 'visible') return true
  return Date.now() - lastInput >= wsStats.idleAfter
}
function checkIdle() {
  const away = isAway()
  if (away !== reportedIdle && sendOp({ op: 'idle', idle: away })) reportedIdle = away
}
function onInput() {
  lastInput = Date.now()
  if (reportedIdle) checkIdle()
}
if (typeof window !== 'undefined') {
  for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'focus']) window.addEventListener(ev, onInput, { passive: true })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onInput(); else checkIdle() })
  setInterval(checkIdle, 15_000)
}


setInterval(() => useStore.getState().pruneTyping(), 2000)

declare global { interface Window { __parleyWs?: typeof wsStats; __parleyTts?: string[] } }
if (typeof window !== 'undefined') window.__parleyWs = wsStats
