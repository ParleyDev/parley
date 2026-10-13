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
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Guild {
    pub id: Uuid,
    pub name: String,
    pub icon_url: Option<String>,
    pub owner_id: Uuid,
    pub created_at: DateTime<Utc>,
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
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
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
    pub reactions: Vec<Reaction>,
}

impl MessageRow {
    pub fn into_message(self, reactions: Vec<Reaction>) -> Message {
        Message {
            id: self.id,
            channel_id: self.channel_id,
            reply_to: self.reply_to,
            content: self.content,
            created_at: self.created_at,
            edited_at: self.edited_at,
            author: User {
                id: self.author_id,
                username: self.username,
                display_name: self.display_name,
                avatar_url: self.avatar_url,
                bio: String::new(),
                status: String::new(),
                created_at: self.created_at,
            },
            reactions,
        }
    }
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

#[derive(Debug, Deserialize)]
pub struct Pagination {
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}
