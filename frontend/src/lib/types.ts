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
}
export interface PrivateUser extends User { email: string; is_admin?: boolean; email_verified_at?: string | null; mfa_enabled?: boolean }
/** GET /users/:id adds the servers you share with that user. */
export interface UserProfile extends User {
  mutual_guilds?: Pick<Guild, 'id' | 'name' | 'icon_url'>[]
  mutual_friends?: Pick<User, 'id' | 'display_name' | 'avatar_url'>[]
  review_count?: number
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
}

/** One entry of the user's server bar: a server, or a folder of servers. */
export type LayoutItem =
  | { kind: 'guild'; id: string }
  | { kind: 'folder'; id: string; name: string; color: string | null; guilds: string[] }

export interface Channel {
  id: string
  guild_id: string | null
  name: string
  kind: 'text' | 'voice' | 'dm' | 'group' | 'category'
  topic: string
  position: number
  created_at: string
  /** Guild channels: the category this channel sits under. */
  parent_id?: string | null
  overwrites?: Overwrite[]
}

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
  /** 'default', or a group-DM system notice kind (recipient_add, recipient_remove, recipient_leave, channel_name_change, channel_icon_change). */
  kind?: string
  poll?: Poll | null
}

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
  /** Server says this member may not speak here; the client keeps its mic gate shut. */
  suppress?: boolean
}

export type RelationshipKind = 'friend' | 'outgoing' | 'incoming' | 'blocked'
export interface Relationship { kind: RelationshipKind; user: User; created_at: string }

export interface RemoteMedia { camera: MediaStream | null; screen: MediaStream | null }

export type PeerStatus = 'connecting' | 'connected' | 'failed'
