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
    pub created_at: DateTime<Utc>,
    pub message_count: i64,
    pub last_message_at: Option<DateTime<Utc>>,
}

const THREAD_SELECT: &str = "SELECT c.id, c.parent_id, c.guild_id, c.name, t.root_message_id, t.owner_id, u.username AS owner_username, t.archived_at, t.created_at,
    (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id) AS message_count,
    (SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id) AS last_message_at
    FROM threads t JOIN channels c ON c.id = t.channel_id LEFT JOIN users u ON u.id = t.owner_id";

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
}

async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<CreateThread>) -> AppResult<(StatusCode, Json<ThreadInfo>)> {
    let (parent, p) = require_channel_perms(&state.db, id, uid).await?;
    if parent.kind != "text" {
        return Err(AppError::BadRequest("Threads can only be created in text channels".into()));
    }
    perms::check(p, perms::SEND_MESSAGES)?;
    let name = clean_name(&req.name)?;
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
    let tid = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO channels (id, guild_id, name, kind, topic, position, parent_id) VALUES ($1, $2, $3, 'thread', '', 0, $4)")
        .bind(tid).bind(parent.guild_id).bind(&name).bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO threads (channel_id, root_message_id, owner_id) VALUES ($1, $2, $3)").bind(tid).bind(req.message_id).bind(uid).execute(&mut *tx).await?;
    tx.commit().await?;
    let mut c = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(tid).fetch_one(&state.db).await?;
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut c)).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target.clone(), "CHANNEL_CREATE", json!(c));
    if let Some(mid) = req.message_id {
        // The root message now carries a thread card.
        let msg = fetch_message(&state.db, mid, uid).await?;
        state.hub.emit(target, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": parent.guild_id }));
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
}

/// Threads of a text channel: active by default, `?archived=true` for the archive. Newest activity first.
async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Query(q): Query<ListQuery>) -> AppResult<Json<Vec<ThreadInfo>>> {
    require_channel_perms(&state.db, id, uid).await?;
    Ok(Json(
        sqlx::query_as::<_, ThreadInfo>(&format!("{THREAD_SELECT} WHERE c.parent_id = $1 AND (t.archived_at IS NOT NULL) = $2 ORDER BY COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id), c.created_at) DESC LIMIT 100"))
            .bind(id)
            .bind(q.archived)
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
}

/// Rename or (un)archive: the thread's owner, or Manage Messages in the parent channel.
async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(tid): Path<Uuid>, Json(req): Json<UpdateThread>) -> AppResult<Json<ThreadInfo>> {
    let (t, p) = require_channel_perms(&state.db, tid, uid).await?;
    if t.kind != "thread" {
        return Err(AppError::NotFound("Thread not found".into()));
    }
    let (owner,): (Option<Uuid>,) = sqlx::query_as("SELECT owner_id FROM threads WHERE channel_id = $1").bind(tid).fetch_one(&state.db).await?;
    if owner != Some(uid) && !has(p, perms::MANAGE_MESSAGES) {
        return Err(AppError::Forbidden);
    }
    if let Some(n) = &req.name {
        let name = clean_name(n)?;
        sqlx::query("UPDATE channels SET name = $2 WHERE id = $1").bind(tid).bind(&name).execute(&state.db).await?;
    }
    if let Some(a) = req.archived {
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
pub async fn on_thread_message(state: &AppState, tid: Uuid) -> AppResult<()> {
    sqlx::query("UPDATE threads SET archived_at = NULL WHERE channel_id = $1").bind(tid).execute(&state.db).await?;
    announce(state, tid).await
}
