use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
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
    #[sqlx(default)]
    #[serde(default)]
    pub custom_status: String,
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
}

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
    /// Permission overwrites; filled by `perms::attach_overwrites` for guild channels.
    #[sqlx(skip)]
    #[serde(default)]
    pub overwrites: Vec<Overwrite>,
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
    #[sqlx(default)]
    #[serde(default)]
    pub custom_status: String,
    /// Timed out until (moderation): only reading allowed while in the future.
    #[sqlx(default)]
    #[serde(default)]
    pub timeout_until: Option<DateTime<Utc>>,
    #[sqlx(skip)]
    #[serde(default)]
    pub roles: Vec<Uuid>,
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
    pub mentions: Vec<Uuid>,
    #[sqlx(default)]
    pub mention_roles: Vec<Uuid>,
    #[sqlx(default)]
    pub mention_everyone: bool,
    /// 'default' for ordinary messages; group-DM system notices use recipient_add / recipient_remove /
    /// recipient_leave / channel_name_change / channel_icon_change.
    #[sqlx(default)]
    pub kind: String,
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

#[derive(Debug, Clone, Serialize)]
pub struct Reaction {
    pub emoji: String,
    pub count: i64,
    pub me: bool,
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
    pub mentions: Vec<Uuid>,
    pub mention_roles: Vec<Uuid>,
    pub mention_everyone: bool,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poll: Option<Poll>,
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
}

impl From<Attachment> for AttachmentJson {
    fn from(a: Attachment) -> Self {
        let url = a.url();
        AttachmentJson { id: a.id, filename: a.filename, content_type: a.content_type, size: a.size, width: a.width, height: a.height, url }
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
            mentions: self.mentions,
            mention_roles: self.mention_roles,
            mention_everyone: self.mention_everyone,
            kind: if self.kind.is_empty() { "default".into() } else { self.kind },
            poll: None,
            sticker: self.sticker_id.map(|id| MessageSticker {
                id,
                name: self.sticker_name.clone().unwrap_or_default(),
                animated: self.sticker_animated.unwrap_or(false),
                url: crate::routes::images::image_url(id),
            }),
            author: User {
                id: self.author_id,
                username: self.username,
                display_name: self.display_name,
                avatar_url: self.avatar_url,
                custom_status: String::new(),
                bio: String::new(),
                status: String::new(),
                created_at: self.created_at,
                banner_url: None,
                theme_primary: None,
                theme_accent: None,
                pronouns: String::new(),
                name_primary: None,
                name_accent: None,
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
}

#[derive(Debug, Clone, Serialize)]
pub struct DmChannel {
    #[serde(flatten)]
    pub channel: Channel,
    pub recipients: Vec<User>,
    pub last_message_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Relationship {
    /// friend | outgoing | incoming | blocked
    pub kind: String,
    pub user: User,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct Pagination {
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}
