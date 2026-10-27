export type SensitiveLevel = 'show' | 'filter' | 'blur' | 'block'

export interface User {
  id: string
  username: string
  display_name: string
  /** Bot account (acts through an app token). */
  bot?: boolean
  /** A bot whose app an administrator verified. */
  verified_bot?: boolean
  /** Display name style: font and effect (see lib/nameStyle.ts); colours in name_primary / name_accent. */
  name_style?: { font?: string; effect?: string; colors?: string[] } | null
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
  /** Cosmetics: profile card frame, nameplate behind the name in lists, and an effect over the card. */
  profile_frame?: string
  nameplate?: string
  profile_effect?: string
  /** Their profile is friends-only and you aren't friends: bio, banner, pronouns and panels are hidden. */
  private_profile?: boolean
  /** The server whose official tag `clan_tag` is. */
  clan_tag_guild?: string | null
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
  /** Set once; 'teen' (13-17) gets safety defaults and no 18+ channels. */
  birthdate?: string | null; age_group?: 'unknown' | 'teen' | 'adult'
  /** When the chosen status reverts to Online, and when the custom status clears (null: they don't). */
  status_expires_at?: string | null; custom_status_expires_at?: string | null
  /** Channels and DMs pinned to the top of their lists, in order. */
  pinned_channels?: string[]
  ignored_users?: string[]
  online_alerts?: string[]
  /** Content & Social (Settings): who may DM you, message requests from non-friends, who may send friend requests, who may add you to groups. */
  dm_privacy?: DmPrivacy
  message_requests?: boolean
  friend_request_from?: FriendRequestSource[]
  group_dm_privacy?: 'friends' | 'nobody'
  /** Findable by partial-name search; an exact username always works. */
  searchable?: boolean
  /** Largest single upload for this user in bytes (null = instance default). */
  max_upload_bytes?: number | null
  /** Default for 'allow DMs from server members' on servers you join. */
  guild_dms_default?: boolean
  /** Data & Privacy: others see Seen on your DMs / see you typing. */
  show_read_receipts?: boolean
  show_typing?: boolean
  /** Sensitive media: blur images/videos from non-friends' DMs and in age-restricted channels until clicked. */
  sensitive_media?: { non_friend_dms?: SensitiveLevel; friend_dms?: SensitiveLevel; servers?: SensitiveLevel; restricted?: SensitiveLevel }
  spam_filter?: 'none' | 'non_friends' | 'all'
  /** Server-side notification preferences (Settings → Notifications). */
  notif_prefs?: NotifPrefsServer
  avatar_history?: string[]
  profile_privacy?: 'everyone' | 'friends'
  /** A sound id, 'builtin:<name>', or '' for none. */
  entrance_sound?: string
  /** Synced client settings (see lib/settingsSync). */
  client_settings?: import('./settingsSync').SyncedSettings
}
export interface NotifPrefsServer { push_timeout_min?: number; email_dms?: boolean; email_friend_requests?: boolean; default_suppress_everyone?: boolean; default_suppress_roles?: boolean }
/** GET /users/:id adds the servers you share with that user. */
export interface UserProfile extends User {
  mutual_guilds?: Pick<Guild, 'id' | 'name' | 'icon_url'>[]
  mutual_friends?: Pick<User, 'id' | 'display_name' | 'avatar_url'>[]
  review_count?: number
  /** Computed by the server: admin, founder, veteran, host, verified, secure. */
  badges?: string[]
  /** Linked external accounts the user shows on their profile. */
  connections?: Connection[]
}
export interface Connection { id: string; provider: string; name: string; url: string; visible: boolean; created_at?: string }

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

export interface WelcomeScreen { enabled?: boolean; description?: string; channels?: { channel_id: string; description: string; emoji?: string | null }[] }

export interface OnboardingOption { id?: string; label: string; emoji: string; role_ids: string[]; channel_ids: string[] }
export interface OnboardingQuestion { id?: string; title: string; multi: boolean; required: boolean; options: OnboardingOption[] }
export interface ApplicationQuestion { id?: string; title: string; paragraph: boolean; required: boolean }
export interface Onboarding { enabled?: boolean; questions?: OnboardingQuestion[] }

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
  description?: string
  /** Where join notices go (null: the first text channel). */
  system_channel_id?: string | null
  join_notices?: boolean
  /** Join notices offer "Wave to say hi". */
  join_wave?: boolean
  /** What members get notified about until they choose. */
  default_notifications?: 'all' | 'mentions'
  /** 0 none, 1 verified email, 2 + account older than 5 minutes, 3 + member for 10 minutes. */
  verification_level?: number
  /** 1: moderator powers need two-factor authentication. */
  mfa_level?: number
  invites_paused?: boolean
  dms_paused_until?: string | null
  /** Idle voice members move here after `afk_timeout` seconds. */
  afk_channel_id?: string | null
  afk_timeout?: number
  rules_channel_id?: string | null
  welcome_screen?: WelcomeScreen
  widget_enabled?: boolean
  widget_invite?: string
  invite_splash_url?: string | null
  raid_protection?: boolean
  raid_threshold?: number
  safety_alerts_channel_id?: string | null
  onboarding?: Onboarding
  /** The server's official tag (members can wear it) and its badge; partnered with this instance. */
  tag?: string | null
  tag_badge?: string | null
  partnered?: boolean
  /** Explicit image filter: off, for members without roles, or for everyone. */
  explicit_filter?: 'off' | 'no_roles' | 'all'
  applications?: { enabled?: boolean; questions?: ApplicationQuestion[] }
}

/** One entry of the user's server bar: a server, or a folder of servers. */
export type LayoutItem =
  | { kind: 'guild'; id: string }
  | { kind: 'folder'; id: string; name: string; color: string | null; guilds: string[] }

export interface Channel {
  id: string
  guild_id: string | null
  name: string
  kind: 'text' | 'voice' | 'stage' | 'studio' | 'dm' | 'group' | 'category' | 'thread' | 'forum' | 'directory'
  topic: string
  position: number
  created_at: string
  /** Guild channels: the category this channel sits under. */
  parent_id?: string | null
  /** Guild text channels: age-restricted (gate before first view; media blurred by preference). */
  nsfw?: boolean
  /** Voice/stage/studio audio profile (see lib/audioProfile). */
  audio_mode?: 'voice' | 'music'
  audio_bitrate?: number
  audio_low_latency?: boolean
  /** Calls here are end-to-end encrypted (voice/stage/studio channels, DM and group calls). */
  e2ee?: boolean
  /** Slowmode: seconds between a member's messages (0 = off). */
  rate_limit_per_user?: number
  /** Voice channels: how many may be in it (0 = no limit). */
  user_limit?: number
  /** Voice channels: what's going on, set by people in it; cleared when it empties. */
  voice_status?: string
  /** Studio channels: the engineers (several allowed). */
  engineer_ids?: string[]
  overwrites?: Overwrite[]
  /** Spoiler channel: a warning before you first see it; media stays blurred until clicked. */
  spoiler?: boolean
  /** Voice channels: camera quality, 'auto' (720p) or 'full' (1080p). */
  video_quality?: 'auto' | 'full' | ''
  /** In a category: follows the category's permissions (no overwrites of its own). */
  permissions_synced?: boolean
  /** Forums: default layout and sort, a tag required on new posts, and the reaction offered on every post. */
  forum_layout?: 'gallery' | 'list' | ''
  forum_sort?: 'activity' | 'created' | ''
  forum_require_tag?: boolean
  forum_default_reaction?: string
  /** Text channels: an announcement channel others can follow. Forums: a media channel (gallery of images and videos). */
  news?: boolean
  media?: boolean
}

/** Recording Studio: a session and its per-artist tracks (GET /channels/:id/studio/sessions). */
export interface StudioTrack { id: string; session_id: string; user_id: string | null; content_type: string; size: number; duration_ms: number | null; offset_ms: number; done: boolean; created_at: string; display_name: string; url: string }
export interface StudioSession { id: string; channel_id: string; guild_id: string; name: string; started_by: string | null; started_at: string; ended_at: string | null; tracks: StudioTrack[] }

export interface Overwrite { id: string; kind: 'role' | 'member'; allow: number; deny: number }

export interface Role {
  id: string
  /** A bot's own role, and a linked role's requirements. */
  managed_app_id?: string | null
  requirements?: import('../components/LinkedRoles').Requirements | null
  guild_id: string
  name: string
  color: string | null
  color_accent: string | null
  position: number
  permissions: number
  hoist: boolean
  created_at: string
  /** Name style for members holding this role: {font, effect, colors}. */
  name_style?: { font?: string; effect?: string; colors?: string[] } | null
  /** Shown next to members' names: an emoji, or an uploaded image's URL. */
  icon?: string | null
  /** Anyone may @mention it (otherwise only members with Mention Everyone). */
  mentionable?: boolean
  /** Members may give themselves this role (Channels & Roles). */
  self_assignable?: boolean
}

export interface DmChannel extends Channel {
  /** Everyone except you. */
  recipients: User[]
  /** Why the spam filter put it in Spam. */
  spam_reasons?: string[]
  last_message_at: string | null
  /** Groups: who may remove members. */
  owner_id: string | null
  icon_url: string | null
  /** Your membership: a DM from a non-friend is a message request until you accept (pending) or ignore it. */
  request_state?: 'accepted' | 'pending' | 'ignored' | 'spam'
  /** You closed it ("Close DM"): hidden from your list until a new message arrives. */
  closed?: boolean
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
  name_primary?: string | null
  name_accent?: string | null
  name_style?: { font?: string; effect?: string; colors?: string[] } | null
  clan_tag?: string
  /** Moderation timeout: read-only in this server until this instant. */
  timeout_until?: string | null
  roles: string[]
  nameplate?: string
  /** Quarantined by a moderator: read-only. */
  quarantined?: boolean
  /** Safety flags, e.g. 'raid'. */
  flags?: string[]
  /** Server profile overrides. */
  guild_avatar?: string | null
  guild_banner?: string | null
  guild_bio?: string
  guild_pronouns?: string
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

/** `burst`: a super reaction (shown and counted apart from the normal one of the same emoji). */
export interface Reaction { emoji: string; count: number; me: boolean; burst?: boolean }

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
  /** Alt text, set by the uploader. */
  description?: string | null
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
  /** "Remove embeds": no link previews for this message. */
  suppress_embeds?: boolean
  /** Announcements: published original, or a copy with where it came from. */
  /** Sent through a webhook, and bot/webhook rich embeds. */
  webhook_id?: string
  /** A bot's answer to a command, and (ephemeral) only shown to you, never stored. */
  interaction?: { id: string; name: string; user: { id: string; display_name: string }; deferred?: boolean }
  ephemeral?: boolean
  /** Buttons and select menus (action rows) on a bot's message. */
  components?: import('../components/MessageComponents').ActionRow[]
  embeds?: import('../components/RichEmbed').Embed[]
  crosspost?: { published?: boolean; guild_id?: string; guild_name?: string; guild_icon?: string | null; channel_id?: string; channel_name?: string; message_id?: string }
  /** What a failed message would send again on Retry. */
  draft?: Draft
  /** Sent with /tts: read aloud to people viewing the channel. */
  tts?: boolean
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
export interface ThreadInfo { id: string; parent_id: string | null; guild_id: string | null; name: string; root_message_id: string | null; owner_id: string | null; owner_username: string | null; archived_at: string | null; pinned_at: string | null; created_at: string; message_count: number; last_message_at: string | null; tags: string[]; preview: string | null; first_message_id?: string | null; private?: boolean; locked?: boolean; auto_archive_minutes?: number; member_count?: number; cover_url?: string | null; cover_type?: string | null }
export interface ForumTag { id: string; channel_id: string; name: string; emoji: string; position: number }

export interface PollOption { id: string; text: string; emoji?: string | null; votes: number; me: boolean }
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
  /** null never expires. */
  expires_at: string | null
  /** A custom code claimed by a server approved for Discovery. */
  vanity: boolean
  /** Members who join with it are removed when they go offline, unless given a role. */
  temporary?: boolean
}

/** An invite in Server Settings › Invites, with who made it. */
export interface InviteListing extends Invite { creator_username: string; creator_display_name: string; creator_avatar_url: string | null }

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
  /** Server muted / deafened by a moderator (deafened members can't speak either). */
  mute?: boolean
  deaf?: boolean
  /** Whose screen shares they are watching. */
  watching?: string[]
  /** When they joined this channel. */
  joined_at?: string
  /** Priority Speaker here: others are turned down while they talk. */
  priority?: boolean
  /** Has live captions on in this call. */
  captions?: boolean
}

/** Scheduled event (GET /guilds/:id/events). */
export interface GuildEvent { id: string; guild_id: string; name: string; description: string; starts_at: string; ends_at: string | null; channel_id: string | null; location: string; creator_id: string | null; created_at: string; rsvp_count: number; me_rsvp: boolean; cover_url?: string | null; recurrence?: '' | 'daily' | 'weekly' | 'biweekly' | 'monthly'; status?: 'scheduled' | 'active' | 'completed' | 'canceled'; started_at?: string | null }

export type RelationshipKind = 'friend' | 'outgoing' | 'incoming' | 'blocked'
/** `created_at`: when the request was sent, or for friends when it was accepted ("Friends since"). `note`: a request's note. */
export interface Relationship { kind: RelationshipKind; user: User; created_at: string; note?: string }
/** Your private nickname and note for another user (GET/PUT /users/@me/notes). */
export interface UserNote { user_id: string; nickname: string; note: string }

export interface RemoteMedia { camera: MediaStream | null; screen: MediaStream | null }

export type PeerStatus = 'connecting' | 'connected' | 'failed'

/** A developer application (Settings → Applications). */
export interface Application { id: string; owner_id: string; name: string; description: string; client_id: string; redirect_uris: string[]; bot_user_id: string | null; created_at: string; privileged_intents?: number; icon_url?: string | null; bot_public?: boolean; verified?: boolean; listed?: boolean; install_permissions?: number; tags?: string[]; client_secret?: string; bot?: User | null; authorized_users?: number }
/** An app holding a token for you (Settings → Authorized Apps). */
export interface AuthorizedApp { id: string; name: string; description: string; owner: string | null; scopes: string[]; since: string }
