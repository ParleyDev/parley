use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Default, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub bio: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub banner_url: Option<String>,
    pub theme_primary: Option<String>,
    pub theme_accent: Option<String>,
    pub pronouns: String,
    pub name_primary: Option<String>,
    pub name_accent: Option<String>,
    /// A bot account (acts only through its token).
    #[sqlx(default)]
    pub bot: bool,
    /// A bot whose app an administrator verified.
    #[sqlx(default)]
    pub verified_bot: bool,
    /// Display name style: {font, effect} (colours in name_primary / name_accent).
    #[sqlx(default)]
    pub name_style: serde_json::Value,
    #[sqlx(default)]
    pub custom_status: String,
    /// Profile flair: preset avatar frame ('' = none), short clan tag, optional panels (wishlist / games).
    #[sqlx(default)]
    pub avatar_decoration: String,
    #[sqlx(default)]
    pub clan_tag: String,
    /// The server whose official tag this is (None: a free-text tag).
    #[sqlx(default)]
    pub clan_tag_guild: Option<Uuid>,
    #[sqlx(default)]
    pub panels: serde_json::Value,
    /// 'everyone' or 'friends': who sees bio, banner, pronouns and panels.
    #[sqlx(default)]
    pub profile_privacy: String,
    #[sqlx(default)]
    pub profile_frame: String,
    #[sqlx(default)]
    pub nameplate: String,
    #[sqlx(default)]
    pub profile_effect: String,
    /// The viewer may see a private profile (themselves, or a friend): set by the profile endpoint.
    #[sqlx(skip)]
    pub reveal: bool,
}

/// What other people get: a private profile (friends only) leaves out bio, banner, pronouns and panels.
#[derive(Serialize)]
struct UserWire<'a> {
    id: Uuid,
    username: &'a str,
    display_name: &'a str,
    avatar_url: &'a Option<String>,
    bio: &'a str,
    status: &'a str,
    created_at: DateTime<Utc>,
    banner_url: Option<&'a String>,
    theme_primary: &'a Option<String>,
    theme_accent: &'a Option<String>,
    pronouns: &'a str,
    name_primary: &'a Option<String>,
    name_accent: &'a Option<String>,
    bot: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    verified_bot: bool,
    name_style: &'a serde_json::Value,
    custom_status: &'a str,
    avatar_decoration: &'a str,
    clan_tag: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    clan_tag_guild: Option<Uuid>,
    panels: &'a serde_json::Value,
    #[serde(skip_serializing_if = "str::is_empty")]
    profile_frame: &'a str,
    #[serde(skip_serializing_if = "str::is_empty")]
    nameplate: &'a str,
    #[serde(skip_serializing_if = "str::is_empty")]
    profile_effect: &'a str,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    private_profile: bool,
}

impl Serialize for User {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let hidden = self.profile_privacy == "friends" && !self.reveal;
        static NULL: serde_json::Value = serde_json::Value::Null;
        UserWire {
            id: self.id, username: &self.username, display_name: &self.display_name, avatar_url: &self.avatar_url,
            bio: if hidden { "" } else { &self.bio }, status: &self.status, created_at: self.created_at,
            banner_url: if hidden { None } else { self.banner_url.as_ref() }, theme_primary: &self.theme_primary, theme_accent: &self.theme_accent,
            pronouns: if hidden { "" } else { &self.pronouns }, name_primary: &self.name_primary, name_accent: &self.name_accent,
            bot: self.bot, verified_bot: self.verified_bot, name_style: &self.name_style, custom_status: &self.custom_status, avatar_decoration: &self.avatar_decoration,
            clan_tag: &self.clan_tag, clan_tag_guild: self.clan_tag_guild, panels: if hidden { &NULL } else { &self.panels },
            profile_frame: &self.profile_frame, nameplate: &self.nameplate, profile_effect: &self.profile_effect,
            private_profile: hidden,
        }
        .serialize(s)
    }
}

impl From<&PrivateUser> for User {
    fn from(u: &PrivateUser) -> Self {
        User {
            name_style: u.name_style.clone(), bot: u.bot, verified_bot: false, id: u.id, username: u.username.clone(), display_name: u.display_name.clone(), avatar_url: u.avatar_url.clone(), bio: u.bio.clone(),
            status: u.status.clone(), custom_status: u.custom_status.clone(), created_at: u.created_at, banner_url: u.banner_url.clone(),
            theme_primary: u.theme_primary.clone(), theme_accent: u.theme_accent.clone(), pronouns: u.pronouns.clone(), name_primary: u.name_primary.clone(),
            name_accent: u.name_accent.clone(), avatar_decoration: u.avatar_decoration.clone(), clan_tag: u.clan_tag.clone(), clan_tag_guild: u.clan_tag_guild, panels: u.panels.clone(),
            profile_privacy: u.profile_privacy.clone(), profile_frame: u.profile_frame.clone(), nameplate: u.nameplate.clone(), profile_effect: u.profile_effect.clone(),
            reveal: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PrivateUser {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub avatar_url: Option<String>,
    pub bio: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub banner_url: Option<String>,
    pub theme_primary: Option<String>,
    pub theme_accent: Option<String>,
    pub pronouns: String,
    pub name_primary: Option<String>,
    pub name_accent: Option<String>,
    #[sqlx(default)]
    #[serde(default)]
    pub custom_status: String,
    #[sqlx(default)]
    #[serde(default)]
    pub name_style: serde_json::Value,
    /// Largest single upload for this user (null = instance default).
    #[sqlx(default)]
    #[serde(default)]
    pub max_upload_bytes: Option<i64>,
    #[sqlx(default)]
    #[serde(default)]
    pub bot: bool,
    /// Content & Social: who may DM you (everyone | friends_and_servers | friends), whether DMs from non-friends
    /// land in Message Requests, who may send friend requests (subset of everyone, friends_of_friends,
    /// server_members; empty = nobody), who may add you to groups (friends | nobody).
    #[sqlx(default)]
    #[serde(default = "default_everyone")]
    pub dm_privacy: String,
    #[sqlx(default)]
    #[serde(default = "default_true")]
    pub message_requests: bool,
    #[sqlx(default)]
    #[serde(default)]
    pub friend_request_from: Vec<String>,
    #[sqlx(default)]
    #[serde(default = "default_friends")]
    pub group_dm_privacy: String,
    /// Findable by partial-name search (an exact username always works).
    #[sqlx(default)]
    #[serde(default)]
    pub searchable: bool,
    /// Default for "allow direct messages from server members" on servers you join (overridable per server).
    #[sqlx(default)]
    #[serde(default = "default_true")]
    pub guild_dms_default: bool,
    /// Data & Privacy: others see "Seen" on your DMs / see you typing.
    #[sqlx(default)]
    #[serde(default = "default_true")]
    pub show_read_receipts: bool,
    #[sqlx(default)]
    #[serde(default = "default_true")]
    pub show_typing: bool,
    /// Sensitive media: {non_friend_dms: show|blur, restricted: show|blur}; DM spam filter: none | non_friends | all.
    #[sqlx(default)]
    #[serde(default)]
    pub sensitive_media: serde_json::Value,
    #[sqlx(default)]
    #[serde(default)]
    pub spam_filter: String,
    /// Notifications: push_timeout_min, email_dms, email_friend_requests, default_suppress_everyone, default_suppress_roles.
    #[sqlx(default)]
    #[serde(default)]
    pub notif_prefs: serde_json::Value,
    /// Profile flair: preset avatar frame ('' = none), short clan tag, optional panels (wishlist / games).
    #[sqlx(default)]
    #[serde(default)]
    pub avatar_decoration: String,
    #[sqlx(default)]
    #[serde(default)]
    pub clan_tag: String,
    #[sqlx(default)]
    #[serde(default)]
    pub panels: serde_json::Value,
    /// Parley admin: may review discovery submissions.
    #[sqlx(default)]
    #[serde(default)]
    pub is_admin: bool,
    #[sqlx(default)]
    #[serde(default)]
    pub email_verified_at: Option<DateTime<Utc>>,
    /// Two-factor authentication (TOTP) is switched on.
    #[sqlx(default)]
    #[serde(default)]
    pub mfa_enabled: bool,
    /// When the chosen status reverts to Online, and when the custom status clears (None: they don't).
    #[sqlx(default)]
    pub status_expires_at: Option<DateTime<Utc>>,
    #[sqlx(default)]
    pub custom_status_expires_at: Option<DateTime<Utc>>,
    /// Channels and DMs pinned to the top of their lists, in order.
    #[sqlx(default)]
    pub pinned_channels: Vec<Uuid>,
    /// People whose messages are hidden and who never notify you (they aren't told).
    #[sqlx(default)]
    pub ignored_users: Vec<Uuid>,
    /// Friends you are told about when they come online.
    #[sqlx(default)]
    pub online_alerts: Vec<Uuid>,
    /// Your last avatars (newest first, up to 6) for a quick switch back.
    #[sqlx(default)]
    pub avatar_history: Vec<String>,
    #[sqlx(default)]
    pub profile_privacy: String,
    #[sqlx(default)]
    pub profile_frame: String,
    #[sqlx(default)]
    pub nameplate: String,
    #[sqlx(default)]
    pub profile_effect: String,
    /// Played when you join a voice channel: a sound id, 'builtin:<name>', or '' for none.
    #[sqlx(default)]
    pub entrance_sound: String,
    /// Device-independent client settings (appearance, prefs, sounds, keybinds) with a revision stamp.
    #[sqlx(default)]
    pub client_settings: serde_json::Value,
    /// Set once by the user; gates 18+ channels.
    #[sqlx(default)]
    pub birthdate: Option<chrono::NaiveDate>,
    /// 'unknown' (no birth date yet), 'teen' (13-17) or 'adult'.
    #[sqlx(default)]
    #[serde(default)]
    pub age_group: String,
    #[sqlx(default)]
    pub clan_tag_guild: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Guild {
    pub id: Uuid,
    pub name: String,
    pub icon_url: Option<String>,
    pub owner_id: Uuid,
    pub created_at: DateTime<Utc>,
    #[sqlx(default)]
    pub banner_url: Option<String>,
    /// Membership screening: rules text (markdown) and whether members must accept it before chatting.
    #[sqlx(default)]
    #[serde(default)]
    pub rules: String,
    #[sqlx(default)]
    #[serde(default)]
    pub rules_required: bool,
    #[sqlx(default)]
    #[serde(default)]
    pub description: String,
    /// Where join notices go (else the first text channel).
    #[sqlx(default)]
    pub system_channel_id: Option<Uuid>,
    #[sqlx(default)]
    #[serde(default = "default_true")]
    pub join_notices: bool,
    /// Join notices offer a "Wave to say hi" button.
    #[sqlx(default)]
    #[serde(default = "default_true")]
    pub join_wave: bool,
    /// 'all' or 'mentions': what members get notified about until they choose.
    #[sqlx(default)]
    #[serde(default = "default_all")]
    pub default_notifications: String,
    /// 0 none, 1 verified email, 2 + account older than 5 minutes, 3 + member for 10 minutes.
    #[sqlx(default)]
    #[serde(default)]
    pub verification_level: i16,
    /// 1: moderator powers need two-factor authentication.
    #[sqlx(default)]
    #[serde(default)]
    pub mfa_level: i16,
    #[sqlx(default)]
    #[serde(default)]
    pub invites_paused: bool,
    #[sqlx(default)]
    pub dms_paused_until: Option<DateTime<Utc>>,
    /// Voice channel idle members are moved to after `afk_timeout` seconds.
    #[sqlx(default)]
    pub afk_channel_id: Option<Uuid>,
    #[sqlx(default)]
    #[serde(default)]
    pub afk_timeout: i32,
    /// The server's #rules channel.
    #[sqlx(default)]
    pub rules_channel_id: Option<Uuid>,
    /// What new members see first: {enabled, description, channels: [{channel_id, description, emoji}]}.
    #[sqlx(default)]
    #[serde(default)]
    pub welcome_screen: serde_json::Value,
    /// Public widget (JSON + embed) and the invite code its Join button uses.
    #[sqlx(default)]
    #[serde(default)]
    pub widget_enabled: bool,
    #[sqlx(default)]
    #[serde(default)]
    pub widget_invite: String,
    /// Background picture on the server's invite page.
    #[sqlx(default)]
    pub invite_splash_url: Option<String>,
    /// Raid protection: pause invites when more than `raid_threshold` people join in a minute; alerts go to
    /// `safety_alerts_channel_id` (else the system channel).
    #[sqlx(default)]
    #[serde(default)]
    pub raid_protection: bool,
    #[sqlx(default)]
    #[serde(default)]
    pub raid_threshold: i32,
    #[sqlx(default)]
    pub safety_alerts_channel_id: Option<Uuid>,
    /// Onboarding questions: {enabled, questions: [{id, title, multi, required, options: [{id, label, emoji, role_ids, channel_ids}]}]}.
    #[sqlx(default)]
    #[serde(default)]
    pub onboarding: serde_json::Value,
    /// Membership applications: {enabled, questions: [{id, title, paragraph, required}]}.
    #[sqlx(default)]
    #[serde(default)]
    pub applications: serde_json::Value,
    /// The server's own tag (2-4 letters) and its badge (an emoji), which members can wear.
    #[sqlx(default)]
    pub tag: Option<String>,
    #[sqlx(default)]
    pub tag_badge: Option<String>,
    /// Partnered with this instance (set by admins).
    #[sqlx(default)]
    #[serde(default)]
    pub partnered: bool,
    /// Explicit image filter: 'off', 'no_roles' (members without roles) or 'all'.
    #[sqlx(default)]
    #[serde(default)]
    pub explicit_filter: String,
}

fn default_all() -> String { "all".into() }

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Channel {
    pub id: Uuid,
    pub guild_id: Option<Uuid>,
    pub name: String,
    pub kind: String,
    pub topic: String,
    pub position: i32,
    pub created_at: DateTime<Utc>,
    /// Group DMs only: who may add/remove members and rename.
    #[sqlx(default)]
    pub owner_id: Option<Uuid>,
    /// Group DMs only: custom icon.
    #[sqlx(default)]
    pub icon_url: Option<String>,
    /// Guild channels: the category this channel sits under.
    #[sqlx(default)]
    pub parent_id: Option<Uuid>,
    /// Guild text channels: age-restricted (a gate before first view; media may be blurred by preference).
    #[sqlx(default)]
    #[serde(default)]
    pub nsfw: bool,
    /// Voice/stage/studio: 'voice' (speech) or 'music' (high fidelity: stereo, no processing, no DTX).
    #[sqlx(default)]
    #[serde(default = "default_audio_mode")]
    pub audio_mode: String,
    /// Opus bitrate in kbps (8..510); 0 = the mode's default.
    #[sqlx(default)]
    #[serde(default)]
    pub audio_bitrate: i32,
    /// 10 ms Opus frames and a minimal jitter buffer.
    #[sqlx(default)]
    #[serde(default)]
    pub audio_low_latency: bool,
    /// Calls here are end-to-end encrypted: media is encrypted per frame with keys the server never sees.
    #[sqlx(default)]
    #[serde(default)]
    pub e2ee: bool,
    /// Spoiler channel: a warning before you first see it, and media stays blurred until clicked.
    #[sqlx(default)]
    #[serde(default)]
    pub spoiler: bool,
    /// Voice channels: camera quality, 'auto' (720p) or 'full' (1080p).
    #[sqlx(default)]
    #[serde(default)]
    pub video_quality: String,
    /// Forums: default layout ('gallery' | 'list') and sort ('activity' | 'created'), tag required on new posts, and
    /// the reaction offered on every post.
    #[sqlx(default)]
    #[serde(default)]
    pub forum_layout: String,
    #[sqlx(default)]
    #[serde(default)]
    pub forum_sort: String,
    #[sqlx(default)]
    #[serde(default)]
    pub forum_require_tag: bool,
    #[sqlx(default)]
    #[serde(default)]
    pub forum_default_reaction: String,
    /// Text channels: an announcement channel (posts can be published to channels that follow it).
    #[sqlx(default)]
    #[serde(default)]
    pub news: bool,
    /// Forums: a media channel (posts lead with an image or video and list as a gallery).
    #[sqlx(default)]
    #[serde(default)]
    pub media: bool,
    /// Slowmode: seconds a member waits between messages here (0 = off).
    #[sqlx(default)]
    #[serde(default)]
    pub rate_limit_per_user: i32,
    /// Voice channels: how many people may be in it (0 = no limit).
    #[sqlx(default)]
    #[serde(default)]
    pub user_limit: i32,
    /// Voice channels: what's going on in there, set by the people in it; cleared when it empties.
    #[sqlx(default)]
    #[serde(default)]
    pub voice_status: String,
    /// Studio channels: the engineers (run recordings, manage the band); filled by `perms::attach_overwrites`.
    #[sqlx(skip)]
    #[serde(default)]
    pub engineer_ids: Vec<Uuid>,
    /// Permission overwrites; filled by `perms::attach_overwrites` for guild channels.
    #[sqlx(skip)]
    #[serde(default)]
    pub overwrites: Vec<Overwrite>,
    /// Channels in a category: whether they follow the category's permissions (no overwrites of their own).
    #[sqlx(skip)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions_synced: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Overwrite {
    #[serde(skip)]
    pub channel_id: Uuid,
    #[serde(rename = "id")]
    pub target_id: Uuid,
    #[serde(rename = "kind")]
    pub target_kind: String,
    pub allow: i64,
    pub deny: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Role {
    pub id: Uuid,
    pub guild_id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub color_accent: Option<String>,
    pub position: i32,
    pub permissions: i64,
    pub hoist: bool,
    pub created_at: DateTime<Utc>,
    /// Name style for members with this role: {font, effect, colors}.
    #[sqlx(default)]
    #[serde(default)]
    pub name_style: serde_json::Value,
    /// Shown next to members' names: a unicode emoji, or an uploaded image's URL.
    #[sqlx(default)]
    pub icon: Option<String>,
    /// Anyone may @mention it (otherwise only members with Mention Everyone).
    #[sqlx(default)]
    #[serde(default)]
    pub mentionable: bool,
    /// Members can give themselves this role (Channels & Roles).
    #[sqlx(default)]
    #[serde(default)]
    pub self_assignable: bool,
    /// A bot's own role (made when it was added, with the permissions picked then): can't be deleted or given to
    /// anyone else while the bot is there.
    #[sqlx(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub managed_app_id: Option<Uuid>,
    /// Linked role: what a member needs to claim it ({account_age_days, verified_email, connection, app}).
    #[sqlx(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requirements: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Member {
    pub guild_id: Uuid,
    pub user_id: Uuid,
    pub nickname: Option<String>,
    pub joined_at: DateTime<Utc>,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub status: String,
    /// Name style fields so lists can paint names without a separate user lookup.
    #[sqlx(default)]
    pub name_primary: Option<String>,
    #[sqlx(default)]
    pub name_accent: Option<String>,
    #[sqlx(default)]
    #[serde(default)]
    pub name_style: serde_json::Value,
    #[sqlx(default)]
    #[serde(default)]
    pub custom_status: String,
    /// Profile flair: preset avatar frame ('' = none), short clan tag, optional panels (wishlist / games).
    #[sqlx(default)]
    #[serde(default)]
    pub avatar_decoration: String,
    #[sqlx(default)]
    #[serde(default)]
    pub clan_tag: String,
    #[sqlx(default)]
    #[serde(default)]
    pub panels: serde_json::Value,
    /// Timed out until (moderation): only reading allowed while in the future.
    #[sqlx(default)]
    #[serde(default)]
    pub timeout_until: Option<DateTime<Utc>>,
    /// When this member accepted the server rules (membership screening); null = not yet.
    #[sqlx(default)]
    #[serde(default)]
    pub rules_accepted_at: Option<DateTime<Utc>>,
    /// Server muted / deafened by a moderator (voice).
    #[sqlx(default)]
    #[serde(default)]
    pub mute: bool,
    #[sqlx(default)]
    #[serde(default)]
    pub deaf: bool,
    #[sqlx(skip)]
    #[serde(default)]
    pub roles: Vec<Uuid>,
    /// Their nameplate (drawn behind the name in the member list).
    #[sqlx(default)]
    #[serde(skip_serializing_if = "String::is_empty")]
    pub nameplate: String,
    /// Quarantined by a moderator: read-only until released.
    #[sqlx(default)]
    #[serde(default)]
    pub quarantined: bool,
    /// Safety flags (e.g. "raid": joined while a raid was detected).
    #[sqlx(default)]
    #[serde(default)]
    pub flags: Vec<String>,
    /// Server profile: overrides of your avatar, banner, bio and pronouns in this server.
    #[sqlx(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guild_avatar: Option<String>,
    #[sqlx(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guild_banner: Option<String>,
    #[sqlx(default)]
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub guild_bio: String,
    #[sqlx(default)]
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub guild_pronouns: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MessageRow {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    pub content: String,
    pub reply_to: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub edited_at: Option<DateTime<Utc>>,
    pub pinned_at: Option<DateTime<Utc>>,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub sticker_id: Option<Uuid>,
    pub sticker_name: Option<String>,
    pub sticker_animated: Option<bool>,
    pub forwarded_from: Option<Uuid>,
    #[sqlx(default)]
    pub ref_id: Option<Uuid>,
    #[sqlx(default)]
    pub avatar_decoration: String,
    #[sqlx(default)]
    pub clan_tag: String,
    #[sqlx(default)]
    pub mentions: Vec<Uuid>,
    #[sqlx(default)]
    pub mention_roles: Vec<Uuid>,
    #[sqlx(default)]
    pub mention_everyone: bool,
    /// 'default' for ordinary messages; group-DM system notices use recipient_add / recipient_remove /
    /// recipient_leave / channel_name_change / channel_icon_change.
    #[sqlx(default)]
    pub kind: String,
    #[sqlx(default)]
    pub author_bot: bool,
    #[sqlx(default)]
    pub author_name_primary: Option<String>,
    #[sqlx(default)]
    pub author_name_accent: Option<String>,
    #[sqlx(default)]
    pub author_name_style: serde_json::Value,
    #[sqlx(default)]
    pub suppress_embeds: bool,
    #[sqlx(default)]
    pub tts: bool,
    #[sqlx(default)]
    pub crosspost: Option<serde_json::Value>,
    #[sqlx(default)]
    pub webhook_id: Option<Uuid>,
    /// Webhook messages: {name, avatar_url} shown instead of the webhook's own.
    #[sqlx(default)]
    pub author_override: Option<serde_json::Value>,
    #[sqlx(default)]
    pub embeds: Option<serde_json::Value>,
    #[sqlx(default)]
    pub interaction: Option<serde_json::Value>,
    #[sqlx(default)]
    pub components: Option<serde_json::Value>,
    #[sqlx(default)]
    pub author_verified_bot: bool,
    #[sqlx(default)]
    pub author_clan_tag_guild: Option<Uuid>,
}

/// The sticker attached to a message (at most one, like Discord).
#[derive(Debug, Clone, Serialize)]
pub struct MessageSticker {
    pub id: Uuid,
    pub name: String,
    pub animated: bool,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PollOption {
    pub id: Uuid,
    pub text: String,
    /// An emoji shown before the answer (unicode or a custom `<:name:id>`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    pub votes: i64,
    /// The viewer voted for this option.
    pub me: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Poll {
    pub question: String,
    pub multi: bool,
    pub expires_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    /// Closed early or expired: no more votes, results are final.
    pub closed: bool,
    pub total_votes: i64,
    pub voters: i64,
    pub options: Vec<PollOption>,
}

/// Summary of the thread started from a message (shown as a card under it).
#[derive(Debug, Clone, Serialize)]
pub struct ThreadRef {
    pub id: Uuid,
    pub name: String,
    pub message_count: i64,
    pub archived: bool,
    pub last_message_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Reaction {
    pub emoji: String,
    pub count: i64,
    pub me: bool,
    /// A super reaction (counted apart from the normal one of the same emoji).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub burst: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author: User,
    pub content: String,
    pub reply_to: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub edited_at: Option<DateTime<Utc>>,
    pub pinned_at: Option<DateTime<Utc>>,
    pub reactions: Vec<Reaction>,
    pub attachments: Vec<Attachment>,
    pub sticker: Option<MessageSticker>,
    /// Set when this message was forwarded from another (the original's id, which may since be deleted).
    pub forwarded_from: Option<Uuid>,
    /// System messages: the related object (thread id for `thread_created`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_id: Option<Uuid>,
    pub mentions: Vec<Uuid>,
    pub mention_roles: Vec<Uuid>,
    pub mention_everyone: bool,
    pub kind: String,
    /// "Remove embeds": link previews are hidden for this message.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub suppress_embeds: bool,
    /// Sent with /tts: read aloud to people viewing the channel (who allow it).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub tts: bool,
    /// Announcements: {published: true} on a published original; on a copy, the server and channel it came from.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crosspost: Option<serde_json::Value>,
    /// Sent through this webhook.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_id: Option<Uuid>,
    /// Rich embeds from bots and webhooks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embeds: Option<serde_json::Value>,
    /// A bot's answer to a command: {id, name, user: {id, display_name}, deferred?}.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interaction: Option<serde_json::Value>,
    /// Buttons and select menus (action rows) on a bot's message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub components: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poll: Option<Poll>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread: Option<ThreadRef>,
    /// The message this one replies to, as a preview (author, text, attachment count), so the reply header
    /// renders even when the original is not loaded. None when the original was deleted (or no reply).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referenced: Option<Box<Referenced>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Referenced {
    pub id: Uuid,
    pub author: User,
    pub content: String,
    pub attachment_count: i64,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[allow(dead_code)]
#[serde(into = "AttachmentJson")]
pub struct Attachment {
    pub id: Uuid,
    pub message_id: Option<Uuid>,
    pub uploader_id: Uuid,
    pub channel_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub created_at: DateTime<Utc>,
    /// Content type of the server-made thumbnail (`/api/attachments/:id/thumb`), when one exists.
    #[sqlx(default)]
    pub thumb_type: Option<String>,
    /// Voice messages: length and a base64 waveform (up to 128 amplitude bytes).
    #[sqlx(default)]
    pub duration_ms: Option<i32>,
    #[sqlx(default)]
    pub waveform: Option<String>,
    #[sqlx(default)]
    pub transcript: Option<String>,
    #[sqlx(default)]
    pub transcript_status: Option<String>,
    /// Alt text, set by the uploader.
    #[sqlx(default)]
    pub description: Option<String>,
    /// Users who have listened to (most of) this voice message; filled by `attachments_for`.
    #[sqlx(default)]
    pub listened_by: Vec<Uuid>,
}

#[derive(Serialize)]
pub struct AttachmentJson {
    pub id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waveform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub listened_by: Vec<Uuid>,
}

impl From<Attachment> for AttachmentJson {
    fn from(a: Attachment) -> Self {
        let url = a.url();
        // `?v=2`: thumbnails are cached as immutable, and v2 ones honour EXIF orientation; bump when they change.
        let thumb_url = a.thumb_type.as_ref().map(|_| format!("/api/attachments/{}/thumb?v=2", a.id));
        AttachmentJson { id: a.id, filename: a.filename, content_type: a.content_type, size: a.size, width: a.width, height: a.height, url, thumb_url, duration_ms: a.duration_ms, waveform: a.waveform, transcript: a.transcript, transcript_status: a.transcript_status, description: a.description, listened_by: a.listened_by }
    }
}

impl Attachment {
    pub fn url(&self) -> String {
        format!("/api/attachments/{}/{}", self.id, urlencode(&self.filename))
    }
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

impl MessageRow {
    pub fn into_message(self, reactions: Vec<Reaction>, attachments: Vec<Attachment>) -> Message {
        Message {
            id: self.id,
            channel_id: self.channel_id,
            reply_to: self.reply_to,
            content: self.content,
            created_at: self.created_at,
            edited_at: self.edited_at,
            pinned_at: self.pinned_at,
            forwarded_from: self.forwarded_from,
            ref_id: self.ref_id,
            mentions: self.mentions,
            mention_roles: self.mention_roles,
            mention_everyone: self.mention_everyone,
            kind: if self.kind.is_empty() { "default".into() } else { self.kind },
            suppress_embeds: self.suppress_embeds,
            tts: self.tts,
            crosspost: self.crosspost,
            webhook_id: self.webhook_id,
            embeds: self.embeds,
            interaction: self.interaction,
            components: self.components,
            poll: None,
            thread: None,
            referenced: None,
            sticker: self.sticker_id.map(|id| MessageSticker {
                id,
                name: self.sticker_name.clone().unwrap_or_default(),
                animated: self.sticker_animated.unwrap_or(false),
                url: crate::routes::images::image_url(id),
            }),
            author: User {
                name_style: self.author_name_style.clone(),
                bot: self.author_bot,
                verified_bot: self.author_verified_bot,
                id: self.author_id,
                username: self.username,
                display_name: self.author_override.as_ref().and_then(|o| o["name"].as_str()).map(str::to_string).unwrap_or(self.display_name),
                avatar_url: match self.author_override.as_ref().map(|o| &o["avatar_url"]) { Some(serde_json::Value::String(a)) => Some(a.clone()), _ => self.avatar_url },
                custom_status: String::new(),
                bio: String::new(),
                status: String::new(),
                created_at: self.created_at,
                banner_url: None,
                theme_primary: None,
                theme_accent: None,
                pronouns: String::new(),
                name_primary: self.author_name_primary.clone(),
                name_accent: self.author_name_accent.clone(),
                avatar_decoration: self.avatar_decoration,
                clan_tag: self.clan_tag,
                clan_tag_guild: self.author_clan_tag_guild,
                panels: serde_json::Value::Null,
                ..Default::default()
            },
            reactions,
            attachments,
        }
    }
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Review {
    pub id: Uuid,
    pub target_id: Uuid,
    pub author_id: Uuid,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub author_username: String,
    pub author_display_name: String,
    pub author_avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Ban {
    pub guild_id: Uuid,
    pub user_id: Uuid,
    pub moderator_id: Option<Uuid>,
    pub reason: String,
    pub created_at: DateTime<Utc>,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub moderator_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Invite {
    pub code: String,
    pub guild_id: Uuid,
    pub creator_id: Uuid,
    pub uses: i32,
    pub max_uses: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub vanity: bool,
    /// Members who join with it are removed when they go offline, unless they have been given a role.
    #[sqlx(default)]
    #[serde(default)]
    pub temporary: bool,
}

/// An invite as Server Settings › Invites lists it, with who made it.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct InviteListing {
    #[serde(flatten)]
    #[sqlx(flatten)]
    pub invite: Invite,
    pub creator_username: String,
    pub creator_display_name: String,
    pub creator_avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DmChannel {
    #[serde(flatten)]
    pub channel: Channel,
    pub recipients: Vec<User>,
    pub last_message_at: Option<DateTime<Utc>>,
    /// This viewer's membership: accepted, or a message request they have not accepted (pending) or ignored.
    #[serde(default = "default_accepted")]
    pub request_state: String,
    /// This viewer closed it ("Close DM"): hidden from their list until a new message arrives.
    #[serde(default)]
    pub closed: bool,
    /// Why the spam filter put it in Spam (only while request_state is 'spam').
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub spam_reasons: Vec<String>,
}

fn default_everyone() -> String { "everyone".into() }
fn default_friends() -> String { "friends".into() }
fn default_accepted() -> String { "accepted".into() }
fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize)]
pub struct Relationship {
    /// friend | outgoing | incoming | blocked
    pub kind: String,
    pub user: User,
    /// When the request was sent, or (friends) when it was accepted: "Friends since".
    pub created_at: DateTime<Utc>,
    /// A friend request's note from the sender.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Pagination {
    pub before: Option<Uuid>,
    /// Newer than this id, oldest first (paging forward after an `around` jump).
    pub after: Option<Uuid>,
    /// A window centred on this id (which need not exist: uuid v7 ids sort by time, so a date works too):
    /// up to limit/2 messages at or before it and the rest after it.
    pub around: Option<Uuid>,
    pub limit: Option<i64>,
}

fn default_audio_mode() -> String {
    "voice".into()
}
