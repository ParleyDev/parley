export interface User {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  bio: string
  status: string
  created_at: string
  banner_url: string | null
  theme_primary: string | null
  theme_accent: string | null
  pronouns: string
  name_primary: string | null
  name_accent: string | null
  /** Free-text status line, e.g. "😂 doing things". */
  custom_status: string
  /** Profile flair: preset avatar frame ('' = none), 2–4 char clan tag, optional panels. */
  avatar_decoration?: string
  clan_tag?: string
  panels?: { wishlist?: PanelItem[]; games?: PanelItem[] } | null
}
export interface PanelItem { title: string; url?: string }
/** Preset avatar frames (User Settings → Profiles). */
export const DECORATIONS: { id: string; label: string }[] = [
  { id: '', label: 'None' }, { id: 'gold', label: 'Gold ring' }, { id: 'rainbow', label: 'Rainbow' }, { id: 'glow', label: 'Glow' }, { id: 'ice', label: 'Ice' }, { id: 'dashed', label: 'Dashed' }, { id: 'ember', label: 'Ember' },
]
export type DmPrivacy = 'everyone' | 'friends_and_servers' | 'friends'
export type FriendRequestSource = 'everyone' | 'friends_of_friends' | 'server_members'
export interface PrivateUser extends User {
  email: string; is_admin?: boolean; email_verified_at?: string | null; mfa_enabled?: boolean
  /** Content & Social (Settings): who may DM you, message requests from non-friends, who may send friend requests, who may add you to groups. */
  dm_privacy?: DmPrivacy
  message_requests?: boolean
  friend_request_from?: FriendRequestSource[]
  group_dm_privacy?: 'friends' | 'nobody'
  /** Default for 'allow DMs from server members' on servers you join. */
  guild_dms_default?: boolean
  /** Data & Privacy: others see Seen on your DMs / see you typing. */
  show_read_receipts?: boolean
  show_typing?: boolean
  /** Sensitive media: blur images/videos from non-friends' DMs and in age-restricted channels until clicked. */
  sensitive_media?: { non_friend_dms?: 'show' | 'blur'; restricted?: 'show' | 'blur' }
  spam_filter?: 'none' | 'non_friends' | 'all'
  /** Server-side notification preferences (Settings → Notifications). */
  notif_prefs?: NotifPrefsServer
}
export interface NotifPrefsServer { push_timeout_min?: number; email_dms?: boolean; email_friend_requests?: boolean; default_suppress_everyone?: boolean; default_suppress_roles?: boolean }
/** GET /users/:id adds the servers you share with that user. */
export interface UserProfile extends User {
  mutual_guilds?: Pick<Guild, 'id' | 'name' | 'icon_url'>[]
  mutual_friends?: Pick<User, 'id' | 'display_name' | 'avatar_url'>[]
  review_count?: number
  /** Computed by the server: admin, founder, veteran, host, verified, secure. */
  badges?: string[]
}

export interface Review {
  id: string
  target_id: string
  author_id: string
  content: string
  created_at: string
  updated_at: string
  author_username: string
  author_display_name: string
  author_avatar_url: string | null
}

export interface Guild {
  id: string
  name: string
  icon_url: string | null
  owner_id: string
  created_at: string
  banner_url?: string | null
  /** Membership screening: rules markdown and whether members must accept it before chatting. */
  rules?: string
  rules_required?: boolean
}

/** One entry of the user's server bar: a server, or a folder of servers. */
export type LayoutItem =
  | { kind: 'guild'; id: string }
  | { kind: 'folder'; id: string; name: string; color: string | null; guilds: string[] }

export interface Channel {
  id: string
  guild_id: string | null
  name: string
  kind: 'text' | 'voice' | 'stage' | 'studio' | 'dm' | 'group' | 'category' | 'thread' | 'forum'
  topic: string
  position: number
  created_at: string
  /** Guild channels: the category this channel sits under. */
  parent_id?: string | null
  /** Guild text channels: age-restricted (gate before first view; media blurred by preference). */
  nsfw?: boolean
  /** Studio channels: the engineers (several allowed). */
  engineer_ids?: string[]
  overwrites?: Overwrite[]
}

/** Recording Studio: a session and its per-artist tracks (GET /channels/:id/studio/sessions). */
export interface StudioTrack { id: string; session_id: string; user_id: string | null; content_type: string; size: number; duration_ms: number | null; offset_ms: number; done: boolean; created_at: string; display_name: string; url: string }
export interface StudioSession { id: string; channel_id: string; guild_id: string; name: string; started_by: string | null; started_at: string; ended_at: string | null; tracks: StudioTrack[] }

export interface Overwrite { id: string; kind: 'role' | 'member'; allow: number; deny: number }

export interface Role {
  id: string
  guild_id: string
  name: string
  color: string | null
  color_accent: string | null
  position: number
  permissions: number
  hoist: boolean
  created_at: string
}

export interface DmChannel extends Channel {
  /** Everyone except you. */
  recipients: User[]
  last_message_at: string | null
  /** Groups: who may remove members. */
  owner_id: string | null
  icon_url: string | null
  /** Your membership: a DM from a non-friend is a message request until you accept (pending) or ignore it. */
  request_state?: 'accepted' | 'pending' | 'ignored' | 'spam'
}

export interface Member {
  guild_id: string
  user_id: string
  nickname: string | null
  joined_at: string
  username: string
  display_name: string
  avatar_url: string | null
  status: string
  custom_status?: string
  /** When this member accepted the server rules; null while screening is pending. */
  rules_accepted_at?: string | null
  avatar_decoration?: string
  clan_tag?: string
  /** Moderation timeout: read-only in this server until this instant. */
  timeout_until?: string | null
  roles: string[]
}

export interface Ban {
  guild_id: string
  user_id: string
  moderator_id: string | null
  moderator_name: string | null
  reason: string
  created_at: string
  username: string
  display_name: string
  avatar_url: string | null
}

export interface Reaction { emoji: string; count: number; me: boolean }

export interface Attachment {
  id: string
  filename: string
  content_type: string
  size: number
  width: number | null
  height: number | null
  url: string
  /** Server-made preview (longest side 400px) for large images; absent for small ones and non-images. */
  thumb_url?: string
  /** Voice messages: length and base64 waveform (amplitude bytes). */
  duration_ms?: number
  waveform?: string
  /** Voice messages: speech-to-text (when the instance has an STT server) and who has listened. */
  transcript?: string
  transcript_status?: 'pending' | 'done' | 'failed'
  listened_by?: string[]
}

export interface Message {
  id: string
  channel_id: string
  author: User
  content: string
  reply_to: string | null
  created_at: string
  edited_at: string | null
  pinned_at: string | null
  reactions: Reaction[]
  attachments: Attachment[]
  sticker?: MessageSticker | null
  forwarded_from?: string | null
  mentions?: string[]
  mention_roles?: string[]
  mention_everyone?: boolean
  /** 'default', or a system notice kind: recipient_add, recipient_remove, recipient_leave, channel_name_change, channel_icon_change,
   *  pins_add (reply_to = pinned message), thread_created (ref_id = thread), member_join, call_started (becomes
   *  call_ended "lasted N minutes" or call_missed once the call is over). */
  kind?: string
  /** System messages: related object id (the thread for thread_created). */
  ref_id?: string | null
  poll?: Poll | null
  /** Thread started from this message (card under it). */
  thread?: ThreadRef | null
  /** Preview of the message this replies to; absent when there is no reply or the original was deleted. */
  referenced?: ReplyRef | null
  /** Client-only rows: 'failed' = your message the server refused to deliver (red, Retry / Delete);
   *  'notice' = the Ribbit explanation under it (kind 'ribbit'). Never sent by the server; gone on reload. */
  local?: 'failed' | 'notice'
  /** What a failed message would send again on Retry. */
  draft?: Draft
}

/** What a reply header needs from the original: enough to show "Author · text", loaded or not. */
export interface ReplyRef { id: string; author: User; content: string; attachment_count?: number; attachments?: Attachment[]; kind?: string }

/** The body of POST /channels/:id/messages, kept for retrying a failed send. */
export interface Draft { content: string; reply_to: string | null; attachment_ids: string[]; sticker_id: string | null }

/** A server custom emoji; `url` serves the image, `id` doubles as the image id. */
export interface Emoji {
  id: string
  guild_id: string
  name: string
  animated: boolean
  creator_id: string | null
  created_at: string
  url: string
}

/** Soundboard sound (GET /guilds/:id/sounds). */
export interface Sound { id: string; guild_id: string; name: string; emoji: string; content_type: string; size: number; volume: number; creator_id: string | null; created_at: string; url: string }

export interface Sticker {
  id: string
  guild_id: string
  name: string
  description: string
  tags: string
  animated: boolean
  creator_id: string | null
  created_at: string
  url: string
}

export interface ThreadRef { id: string; name: string; message_count: number; archived: boolean; last_message_at: string | null }
export interface ThreadInfo { id: string; parent_id: string | null; guild_id: string | null; name: string; root_message_id: string | null; owner_id: string | null; owner_username: string | null; archived_at: string | null; pinned_at: string | null; created_at: string; message_count: number; last_message_at: string | null; tags: string[]; preview: string | null }
export interface ForumTag { id: string; channel_id: string; name: string; emoji: string; position: number }

export interface PollOption { id: string; text: string; votes: number; me: boolean }
export interface Poll { question: string; multi: boolean; expires_at: string | null; closed_at: string | null; closed: boolean; total_votes: number; voters: number; options: PollOption[] }

export interface MessageSticker { id: string; name: string; animated: boolean; url: string }

/** An uploaded avatar/banner/icon (`POST /images`). */
export interface UploadedImage { id: string; kind: string; content_type: string; size: number; width: number | null; height: number | null; animated: boolean; url: string }

export interface Gif { id: string; title: string; url: string; preview: string; width: number; height: number }
export interface GifPage { results: Gif[]; next: string | null; provider: string }
export interface GifCategory { name: string; image: string }

export interface Invite {
  code: string
  guild_id: string
  creator_id: string
  uses: number
  max_uses: number | null
  created_at: string
}

export interface ReadState { channel_id: string; last_read_msg: string | null }

export interface VoiceState {
  /** null for a DM call */
  guild_id: string | null
  channel_id: string | null
  user_id: string
  self_mute: boolean
  self_deaf: boolean
  self_video: boolean
  self_stream: boolean
  /** Server says this member may not speak here (no Speak, or stage audience); the client keeps its mic gate shut. */
  suppress?: boolean
  /** Stage channels: raised hand. */
  request_to_speak?: boolean
}

/** Scheduled event (GET /guilds/:id/events). */
export interface GuildEvent { id: string; guild_id: string; name: string; description: string; starts_at: string; ends_at: string | null; channel_id: string | null; location: string; creator_id: string | null; created_at: string; rsvp_count: number; me_rsvp: boolean }

export type RelationshipKind = 'friend' | 'outgoing' | 'incoming' | 'blocked'
export interface Relationship { kind: RelationshipKind; user: User; created_at: string }
/** Your private nickname and note for another user (GET/PUT /users/@me/notes). */
export interface UserNote { user_id: string; nickname: string; note: string }

export interface RemoteMedia { camera: MediaStream | null; screen: MediaStream | null }

export type PeerStatus = 'connecting' | 'connected' | 'failed'
