import { STORAGE_PREFIX } from './lib/brand'
import { create } from 'zustand'
import { api, getToken, setToken } from './lib/api'
import { loadSettings, saveSettings, type VoiceSettings } from './lib/settings'
import type { Anchor } from './lib/anchor'

let localSeq = Date.now()
/** Undelivered rows survive channel switches, reconnects and reloads: they live in localStorage until Retry succeeds, Delete or Dismiss. */
const localKey = (uid: string) => `parley.undelivered.${uid}`
const readLocal = (uid: string): Record<string, Message[]> => { try { return JSON.parse(localStorage.getItem(localKey(uid)) ?? '{}') } catch { return {} } }
const writeLocal = (uid: string, channelId: string, rows: Message[]) => {
  try {
    const all = readLocal(uid)
    if (rows.length) all[channelId] = rows; else delete all[channelId]
    localStorage.setItem(localKey(uid), JSON.stringify(all))
  } catch { /* storage unavailable */ }
}
/** The in-app "system app" that explains undelivered messages: a friendly frog. */
const FROG = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#57c26b"/><circle cx="20" cy="22" r="9" fill="#57c26b" stroke="#3f9a52" stroke-width="2"/><circle cx="44" cy="22" r="9" fill="#57c26b" stroke="#3f9a52" stroke-width="2"/><circle cx="20" cy="22" r="6" fill="#fff"/><circle cx="44" cy="22" r="6" fill="#fff"/><circle cx="21.5" cy="23" r="3" fill="#1f2937"/><circle cx="45.5" cy="23" r="3" fill="#1f2937"/><circle cx="22.5" cy="21.5" r="1" fill="#fff"/><circle cx="46.5" cy="21.5" r="1" fill="#fff"/><path d="M18 40q14 12 28 0" fill="none" stroke="#1f2937" stroke-width="3" stroke-linecap="round"/><circle cx="14" cy="36" r="3.5" fill="#f28ba8" opacity="0.8"/><circle cx="50" cy="36" r="3.5" fill="#f28ba8" opacity="0.8"/></svg>`)
export const RIBBIT = { id: 'ribbit', username: 'ribbit', display_name: 'Ribbit', avatar_url: FROG, bio: '', status: '', created_at: new Date(0).toISOString(), banner_url: null, theme_primary: null, theme_accent: null, pronouns: '', name_primary: null } as unknown as User
import type { Poll, ThreadInfo } from './lib/types'
import type { Ban, Channel, DmChannel, Draft, Emoji, Guild, LayoutItem, Member, Message, PeerStatus, PrivateUser, ReadState, Relationship, RemoteMedia, Role, Sticker, User, UserNote, VoiceState } from './lib/types'
import { reconcile } from './lib/layout'
import { effective, mutedTarget, type NotifSetting } from './lib/notify'
import { channelPerms, guildPerms } from './lib/perms'

export type ModalKind =
  | { kind: 'createGuild' }
  | { kind: 'joinGuild'; code?: string }
  | { kind: 'createChannel'; guildId: string; parentId?: string | null }
  | { kind: 'invite'; guildId: string }
  | { kind: 'guildSettings'; guildId: string; tab?: 'overview' | 'roles' | 'members' | 'bans' | 'emoji' | 'stickers' | 'discovery' | 'audit' }
  | { kind: 'channelSettings'; channelId: string; tab?: 'overview' | 'permissions' }
  | { kind: 'userSettings'; tab?: 'account' | 'profile' | 'voice' | 'appearance' }
  | { kind: 'newDm' }
  | { kind: 'profile'; userId: string; anchor?: Anchor }
  | { kind: 'image'; url: string; name: string }
  | { kind: 'confirm'; title: string; body: string; action: () => Promise<void> | void; danger?: boolean; confirmLabel?: string }
  | { kind: 'ban'; guildId: string; userId: string }
  | { kind: 'timeout'; guildId: string; userId: string }
  | { kind: 'editHistory'; channelId: string; messageId: string }
  | { kind: 'report'; messageId?: string; userId: string; name: string }
  | { kind: 'createPoll'; channelId: string }
  | { kind: 'editCategory'; channelId: string }
  | { kind: 'createThread'; channelId: string; messageId?: string; suggested?: string }
  | { kind: 'newPost'; channelId: string }
  | { kind: 'transferOwnership'; guildId: string; userId?: string }
  | { kind: 'customStatus' }
  | { kind: 'forward'; message: Message }
  | { kind: 'groupMembers'; channelId?: string; userIds?: string[] }
  | { kind: 'folderSettings'; folderId: string }

export interface ReadyPayload {
  user: PrivateUser
  guilds: Guild[]
  channels: Channel[]
  roles: Role[]
  emojis?: Emoji[]
  stickers?: Sticker[]
  bookmarks?: string[]
  guild_layout?: LayoutItem[]
  mention_counts?: { channel_id: string; count: number }[]
  notification_settings?: NotifSetting[]
  me_members: Member[]
  dm_channels: DmChannel[]
  relationships?: Relationship[]
  online: string[]
  read_states: ReadState[]
  last_message_ids: { channel_id: string; message_id: string }[]
  voice_states: VoiceState[]
  ice_servers: RTCIceServer[]
}

interface State {
  token: string | null
  user: PrivateUser | null
  ready: boolean
  connected: boolean

  guilds: Record<string, Guild>
  guildOrder: string[]
  /** The server bar: ordering and folders, per user, saved server-side. Always reconciled with `guildOrder`. */
  guildLayout: LayoutItem[]
  channels: Record<string, Channel>
  dms: Record<string, DmChannel>
  /** Friends, pending requests and blocks keyed by the other user's id. */
  relationships: Record<string, Relationship>
  /** Your friend nicknames and private notes, by user id. */
  notes: Record<string, UserNote>
  loadNotes: () => Promise<void>
  setNote: (userId: string, patch: { nickname?: string; note?: string }) => Promise<void>
  members: Record<string, Record<string, Member>>
  membersLoaded: Record<string, true>
  /** guildId -> userId -> ban (loaded on demand for moderators) */
  bans: Record<string, Record<string, Ban>>
  bansLoaded: Record<string, true>
  /** guildId -> roleId -> role */
  roles: Record<string, Record<string, Role>>
  /** Custom emoji and stickers per server, sorted by name. */
  emojis: Record<string, Emoji[]>
  stickers: Record<string, Sticker[]>
  /** Message ids the user has bookmarked. */
  bookmarks: Record<string, true>
  /** Unread messages per channel that mention me (direct, role or @everyone). */
  mentionCounts: Record<string, number>
  /** Per-server / per-channel notification settings, keyed by target id. */
  notifSettings: Record<string, NotifSetting>
  messages: Record<string, Message[]>
  hasMore: Record<string, boolean>
  /** True while a channel shows a window from the past (after a jump); newer pages load on scroll-down and live messages wait until Jump to Present. */
  hasNewer: Record<string, boolean>
  /** Replace the channel's list with a window around a message id (or a uuid v7 built from a date). */
  loadAround: (channelId: string, anchor: string) => Promise<void>
  loadNewer: (channelId: string) => Promise<void>
  loadLatest: (channelId: string) => Promise<void>
  loadingMessages: Record<string, boolean>
  online: Record<string, true>
  users: Record<string, User>
  typing: Record<string, Record<string, number>>
  readStates: Record<string, string | null>
  lastMessageId: Record<string, string>
  activeChannelId: string | null
  /** Mobile only: which pane is on screen. */
  mobilePane: 'nav' | 'content'
  /** Member list visible (desktop sidebar / mobile overlay). */
  membersOpen: boolean
  /** DM view: the recipient's profile panel on the right (desktop). */
  dmProfileOpen: boolean
  // voice
  voiceStates: Record<string, VoiceState>
  iceServers: RTCIceServer[]
  myVoiceChannelId: string | null
  voiceConnecting: boolean
  selfMute: boolean
  selfDeaf: boolean
  speaking: Record<string, true>
  peerStatus: Record<string, PeerStatus>
  localCamera: MediaStream | null
  localScreen: MediaStream | null
  remoteMedia: Record<string, RemoteMedia>
  voiceSettings: VoiceSettings
  /** Local mic level in dBFS (-100..0), published while the mic is open. */
  inputLevel: number
  /** Whether the input gate is currently open (voice detected / PTT held). */
  transmitting: boolean
  pttHeld: boolean
  modal: ModalKind | null
  /** Instance-wide settings from GET /instance (registration, announcement banner). */
  instance: { registration_enabled: boolean; announcement: string; require_email_verification?: boolean; mail_enabled?: boolean; voice_mode?: 'mesh' | 'sfu'; livekit_url?: string; transcription?: boolean }
  toast: { id: number; text: string; kind: 'info' | 'error' }[]

  // auth
  setAuth: (token: string, user: PrivateUser) => void
  logout: () => void
  // ws lifecycle
  applyReady: (r: ReadyPayload) => void
  setConnected: (c: boolean) => void
  // mutations
  upsertGuild: (g: Guild & { channels?: Channel[]; roles?: Role[]; emojis?: Emoji[]; stickers?: Sticker[] }) => void
  setGuildEmojis: (guildId: string, emojis: Emoji[]) => void
  setGuildStickers: (guildId: string, stickers: Sticker[]) => void
  setBookmark: (messageId: string, on: boolean) => void
  /** Replace the server bar layout; `save` also PUTs it to the server. */
  setGuildLayout: (items: LayoutItem[], save?: boolean) => void
  setInstance: (i: { registration_enabled: boolean; announcement: string; require_email_verification?: boolean; mail_enabled?: boolean; voice_mode?: 'mesh' | 'sfu'; livekit_url?: string; transcription?: boolean }) => void
  setNotifSetting: (s: NotifSetting & { deleted?: boolean }) => void
  /** PUT a notification setting (level / mute / suppress) for a server, channel or DM. */
  updateNotif: (target: string, body: { level?: string; mute_minutes?: number; unmute?: boolean; suppress_everyone?: boolean }) => Promise<void>
  upsertRelationship: (r: Relationship) => void
  removeRelationship: (userId: string) => void
  upsertRole: (r: Role) => void
  removeRole: (guildId: string, roleId: string) => void
  setRoles: (guildId: string, roles: Role[]) => void
  removeGuild: (id: string) => void
  upsertChannel: (c: Channel | DmChannel) => void
  removeChannel: (id: string) => void
  setMembers: (guildId: string, m: Member[]) => void
  upsertMember: (m: Member) => void
  removeMember: (guildId: string, userId: string) => void
  setBans: (guildId: string, bans: Ban[]) => void
  upsertBan: (b: Ban) => void
  removeBan: (guildId: string, userId: string) => void
  addMessage: (m: Message) => void
  updateMessage: (m: Message) => void
  removeMessage: (channelId: string, id: string) => void
  prependMessages: (channelId: string, ms: Message[], hasMore: boolean) => void
  setLoadingMessages: (channelId: string, v: boolean) => void
  applyReaction: (channelId: string, messageId: string, emoji: string, userId: string, add: boolean) => void
  /** Merge a POLL_UPDATE (counts/closed) while keeping this viewer's own `me` flags. */
  applyPollUpdate: (channelId: string, messageId: string, poll: Poll) => void
  sendPoll: (channelId: string, poll: { question: string; options: string[]; multi: boolean; duration_hours: number | null }) => Promise<void>
  setPresence: (userId: string, online: boolean) => void
  upsertUser: (u: User) => void
  setTyping: (channelId: string, userId: string) => void
  pruneTyping: () => void
  setReadState: (channelId: string, msgId: string | null) => void
  /** channel -> other user -> newest message they have read (read receipts). */
  receipts: Record<string, Record<string, string>>
  setReceipts: (channelId: string, list: { user_id: string; message_id: string }[]) => void
  applyReceipt: (channelId: string, userId: string, messageId: string) => void
  /** Someone listened to a voice message: add them to the attachment's listened_by. */
  applyListened: (channelId: string, messageId: string, attachmentId: string, userId: string) => void
  /** The server refused to deliver a DM: keep it in the list in red with a Ribbit notice under it. */
  failDelivery: (channelId: string, draft: Draft) => void
  /** Send a failed message again; on success it becomes a real message and the notice goes away. */
  retryLocal: (channelId: string, id: string) => Promise<void>
  /** Remove a failed message (and its notice) or just a notice. */
  discardLocal: (channelId: string, id: string) => void
  /** Load older pages (up to 60) until `messageId` is in the list (jumping to pins, bookmarks, search hits, reply originals). Returns whether it is loaded. */
  loadUntil: (channelId: string, messageId: string) => Promise<boolean>
  setActiveChannel: (id: string | null) => void
  setMobilePane: (p: 'nav' | 'content') => void
  setMembersOpen: (open: boolean) => void
  setDmProfileOpen: (open: boolean) => void
  applyVoiceState: (v: VoiceState) => void
  setMyVoice: (channelId: string | null, connecting?: boolean) => void
  setSelfVoiceFlags: (mute: boolean, deaf: boolean) => void
  setSpeaking: (userId: string, on: boolean) => void
  setPeerStatus: (userId: string, status: PeerStatus | null) => void
  setLocalMedia: (m: { camera?: MediaStream | null; screen?: MediaStream | null }) => void
  setRemoteMedia: (userId: string, kind: 'camera' | 'screen', stream: MediaStream | null) => void
  updateVoiceSettings: (patch: Partial<VoiceSettings>) => void
  setInputLevel: (level: number, transmitting: boolean) => void
  setPttHeld: (held: boolean) => void
  openModal: (m: ModalKind) => void
  /** Thread shown in the side panel (a channel of kind 'thread'), or null. */
  openThread: string | null
  setOpenThread: (id: string | null) => void
  /** Thread metadata by id (from THREAD_UPDATE / list loads). */
  threads: Record<string, ThreadInfo>
  upsertThread: (t: ThreadInfo) => void
  closeModal: () => void
  pushToast: (text: string, kind?: 'info' | 'error') => void
  dismissToast: (id: number) => void

  // async actions
  loadMessages: (channelId: string, before?: string) => Promise<void>
  loadMembers: (guildId: string) => Promise<void>
  loadBans: (guildId: string) => Promise<void>
  sendMessage: (channelId: string, content: string, replyTo?: string | null, attachmentIds?: string[], stickerId?: string | null) => Promise<void>
  markRead: (channelId: string) => Promise<void>
}

let toastSeq = 1

/** On first load, land on the content pane only if the URL already points at a channel. */
function initialPane(): 'nav' | 'content' {
  if (typeof window === 'undefined') return 'nav'
  return /^\/channels\/[^/]+\/[^/]+/.test(window.location.pathname) ? 'content' : 'nav'
}

export const useStore = create<State>((set, get) => ({
  token: getToken(),
  user: null,
  ready: false,
  connected: false,
  guilds: {},
  guildOrder: [],
  guildLayout: [],
  instance: { registration_enabled: true, announcement: '' },
  channels: {},
  dms: {},
  relationships: {},
  notes: {},
  loadNotes: async () => { try { const list = await api.get<UserNote[]>('/users/@me/notes'); set({ notes: Object.fromEntries(list.map((n) => [n.user_id, n])) }) } catch { /* keep what we have */ } },
  setNote: async (userId, patch) => { const n = await api.put<UserNote>(`/users/@me/notes/${userId}`, patch); set((s) => { const notes = { ...s.notes }; if (n.nickname || n.note) notes[userId] = n; else delete notes[userId]; return { notes } }) },
  members: {},
  membersLoaded: {},
  bans: {},
  bansLoaded: {},
  roles: {},
  emojis: {},
  stickers: {},
  bookmarks: {},
  mentionCounts: {},
  notifSettings: {},
  messages: {},
  hasMore: {},
  hasNewer: {},
  loadingMessages: {},
  online: {},
  users: {},
  typing: {},
  readStates: {},
  receipts: {},
  lastMessageId: {},
  activeChannelId: null,
  mobilePane: initialPane(),
  membersOpen: typeof window !== 'undefined' && window.innerWidth >= 1024,
  dmProfileOpen: (() => { try { return localStorage.getItem(STORAGE_PREFIX + 'dmProfile') !== '0' } catch { return true } })(),
  voiceStates: {},
  iceServers: [],
  myVoiceChannelId: null,
  voiceConnecting: false,
  selfMute: false,
  selfDeaf: false,
  speaking: {},
  peerStatus: {},
  localCamera: null,
  localScreen: null,
  remoteMedia: {},
  voiceSettings: loadSettings(),
  inputLevel: -100,
  transmitting: false,
  pttHeld: false,
  modal: null,
  toast: [],

  setAuth: (token, user) => {
    setToken(token)
    set({ token, user })
  },
  logout: () => {
    // Best effort: end the session server-side so the token is dead even if a copy survives. Already-revoked
    // sessions (SESSION_REVOKED, 401) just fail quietly.
    if (getToken()) api.post('/auth/logout').catch(() => {})
    setToken(null)
    set({
      token: null, user: null, ready: false, connected: false, guilds: {}, guildOrder: [], guildLayout: [], channels: {}, dms: {}, relationships: {},
      members: {}, membersLoaded: {}, bans: {}, bansLoaded: {}, roles: {}, emojis: {}, stickers: {}, bookmarks: {}, mentionCounts: {}, notifSettings: {}, messages: {}, hasMore: {}, online: {}, users: {}, typing: {}, readStates: {}, lastMessageId: {}, modal: null,
      voiceStates: {}, myVoiceChannelId: null, voiceConnecting: false, speaking: {}, peerStatus: {}, localCamera: null, localScreen: null, remoteMedia: {},
    })
  },

  applyReady: (r) => {
    const guilds: Record<string, Guild> = {}
    r.guilds.forEach((g) => (guilds[g.id] = g))
    const channels: Record<string, Channel> = {}
    r.channels.forEach((c) => (channels[c.id] = c))
    const dms: Record<string, DmChannel> = {}
    const users: Record<string, User> = { ...get().users }
    r.dm_channels.forEach((d) => {
      dms[d.id] = d
      d.recipients.forEach((u) => (users[u.id] = u))
    })
    const relationships: Record<string, Relationship> = {}
    ;(r.relationships ?? []).forEach((rel) => { relationships[rel.user.id] = rel; users[rel.user.id] = rel.user })
    const online: Record<string, true> = {}
    r.online.forEach((id) => (online[id] = true))
    const readStates: Record<string, string | null> = {}
    r.read_states.forEach((rs) => (readStates[rs.channel_id] = rs.last_read_msg))
    const lastMessageId: Record<string, string> = {}
    r.last_message_ids.forEach((l) => (lastMessageId[l.channel_id] = l.message_id))
    const voiceStates: Record<string, VoiceState> = {}
    r.voice_states.forEach((v) => (voiceStates[v.user_id] = v))
    const roles: Record<string, Record<string, Role>> = {}
    ;(r.roles ?? []).forEach((role) => { (roles[role.guild_id] ??= {})[role.id] = role })
    const emojis: Record<string, Emoji[]> = {}
    r.guilds.forEach((g) => (emojis[g.id] = []))
    ;(r.emojis ?? []).forEach((e) => (emojis[e.guild_id] ??= []).push(e))
    const stickers: Record<string, Sticker[]> = {}
    r.guilds.forEach((g) => (stickers[g.id] = []))
    ;(r.stickers ?? []).forEach((st) => (stickers[st.guild_id] ??= []).push(st))
    // Seed our own member row per guild so permission checks work before the full member list loads.
    const members: Record<string, Record<string, Member>> = {}
    ;(r.me_members ?? []).forEach((m) => { members[m.guild_id] = { [m.user_id]: m } })
    const bookmarks: Record<string, true> = {}
    ;(r.bookmarks ?? []).forEach((id) => (bookmarks[id] = true))
    const guildLayout = reconcile(r.guild_layout ?? [], r.guilds.map((g) => g.id))
    const mentionCounts: Record<string, number> = {}
    ;(r.mention_counts ?? []).forEach((m) => (mentionCounts[m.channel_id] = m.count))
    const notifSettings: Record<string, NotifSetting> = {}
    ;(r.notification_settings ?? []).forEach((n) => (notifSettings[n.target_id] = n))
    set({
      voiceStates, iceServers: r.ice_servers ?? [],
      // READY is a snapshot taken when the socket connected; a verification that landed in between must not be undone.
      user: (() => { const cur = get().user; return cur?.id === r.user.id && cur.email_verified_at && !r.user.email_verified_at ? { ...r.user, email_verified_at: cur.email_verified_at } : r.user })(), guilds, guildOrder: r.guilds.map((g) => g.id), channels, dms, relationships, online, users, readStates, lastMessageId, roles, emojis, stickers, bookmarks, guildLayout, mentionCounts, notifSettings,
      ready: true, connected: true,
      // Drop cached messages/members on (re)connect: we may have missed events.
      messages: {}, hasMore: {}, members, membersLoaded: {}, bans: {}, bansLoaded: {},
    })
  },
  setConnected: (connected) => set({ connected }),

  upsertGuild: (g) => set((s) => {
    const { channels: gchannels, roles: groles, emojis: gemojis, stickers: gstickers, ...guild } = g
    const channels = { ...s.channels }
    gchannels?.forEach((c) => (channels[c.id] = c))
    const guildOrder = s.guildOrder.includes(guild.id) ? s.guildOrder : [...s.guildOrder, guild.id]
    const roles = groles ? { ...s.roles, [guild.id]: Object.fromEntries(groles.map((r) => [r.id, r])) } : s.roles
    const emojis = gemojis || !s.emojis[guild.id] ? { ...s.emojis, [guild.id]: gemojis ?? [] } : s.emojis
    const stickers = gstickers || !s.stickers[guild.id] ? { ...s.stickers, [guild.id]: gstickers ?? [] } : s.stickers
    const guildLayout = reconcile(s.guildLayout, guildOrder)
    return { guilds: { ...s.guilds, [guild.id]: { ...s.guilds[guild.id], ...guild } }, channels, guildOrder, roles, emojis, stickers, guildLayout }
  }),
  setGuildEmojis: (guildId, emojis) => set((s) => ({ emojis: { ...s.emojis, [guildId]: emojis } })),
  setGuildStickers: (guildId, stickers) => set((s) => ({ stickers: { ...s.stickers, [guildId]: stickers } })),
  setInstance: (instance) => set({ instance }),
  setNotifSetting: (n) => set((s) => { const notifSettings = { ...s.notifSettings }; if (n.deleted) delete notifSettings[n.target_id]; else notifSettings[n.target_id] = n; return { notifSettings } }),
  updateNotif: async (target, body) => {
    try { const n = await api.put<NotifSetting>(`/users/@me/notification-settings/${target}`, body); get().setNotifSetting(n) } catch (e) { get().pushToast((e as Error).message, 'error') }
  },
  setGuildLayout: (items, save) => {
    const layout = reconcile(items, get().guildOrder)
    set({ guildLayout: layout })
    if (save) api.put('/users/@me/guild-layout', layout).catch((e: Error) => get().pushToast(`Could not save server layout: ${e.message}`, 'error'))
  },
  setBookmark: (messageId, on) => set((s) => { const bookmarks = { ...s.bookmarks }; if (on) bookmarks[messageId] = true; else delete bookmarks[messageId]; return { bookmarks } }),
  upsertRelationship: (r) => set((s) => ({ relationships: { ...s.relationships, [r.user.id]: r }, users: { ...s.users, [r.user.id]: r.user } })),
  removeRelationship: (userId) => set((s) => { const relationships = { ...s.relationships }; delete relationships[userId]; return { relationships } }),
  upsertRole: (r) => set((s) => ({ roles: { ...s.roles, [r.guild_id]: { ...(s.roles[r.guild_id] ?? {}), [r.id]: r } } })),
  removeRole: (guildId, roleId) => set((s) => {
    const g = { ...(s.roles[guildId] ?? {}) }; delete g[roleId]
    // Members lose the role too.
    const gm = s.members[guildId]
    const members = gm ? { ...s.members, [guildId]: Object.fromEntries(Object.entries(gm).map(([id, m]) => [id, m.roles.includes(roleId) ? { ...m, roles: m.roles.filter((x) => x !== roleId) } : m])) } : s.members
    return { roles: { ...s.roles, [guildId]: g }, members }
  }),
  setRoles: (guildId, list) => set((s) => ({ roles: { ...s.roles, [guildId]: Object.fromEntries(list.map((r) => [r.id, r])) } })),
  removeGuild: (id) => set((s) => {
    const guilds = { ...s.guilds }; delete guilds[id]
    const roles = { ...s.roles }; delete roles[id]
    const emojis = { ...s.emojis }; delete emojis[id]
    const stickers = { ...s.stickers }; delete stickers[id]
    const channels = { ...s.channels }
    Object.values(channels).forEach((c) => { if (c.guild_id === id) delete channels[c.id] })
    const members = { ...s.members }; delete members[id]
    const membersLoaded = { ...s.membersLoaded }; delete membersLoaded[id]
    const voiceStates = { ...s.voiceStates }
    Object.values(voiceStates).forEach((v) => { if (v.guild_id === id) delete voiceStates[v.user_id] })
    const guildOrder = s.guildOrder.filter((g) => g !== id)
    return { guilds, channels, members, membersLoaded, voiceStates, roles, emojis, stickers, guildOrder, guildLayout: reconcile(s.guildLayout, guildOrder) }
  }),
  upsertChannel: (c) => set((s) => {
    if (c.guild_id === null && 'recipients' in c) {
      const users = { ...s.users }
      c.recipients.forEach((u) => (users[u.id] = u))
      return { dms: { ...s.dms, [c.id]: c }, users }
    }
    return { channels: { ...s.channels, [c.id]: c } }
  }),
  removeChannel: (id) => set((s) => {
    const channels = { ...s.channels }; delete channels[id]
    const dms = { ...s.dms }; delete dms[id]
    const messages = { ...s.messages }; delete messages[id]
    return { channels, dms, messages }
  }),
  setMembers: (guildId, ms) => set((s) => {
    const map: Record<string, Member> = {}
    const users = { ...s.users }
    ms.forEach((m) => {
      map[m.user_id] = m
      const prev = users[m.user_id] as User | undefined
      users[m.user_id] = { id: m.user_id, username: m.username, display_name: m.display_name, avatar_url: m.avatar_url, status: m.status, bio: prev?.bio ?? '', created_at: prev?.created_at ?? m.joined_at, banner_url: prev?.banner_url ?? null, theme_primary: prev?.theme_primary ?? null, theme_accent: prev?.theme_accent ?? null, pronouns: prev?.pronouns ?? '', name_primary: prev?.name_primary ?? null, name_accent: prev?.name_accent ?? null, custom_status: m.custom_status ?? prev?.custom_status ?? '' }
    })
    return { members: { ...s.members, [guildId]: map }, membersLoaded: { ...s.membersLoaded, [guildId]: true }, users }
  }),
  upsertMember: (m) => set((s) => ({
    members: { ...s.members, [m.guild_id]: { ...(s.members[m.guild_id] ?? {}), [m.user_id]: m } },
  })),
  removeMember: (guildId, userId) => set((s) => {
    const g = { ...(s.members[guildId] ?? {}) }; delete g[userId]
    return { members: { ...s.members, [guildId]: g } }
  }),
  setBans: (guildId, bs) => set((s) => ({
    bans: { ...s.bans, [guildId]: Object.fromEntries(bs.map((b) => [b.user_id, b])) }, bansLoaded: { ...s.bansLoaded, [guildId]: true },
  })),
  upsertBan: (b) => set((s) => ({ bans: { ...s.bans, [b.guild_id]: { ...(s.bans[b.guild_id] ?? {}), [b.user_id]: b } } })),
  removeBan: (guildId, userId) => set((s) => {
    const g = { ...(s.bans[guildId] ?? {}) }; delete g[userId]
    return { bans: { ...s.bans, [guildId]: g } }
  }),
  addMessage: (m) => set((s) => {
    const list = s.messages[m.channel_id]
    // A replayed or re-delivered event must not count twice.
    if (list?.some((x) => x.id === m.id)) return {}
    const users = { ...s.users, [m.author.id]: { ...s.users[m.author.id], ...m.author, bio: s.users[m.author.id]?.bio ?? '', status: s.users[m.author.id]?.status ?? '' } }
    const lastMessageId = { ...s.lastMessageId, [m.channel_id]: m.id }
    // Your own messages (sent, forwarded, from any device) never count as unread for you.
    const readStates = m.author.id === s.user?.id ? { ...s.readStates, [m.channel_id]: m.id } : s.readStates
    const mentionCounts = m.author.id !== s.user?.id && mentionsMe(s, m) ? { ...s.mentionCounts, [m.channel_id]: (s.mentionCounts[m.channel_id] ?? 0) + 1 } : s.mentionCounts
    const typing = { ...s.typing }
    if (typing[m.channel_id]?.[m.author.id]) {
      typing[m.channel_id] = { ...typing[m.channel_id] }; delete typing[m.channel_id][m.author.id]
    }
    const dms = s.dms[m.channel_id] ? { ...s.dms, [m.channel_id]: { ...s.dms[m.channel_id], last_message_at: m.created_at } } : s.dms
    if (!list || s.hasNewer[m.channel_id]) return { users, lastMessageId, readStates, mentionCounts, typing, dms }
    return { messages: { ...s.messages, [m.channel_id]: [...list, m] }, users, lastMessageId, readStates, mentionCounts, typing, dms }
  }),
  updateMessage: (m) => set((s) => {
    const list = s.messages[m.channel_id]
    if (!list) return {}
    return { messages: { ...s.messages, [m.channel_id]: list.map((x) => (x.id === m.id ? { ...m, reactions: x.reactions } : x)) } }
  }),
  removeMessage: (channelId, id) => set((s) => {
    const list = s.messages[channelId]
    if (!list) return {}
    return { messages: { ...s.messages, [channelId]: list.filter((x) => x.id !== id) } }
  }),
  prependMessages: (channelId, ms, hasMore) => set((s) => {
    const existing = s.messages[channelId] ?? []
    const ids = new Set(existing.map((m) => m.id))
    const fresh = ms.filter((m) => !ids.has(m.id))
    const merged = [...fresh, ...existing].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    // First page of a channel: bring back any undelivered rows saved for it (they sort last: ids start with "local-").
    if (s.user && !merged.some((m) => m.local)) {
      const saved = readLocal(s.user.id)[channelId]
      if (saved?.length) merged.push(...saved)
    }
    return { messages: { ...s.messages, [channelId]: merged }, hasMore: { ...s.hasMore, [channelId]: hasMore } }
  }),
  setLoadingMessages: (channelId, v) => set((s) => ({ loadingMessages: { ...s.loadingMessages, [channelId]: v } })),
  openThread: null,
  setOpenThread: (id) => set({ openThread: id }),
  threads: {},
  upsertThread: (t) => set((s) => ({ threads: { ...s.threads, [t.id]: t }, channels: s.channels[t.id] ? { ...s.channels, [t.id]: { ...s.channels[t.id], name: t.name } } : s.channels })),
  applyPollUpdate: (channelId, messageId, poll) => set((s) => {
    const list = s.messages[channelId]
    if (!list) return {}
    return { messages: { ...s.messages, [channelId]: list.map((m) => {
      if (m.id !== messageId) return m
      const mine = new Set((m.poll?.options ?? []).filter((o) => o.me).map((o) => o.id))
      return { ...m, poll: { ...poll, options: poll.options.map((o) => ({ ...o, me: mine.has(o.id) })) } }
    }) } }
  }),
  sendPoll: async (channelId, poll) => {
    const m = await api.post<Message>(`/channels/${channelId}/messages`, { content: '', poll })
    get().addMessage(m)
    get().setReadState(channelId, m.id)
  },
  applyReaction: (channelId, messageId, emoji, userId, add) => set((s) => {
    const list = s.messages[channelId]
    if (!list) return {}
    const me = s.user?.id === userId
    return {
      messages: {
        ...s.messages,
        [channelId]: list.map((m) => {
          if (m.id !== messageId) return m
          const existing = m.reactions.find((r) => r.emoji === emoji)
          let reactions = m.reactions
          if (add) {
            reactions = existing
              ? m.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, me: r.me || me } : r))
              : [...m.reactions, { emoji, count: 1, me }]
          } else if (existing) {
            reactions = m.reactions
              .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, me: me ? false : r.me } : r))
              .filter((r) => r.count > 0)
          }
          return { ...m, reactions }
        }),
      },
    }
  }),
  setPresence: (userId, isOnline) => set((s) => {
    const online = { ...s.online }
    if (isOnline) online[userId] = true; else delete online[userId]
    return { online }
  }),
  upsertUser: (u) => set((s) => {
    const members = { ...s.members }
    for (const gid of Object.keys(members)) {
      const m = members[gid][u.id]
      if (m) members[gid] = { ...members[gid], [u.id]: { ...m, display_name: u.display_name, avatar_url: u.avatar_url, status: u.status } }
    }
    const dms = { ...s.dms }
    for (const id of Object.keys(dms)) {
      if (dms[id].recipients.some((r) => r.id === u.id)) {
        dms[id] = { ...dms[id], recipients: dms[id].recipients.map((r) => (r.id === u.id ? u : r)) }
      }
    }
    const messages = { ...s.messages }
    for (const cid of Object.keys(messages)) {
      if (messages[cid].some((m) => m.author.id === u.id)) {
        messages[cid] = messages[cid].map((m) => (m.author.id === u.id ? { ...m, author: { ...m.author, ...u } } : m))
      }
    }
    const user = s.user && s.user.id === u.id ? { ...s.user, ...u } : s.user
    const relationships = s.relationships[u.id] ? { ...s.relationships, [u.id]: { ...s.relationships[u.id], user: u } } : s.relationships
    return { users: { ...s.users, [u.id]: u }, members, dms, messages, user, relationships }
  }),
  setTyping: (channelId, userId) => set((s) => ({
    typing: { ...s.typing, [channelId]: { ...(s.typing[channelId] ?? {}), [userId]: Date.now() } },
  })),
  pruneTyping: () => set((s) => {
    const now = Date.now()
    let changed = false
    const typing: Record<string, Record<string, number>> = {}
    for (const cid of Object.keys(s.typing)) {
      const entries = Object.entries(s.typing[cid]).filter(([, t]) => now - t < 8000)
      if (entries.length !== Object.keys(s.typing[cid]).length) changed = true
      if (entries.length) typing[cid] = Object.fromEntries(entries)
    }
    return changed ? { typing } : {}
  }),
  setReadState: (channelId, msgId) => set((s) => { const mentionCounts = { ...s.mentionCounts }; if (msgId && msgId === s.lastMessageId[channelId]) delete mentionCounts[channelId]; return { readStates: { ...s.readStates, [channelId]: msgId }, mentionCounts } }),
  setActiveChannel: (id) => set({ activeChannelId: id }),
  setMobilePane: (mobilePane) => set({ mobilePane }),
  setMembersOpen: (membersOpen) => set({ membersOpen }),
  setDmProfileOpen: (open) => { try { localStorage.setItem(STORAGE_PREFIX + 'dmProfile', open ? '1' : '0') } catch { /* ignore */ } set({ dmProfileOpen: open }) },
  applyVoiceState: (v) => set((s) => {
    const voiceStates = { ...s.voiceStates }
    if (v.channel_id) voiceStates[v.user_id] = v; else delete voiceStates[v.user_id]
    const speaking = { ...s.speaking }
    if (!v.channel_id) delete speaking[v.user_id]
    return { voiceStates, speaking }
  }),
  setMyVoice: (channelId, connecting = false) => set({ myVoiceChannelId: channelId, voiceConnecting: connecting, ...(channelId ? {} : { speaking: {}, peerStatus: {}, remoteMedia: {}, localCamera: null, localScreen: null }) }),
  setSelfVoiceFlags: (selfMute, selfDeaf) => set({ selfMute, selfDeaf }),
  setSpeaking: (userId, on) => set((s) => {
    if (!!s.speaking[userId] === on) return {}
    const speaking = { ...s.speaking }
    if (on) speaking[userId] = true; else delete speaking[userId]
    return { speaking }
  }),
  setPeerStatus: (userId, status) => set((s) => {
    const peerStatus = { ...s.peerStatus }
    if (status) peerStatus[userId] = status; else delete peerStatus[userId]
    const remoteMedia = { ...s.remoteMedia }
    if (!status) delete remoteMedia[userId]
    return { peerStatus, remoteMedia }
  }),
  updateVoiceSettings: (patch) => set((s) => {
    const voiceSettings = { ...s.voiceSettings, ...patch }
    saveSettings(voiceSettings)
    return { voiceSettings }
  }),
  setInputLevel: (inputLevel, transmitting) => set((s) => (s.inputLevel === inputLevel && s.transmitting === transmitting ? {} : { inputLevel, transmitting })),
  setPttHeld: (pttHeld) => set((s) => (s.pttHeld === pttHeld ? {} : { pttHeld })),
  setLocalMedia: (m) => set((s) => ({ localCamera: m.camera === undefined ? s.localCamera : m.camera, localScreen: m.screen === undefined ? s.localScreen : m.screen })),
  setRemoteMedia: (userId, kind, stream) => set((s) => ({
    remoteMedia: { ...s.remoteMedia, [userId]: { ...(s.remoteMedia[userId] ?? { camera: null, screen: null }), [kind]: stream } },
  })),
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  pushToast: (text, kind = 'info') => {
    const id = toastSeq++
    set((s) => ({ toast: [...s.toast, { id, text, kind }] }))
    setTimeout(() => get().dismissToast(id), 4000)
  },
  dismissToast: (id) => set((s) => ({ toast: s.toast.filter((t) => t.id !== id) })),

  setReceipts: (channelId, list) => set((s) => ({ receipts: { ...s.receipts, [channelId]: Object.fromEntries(list.map((r) => [r.user_id, r.message_id])) } })),
  applyReceipt: (channelId, userId, messageId) => set((s) => { const cur = s.receipts[channelId]?.[userId]; if (cur && cur >= messageId) return {}; return { receipts: { ...s.receipts, [channelId]: { ...(s.receipts[channelId] ?? {}), [userId]: messageId } } } }),
  failDelivery: (channelId, draft) => set((s) => {
    const me = s.user; if (!me) return {}
    const n = ++localSeq
    const content = draft.content || (draft.sticker_id ? 'Sticker' : draft.attachment_ids.length ? `${draft.attachment_ids.length} attachment${draft.attachment_ids.length === 1 ? '' : 's'}` : '')
    const now = new Date().toISOString()
    const failed: Message = { id: `local-failed-${n}`, channel_id: channelId, author: me, content, reply_to: draft.reply_to, created_at: now, edited_at: null, pinned_at: null, reactions: [], attachments: [], kind: 'default', local: 'failed', draft }
    const notice: Message = { id: `local-notice-${n}`, channel_id: channelId, author: RIBBIT, content: '', reply_to: null, created_at: now, edited_at: null, pinned_at: null, reactions: [], attachments: [], kind: 'ribbit', local: 'notice', ref_id: failed.id }
    const list = [...(s.messages[channelId] ?? []), failed, notice]
    writeLocal(me.id, channelId, list.filter((m) => m.local))
    return { messages: { ...s.messages, [channelId]: list } }
  }),
  retryLocal: async (channelId, id) => {
    const m = (get().messages[channelId] ?? []).find((x) => x.id === id)
    if (!m?.draft) return
    try {
      const sent = await api.post<Message>(`/channels/${channelId}/messages`, { content: m.draft.content, reply_to: m.draft.reply_to, attachment_ids: m.draft.attachment_ids, sticker_id: m.draft.sticker_id })
      get().discardLocal(channelId, id)
      get().addMessage(sent)
      get().setReadState(channelId, sent.id)
    } catch (e) {
      if ((e as { code?: string }).code !== 'undeliverable') get().pushToast((e as Error).message, 'error')
    }
  },
  discardLocal: (channelId, id) => set((s) => {
    const list = s.messages[channelId]
    if (!list) return {}
    const next = list.filter((x) => x.id !== id && x.ref_id !== id)
    if (s.user) writeLocal(s.user.id, channelId, next.filter((m) => m.local))
    return { messages: { ...s.messages, [channelId]: next } }
  }),
  applyListened: (channelId, messageId, attachmentId, userId) => set((s) => {
    const list = s.messages[channelId]
    if (!list?.some((m) => m.id === messageId)) return {}
    return { messages: { ...s.messages, [channelId]: list.map((m) => (m.id !== messageId ? m : { ...m, attachments: (m.attachments ?? []).map((a) => (a.id !== attachmentId || a.listened_by?.includes(userId) ? a : { ...a, listened_by: [...(a.listened_by ?? []), userId] })) })) } }
  }),
  loadUntil: async (channelId, messageId) => {
    for (let i = 0; i < 60; i++) {
      const list = get().messages[channelId] ?? []
      if (list.some((m) => m.id === messageId)) return true
      if (!list.length || get().hasMore[channelId] === false || list[0].id < messageId) return false
      await get().loadMessages(channelId, list[0].id)
      if ((get().messages[channelId] ?? []).length === list.length) return false
    }
    return false
  },
  loadAround: async (channelId, anchor) => {
    const s = get()
    if (s.loadingMessages[channelId]) return
    s.setLoadingMessages(channelId, true)
    try {
      const ms = await api.get<Message[]>(`/channels/${channelId}/messages?around=${anchor}&limit=50`)
      const older = ms.filter((m) => m.id <= anchor).length, newer = ms.length - older
      const local = (get().messages[channelId] ?? []).filter((m) => m.local)
      set((st) => ({ messages: { ...st.messages, [channelId]: [...ms, ...local] }, hasMore: { ...st.hasMore, [channelId]: older >= 25 }, hasNewer: { ...st.hasNewer, [channelId]: newer >= 25 } }))
    } catch (e) {
      get().pushToast((e as Error).message, 'error')
    } finally {
      get().setLoadingMessages(channelId, false)
    }
  },
  loadNewer: async (channelId) => {
    const s = get()
    if (s.loadingMessages[channelId] || !s.hasNewer[channelId]) return
    const list = (s.messages[channelId] ?? []).filter((m) => !m.local)
    if (!list.length) return
    s.setLoadingMessages(channelId, true)
    try {
      const ms = await api.get<Message[]>(`/channels/${channelId}/messages?after=${list[list.length - 1].id}&limit=50`)
      set((st) => {
        const cur = st.messages[channelId] ?? []
        const ids = new Set(cur.map((m) => m.id))
        const fresh = ms.filter((m) => !ids.has(m.id))
        const real = cur.filter((m) => !m.local), local = cur.filter((m) => m.local)
        return { messages: { ...st.messages, [channelId]: [...real, ...fresh, ...local] }, hasNewer: { ...st.hasNewer, [channelId]: ms.length === 50 } }
      })
    } catch (e) {
      get().pushToast((e as Error).message, 'error')
    } finally {
      get().setLoadingMessages(channelId, false)
    }
  },
  loadLatest: async (channelId) => {
    const s = get()
    if (s.loadingMessages[channelId]) return
    s.setLoadingMessages(channelId, true)
    try {
      const ms = await api.get<Message[]>(`/channels/${channelId}/messages?limit=50`)
      const local = (get().messages[channelId] ?? []).filter((m) => m.local)
      set((st) => ({ messages: { ...st.messages, [channelId]: [...ms, ...local] }, hasMore: { ...st.hasMore, [channelId]: ms.length === 50 }, hasNewer: { ...st.hasNewer, [channelId]: false } }))
    } catch (e) {
      get().pushToast((e as Error).message, 'error')
    } finally {
      get().setLoadingMessages(channelId, false)
    }
  },
  loadMessages: async (channelId, before) => {
    const s = get()
    if (s.loadingMessages[channelId]) return
    if (before && s.hasMore[channelId] === false) return
    s.setLoadingMessages(channelId, true)
    try {
      const q = before ? `?before=${before}&limit=50` : '?limit=50'
      const ms = await api.get<Message[]>(`/channels/${channelId}/messages${q}`)
      get().prependMessages(channelId, ms, ms.length === 50)
    } catch (e) {
      get().pushToast((e as Error).message, 'error')
    } finally {
      get().setLoadingMessages(channelId, false)
    }
  },
  loadMembers: async (guildId) => {
    try {
      const ms = await api.get<Member[]>(`/guilds/${guildId}/members`)
      get().setMembers(guildId, ms)
    } catch { /* ignore */ }
  },
  loadBans: async (guildId) => {
    try {
      const bs = await api.get<Ban[]>(`/guilds/${guildId}/bans`)
      get().setBans(guildId, bs)
    } catch { /* ignore */ }
  },
  sendMessage: async (channelId, content, replyTo, attachmentIds = [], stickerId = null) => {
    const m = await api.post<Message>(`/channels/${channelId}/messages`, { content, reply_to: replyTo ?? null, attachment_ids: attachmentIds, sticker_id: stickerId })
    get().addMessage(m)
    get().setReadState(channelId, m.id)
  },
  markRead: async (channelId) => {
    const s = get()
    const last = s.lastMessageId[channelId]
    if (!last || s.readStates[channelId] === last) return
    s.setReadState(channelId, last)
    try { await api.put(`/channels/${channelId}/read`, { message_id: last }) } catch { /* ignore */ }
  },
}))

// ---- Selectors / helpers ----
export function isUnread(s: Pick<State, 'readStates' | 'lastMessageId'>, channelId: string): boolean {
  const last = s.lastMessageId[channelId]
  if (!last) return false
  const read = s.readStates[channelId]
  return !read || read < last
}

/** Unread AND allowed to show as such: not muted, and the level is "all messages". */
export function showsUnread(s: Pick<State, 'readStates' | 'lastMessageId' | 'channels' | 'dms' | 'notifSettings'>, channelId: string): boolean {
  if (!isUnread(s, channelId)) return false
  const e = effective(s.notifSettings, s.channels[channelId] ?? s.dms[channelId])
  return !e.muted && e.level === 'all'
}

/** Mention badges show unless the place is set to "nothing" (muted places still badge mentions, like Discord). */
export function showsMentions(s: Pick<State, 'channels' | 'dms' | 'notifSettings'>, channelId: string): boolean {
  return effective(s.notifSettings, s.channels[channelId] ?? s.dms[channelId]).level !== 'nothing'
}

export function guildUnread(s: Pick<State, 'readStates' | 'lastMessageId' | 'channels' | 'dms' | 'notifSettings'>, guildId: string): boolean {
  if (mutedTarget(s.notifSettings, guildId)) return false
  // Threads only badge the server when they mention you (see guildMentions), not for every reply.
  return Object.values(s.channels).some((c) => c.guild_id === guildId && c.kind !== 'thread' && showsUnread(s, c.id))
}

export function dmUnreadCount(s: Pick<State, 'readStates' | 'lastMessageId' | 'dms' | 'channels' | 'notifSettings'>): number {
  return Object.keys(s.dms).filter((id) => showsUnread(s, id)).length
}

/** Incoming friend requests awaiting my answer. */
export function pendingCount(s: Pick<State, 'relationships'>): number {
  return Object.values(s.relationships).filter((r) => r.kind === 'incoming').length
}

export function isBlocked(s: Pick<State, 'relationships'>, userId: string): boolean {
  return s.relationships[userId]?.kind === 'blocked'
}

export function voiceParticipants(s: Pick<State, 'voiceStates'>, channelId: string): VoiceState[] {
  return Object.values(s.voiceStates).filter((v) => v.channel_id === channelId)
}

type PermState = Pick<State, 'guilds' | 'roles' | 'members' | 'user' | 'channels'>

/** My guild-wide permissions (0 when not a member or not loaded). */
export function myGuildPerms(s: PermState, guildId: string): number {
  const guild = s.guilds[guildId]
  if (!guild || !s.user) return 0
  return guildPerms({ guild, roles: s.roles[guildId] ?? {}, member: s.members[guildId]?.[s.user.id] }, s.user.id)
}

/** My permissions inside a channel. DMs grant everything. */
export function myChannelPerms(s: PermState, channelId: string): number {
  const c = s.channels[channelId]
  if (!c) return s.user ? ALL_PERMS : 0
  if (!c.guild_id) return ALL_PERMS
  const guild = s.guilds[c.guild_id]
  if (!guild || !s.user) return 0
  return channelPerms({ guild, roles: s.roles[c.guild_id] ?? {}, member: s.members[c.guild_id]?.[s.user.id] }, s.user.id, c)
}
const ALL_PERMS = -1 >>> 1

/** Does this message mention the current user, one of their roles, or everyone? */
export function mentionsMe(s: Pick<State, 'user' | 'members' | 'notifSettings' | 'channels' | 'dms'>, m: Message): boolean {
  const me = s.user?.id
  if (!me) return false
  if (m.mention_everyone && !effective(s.notifSettings, s.channels[m.channel_id] ?? s.dms[m.channel_id]).suppressEveryone) return true
  if (m.mentions?.includes(me)) return true
  if (m.mention_roles?.length) { for (const g of Object.values(s.members)) { const mine = g[me]?.roles ?? []; if (m.mention_roles.some((r) => mine.includes(r))) return true } }
  return false
}

/** Unread mentions summed over a server's channels. */
export function guildMentions(s: Pick<State, 'mentionCounts' | 'channels' | 'dms' | 'notifSettings'>, guildId: string): number {
  return Object.entries(s.mentionCounts).reduce((n, [cid, c]) => (s.channels[cid]?.guild_id === guildId && showsMentions(s, cid) ? n + c : n), 0)
}
