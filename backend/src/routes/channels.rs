use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Channel, Message, MessageRow, Pagination, Reaction},
    routes::guilds::{normalize_channel_name, require_member, CHANNEL_COLS},
    state::AppState,
    ws::hub::Target,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id", get(get_channel).patch(update_channel).delete(delete_channel))
        .route("/channels/:id/messages", get(list_messages).post(create_message))
        .route("/channels/:id/messages/:mid", axum::routing::patch(edit_message).delete(delete_message))
        .route("/channels/:id/messages/:mid/reactions/:emoji", put(add_reaction).delete(remove_reaction))
        .route("/channels/:id/typing", post(typing))
        .route("/channels/:id/read", put(mark_read))
}

/// Verify the user can access the channel. Returns the channel.
pub async fn require_channel(db: &PgPool, channel_id: Uuid, user_id: Uuid) -> AppResult<Channel> {
    let c = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1"))
        .bind(channel_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;
    match c.guild_id {
        Some(g) => {
            require_member(db, g, user_id).await?;
        }
        None => {
            let ok: Option<(bool,)> =
                sqlx::query_as("SELECT true FROM channel_members WHERE channel_id = $1 AND user_id = $2")
                    .bind(channel_id)
                    .bind(user_id)
                    .fetch_optional(db)
                    .await?;
            if ok.is_none() {
                return Err(AppError::NotFound("Channel not found".into()));
            }
        }
    }
    Ok(c)
}

/// Compute the fan-out target for events in this channel.
pub async fn channel_target(db: &PgPool, channel_id: Uuid, user_id: Uuid) -> AppResult<Target> {
    let c = require_channel(db, channel_id, user_id).await?;
    target_for(db, &c).await
}

pub async fn target_for(db: &PgPool, c: &Channel) -> AppResult<Target> {
    match c.guild_id {
        Some(g) => Ok(Target::Guild(g)),
        None => {
            let rows: Vec<(Uuid,)> = sqlx::query_as("SELECT user_id FROM channel_members WHERE channel_id = $1")
                .bind(c.id)
                .fetch_all(db)
                .await?;
            Ok(Target::Users(rows.into_iter().map(|r| r.0).collect()))
        }
    }
}

async fn get_channel(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Channel>> {
    Ok(Json(require_channel(&state.db, id, uid).await?))
}

#[derive(Deserialize)]
struct UpdateChannel {
    name: Option<String>,
    topic: Option<String>,
}

async fn update_channel(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateChannel>,
) -> AppResult<Json<Channel>> {
    let c = require_channel(&state.db, id, uid).await?;
    if c.guild_id.is_none() {
        return Err(AppError::BadRequest("Cannot edit DM channels".into()));
    }
    let name = match req.name {
        Some(n) => Some(normalize_channel_name(&n, &c.kind)?),
        None => None,
    };
    let c = sqlx::query_as::<_, Channel>(&format!(
        "UPDATE channels SET name = COALESCE($2, name), topic = COALESCE($3, topic) WHERE id = $1 RETURNING {CHANNEL_COLS}"
    ))
    .bind(id)
    .bind(name)
    .bind(req.topic.map(|t| t.chars().take(1024).collect::<String>()))
    .fetch_one(&state.db)
    .await?;
    state.hub.emit_guild(c.guild_id.unwrap(), "CHANNEL_UPDATE", json!(c));
    Ok(Json(c))
}

async fn delete_channel(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let c = require_channel(&state.db, id, uid).await?;
    let gid = c.guild_id.ok_or_else(|| AppError::BadRequest("Cannot delete DM channels".into()))?;
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM channels WHERE guild_id = $1 AND kind = 'text'")
        .bind(gid)
        .fetch_one(&state.db)
        .await?;
    if c.kind == "text" && count <= 1 {
        return Err(AppError::BadRequest("A server must keep at least one text channel".into()));
    }
    sqlx::query("DELETE FROM channels WHERE id = $1").bind(id).execute(&state.db).await?;
    state.hub.voice_evict(|v| v.channel_id == id);
    state.hub.emit_guild(gid, "CHANNEL_DELETE", json!({ "id": id, "guild_id": gid }));
    Ok(StatusCode::NO_CONTENT)
}

const MESSAGE_SELECT: &str = "SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to, m.created_at, m.edited_at,
    u.username, u.display_name, u.avatar_url FROM messages m JOIN users u ON u.id = m.author_id";

async fn reactions_for(db: &PgPool, ids: &[Uuid], me: Uuid) -> AppResult<HashMap<Uuid, Vec<Reaction>>> {
    let mut map: HashMap<Uuid, Vec<Reaction>> = HashMap::new();
    if ids.is_empty() {
        return Ok(map);
    }
    let rows: Vec<(Uuid, String, i64, bool)> = sqlx::query_as(
        "SELECT message_id, emoji, COUNT(*), bool_or(user_id = $2) FROM reactions
         WHERE message_id = ANY($1) GROUP BY message_id, emoji ORDER BY MIN(ctid)",
    )
    .bind(ids)
    .bind(me)
    .fetch_all(db)
    .await?;
    for (mid, emoji, count, me) in rows {
        map.entry(mid).or_default().push(Reaction { emoji, count, me });
    }
    Ok(map)
}

pub async fn fetch_message(db: &PgPool, mid: Uuid, me: Uuid) -> AppResult<Message> {
    let row = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.id = $1"))
        .bind(mid)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Message not found".into()))?;
    let mut reactions = reactions_for(db, &[mid], me).await?;
    Ok(row.into_message(reactions.remove(&mid).unwrap_or_default()))
}

async fn list_messages(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<Pagination>,
) -> AppResult<Json<Vec<Message>>> {
    require_channel(&state.db, id, uid).await?;
    let limit = p.limit.unwrap_or(50).clamp(1, 100);
    let rows = match p.before {
        Some(b) => {
            sqlx::query_as::<_, MessageRow>(&format!(
                "{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.id < $2 ORDER BY m.id DESC LIMIT $3"
            ))
            .bind(id)
            .bind(b)
            .bind(limit)
            .fetch_all(&state.db)
            .await?
        }
        None => {
            sqlx::query_as::<_, MessageRow>(&format!(
                "{MESSAGE_SELECT} WHERE m.channel_id = $1 ORDER BY m.id DESC LIMIT $2"
            ))
            .bind(id)
            .bind(limit)
            .fetch_all(&state.db)
            .await?
        }
    };
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let mut reactions = reactions_for(&state.db, &ids, uid).await?;
    let msgs: Vec<Message> = rows
        .into_iter()
        .rev()
        .map(|r| {
            let rx = reactions.remove(&r.id).unwrap_or_default();
            r.into_message(rx)
        })
        .collect();
    Ok(Json(msgs))
}

#[derive(Deserialize)]
struct CreateMessage {
    content: String,
    reply_to: Option<Uuid>,
}

async fn create_message(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateMessage>,
) -> AppResult<(StatusCode, Json<Message>)> {
    let c = require_channel(&state.db, id, uid).await?;
    let content = req.content.trim_end().to_string();
    if content.trim().is_empty() || content.chars().count() > 2000 {
        return Err(AppError::BadRequest("Message must be 1-2000 characters".into()));
    }
    if let Some(r) = req.reply_to {
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM messages WHERE id = $1 AND channel_id = $2")
            .bind(r)
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
        if ok.is_none() {
            return Err(AppError::BadRequest("Reply target not in this channel".into()));
        }
    }
    let mid = Uuid::now_v7();
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, reply_to) VALUES ($1, $2, $3, $4, $5)")
        .bind(mid)
        .bind(id)
        .bind(uid)
        .bind(&content)
        .bind(req.reply_to)
        .execute(&state.db)
        .await?;
    // Author has implicitly read their own message.
    sqlx::query(
        "INSERT INTO read_states (user_id, channel_id, last_read_msg) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_msg = EXCLUDED.last_read_msg",
    )
    .bind(uid)
    .bind(id)
    .bind(mid)
    .execute(&state.db)
    .await?;
    let msg = fetch_message(&state.db, mid, uid).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": c.guild_id }));
    Ok((StatusCode::CREATED, Json(msg)))
}

#[derive(Deserialize)]
struct EditMessage {
    content: String,
}

async fn edit_message(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid)): Path<(Uuid, Uuid)>,
    Json(req): Json<EditMessage>,
) -> AppResult<Json<Message>> {
    let c = require_channel(&state.db, id, uid).await?;
    let content = req.content.trim_end().to_string();
    if content.trim().is_empty() || content.chars().count() > 2000 {
        return Err(AppError::BadRequest("Message must be 1-2000 characters".into()));
    }
    let res = sqlx::query(
        "UPDATE messages SET content = $3, edited_at = now() WHERE id = $1 AND channel_id = $2 AND author_id = $4",
    )
    .bind(mid)
    .bind(id)
    .bind(&content)
    .bind(uid)
    .execute(&state.db)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }
    let msg = fetch_message(&state.db, mid, uid).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": c.guild_id }));
    Ok(Json(msg))
}

async fn delete_message(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let c = require_channel(&state.db, id, uid).await?;
    // Author or guild owner may delete.
    let is_owner = match c.guild_id {
        Some(g) => {
            let (owner,): (Uuid,) = sqlx::query_as("SELECT owner_id FROM guilds WHERE id = $1").bind(g).fetch_one(&state.db).await?;
            owner == uid
        }
        None => false,
    };
    let res = if is_owner {
        sqlx::query("DELETE FROM messages WHERE id = $1 AND channel_id = $2").bind(mid).bind(id)
    } else {
        sqlx::query("DELETE FROM messages WHERE id = $1 AND channel_id = $2 AND author_id = $3").bind(mid).bind(id).bind(uid)
    }
    .execute(&state.db)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_DELETE", json!({ "id": mid, "channel_id": id, "guild_id": c.guild_id }));
    Ok(StatusCode::NO_CONTENT)
}

fn valid_emoji(e: &str) -> bool {
    !e.is_empty() && e.chars().count() <= 8 && !e.chars().any(|c| c.is_ascii_alphanumeric() || c.is_whitespace())
}

async fn add_reaction(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid, emoji)): Path<(Uuid, Uuid, String)>,
) -> AppResult<StatusCode> {
    let c = require_channel(&state.db, id, uid).await?;
    if !valid_emoji(&emoji) {
        return Err(AppError::BadRequest("Invalid emoji".into()));
    }
    let exists: Option<(bool,)> = sqlx::query_as("SELECT true FROM messages WHERE id = $1 AND channel_id = $2")
        .bind(mid).bind(id).fetch_optional(&state.db).await?;
    if exists.is_none() {
        return Err(AppError::NotFound("Message not found".into()));
    }
    sqlx::query("INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
        .bind(mid).bind(uid).bind(&emoji).execute(&state.db).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "REACTION_ADD", json!({ "message_id": mid, "channel_id": id, "user_id": uid, "emoji": emoji }));
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_reaction(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid, emoji)): Path<(Uuid, Uuid, String)>,
) -> AppResult<StatusCode> {
    let c = require_channel(&state.db, id, uid).await?;
    sqlx::query("DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3")
        .bind(mid).bind(uid).bind(&emoji).execute(&state.db).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "REACTION_REMOVE", json!({ "message_id": mid, "channel_id": id, "user_id": uid, "emoji": emoji }));
    Ok(StatusCode::NO_CONTENT)
}

async fn typing(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let target = channel_target(&state.db, id, uid).await?;
    state.hub.emit(target, "TYPING_START", json!({ "channel_id": id, "user_id": uid }));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct MarkRead {
    message_id: Uuid,
}

async fn mark_read(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<MarkRead>,
) -> AppResult<StatusCode> {
    require_channel(&state.db, id, uid).await?;
    sqlx::query(
        "INSERT INTO read_states (user_id, channel_id, last_read_msg) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_msg = EXCLUDED.last_read_msg",
    )
    .bind(uid).bind(id).bind(req.message_id).execute(&state.db).await?;
    state.hub.emit_users(vec![uid], "READ_STATE_UPDATE", json!({ "channel_id": id, "last_read_msg": req.message_id }));
    Ok(StatusCode::NO_CONTENT)
}
