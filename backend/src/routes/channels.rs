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
use serde::{Deserialize, Serialize};
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
        .route("/users/@me/bookmarks/:mid", put(add_bookmark).delete(remove_bookmark).patch(move_bookmark))
        .route("/channels/:id/receipts", get(receipts))
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
    /// Group DMs: hand the group to another member (owner only).
    owner_id: Option<Uuid>,
    /// Guild channels: move under a category (null = top level).
    #[serde(default, deserialize_with = "crate::routes::roles::deserialize_nullable_uuid")]
    parent_id: Option<Option<Uuid>>,
    position: Option<i32>,
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
        if let Some(new_owner) = req.owner_id.filter(|o| Some(*o) != c.owner_id) {
            if c.owner_id != Some(uid) {
                return Err(AppError::Forbidden);
            }
            let member: Option<(bool,)> = sqlx::query_as("SELECT true FROM channel_members WHERE channel_id = $1 AND user_id = $2").bind(id).bind(new_owner).fetch_optional(&state.db).await?;
            if member.is_none() {
                return Err(AppError::BadRequest("That user is not in the group".into()));
            }
            sqlx::query("UPDATE channels SET owner_id = $2 WHERE id = $1").bind(id).bind(new_owner).execute(&state.db).await?;
            crate::routes::dms::broadcast_group(&state, id).await?;
            let name = crate::audit::username(&state, new_owner).await;
            crate::routes::dms::system_message(&state, id, uid, "channel_owner_change", &format!("made {name} the group owner."), vec![new_owner]).await?;
        }
        return Ok(Json(sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(id).fetch_one(&state.db).await?));
    }
    perms::check(p, perms::MANAGE_CHANNELS)?;
    let name = match req.name {
        Some(n) => Some(normalize_channel_name(&n, &c.kind)?),
        None => None,
    };
    let gid = c.guild_id.unwrap_or_default();
    let parent = match req.parent_id {
        Some(p) => Some(crate::routes::guilds::check_parent(&state.db, gid, &c.kind, p).await?),
        None => None,
    };
    let before = if parent.is_some() { Some(perms::visibility(&state.db, gid).await?) } else { None };
    let mut updated = sqlx::query_as::<_, Channel>(&format!(
        "UPDATE channels SET name = COALESCE($2, name), topic = COALESCE($3, topic), position = COALESCE($4, position),
         parent_id = CASE WHEN $5 THEN $6 ELSE parent_id END WHERE id = $1 RETURNING {CHANNEL_COLS}"
    ))
    .bind(id)
    .bind(name)
    .bind(req.topic.map(|t| t.chars().take(1024).collect::<String>()))
    .bind(req.position)
    .bind(parent.is_some())
    .bind(parent.flatten())
    .fetch_one(&state.db)
    .await?;
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut updated)).await?;
    if let Some(before) = before {
        perms::resync_visibility(&state, gid, &before).await?;
    }
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
    m.mentions, m.mention_roles, m.mention_everyone, m.kind, m.ref_id, u.avatar_decoration, u.clan_tag
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

/// Insert a system notice ("X pinned a message") authored by the actor and push it to the channel's audience like a normal
/// message. `content` is the sentence after the actor's name; `reply_to` links a related message, `ref_id` a related object.
pub async fn system_message(state: &AppState, c: &Channel, actor: Uuid, kind: &str, content: &str, mentions: Vec<Uuid>, reply_to: Option<Uuid>, ref_id: Option<Uuid>) -> AppResult<Message> {
    let mid = Uuid::now_v7();
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, kind, mentions, reply_to, ref_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)")
        .bind(mid).bind(c.id).bind(actor).bind(content).bind(kind).bind(&mentions).bind(reply_to).bind(ref_id)
        .execute(&state.db)
        .await?;
    let msg = fetch_message(&state.db, mid, actor).await?;
    crate::metrics::METRICS.messages_created.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let target = target_for(&state.db, c).await?;
    state.hub.emit(target, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": c.guild_id }));
    Ok(msg)
}

/// Human length of a call: "a few seconds", "4 minutes", "1 hour 12 minutes".
pub fn call_duration(secs: u64) -> String {
    if secs < 60 { return "a few seconds".into() }
    let (h, m) = (secs / 3600, (secs % 3600) / 60);
    let mins = |m: u64| format!("{m} minute{}", if m == 1 { "" } else { "s" });
    if h == 0 { mins(m) } else if m == 0 { format!("{h} hour{}", if h == 1 { "" } else { "s" }) } else { format!("{h} hour{} {}", if h == 1 { "" } else { "s" }, mins(m)) }
}

/// The last person left a DM call: turn its "started a call." notice into "started a call that lasted N minutes."
/// (call_ended) or, if nobody else ever picked up, a missed call (call_missed).
pub async fn finish_call(state: &AppState, channel_id: Uuid, call: crate::ws::hub::CallInfo) -> AppResult<()> {
    let (kind, content) = if call.answered {
        ("call_ended", format!("started a call that lasted {}.", call_duration(call.started_at.elapsed().as_secs())))
    } else {
        ("call_missed", "started a call. No one answered.".to_string())
    };
    sqlx::query("UPDATE messages SET kind = $1, content = $2 WHERE id = $3 AND kind = 'call_started'")
        .bind(kind).bind(&content).bind(call.message_id).execute(&state.db).await?;
    let Some(mut c) = sqlx::query_as::<_, Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS))
        .bind(channel_id).fetch_optional(&state.db).await? else { return Ok(()) };
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut c)).await?;
    let msg = fetch_message(&state.db, call.message_id, call.starter).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": c.guild_id }));
    Ok(())
}

/// Post a server-wide notice ("X joined the server") to the guild's system channel: its first text channel.
pub async fn guild_system_message(state: &AppState, guild_id: Uuid, actor: Uuid, kind: &str, content: &str) -> AppResult<()> {
    let Some(mut c) = sqlx::query_as::<_, Channel>(&format!("SELECT {} FROM channels WHERE guild_id = $1 AND kind = 'text' ORDER BY position, created_at LIMIT 1", crate::routes::guilds::CHANNEL_COLS))
        .bind(guild_id).fetch_optional(&state.db).await? else { return Ok(()) };
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut c)).await?;
    system_message(state, &c, actor, kind, content, vec![], None, None).await?;
    Ok(())
}

pub async fn fetch_message(db: &PgPool, mid: Uuid, me: Uuid) -> AppResult<Message> {
    let row = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.id = $1"))
        .bind(mid)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Message not found".into()))?;
    Ok(hydrate(db, vec![row], me, false).await?.pop().ok_or_else(|| AppError::NotFound("Message not found".into()))?)
}

async fn list_messages(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<Pagination>,
) -> AppResult<Json<Vec<Message>>> {
    require_channel(&state.db, id, uid).await?;
    let limit = p.limit.unwrap_or(50).clamp(1, 100);
    if let Some(anchor) = p.around {
        let half = limit / 2;
        let mut older = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.id <= $2 ORDER BY m.id DESC LIMIT $3"))
            .bind(id).bind(anchor).bind(half).fetch_all(&state.db).await?;
        older.reverse();
        let newer = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT $3"))
            .bind(id).bind(anchor).bind(limit - half).fetch_all(&state.db).await?;
        older.extend(newer);
        return Ok(Json(hydrate(&state.db, older, uid, false).await?));
    }
    if let Some(after) = p.after {
        let rows = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT $3"))
            .bind(id).bind(after).bind(limit).fetch_all(&state.db).await?;
        return Ok(Json(hydrate(&state.db, rows, uid, false).await?));
    }
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
    Ok(Json(hydrate(&state.db, rows, uid, true).await?))
}

#[derive(Deserialize)]
struct CreateMessage {
    #[serde(default)]
    content: String,
    reply_to: Option<Uuid>,
    #[serde(default)]
    attachment_ids: Vec<Uuid>,
    sticker_id: Option<Uuid>,
    poll: Option<crate::routes::polls::PollInput>,
}

async fn create_message(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateMessage>,
) -> AppResult<(StatusCode, Json<Message>)> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::SEND_MESSAGES)?;
    if let Some(gid) = c.guild_id {
        crate::routes::guilds::check_rules(&state.db, gid, uid).await?;
    }
    if c.kind == "category" {
        return Err(AppError::BadRequest("Categories cannot hold messages".into()));
    }
    if c.kind == "forum" {
        return Err(AppError::BadRequest("Forum channels hold posts: create a post instead".into()));
    }
    let content = req.content.trim_end().to_string();
    if (content.trim().is_empty() && req.attachment_ids.is_empty() && req.sticker_id.is_none() && req.poll.is_none()) || content.chars().count() > 2000 {
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
            if crate::routes::relationships::blocked_either_way(&state.db, uid, other).await? || !crate::routes::dms::can_dm(&state.db, uid, other).await? {
                return Err(AppError::Undeliverable);
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
    if let Some(poll) = &req.poll {
        crate::routes::polls::insert(&mut tx, mid, poll).await?;
    }
    tx.commit().await?;
    crate::metrics::METRICS.messages_created.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
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
    if !req.attachment_ids.is_empty() {
        crate::routes::attachments::queue_transcriptions(&state, mid, uid, &c).await?;
    }
    let msg = fetch_message(&state.db, mid, uid).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": c.guild_id }));
    crate::push::after_message(state.clone(), msg.clone(), c.clone());
    if c.kind == "thread" {
        crate::routes::threads::on_thread_message(&state, c.id).await?;
    }
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
        let _ = tokio::fs::remove_file(state.config.upload_dir.join(fid.to_string())).await; let _ = tokio::fs::remove_file(state.config.upload_dir.join(format!("{fid}.thumb"))).await;
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
    let c = require_channel(&state.db, id, uid).await?;
    let prev: Option<(Option<Uuid>,)> = sqlx::query_as("SELECT last_read_msg FROM read_states WHERE user_id = $1 AND channel_id = $2").bind(uid).bind(id).fetch_optional(&state.db).await?;
    sqlx::query(
        "INSERT INTO read_states (user_id, channel_id, last_read_msg) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_msg = EXCLUDED.last_read_msg",
    )
    .bind(uid).bind(id).bind(req.message_id).execute(&state.db).await?;
    state.hub.emit_users(vec![uid], "READ_STATE_UPDATE", json!({ "channel_id": id, "last_read_msg": req.message_id }));
    // Read receipt for everyone else in the channel, only when the pointer actually moved forward and the
    // reader has not turned receipts off.
    let advanced = prev.and_then(|p| p.0).map(|p| req.message_id > p).unwrap_or(true);
    let (shows,): (bool,) = sqlx::query_as("SELECT show_read_receipts FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if advanced && shows {
        if let Ok(target) = target_for(&state.db, &c).await {
            state.hub.emit(target, "READ_RECEIPT", json!({ "channel_id": id, "user_id": uid, "message_id": req.message_id }));
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct Receipt {
    user_id: Uuid,
    message_id: Uuid,
}

/// Where everyone else in this channel has read up to (what the "seen" markers are built from).
async fn receipts(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Receipt>>> {
    require_channel(&state.db, id, uid).await?;
    Ok(Json(
        sqlx::query_as::<_, Receipt>("SELECT rs.user_id, rs.last_read_msg AS message_id FROM read_states rs JOIN users u ON u.id = rs.user_id WHERE rs.channel_id = $1 AND rs.user_id <> $2 AND rs.last_read_msg IS NOT NULL AND u.show_read_receipts ORDER BY rs.last_read_msg DESC LIMIT 500")
            .bind(id).bind(uid)
            .fetch_all(&state.db)
            .await?,
    ))
}

/// Hydrate rows into messages (oldest first when `rows` is newest-first).
pub async fn hydrate(db: &PgPool, rows: Vec<MessageRow>, me: Uuid, reverse: bool) -> AppResult<Vec<Message>> {
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let mut reactions = reactions_for(db, &ids, me).await?;
    let mut atts = attachments_for(db, &ids).await?;
    let mut polls = crate::routes::polls::polls_for(db, &ids, me).await?;
    let mut threads = crate::routes::threads::threads_for(db, &ids).await?;
    let mut refs = referenced_for(db, &rows).await?;
    let it = rows.into_iter().map(|r| {
        let rx = reactions.remove(&r.id).unwrap_or_default();
        let at = atts.remove(&r.id).unwrap_or_default();
        let poll = polls.remove(&r.id);
        let thread = threads.remove(&r.id);
        let referenced = r.reply_to.and_then(|t| refs.get(&t).cloned());
        let mut m = r.into_message(rx, at);
        m.poll = poll;
        m.thread = thread;
        m.referenced = referenced.map(Box::new);
        m
    });
    Ok(if reverse { it.rev().collect() } else { it.collect() })
}

/// Previews of the messages these rows reply to, keyed by the original's id (missing when deleted).
async fn referenced_for(db: &PgPool, rows: &[MessageRow]) -> AppResult<HashMap<Uuid, crate::models::Referenced>> {
    let mut targets: Vec<Uuid> = rows.iter().filter_map(|r| r.reply_to).collect();
    targets.sort(); targets.dedup();
    if targets.is_empty() { return Ok(HashMap::new()) }
    let originals = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.id = ANY($1)"))
        .bind(&targets).fetch_all(db).await?;
    let counts: Vec<(Uuid, i64)> = sqlx::query_as("SELECT message_id, count(*) FROM attachments WHERE message_id = ANY($1) GROUP BY message_id")
        .bind(&targets).fetch_all(db).await?;
    let counts: HashMap<Uuid, i64> = counts.into_iter().collect();
    Ok(originals.into_iter().map(|r| {
        let m = r.into_message(vec![], vec![]);
        (m.id, crate::models::Referenced { id: m.id, author: m.author, content: m.content, attachment_count: counts.get(&m.id).copied().unwrap_or(0), kind: m.kind })
    }).collect())
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
    if pinned && res.rows_affected() > 0 {
        system_message(state, &c, uid, "pins_add", "pinned a message to this channel.", vec![], Some(mid), None).await?;
    }
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
/// Per-channel search (the header box in a DM); same engine as `GET /search` with the channel fixed.
async fn search_messages(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<Message>>> {
    let params = crate::routes::search::SearchParams { q: q.q, guild_id: None, channel_id: Some(id), offset: 0 };
    Ok(Json(crate::routes::search::run(&state, uid, &params).await?.results.into_iter().map(|h| h.message).collect()))
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
            if crate::routes::relationships::blocked_either_way(&state.db, uid, other).await? || (target_ch.kind == "dm" && !crate::routes::dms::can_dm(&state.db, uid, other).await?) {
                return Err(AppError::Undeliverable);
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
        "{MESSAGE_SELECT} JOIN bookmarks b ON b.message_id = m.id AND b.user_id = $1 ORDER BY b.folder, b.position, b.created_at DESC LIMIT 200"
    ))
    .bind(uid)
    .fetch_all(&state.db)
    .await?;
    let meta: Vec<(Uuid, String, i32)> = sqlx::query_as("SELECT message_id, folder, position FROM bookmarks WHERE user_id = $1").bind(uid).fetch_all(&state.db).await?;
    let meta: HashMap<Uuid, (String, i32)> = meta.into_iter().map(|(id, f, p)| (id, (f, p))).collect();
    let msgs = hydrate(&state.db, rows, uid, false).await?;
    let mut out = Vec::with_capacity(msgs.len());
    for m in msgs {
        // Skip messages in channels the user can no longer view.
        let Ok(c) = require_channel(&state.db, m.channel_id, uid).await else { continue };
        let (folder, position) = meta.get(&m.id).cloned().unwrap_or_default();
        let mut v = json!(m);
        v["guild_id"] = json!(c.guild_id);
        v["channel_name"] = json!(c.name);
        v["folder"] = json!(folder);
        v["position"] = json!(position);
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

#[derive(Deserialize)]
struct MoveBookmark {
    /// Folder name (empty = no folder), up to 40 chars.
    folder: Option<String>,
    /// Manual order inside the folder (lower first).
    position: Option<i32>,
}

/// `PATCH /users/@me/bookmarks/:mid`: move a bookmark into a folder and/or reorder it.
async fn move_bookmark(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(mid): Path<Uuid>, Json(req): Json<MoveBookmark>) -> AppResult<Json<serde_json::Value>> {
    let folder = req.folder.map(|f| f.trim().chars().take(40).collect::<String>());
    let row: Option<(String, i32)> = sqlx::query_as(
        "UPDATE bookmarks SET folder = COALESCE($3, folder), position = COALESCE($4, position) WHERE user_id = $1 AND message_id = $2 RETURNING folder, position",
    )
    .bind(uid).bind(mid).bind(&folder).bind(req.position)
    .fetch_optional(&state.db)
    .await?;
    let (folder, position) = row.ok_or_else(|| AppError::NotFound("Bookmark not found".into()))?;
    Ok(Json(json!({ "message_id": mid, "folder": folder, "position": position })))
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
