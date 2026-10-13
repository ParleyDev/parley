import { create } from 'zustand'
import { api, getToken, setToken } from './lib/api'
import type { Channel, DmChannel, Guild, Member, Message, PeerStatus, PrivateUser, ReadState, RemoteMedia, User, VoiceState } from './lib/types'

export type ModalKind =
  | { kind: 'createGuild' }
  | { kind: 'joinGuild'; code?: string }
  | { kind: 'createChannel'; guildId: string }
  | { kind: 'invite'; guildId: string }
  | { kind: 'guildSettings'; guildId: string }
  | { kind: 'channelSettings'; channelId: string }
  | { kind: 'userSettings' }
  | { kind: 'newDm' }
  | { kind: 'profile'; userId: string }
  | { kind: 'confirm'; title: string; body: string; action: () => Promise<void> | void; danger?: boolean; confirmLabel?: string }

export interface ReadyPayload {
  user: PrivateUser
  guilds: Guild[]
  channels: Channel[]
  dm_channels: DmChannel[]
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
  channels: Record<string, Channel>
  dms: Record<string, DmChannel>
  members: Record<string, Record<string, Member>>
  membersLoaded: Record<string, true>
  messages: Record<string, Message[]>
  hasMore: Record<string, boolean>
  loadingMessages: Record<string, boolean>
  online: Record<string, true>
  users: Record<string, User>
  typing: Record<string, Record<string, number>>
  readStates: Record<string, string | null>
  lastMessageId: Record<string, string>
  activeChannelId: string | null
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
  modal: ModalKind | null
  toast: { id: number; text: string; kind: 'info' | 'error' }[]

  // auth
  setAuth: (token: string, user: PrivateUser) => void
  logout: () => void
  // ws lifecycle
  applyReady: (r: ReadyPayload) => void
  setConnected: (c: boolean) => void
  // mutations
  upsertGuild: (g: Guild & { channels?: Channel[] }) => void
  removeGuild: (id: string) => void
  upsertChannel: (c: Channel | DmChannel) => void
  removeChannel: (id: string) => void
  setMembers: (guildId: string, m: Member[]) => void
  upsertMember: (m: Member) => void
  removeMember: (guildId: string, userId: string) => void
  addMessage: (m: Message) => void
  updateMessage: (m: Message) => void
  removeMessage: (channelId: string, id: string) => void
  prependMessages: (channelId: string, ms: Message[], hasMore: boolean) => void
  setLoadingMessages: (channelId: string, v: boolean) => void
  applyReaction: (channelId: string, messageId: string, emoji: string, userId: string, add: boolean) => void
  setPresence: (userId: string, online: boolean) => void
  upsertUser: (u: User) => void
  setTyping: (channelId: string, userId: string) => void
  pruneTyping: () => void
  setReadState: (channelId: string, msgId: string | null) => void
  setActiveChannel: (id: string | null) => void
  applyVoiceState: (v: VoiceState) => void
  setMyVoice: (channelId: string | null, connecting?: boolean) => void
  setSelfVoiceFlags: (mute: boolean, deaf: boolean) => void
  setSpeaking: (userId: string, on: boolean) => void
  setPeerStatus: (userId: string, status: PeerStatus | null) => void
  setLocalMedia: (m: { camera?: MediaStream | null; screen?: MediaStream | null }) => void
  setRemoteMedia: (userId: string, kind: 'camera' | 'screen', stream: MediaStream | null) => void
  openModal: (m: ModalKind) => void
  closeModal: () => void
  pushToast: (text: string, kind?: 'info' | 'error') => void
  dismissToast: (id: number) => void

  // async actions
  loadMessages: (channelId: string, before?: string) => Promise<void>
  loadMembers: (guildId: string) => Promise<void>
  sendMessage: (channelId: string, content: string, replyTo?: string | null) => Promise<void>
  markRead: (channelId: string) => Promise<void>
}

let toastSeq = 1

export const useStore = create<State>((set, get) => ({
  token: getToken(),
  user: null,
  ready: false,
  connected: false,
  guilds: {},
  guildOrder: [],
  channels: {},
  dms: {},
  members: {},
  membersLoaded: {},
  messages: {},
  hasMore: {},
  loadingMessages: {},
  online: {},
  users: {},
  typing: {},
  readStates: {},
  lastMessageId: {},
  activeChannelId: null,
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
  modal: null,
  toast: [],

  setAuth: (token, user) => {
    setToken(token)
    set({ token, user })
  },
  logout: () => {
    setToken(null)
    set({
      token: null, user: null, ready: false, connected: false, guilds: {}, guildOrder: [], channels: {}, dms: {},
      members: {}, membersLoaded: {}, messages: {}, hasMore: {}, online: {}, users: {}, typing: {}, readStates: {}, lastMessageId: {}, modal: null,
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
    const online: Record<string, true> = {}
    r.online.forEach((id) => (online[id] = true))
    const readStates: Record<string, string | null> = {}
    r.read_states.forEach((rs) => (readStates[rs.channel_id] = rs.last_read_msg))
    const lastMessageId: Record<string, string> = {}
    r.last_message_ids.forEach((l) => (lastMessageId[l.channel_id] = l.message_id))
    const voiceStates: Record<string, VoiceState> = {}
    r.voice_states.forEach((v) => (voiceStates[v.user_id] = v))
    set({
      voiceStates, iceServers: r.ice_servers ?? [],
      user: r.user, guilds, guildOrder: r.guilds.map((g) => g.id), channels, dms, online, users, readStates, lastMessageId,
      ready: true, connected: true,
      // Drop cached messages/members on (re)connect: we may have missed events.
      messages: {}, hasMore: {}, members: {}, membersLoaded: {},
    })
  },
  setConnected: (connected) => set({ connected }),

  upsertGuild: (g) => set((s) => {
    const { channels: gchannels, ...guild } = g
    const channels = { ...s.channels }
    gchannels?.forEach((c) => (channels[c.id] = c))
    const guildOrder = s.guildOrder.includes(guild.id) ? s.guildOrder : [...s.guildOrder, guild.id]
    return { guilds: { ...s.guilds, [guild.id]: { ...s.guilds[guild.id], ...guild } }, channels, guildOrder }
  }),
  removeGuild: (id) => set((s) => {
    const guilds = { ...s.guilds }; delete guilds[id]
    const channels = { ...s.channels }
    Object.values(channels).forEach((c) => { if (c.guild_id === id) delete channels[c.id] })
    const members = { ...s.members }; delete members[id]
    const membersLoaded = { ...s.membersLoaded }; delete membersLoaded[id]
    const voiceStates = { ...s.voiceStates }
    Object.values(voiceStates).forEach((v) => { if (v.guild_id === id) delete voiceStates[v.user_id] })
    return { guilds, channels, members, membersLoaded, voiceStates, guildOrder: s.guildOrder.filter((g) => g !== id) }
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
    const messages = { ...s.messages }; delete messages[id]
    return { channels, messages }
  }),
  setMembers: (guildId, ms) => set((s) => {
    const map: Record<string, Member> = {}
    const users = { ...s.users }
    ms.forEach((m) => {
      map[m.user_id] = m
      users[m.user_id] = { id: m.user_id, username: m.username, display_name: m.display_name, avatar_url: m.avatar_url, bio: '', status: m.status, created_at: m.joined_at }
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
  addMessage: (m) => set((s) => {
    const list = s.messages[m.channel_id]
    const users = { ...s.users, [m.author.id]: { ...s.users[m.author.id], ...m.author, bio: s.users[m.author.id]?.bio ?? '', status: s.users[m.author.id]?.status ?? '' } }
    const lastMessageId = { ...s.lastMessageId, [m.channel_id]: m.id }
    const typing = { ...s.typing }
    if (typing[m.channel_id]?.[m.author.id]) {
      typing[m.channel_id] = { ...typing[m.channel_id] }; delete typing[m.channel_id][m.author.id]
    }
    const dms = s.dms[m.channel_id] ? { ...s.dms, [m.channel_id]: { ...s.dms[m.channel_id], last_message_at: m.created_at } } : s.dms
    if (!list) return { users, lastMessageId, typing, dms }
    if (list.some((x) => x.id === m.id)) return { users, lastMessageId, typing, dms }
    return { messages: { ...s.messages, [m.channel_id]: [...list, m] }, users, lastMessageId, typing, dms }
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
    return { messages: { ...s.messages, [channelId]: merged }, hasMore: { ...s.hasMore, [channelId]: hasMore } }
  }),
  setLoadingMessages: (channelId, v) => set((s) => ({ loadingMessages: { ...s.loadingMessages, [channelId]: v } })),
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
    return { users: { ...s.users, [u.id]: u }, members, dms, messages, user }
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
  setReadState: (channelId, msgId) => set((s) => ({ readStates: { ...s.readStates, [channelId]: msgId } })),
  setActiveChannel: (id) => set({ activeChannelId: id }),
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
  sendMessage: async (channelId, content, replyTo) => {
    const m = await api.post<Message>(`/channels/${channelId}/messages`, { content, reply_to: replyTo ?? null })
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

export function guildUnread(s: Pick<State, 'readStates' | 'lastMessageId' | 'channels'>, guildId: string): boolean {
  return Object.values(s.channels).some((c) => c.guild_id === guildId && c.kind === 'text' && isUnread(s, c.id))
}

export function dmUnreadCount(s: Pick<State, 'readStates' | 'lastMessageId' | 'dms'>): number {
  return Object.keys(s.dms).filter((id) => isUnread(s, id)).length
}

export function voiceParticipants(s: Pick<State, 'voiceStates'>, channelId: string): VoiceState[] {
  return Object.values(s.voiceStates).filter((v) => v.channel_id === channelId)
}
