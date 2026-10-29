//! Threads: side conversations under a text channel, started from a message or from the channel.
//! A thread is a channel (kind 'thread', parent_id = the text channel) so every message route works
//! inside it and it inherits the parent's permission overwrites. Archiving freezes it until someone posts.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Channel, Message, ThreadRef},
    perms::{self, has},
    routes::{channels::{fetch_message, require_channel_perms, target_for}, guilds::CHANNEL_COLS},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/threads", get(list).post(create))
        .route("/channels/:id/threads/:tid", get(show))
        .route("/threads/:tid", patch(update))
        .route("/threads/:tid/members", get(members))
        .route("/threads/:tid/members/:uid", axum::routing::put(add_member).delete(remove_member))
        .route("/users/@me/threads", get(my_threads))
        .route("/channels/:id/tags", get(list_tags).post(create_tag))
        .route("/channels/:id/tags/:tag", patch(update_tag).delete(delete_tag))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ThreadInfo {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub guild_id: Option<Uuid>,
    pub name: String,
    pub root_message_id: Option<Uuid>,
    pub owner_id: Option<Uuid>,
    pub owner_username: Option<String>,
    pub archived_at: Option<DateTime<Utc>>,
    pub pinned_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub message_count: i64,
    pub last_message_at: Option<DateTime<Utc>>,
    /// Forum posts: tag ids and the first message's text (list preview).
    pub tags: Vec<Uuid>,
    pub preview: Option<String>,
    pub private: bool,
    pub locked: bool,
    pub auto_archive_minutes: i32,
    pub member_count: i64,
    /// The post's first message (forum default reactions go on it).
    pub first_message_id: Option<Uuid>,
    /// Media channels: the first image or video of the post (a thumbnail when there is one), and its type.
    pub cover_url: Option<String>,
    pub cover_type: Option<String>,
}

const THREAD_SELECT: &str = "SELECT c.id, c.parent_id, c.guild_id, c.name, t.root_message_id, t.owner_id, u.username AS owner_username, t.archived_at, t.pinned_at, t.created_at,
    (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id) AS message_count,
    (SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id) AS last_message_at,
    ARRAY(SELECT tt.tag_id FROM thread_tags tt JOIN forum_tags ft ON ft.id = tt.tag_id WHERE tt.thread_id = c.id ORDER BY ft.position) AS tags,
    (SELECT LEFT(m.content, 200) FROM messages m WHERE m.channel_id = c.id ORDER BY m.id LIMIT 1) AS preview,
    t.private, t.locked, t.auto_archive_minutes, (SELECT COUNT(*) FROM thread_members tm WHERE tm.thread_id = c.id) AS member_count,
    (SELECT m.id FROM messages m WHERE m.channel_id = c.id ORDER BY m.id LIMIT 1) AS first_message_id,
    cov.url AS cover_url, cov.content_type AS cover_type
    FROM threads t JOIN channels c ON c.id = t.channel_id LEFT JOIN users u ON u.id = t.owner_id
    LEFT JOIN LATERAL (SELECT '/api/attachments/' || a.id || CASE WHEN a.thumb_type IS NOT NULL THEN '/thumb?v=2' ELSE '/cover' END AS url, a.content_type
        FROM attachments a WHERE a.channel_id = c.id AND (a.content_type LIKE 'image/%' OR a.content_type LIKE 'video/%') AND a.message_id = (SELECT m.id FROM messages m WHERE m.channel_id = c.id ORDER BY m.id LIMIT 1)
        ORDER BY a.created_at LIMIT 1) cov ON true";

/// Thread summaries keyed by root message, for a batch of messages (message hydration).
pub async fn threads_for(db: &PgPool, message_ids: &[Uuid]) -> AppResult<HashMap<Uuid, ThreadRef>> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows: Vec<(Uuid, Uuid, String, i64, Option<DateTime<Utc>>, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT t.root_message_id, c.id, c.name, (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id), t.archived_at,
                (SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id)
         FROM threads t JOIN channels c ON c.id = t.channel_id WHERE t.root_message_id = ANY($1)",
    )
    .bind(message_ids)
    .fetch_all(db)
    .await?;
    Ok(rows.into_iter().map(|(root, id, name, n, archived, last)| (root, ThreadRef { id, name, message_count: n, archived: archived.is_some(), last_message_at: last })).collect())
}

fn clean_name(raw: &str) -> AppResult<String> {
    let name: String = raw.trim().chars().take(100).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(AppError::BadRequest("Thread name must be 1-100 characters".into()));
    }
    Ok(name)
}

#[derive(Deserialize)]
struct CreateThread {
    name: String,
    /// Start the thread from this message of the channel (shown as a card under it).
    message_id: Option<Uuid>,
    /// Forum posts: the body of the first message and the post's tags.
    #[serde(default)]
    content: String,
    #[serde(default)]
    tags: Vec<Uuid>,
    /// Text channels only: a private thread (members and moderators see it).
    #[serde(default)]
    private: bool,
    /// Minutes of quiet before it archives itself: 60, 1440, 4320 or 10080.
    auto_archive_minutes: Option<i32>,
    /// Forum posts: files uploaded to the forum, attached to the first message. Media channels need at least one.
    #[serde(default)]
    attachment_ids: Vec<Uuid>,
}

pub const AUTO_ARCHIVE: [i32; 4] = [60, 1440, 4320, 10080];

async fn check_tags(db: &PgPool, forum: Uuid, tags: &[Uuid]) -> AppResult<()> {
    for t in tags {
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM forum_tags WHERE id = $1 AND channel_id = $2").bind(t).bind(forum).fetch_optional(db).await?;
        if ok.is_none() {
            return Err(AppError::BadRequest("Unknown tag".into()));
        }
    }
    Ok(())
}

async fn set_tags(db: &PgPool, forum: Uuid, tid: Uuid, tags: &[Uuid]) -> AppResult<()> {
    check_tags(db, forum, tags).await?;
    sqlx::query("DELETE FROM thread_tags WHERE thread_id = $1").bind(tid).execute(db).await?;
    for t in tags {
        sqlx::query("INSERT INTO thread_tags (thread_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(tid).bind(t).execute(db).await?;
    }
    Ok(())
}

async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<CreateThread>) -> AppResult<(StatusCode, Json<ThreadInfo>)> {
    let (parent, p) = require_channel_perms(&state.db, id, uid).await?;
    if parent.kind != "text" && parent.kind != "forum" {
        return Err(AppError::BadRequest("Threads can only be created in text or forum channels".into()));
    }
    perms::check(p, perms::SEND_MESSAGES)?;
    crate::signup_guard::require_can_post(&state, uid).await?;
    let name = clean_name(&req.name)?;
    let is_forum = parent.kind == "forum";
    let content = req.content.trim_end().to_string();
    if is_forum && ((content.trim().is_empty() && req.attachment_ids.is_empty()) || content.chars().count() > 2000) {
        return Err(AppError::BadRequest("A post needs a message of 1-2000 characters".into()));
    }
    if is_forum && parent.media && req.attachment_ids.is_empty() { return Err(AppError::BadRequest("Posts in a media channel need an image or video".into())) }
    if !req.attachment_ids.is_empty() && (!is_forum || !perms::has(p, perms::ATTACH_FILES)) { return Err(AppError::Forbidden) }
    if is_forum {
        check_tags(&state.db, id, &req.tags).await?;
        if parent.forum_require_tag && req.tags.is_empty() { return Err(AppError::BadRequest("This forum needs at least one tag on new posts".into())) }
    }
    if let Some(mid) = req.message_id {
        let row: Option<(Uuid,)> = sqlx::query_as("SELECT channel_id FROM messages WHERE id = $1").bind(mid).fetch_optional(&state.db).await?;
        if row.map(|r| r.0) != Some(id) {
            return Err(AppError::BadRequest("That message is not in this channel".into()));
        }
        let existing: Option<(Uuid,)> = sqlx::query_as("SELECT channel_id FROM threads WHERE root_message_id = $1").bind(mid).fetch_optional(&state.db).await?;
        if existing.is_some() {
            return Err(AppError::Conflict("That message already has a thread".into()));
        }
    }
    if req.private && (is_forum || req.message_id.is_some()) { return Err(AppError::BadRequest("Only threads started from a channel can be private".into())) }
    if req.auto_archive_minutes.map(|m| !AUTO_ARCHIVE.contains(&m)).unwrap_or(false) { return Err(AppError::BadRequest("auto_archive_minutes must be 60, 1440, 4320 or 10080".into())) }
    let tid = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO channels (id, guild_id, name, kind, topic, position, parent_id) VALUES ($1, $2, $3, 'thread', '', 0, $4)")
        .bind(tid).bind(parent.guild_id).bind(&name).bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO threads (channel_id, root_message_id, owner_id, private, auto_archive_minutes) VALUES ($1, $2, $3, $4, COALESCE($5, 4320))")
        .bind(tid).bind(req.message_id).bind(uid).bind(req.private).bind(req.auto_archive_minutes).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO thread_members (thread_id, user_id) VALUES ($1, $2)").bind(tid).bind(uid).execute(&mut *tx).await?;
    if req.private {
        // Private: the parent's effective permissions, minus View for @everyone, plus View for the creator and for
        // roles that moderate messages (they can always see private threads, like Discord's Manage Threads).
        let mut par = parent.clone();
        perms::attach_overwrites(&state.db, std::slice::from_mut(&mut par)).await?;
        let gid = parent.guild_id.ok_or(AppError::BadRequest("Not a server channel".into()))?;
        let mut ows: Vec<(Uuid, String, i64, i64)> = par.overwrites.iter().map(|o| (o.target_id, o.target_kind.clone(), o.allow, o.deny)).collect();
        match ows.iter_mut().find(|o| o.0 == gid) {
            Some(e) => { e.2 &= !(perms::VIEW_CHANNEL as i64); e.3 |= perms::VIEW_CHANNEL as i64; }
            None => ows.push((gid, "role".into(), 0, perms::VIEW_CHANNEL as i64)),
        }
        let mods: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM roles WHERE guild_id = $1 AND id <> guild_id AND (permissions & $2) <> 0").bind(gid).bind((perms::MANAGE_MESSAGES | perms::MANAGE_THREADS) as i64).fetch_all(&mut *tx).await?;
        for (r,) in mods { match ows.iter_mut().find(|o| o.0 == r) { Some(e) => { e.2 |= perms::VIEW_CHANNEL as i64; e.3 &= !(perms::VIEW_CHANNEL as i64); } None => ows.push((r, "role".into(), perms::VIEW_CHANNEL as i64, 0)) } }
        match ows.iter_mut().find(|o| o.0 == uid) { Some(e) => { e.2 |= perms::VIEW_CHANNEL as i64; e.3 &= !(perms::VIEW_CHANNEL as i64); } None => ows.push((uid, "member".into(), perms::VIEW_CHANNEL as i64, 0)) }
        for (target, kind, allow, deny) in ows {
            sqlx::query("INSERT INTO channel_overwrites (channel_id, target_id, target_kind, allow, deny) VALUES ($1, $2, $3, $4, $5)").bind(tid).bind(target).bind(kind).bind(allow).bind(deny).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    if is_forum {
        set_tags(&state.db, id, tid, &req.tags).await?;
    }
    let mut c = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(tid).fetch_one(&state.db).await?;
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut c)).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target.clone(), "CHANNEL_CREATE", json!(c));
    state.hub.emit_users(vec![uid], "THREAD_MEMBER_UPDATE", json!({ "thread_id": tid, "joined": true }));
    if is_forum {
        // The post body is the thread's first message, by the poster.
        let mid = Uuid::now_v7();
        let (m_users, m_roles, _) = crate::routes::channels::parse_mentions(&content);
        let mut tx = state.db.begin().await?;
        sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, mentions, mention_roles) VALUES ($1, $2, $3, $4, $5, $6)")
            .bind(mid).bind(tid).bind(uid).bind(&content).bind(&m_users).bind(&m_roles)
            .execute(&mut *tx)
            .await?;
        // Uploaded to the forum; they move into the post with its first message.
        crate::routes::attachments::link(&mut tx, mid, id, uid, &req.attachment_ids).await?;
        sqlx::query("UPDATE attachments SET channel_id = $2 WHERE message_id = $1").bind(mid).bind(tid).execute(&mut *tx).await?;
        tx.commit().await?;
        crate::metrics::METRICS.messages_created.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let msg = fetch_message(&state.db, mid, uid).await?;
        state.hub.emit(target.clone(), "MESSAGE_CREATE", json!({ "message": msg, "guild_id": c.guild_id }));
        state.hub.emit(target.clone(), "THREAD_UPDATE", json!(info(&state.db, tid).await?));
    }
    if let Some(mid) = req.message_id {
        // The root message now carries a thread card.
        let msg = fetch_message(&state.db, mid, uid).await?;
        state.hub.emit(target, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": parent.guild_id }));
    }
    if !is_forum && !req.private {
        crate::routes::channels::system_message(&state, &parent, uid, "thread_created", &format!("started a thread: {name}"), vec![], req.message_id, Some(tid)).await?;
    }
    if let Some(gid) = parent.guild_id {
        crate::audit::guild(&state, gid, uid, "thread.create", "channel", Some(tid), &name, json!({ "parent": parent.name })).await;
    }
    Ok((StatusCode::CREATED, Json(info(&state.db, tid).await?)))
}

pub async fn info(db: &PgPool, tid: Uuid) -> AppResult<ThreadInfo> {
    sqlx::query_as::<_, ThreadInfo>(&format!("{THREAD_SELECT} WHERE c.id = $1")).bind(tid).fetch_optional(db).await?.ok_or_else(|| AppError::NotFound("Thread not found".into()))
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default)]
    archived: bool,
    /// Forum: only posts carrying this tag.
    tag: Option<Uuid>,
    /// "activity" (default) or "created".
    #[serde(default)]
    sort: String,
    /// Search titles and first messages.
    #[serde(default)]
    q: String,
}

/// Threads of a text/forum channel: active by default, `?archived=true` for the archive; pinned posts first,
/// then newest activity (or newest created with `sort=created`); `tag=` filters forum posts.
async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Query(q): Query<ListQuery>) -> AppResult<Json<Vec<ThreadInfo>>> {
    require_channel_perms(&state.db, id, uid).await?;
    let order = if q.sort == "created" { "c.created_at DESC" } else { "COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id), c.created_at) DESC" };
    Ok(Json(
        sqlx::query_as::<_, ThreadInfo>(&format!("{THREAD_SELECT} WHERE c.parent_id = $1 AND (t.archived_at IS NOT NULL) = $2 AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM thread_tags tt WHERE tt.thread_id = c.id AND tt.tag_id = $3))
            AND ($4 = '' OR c.name ILIKE '%' || $4 || '%' OR EXISTS (SELECT 1 FROM messages fm WHERE fm.channel_id = c.id AND fm.id = (SELECT m2.id FROM messages m2 WHERE m2.channel_id = c.id ORDER BY m2.id LIMIT 1) AND fm.content ILIKE '%' || $4 || '%')) ORDER BY (t.pinned_at IS NOT NULL) DESC, {order} LIMIT 200"))
            .bind(id)
            .bind(q.archived)
            .bind(q.tag)
            .bind(q.q.trim().replace('%', "").replace('_', ""))
            .fetch_all(&state.db)
            .await?,
    ))
}

/// One thread with its root message (hydrated), for the thread panel header.
async fn show(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, tid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Value>> {
    let (t, _) = require_channel_perms(&state.db, tid, uid).await?;
    if t.kind != "thread" || t.parent_id != Some(id) {
        return Err(AppError::NotFound("Thread not found".into()));
    }
    let i = info(&state.db, tid).await?;
    let root: Option<Message> = match i.root_message_id { Some(mid) => fetch_message(&state.db, mid, uid).await.ok(), None => None };
    Ok(Json(json!({ "thread": i, "root": root })))
}

#[derive(Deserialize)]
struct UpdateThread {
    name: Option<String>,
    archived: Option<bool>,
    /// Forum posts: pin to the top (Manage Messages only).
    pinned: Option<bool>,
    tags: Option<Vec<Uuid>>,
    /// Only moderators can post (or unarchive). Manage Messages only.
    locked: Option<bool>,
    auto_archive_minutes: Option<i32>,
}

/// Rename, (un)archive, retag: the thread's owner, or Manage Messages in the parent channel. Pinning is moderators only.
async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(tid): Path<Uuid>, Json(req): Json<UpdateThread>) -> AppResult<Json<ThreadInfo>> {
    let (t, p) = require_channel_perms(&state.db, tid, uid).await?;
    if t.kind != "thread" {
        return Err(AppError::NotFound("Thread not found".into()));
    }
    let (owner,): (Option<Uuid>,) = sqlx::query_as("SELECT owner_id FROM threads WHERE channel_id = $1").bind(tid).fetch_one(&state.db).await?;
    if owner != Some(uid) && !perms::moderates_threads(p) {
        return Err(AppError::Forbidden);
    }
    if let Some(pin) = req.pinned {
        if !perms::moderates_threads(p) { return Err(AppError::Forbidden) }
        sqlx::query("UPDATE threads SET pinned_at = CASE WHEN $2 THEN COALESCE(pinned_at, now()) ELSE NULL END WHERE channel_id = $1").bind(tid).bind(pin).execute(&state.db).await?;
    }
    if let Some(tags) = &req.tags {
        let forum = t.parent_id.ok_or(AppError::NotFound("Thread not found".into()))?;
        set_tags(&state.db, forum, tid, tags).await?;
    }
    if let Some(n) = &req.name {
        let name = clean_name(n)?;
        sqlx::query("UPDATE channels SET name = $2 WHERE id = $1").bind(tid).bind(&name).execute(&state.db).await?;
    }
    if let Some(l) = req.locked {
        if !perms::moderates_threads(p) { return Err(AppError::Forbidden) }
        sqlx::query("UPDATE threads SET locked = $2 WHERE channel_id = $1").bind(tid).bind(l).execute(&state.db).await?;
    }
    if let Some(m) = req.auto_archive_minutes {
        if !AUTO_ARCHIVE.contains(&m) { return Err(AppError::BadRequest("auto_archive_minutes must be 60, 1440, 4320 or 10080".into())) }
        sqlx::query("UPDATE threads SET auto_archive_minutes = $2 WHERE channel_id = $1").bind(tid).bind(m).execute(&state.db).await?;
    }
    if let Some(a) = req.archived {
        let (locked,): (bool,) = sqlx::query_as("SELECT locked FROM threads WHERE channel_id = $1").bind(tid).fetch_one(&state.db).await?;
        if locked && !a && !perms::moderates_threads(p) { return Err(AppError::Forbidden) }
        sqlx::query("UPDATE threads SET archived_at = CASE WHEN $2 THEN COALESCE(archived_at, now()) ELSE NULL END WHERE channel_id = $1").bind(tid).bind(a).execute(&state.db).await?;
    }
    announce(&state, tid).await?;
    Ok(Json(info(&state.db, tid).await?))
}

/// Push the thread's current state: CHANNEL_UPDATE for the thread and MESSAGE_UPDATE for its root message's card.
pub async fn announce(state: &AppState, tid: Uuid) -> AppResult<()> {
    let mut c = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(tid).fetch_one(&state.db).await?;
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut c)).await?;
    let target = target_for(&state.db, &c).await?;
    let i = info(&state.db, tid).await?;
    state.hub.emit(target.clone(), "THREAD_UPDATE", json!(i));
    if let Some(mid) = i.root_message_id {
        if let Ok(msg) = fetch_message(&state.db, mid, Uuid::nil()).await {
            state.hub.emit(target, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": c.guild_id }));
        }
    }
    Ok(())
}

/// Called when a message lands in a thread: wakes an archived thread and refreshes the root card's count.
pub async fn on_thread_message(state: &AppState, tid: Uuid, author: Uuid) -> AppResult<()> {
    sqlx::query("UPDATE threads SET archived_at = NULL WHERE channel_id = $1").bind(tid).execute(&state.db).await?;
    // Posting in a thread joins it.
    if sqlx::query("INSERT INTO thread_members (thread_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(tid).bind(author).execute(&state.db).await?.rows_affected() > 0 {
        state.hub.emit_users(vec![author], "THREAD_MEMBER_UPDATE", json!({ "thread_id": tid, "joined": true }));
    }
    announce(state, tid).await
}

/// Locked threads take posts from moderators only.
pub async fn check_locked(db: &PgPool, tid: Uuid, p: u64) -> AppResult<()> {
    let row: Option<(bool,)> = sqlx::query_as("SELECT locked FROM threads WHERE channel_id = $1").bind(tid).fetch_optional(db).await?;
    if row.map(|r| r.0).unwrap_or(false) && !perms::moderates_threads(p) { return Err(AppError::Forbidden) }
    Ok(())
}

/// Background task: archive threads quiet for longer than their auto-archive time.
pub async fn auto_archive(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(120)).await;
        let due: Vec<(Uuid,)> = sqlx::query_as(
            "UPDATE threads t SET archived_at = now() WHERE t.archived_at IS NULL AND t.pinned_at IS NULL
               AND COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = t.channel_id), t.created_at) < now() - make_interval(mins => t.auto_archive_minutes)
             RETURNING t.channel_id")
            .fetch_all(&state.db).await.unwrap_or_default();
        for (tid,) in due { let _ = announce(&state, tid).await; }
    }
}

/// `GET /threads/:tid/members`
async fn members(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(tid): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    let (t, _) = require_channel_perms(&state.db, tid, uid).await?;
    if t.kind != "thread" { return Err(AppError::NotFound("Thread not found".into())) }
    let rows: Vec<(Uuid, String, Option<String>)> = sqlx::query_as("SELECT u.id, u.display_name, u.avatar_url FROM thread_members tm JOIN users u ON u.id = tm.user_id WHERE tm.thread_id = $1 ORDER BY tm.joined_at LIMIT 500")
        .bind(tid).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(id, name, av)| json!({ "id": id, "display_name": name, "avatar_url": av })).collect()))
}

/// `PUT /threads/:tid/members/:uid`: join (yourself), or add someone (a member of a private thread adds people).
async fn add_member(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((tid, target)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    let (t, p) = require_channel_perms(&state.db, tid, uid).await?;
    if t.kind != "thread" { return Err(AppError::NotFound("Thread not found".into())) }
    let (private,): (bool,) = sqlx::query_as("SELECT private FROM threads WHERE channel_id = $1").bind(tid).fetch_one(&state.db).await?;
    let gid = t.guild_id.ok_or(AppError::NotFound("Thread not found".into()))?;
    if target != uid {
        let mine: Option<(bool,)> = sqlx::query_as("SELECT true FROM thread_members WHERE thread_id = $1 AND user_id = $2").bind(tid).bind(uid).fetch_optional(&state.db).await?;
        if mine.is_none() && !perms::moderates_threads(p) { return Err(AppError::Forbidden) }
        let (ctx, _) = perms::guild_perms(&state.db, gid, uid).await?;
        if !ctx.is_member(target) { return Err(AppError::NotFound("Member not found".into())) }
        // They must be able to see the parent channel.
        if require_channel_perms(&state.db, t.parent_id.unwrap_or(tid), target).await.is_err() { return Err(AppError::BadRequest("They can't see this channel".into())) }
    }
    if private {
        let before = perms::visibility(&state.db, gid).await?;
        sqlx::query("INSERT INTO channel_overwrites (channel_id, target_id, target_kind, allow, deny) VALUES ($1, $2, 'member', $3, 0)
                     ON CONFLICT (channel_id, target_id) DO UPDATE SET allow = channel_overwrites.allow | $3, deny = channel_overwrites.deny & ~$3")
            .bind(tid).bind(target).bind(perms::VIEW_CHANNEL as i64).execute(&state.db).await?;
        perms::resync_visibility(&state, gid, &before).await?;
    }
    sqlx::query("INSERT INTO thread_members (thread_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(tid).bind(target).execute(&state.db).await?;
    state.hub.emit_users(vec![target], "THREAD_MEMBER_UPDATE", json!({ "thread_id": tid, "joined": true }));
    announce(&state, tid).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `DELETE /threads/:tid/members/:uid`: leave (yourself), or remove someone (the owner or a moderator).
async fn remove_member(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((tid, target)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    let (t, p) = require_channel_perms(&state.db, tid, uid).await?;
    if t.kind != "thread" { return Err(AppError::NotFound("Thread not found".into())) }
    let (private, owner): (bool, Option<Uuid>) = sqlx::query_as("SELECT private, owner_id FROM threads WHERE channel_id = $1").bind(tid).fetch_one(&state.db).await?;
    if target != uid && owner != Some(uid) && !perms::moderates_threads(p) { return Err(AppError::Forbidden) }
    sqlx::query("DELETE FROM thread_members WHERE thread_id = $1 AND user_id = $2").bind(tid).bind(target).execute(&state.db).await?;
    if private {
        if let Some(gid) = t.guild_id {
            let before = perms::visibility(&state.db, gid).await?;
            sqlx::query("DELETE FROM channel_overwrites WHERE channel_id = $1 AND target_id = $2 AND target_kind = 'member'").bind(tid).bind(target).execute(&state.db).await?;
            perms::resync_visibility(&state, gid, &before).await?;
        }
    }
    state.hub.emit_users(vec![target], "THREAD_MEMBER_UPDATE", json!({ "thread_id": tid, "joined": false }));
    announce(&state, tid).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /users/@me/threads`: active threads you've joined (for the channel list).
async fn my_threads(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Uuid>>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as("SELECT tm.thread_id FROM thread_members tm JOIN threads t ON t.channel_id = tm.thread_id WHERE tm.user_id = $1 AND t.archived_at IS NULL")
        .bind(uid).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|r| r.0).collect()))
}

// ---------- forum tags ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ForumTag {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub name: String,
    pub emoji: String,
    pub position: i32,
}

#[derive(Deserialize)]
struct TagInput {
    name: Option<String>,
    emoji: Option<String>,
}

fn clean_tag(name: &str) -> AppResult<String> {
    let n: String = name.trim().chars().take(20).collect();
    if n.is_empty() { return Err(AppError::BadRequest("Tag name must be 1-20 characters".into())) }
    Ok(n)
}

async fn list_tags(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<ForumTag>>> {
    require_channel_perms(&state.db, id, uid).await?;
    Ok(Json(sqlx::query_as::<_, ForumTag>("SELECT id, channel_id, name, emoji, position FROM forum_tags WHERE channel_id = $1 ORDER BY position, name").bind(id).fetch_all(&state.db).await?))
}

async fn tags_changed(state: &AppState, forum: &Channel) -> AppResult<()> {
    let target = target_for(&state.db, forum).await?;
    state.hub.emit(target, "CHANNEL_UPDATE", json!(forum));
    Ok(())
}

async fn create_tag(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<TagInput>) -> AppResult<(StatusCode, Json<ForumTag>)> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    if c.kind != "forum" {
        return Err(AppError::BadRequest("Only forum channels have tags".into()));
    }
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM forum_tags WHERE channel_id = $1").bind(id).fetch_one(&state.db).await?;
    if count >= 20 {
        return Err(AppError::BadRequest("A forum can have at most 20 tags".into()));
    }
    let name = clean_tag(req.name.as_deref().unwrap_or(""))?;
    let emoji: String = req.emoji.unwrap_or_default().trim().chars().take(8).collect();
    let tag = sqlx::query_as::<_, ForumTag>("INSERT INTO forum_tags (id, channel_id, name, emoji, position) VALUES ($1, $2, $3, $4, $5) RETURNING id, channel_id, name, emoji, position")
        .bind(Uuid::now_v7()).bind(id).bind(&name).bind(&emoji).bind(count as i32)
        .fetch_one(&state.db)
        .await?;
    tags_changed(&state, &c).await?;
    Ok((StatusCode::CREATED, Json(tag)))
}

async fn update_tag(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, tag)): Path<(Uuid, Uuid)>, Json(req): Json<TagInput>) -> AppResult<Json<ForumTag>> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    let name = match req.name { Some(n) => Some(clean_tag(&n)?), None => None };
    let emoji: Option<String> = req.emoji.map(|e| e.trim().chars().take(8).collect());
    let t = sqlx::query_as::<_, ForumTag>("UPDATE forum_tags SET name = COALESCE($3, name), emoji = COALESCE($4, emoji) WHERE id = $1 AND channel_id = $2 RETURNING id, channel_id, name, emoji, position")
        .bind(tag).bind(id).bind(name).bind(emoji)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Tag not found".into()))?;
    tags_changed(&state, &c).await?;
    Ok(Json(t))
}

async fn delete_tag(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, tag)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    let res = sqlx::query("DELETE FROM forum_tags WHERE id = $1 AND channel_id = $2").bind(tag).bind(id).execute(&state.db).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Tag not found".into()));
    }
    tags_changed(&state, &c).await?;
    Ok(StatusCode::NO_CONTENT)
}
