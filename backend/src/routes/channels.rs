use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Channel, Message, MessageRow, Pagination, Reaction},
    perms::{self, has},
    routes::attachments::{attachments_for, link},
    routes::guilds::{normalize_channel_name, CHANNEL_COLS},
    state::AppState,
    ws::hub::Target,
};
use crate::ratelimit::rl_messages;
use axum::{middleware::from_fn,
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
        .route("/channels/:id/messages", get(list_messages).post(create_message).route_layer(from_fn(rl_messages)))
        .route("/channels/:id/messages/:mid", axum::routing::patch(edit_message).delete(delete_message))
        .route("/channels/:id/messages/:mid/history", get(message_history))
        .route("/channels/:id/messages/:mid/reactions/:emoji", get(list_reactors).put(add_reaction).delete(remove_reaction))
        .route("/channels/:id/messages/:mid/forward", post(forward_message))
        .route("/users/@me/bookmarks", get(list_bookmarks))
        .route("/users/@me/bookmarks/:mid", put(add_bookmark).delete(remove_bookmark))
        .route("/channels/:id/pins", get(list_pins))
        .route("/channels/:id/pins/:mid", put(pin_message).delete(unpin_message))
        .route("/channels/:id/search", get(search_messages))
        .route("/channels/:id/typing", post(typing))
        .route("/channels/:id/read", put(mark_read))
        .route("/channels/:id/permissions/:target", put(set_overwrite).delete(delete_overwrite))
}

/// Verify the user can access the channel. Returns the channel.
pub async fn require_channel(db: &PgPool, channel_id: Uuid, user_id: Uuid) -> AppResult<Channel> {
    Ok(require_channel_perms(db, channel_id, user_id).await?.0)
}

/// Channel (with overwrites) plus the caller's effective permissions in it.
/// Guild channels the caller cannot view are reported as not found. DMs grant everything to their members.
pub async fn require_channel_perms(db: &PgPool, channel_id: Uuid, user_id: Uuid) -> AppResult<(Channel, u64)> {
    let mut c = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1"))
        .bind(channel_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;
    match c.guild_id {
        Some(_) => {
            perms::attach_overwrites(db, std::slice::from_mut(&mut c)).await?;
            let (_, p) = perms::channel_perms(db, &c, user_id).await.map_err(|_| AppError::NotFound("Channel not found".into()))?;
            if !has(p, perms::VIEW_CHANNEL) {
                return Err(AppError::NotFound("Channel not found".into()));
            }
            Ok((c, p))
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
            Ok((c, perms::ALL))
        }
    }
}

pub async fn target_for(db: &PgPool, c: &Channel) -> AppResult<Target> {
    match c.guild_id {
        Some(_) => perms::channel_audience(db, c).await,
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
    /// Group DMs: empty string clears.
    icon_url: Option<String>,
}

async fn update_channel(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateChannel>,
) -> AppResult<Json<Channel>> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    if c.guild_id.is_none() {
        // Group DMs: any member may rename or change the icon.
        if c.kind != "group" {
            return Err(AppError::BadRequest("Cannot edit DM channels".into()));
        }
        crate::routes::users::validate_image(&req.icon_url)?;
        let name = req.name.map(|n| n.trim().chars().take(100).collect::<String>());
        let renamed = name.as_ref().map(|n| *n != c.name).unwrap_or(false);
        let icon_changed = req.icon_url.as_ref().map(|u| u.as_str() != c.icon_url.as_deref().unwrap_or("")).unwrap_or(false);
        sqlx::query("UPDATE channels SET name = COALESCE($2, name), icon_url = CASE WHEN $3::text IS NULL THEN icon_url WHEN $3 = '' THEN NULL ELSE $3 END WHERE id = $1")
            .bind(id)
            .bind(&name)
            .bind(req.icon_url)
            .execute(&state.db)
            .await?;
        crate::routes::dms::broadcast_group(&state, id).await?;
        if renamed {
            let n = name.clone().unwrap_or_default();
            let text = if n.is_empty() { "cleared the group name.".to_string() } else { format!("changed the group name to {n}.") };
            crate::routes::dms::system_message(&state, id, uid, "channel_name_change", &text, vec![]).await?;
        }
        if icon_changed {
            crate::routes::dms::system_message(&state, id, uid, "channel_icon_change", "changed the group icon.", vec![]).await?;
        }
        return Ok(Json(sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(id).fetch_one(&state.db).await?));
    }
    perms::check(p, perms::MANAGE_CHANNELS)?;
    let name = match req.name {
        Some(n) => Some(normalize_channel_name(&n, &c.kind)?),
        None => None,
    };
    let mut updated = sqlx::query_as::<_, Channel>(&format!(
        "UPDATE channels SET name = COALESCE($2, name), topic = COALESCE($3, topic) WHERE id = $1 RETURNING {CHANNEL_COLS}"
    ))
    .bind(id)
    .bind(name)
    .bind(req.topic.map(|t| t.chars().take(1024).collect::<String>()))
    .fetch_one(&state.db)
    .await?;
    updated.overwrites = c.overwrites;
    let target = perms::channel_audience(&state.db, &updated).await?;
    state.hub.emit(target, "CHANNEL_UPDATE", json!(updated));
    if let Some(gid) = updated.guild_id {
        let mut d = serde_json::Map::new();
        if updated.name != c.name { d.insert("name".into(), json!(updated.name)); }
        if updated.topic != c.topic { d.insert("topic".into(), json!(updated.topic)); }
        crate::audit::guild(&state, gid, uid, "channel.update", "channel", Some(id), &updated.name, serde_json::Value::Object(d)).await;
    }
    Ok(Json(updated))
}

async fn delete_channel(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    let gid = c.guild_id.ok_or_else(|| AppError::BadRequest("Cannot delete DM channels".into()))?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
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
    crate::audit::guild(&state, gid, uid, "channel.delete", "channel", Some(id), &c.name, json!({ "kind": c.kind })).await;
    Ok(StatusCode::NO_CONTENT)
}

pub const MESSAGE_SELECT: &str = "SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to, m.created_at, m.edited_at, m.pinned_at,
    u.username, u.display_name, u.avatar_url, m.sticker_id, s.name AS sticker_name, s.animated AS sticker_animated, m.forwarded_from,
    m.mentions, m.mention_roles, m.mention_everyone, m.kind
    FROM messages m JOIN users u ON u.id = m.author_id LEFT JOIN stickers s ON s.id = m.sticker_id";

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
    let mut atts = attachments_for(db, &[mid]).await?;
    Ok(row.into_message(reactions.remove(&mid).unwrap_or_default(), atts.remove(&mid).unwrap_or_default()))
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
    let mut atts = attachments_for(&state.db, &ids).await?;
    let msgs: Vec<Message> = rows
        .into_iter()
        .rev()
        .map(|r| {
            let rx = reactions.remove(&r.id).unwrap_or_default();
            let at = atts.remove(&r.id).unwrap_or_default();
            r.into_message(rx, at)
        })
        .collect();
    Ok(Json(msgs))
}

#[derive(Deserialize)]
struct CreateMessage {
    #[serde(default)]
    content: String,
    reply_to: Option<Uuid>,
    #[serde(default)]
    attachment_ids: Vec<Uuid>,
    sticker_id: Option<Uuid>,
}

async fn create_message(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateMessage>,
) -> AppResult<(StatusCode, Json<Message>)> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::SEND_MESSAGES)?;
    let content = req.content.trim_end().to_string();
    if (content.trim().is_empty() && req.attachment_ids.is_empty() && req.sticker_id.is_none()) || content.chars().count() > 2000 {
        return Err(AppError::BadRequest("Message must be 1-2000 characters".into()));
    }
    if let Some(sid) = req.sticker_id {
        if !crate::routes::expressions::sendable_sticker(&state.db, sid, uid).await? {
            return Err(AppError::BadRequest("Unknown sticker".into()));
        }
    }
    if !req.attachment_ids.is_empty() && c.guild_id.is_some() {
        perms::check(p, perms::ATTACH_FILES)?;
    }
    if c.guild_id.is_none() && c.kind == "dm" {
        // 1:1 DMs: either side blocking the other closes the channel to new messages. Groups stay open.
        let others: Vec<(Uuid,)> = sqlx::query_as("SELECT user_id FROM channel_members WHERE channel_id = $1 AND user_id <> $2").bind(id).bind(uid).fetch_all(&state.db).await?;
        for (other,) in others {
            if crate::routes::relationships::blocked_either_way(&state.db, uid, other).await? {
                return Err(AppError::Forbidden);
            }
        }
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
    let (m_users, m_roles, m_everyone) = parse_mentions(&content);
    // @everyone only counts inside a server for members allowed to use it (it still renders as text otherwise).
    let m_everyone = m_everyone && c.guild_id.is_some() && has(p, perms::MENTION_EVERYONE);
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, reply_to, sticker_id, mentions, mention_roles, mention_everyone) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
        .bind(mid)
        .bind(id)
        .bind(uid)
        .bind(&content)
        .bind(req.reply_to)
        .bind(req.sticker_id)
        .bind(&m_users)
        .bind(&m_roles)
        .bind(m_everyone)
        .execute(&mut *tx)
        .await?;
    link(&mut tx, mid, id, uid, &req.attachment_ids).await?;
    tx.commit().await?;
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
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    let content = req.content.trim_end().to_string();
    if content.trim().is_empty() || content.chars().count() > 2000 {
        return Err(AppError::BadRequest("Message must be 1-2000 characters".into()));
    }
    let (m_users, m_roles, m_everyone) = parse_mentions(&content);
    let m_everyone = m_everyone && c.guild_id.is_some() && has(p, perms::MENTION_EVERYONE);
    let mut tx = state.db.begin().await?;
    // Keep what is being replaced (only when it actually changes) so readers can see the history.
    sqlx::query("INSERT INTO message_revisions (id, message_id, content) SELECT $1, id, content FROM messages WHERE id = $2 AND channel_id = $3 AND author_id = $4 AND content <> $5")
        .bind(Uuid::now_v7())
        .bind(mid)
        .bind(id)
        .bind(uid)
        .bind(&content)
        .execute(&mut *tx)
        .await?;
    let res = sqlx::query(
        "UPDATE messages SET content = $3, edited_at = now(), mentions = $5, mention_roles = $6, mention_everyone = $7 WHERE id = $1 AND channel_id = $2 AND author_id = $4",
    )
    .bind(mid)
    .bind(id)
    .bind(&content)
    .bind(uid)
    .bind(&m_users)
    .bind(&m_roles)
    .bind(m_everyone)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }
    tx.commit().await?;
    let msg = fetch_message(&state.db, mid, uid).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": c.guild_id }));
    Ok(Json(msg))
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct Revision {
    id: Uuid,
    content: String,
    replaced_at: chrono::DateTime<chrono::Utc>,
}

/// Previous contents of an edited message, oldest first (anyone who can read the channel).
async fn message_history(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, mid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Vec<Revision>>> {
    require_channel_perms(&state.db, id, uid).await?;
    let exists: Option<(bool,)> = sqlx::query_as("SELECT true FROM messages WHERE id = $1 AND channel_id = $2").bind(mid).bind(id).fetch_optional(&state.db).await?;
    if exists.is_none() {
        return Err(AppError::NotFound("Message not found".into()));
    }
    Ok(Json(sqlx::query_as::<_, Revision>("SELECT id, content, replaced_at FROM message_revisions WHERE message_id = $1 ORDER BY id").bind(mid).fetch_all(&state.db).await?))
}

async fn delete_message(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    // Author, or anyone who may manage messages in this channel.
    let moderator = c.guild_id.is_some() && has(p, perms::MANAGE_MESSAGES);
    // Collect attachment ids first; files are removed only after the row delete proves the caller may.
    let files: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM attachments WHERE message_id = $1").bind(mid).fetch_all(&state.db).await?;
    let author: Option<(Uuid,)> = sqlx::query_as("SELECT author_id FROM messages WHERE id = $1").bind(mid).fetch_optional(&state.db).await?;
    let res = if moderator {
        sqlx::query("DELETE FROM messages WHERE id = $1 AND channel_id = $2").bind(mid).bind(id)
    } else {
        sqlx::query("DELETE FROM messages WHERE id = $1 AND channel_id = $2 AND author_id = $3").bind(mid).bind(id).bind(uid)
    }
    .execute(&state.db)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }
    for (fid,) in files {
        let _ = tokio::fs::remove_file(state.config.upload_dir.join(fid.to_string())).await;
    }
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_DELETE", json!({ "id": mid, "channel_id": id, "guild_id": c.guild_id }));
    if let (Some(gid), Some((author_id,))) = (c.guild_id, author) {
        if author_id != uid {
            crate::audit::guild(&state, gid, uid, "message.delete", "user", Some(author_id), &crate::audit::username(&state, author_id).await, json!({ "channel": c.name, "message_id": mid })).await;
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Mentions in Discord's wire syntax: `<@id>` users, `<@&id>` roles, `@everyone` / `@here`.
pub fn parse_mentions(content: &str) -> (Vec<Uuid>, Vec<Uuid>, bool) {
    let mut users = Vec::new();
    let mut roles = Vec::new();
    let mut rest = content;
    while let Some(i) = rest.find("<@") {
        let after = &rest[i + 2..];
        let (is_role, body) = match after.strip_prefix('&') { Some(b) => (true, b), None => (false, after) };
        if let Some(end) = body.find('>') {
            if let Ok(id) = Uuid::parse_str(&body[..end]) {
                let v = if is_role { &mut roles } else { &mut users };
                if !v.contains(&id) { v.push(id) }
            }
            rest = &body[end + 1..];
        } else {
            break;
        }
    }
    let everyone = content.contains("@everyone") || content.contains("@here");
    (users, roles, everyone)
}

/// A unicode emoji (short, no letters/digits) or a custom `<:name:id>` token.
fn valid_emoji(e: &str) -> bool {
    if crate::routes::expressions::parse_custom_emoji(e).is_some() {
        return true;
    }
    !e.is_empty() && e.chars().count() <= 8 && !e.chars().any(|c| c.is_ascii_alphanumeric() || c.is_whitespace())
}

async fn add_reaction(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid, emoji)): Path<(Uuid, Uuid, String)>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::ADD_REACTIONS)?;
    if !valid_emoji(&emoji) {
        return Err(AppError::BadRequest("Invalid emoji".into()));
    }
    if let Some((_, _, eid)) = crate::routes::expressions::parse_custom_emoji(&emoji) {
        if !crate::routes::expressions::usable_emoji(&state.db, eid, uid).await? {
            return Err(AppError::BadRequest("Unknown emoji".into()));
        }
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

/// Who reacted with one emoji (for the reaction tooltip), oldest first, capped at 100.
async fn list_reactors(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid, emoji)): Path<(Uuid, Uuid, String)>,
) -> AppResult<Json<Vec<serde_json::Value>>> {
    require_channel(&state.db, id, uid).await?;
    let rows: Vec<(Uuid, String, Option<String>)> = sqlx::query_as(
        "SELECT u.id, u.display_name, u.avatar_url FROM reactions r JOIN users u ON u.id = r.user_id
         WHERE r.message_id = $1 AND r.emoji = $2 ORDER BY r.ctid LIMIT 100",
    )
    .bind(mid)
    .bind(&emoji)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows.into_iter().map(|(id, name, avatar)| json!({ "id": id, "display_name": name, "avatar_url": avatar })).collect()))
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
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::SEND_MESSAGES)?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "TYPING_START", json!({ "channel_id": id, "user_id": uid }));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct SetOverwrite {
    kind: String,
    allow: i64,
    deny: i64,
}

/// Create or replace a permission overwrite for a role or member on a guild channel.
async fn set_overwrite(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
    Json(req): Json<SetOverwrite>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    let gid = c.guild_id.ok_or_else(|| AppError::BadRequest("DM channels have no permissions".into()))?;
    perms::check(p, perms::MANAGE_ROLES)?;
    if !["role", "member"].contains(&req.kind.as_str()) {
        return Err(AppError::BadRequest("kind must be role or member".into()));
    }
    let (ctx, _) = perms::guild_perms(&state.db, gid, uid).await?;
    if req.kind == "role" {
        let role = ctx.roles.get(&target).ok_or_else(|| AppError::NotFound("Role not found".into()))?;
        if !ctx.outranks_role(uid, role) {
            return Err(AppError::Forbidden);
        }
    } else if !ctx.is_member(target) {
        return Err(AppError::NotFound("Member not found".into()));
    }
    let allow = (req.allow as u64) & perms::ALL;
    let deny = (req.deny as u64) & perms::ALL & !allow;
    // Only touch bits you hold here yourself (admins hold all).
    let existing = c.overwrites.iter().find(|o| o.target_id == target);
    let (old_allow, old_deny) = existing.map(|o| (o.allow as u64, o.deny as u64)).unwrap_or((0, 0));
    if ((old_allow ^ allow) | (old_deny ^ deny)) & !p != 0 {
        return Err(AppError::Forbidden);
    }
    let before = perms::visibility(&state.db, gid).await?;
    sqlx::query(
        "INSERT INTO channel_overwrites (channel_id, target_id, target_kind, allow, deny) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (channel_id, target_id) DO UPDATE SET target_kind = EXCLUDED.target_kind, allow = EXCLUDED.allow, deny = EXCLUDED.deny",
    )
    .bind(id)
    .bind(target)
    .bind(&req.kind)
    .bind(allow as i64)
    .bind(deny as i64)
    .execute(&state.db)
    .await?;
    perms::resync_visibility(&state, gid, &before).await?;
    crate::audit::guild(&state, gid, uid, "channel.overwrite", "channel", Some(id), &c.name, json!({ "target": target, "kind": req.kind, "allow": allow, "deny": deny })).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_overwrite(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    let gid = c.guild_id.ok_or_else(|| AppError::BadRequest("DM channels have no permissions".into()))?;
    perms::check(p, perms::MANAGE_ROLES)?;
    let existing = c.overwrites.iter().find(|o| o.target_id == target).ok_or_else(|| AppError::NotFound("Overwrite not found".into()))?;
    if ((existing.allow as u64) | (existing.deny as u64)) & !p != 0 {
        return Err(AppError::Forbidden);
    }
    if existing.target_kind == "role" {
        let (ctx, _) = perms::guild_perms(&state.db, gid, uid).await?;
        if let Some(role) = ctx.roles.get(&target) {
            if !ctx.outranks_role(uid, role) {
                return Err(AppError::Forbidden);
            }
        }
    }
    let before = perms::visibility(&state.db, gid).await?;
    sqlx::query("DELETE FROM channel_overwrites WHERE channel_id = $1 AND target_id = $2").bind(id).bind(target).execute(&state.db).await?;
    perms::resync_visibility(&state, gid, &before).await?;
    crate::audit::guild(&state, gid, uid, "channel.overwrite_delete", "channel", Some(id), &c.name, json!({ "target": target })).await;
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

/// Hydrate rows into messages (oldest first when `rows` is newest-first).
pub async fn hydrate(db: &PgPool, rows: Vec<MessageRow>, me: Uuid, reverse: bool) -> AppResult<Vec<Message>> {
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let mut reactions = reactions_for(db, &ids, me).await?;
    let mut atts = attachments_for(db, &ids).await?;
    let it = rows.into_iter().map(|r| {
        let rx = reactions.remove(&r.id).unwrap_or_default();
        let at = atts.remove(&r.id).unwrap_or_default();
        r.into_message(rx, at)
    });
    Ok(if reverse { it.rev().collect() } else { it.collect() })
}

async fn list_pins(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Message>>> {
    require_channel(&state.db, id, uid).await?;
    let rows = sqlx::query_as::<_, MessageRow>(&format!(
        "{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.pinned_at IS NOT NULL ORDER BY m.pinned_at DESC LIMIT 50"
    ))
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(hydrate(&state.db, rows, uid, false).await?))
}

/// Pinning needs Manage Messages in a server; anyone in a DM may pin.
async fn set_pinned(state: &AppState, id: Uuid, mid: Uuid, uid: Uuid, pinned: bool) -> AppResult<Json<Message>> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    if c.guild_id.is_some() && !has(p, perms::MANAGE_MESSAGES) {
        return Err(AppError::Forbidden);
    }
    let res = sqlx::query(if pinned {
        "UPDATE messages SET pinned_at = now() WHERE id = $1 AND channel_id = $2 AND pinned_at IS NULL"
    } else {
        "UPDATE messages SET pinned_at = NULL WHERE id = $1 AND channel_id = $2 AND pinned_at IS NOT NULL"
    })
    .bind(mid)
    .bind(id)
    .execute(&state.db)
    .await?;
    if res.rows_affected() == 0 {
        // Either the message is missing or already in the requested state; report which.
        let exists: Option<(bool,)> = sqlx::query_as("SELECT true FROM messages WHERE id = $1 AND channel_id = $2").bind(mid).bind(id).fetch_optional(&state.db).await?;
        if exists.is_none() {
            return Err(AppError::NotFound("Message not found".into()));
        }
    }
    let msg = fetch_message(&state.db, mid, uid).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": c.guild_id }));
    Ok(Json(msg))
}

async fn pin_message(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, mid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Message>> {
    set_pinned(&state, id, mid, uid, true).await
}

async fn unpin_message(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, mid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Message>> {
    set_pinned(&state, id, mid, uid, false).await
}

#[derive(Deserialize)]
pub struct SearchQuery {
    q: String,
}

/// Case-insensitive substring search over a channel's messages, newest first.
async fn search_messages(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<Message>>> {
    require_channel(&state.db, id, uid).await?;
    let needle = q.q.trim();
    if needle.is_empty() {
        return Ok(Json(Vec::new()));
    }
    let pattern = format!("%{}%", needle.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    let rows = sqlx::query_as::<_, MessageRow>(&format!(
        "{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.content ILIKE $2 ORDER BY m.id DESC LIMIT 25"
    ))
    .bind(id)
    .bind(pattern)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(hydrate(&state.db, rows, uid, false).await?))
}

#[derive(Deserialize)]
struct ForwardReq {
    channel_id: Uuid,
}

/// Copy a message (content, sticker, attachments) into another channel as a new message by the
/// forwarder, marked with `forwarded_from`. Needs view on the source and send (+ attach) on the target.
async fn forward_message(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid)): Path<(Uuid, Uuid)>,
    Json(req): Json<ForwardReq>,
) -> AppResult<(StatusCode, Json<Message>)> {
    require_channel(&state.db, id, uid).await?;
    let src = fetch_message(&state.db, mid, uid).await?;
    if src.channel_id != id {
        return Err(AppError::NotFound("Message not found".into()));
    }
    let (target_ch, p) = require_channel_perms(&state.db, req.channel_id, uid).await?;
    perms::check(p, perms::SEND_MESSAGES)?;
    if !src.attachments.is_empty() && target_ch.guild_id.is_some() {
        perms::check(p, perms::ATTACH_FILES)?;
    }
    if target_ch.guild_id.is_none() {
        let others: Vec<(Uuid,)> = sqlx::query_as("SELECT user_id FROM channel_members WHERE channel_id = $1 AND user_id <> $2").bind(req.channel_id).bind(uid).fetch_all(&state.db).await?;
        for (other,) in others {
            if crate::routes::relationships::blocked_either_way(&state.db, uid, other).await? {
                return Err(AppError::Forbidden);
            }
        }
    }
    let new_id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, sticker_id, forwarded_from) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(new_id)
        .bind(req.channel_id)
        .bind(uid)
        .bind(&src.content)
        .bind(src.sticker.as_ref().map(|s| s.id))
        .bind(mid)
        .execute(&mut *tx)
        .await?;
    // Duplicate attachment rows and files so the copy survives deletion of the original.
    for a in &src.attachments {
        let aid = Uuid::new_v4();
        let dir = &state.config.upload_dir;
        tokio::fs::copy(dir.join(a.id.to_string()), dir.join(aid.to_string())).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
        sqlx::query(
            "INSERT INTO attachments (id, message_id, uploader_id, channel_id, filename, content_type, size, width, height) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(aid)
        .bind(new_id)
        .bind(uid)
        .bind(req.channel_id)
        .bind(&a.filename)
        .bind(&a.content_type)
        .bind(a.size)
        .bind(a.width)
        .bind(a.height)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    sqlx::query(
        "INSERT INTO read_states (user_id, channel_id, last_read_msg) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_msg = EXCLUDED.last_read_msg",
    )
    .bind(uid)
    .bind(req.channel_id)
    .bind(new_id)
    .execute(&state.db)
    .await?;
    let msg = fetch_message(&state.db, new_id, uid).await?;
    let target = target_for(&state.db, &target_ch).await?;
    state.hub.emit(target, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": target_ch.guild_id }));
    Ok((StatusCode::CREATED, Json(msg)))
}

/// Bookmarked messages the user can still see, newest bookmark first, with their channel's guild id.
async fn list_bookmarks(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<serde_json::Value>>> {
    let rows = sqlx::query_as::<_, MessageRow>(&format!(
        "{MESSAGE_SELECT} JOIN bookmarks b ON b.message_id = m.id AND b.user_id = $1 ORDER BY b.created_at DESC LIMIT 200"
    ))
    .bind(uid)
    .fetch_all(&state.db)
    .await?;
    let msgs = hydrate(&state.db, rows, uid, false).await?;
    let mut out = Vec::with_capacity(msgs.len());
    for m in msgs {
        // Skip messages in channels the user can no longer view.
        let Ok(c) = require_channel(&state.db, m.channel_id, uid).await else { continue };
        let mut v = json!(m);
        v["guild_id"] = json!(c.guild_id);
        v["channel_name"] = json!(c.name);
        out.push(v);
    }
    Ok(Json(out))
}

async fn add_bookmark(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(mid): Path<Uuid>) -> AppResult<StatusCode> {
    let ch: Option<(Uuid,)> = sqlx::query_as("SELECT channel_id FROM messages WHERE id = $1").bind(mid).fetch_optional(&state.db).await?;
    let (channel_id,) = ch.ok_or_else(|| AppError::NotFound("Message not found".into()))?;
    require_channel(&state.db, channel_id, uid).await?;
    sqlx::query("INSERT INTO bookmarks (user_id, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(uid).bind(mid).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_bookmark(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(mid): Path<Uuid>) -> AppResult<StatusCode> {
    sqlx::query("DELETE FROM bookmarks WHERE user_id = $1 AND message_id = $2").bind(uid).bind(mid).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Ids of the user's bookmarks, for READY.
pub async fn bookmark_ids(db: &PgPool, uid: Uuid) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as("SELECT message_id FROM bookmarks WHERE user_id = $1").bind(uid).fetch_all(db).await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}
