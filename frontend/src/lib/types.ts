export interface User {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  bio: string
  status: string
  created_at: string
}
export interface PrivateUser extends User { email: string }

export interface Guild {
  id: string
  name: string
  icon_url: string | null
  owner_id: string
  created_at: string
}

export interface Channel {
  id: string
  guild_id: string | null
  name: string
  kind: 'text' | 'voice' | 'dm' | 'group_dm'
  topic: string
  position: number
  created_at: string
}

export interface DmChannel extends Channel {
  recipients: User[]
  last_message_at: string | null
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
}

export interface Reaction { emoji: string; count: number; me: boolean }

export interface Message {
  id: string
  channel_id: string
  author: User
  content: string
  reply_to: string | null
  created_at: string
  edited_at: string | null
  reactions: Reaction[]
}

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
  guild_id: string
  channel_id: string | null
  user_id: string
  self_mute: boolean
  self_deaf: boolean
  self_video: boolean
  self_stream: boolean
}

export interface RemoteMedia { camera: MediaStream | null; screen: MediaStream | null }

export type PeerStatus = 'connecting' | 'connected' | 'failed'
