//! Scheduled messages: written now, sent later by the server as the author. Everything a normal send checks is
//! checked again at send time (through `channels::create_message`), so a message can still fail when due: it then
//! stays in the author's list as failed, with the reason, to edit, retry or delete.
//!
//! Like Discord, it works in DMs, groups, channels and threads, from the Inbox's Scheduled tab. Everyone gets the
//! larger (Nitro) limit. In a server it needs Schedule Messages next to Send Messages, so a channel overwrite can keep
//! scheduled messages out, and a server can turn them off altogether (`guilds.scheduled_off`).

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Channel, Message},
    perms,
    ratelimit::rl_messages,
    routes::channels::{create_message, require_channel_perms, CreateMessage},
    state::AppState,
    ws::hub::Target,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    middleware::from_fn,
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

/// Queued (pending or failed) per user at once: Discord's Nitro limit, for everyone.
pub const MAX_QUEUED: i64 = 30;
/// How far ahead a message can be scheduled.
const MAX_AHEAD_DAYS: i64 = 365;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/scheduled-messages", get(list))
        .route("/users/@me/scheduled-messages/:id", patch(update).delete(remove))
        .route("/users/@me/scheduled-messages/:id/send", post(send_now).route_layer(from_fn(rl_messages)))
        .route("/channels/:id/scheduled-messages", post(create).route_layer(from_fn(rl_messages)))
}

#[derive(Serialize, Clone)]
pub struct ScheduledAttachment {
    pub id: Uuid,
    pub filename: String,
    pub content_type: String,
}

#[derive(Serialize, Clone)]
pub struct Scheduled {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub guild_id: Option<Uuid>,
    pub content: String,
    pub reply_to: Option<Uuid>,
    pub attachments: Vec<ScheduledAttachment>,
    pub send_at: DateTime<Utc>,
    /// 'pending', 'sending' or 'failed'.
    pub status: String,
    /// Why it couldn't be sent (failed only).
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
}

type Row = (Uuid, Uuid, Option<Uuid>, String, Option<Uuid>, Vec<Uuid>, DateTime<Utc>, String, Option<String>, DateTime<Utc>);
const COLS: &str = "s.id, s.channel_id, c.guild_id, s.content, s.reply_to, s.attachment_ids, s.send_at, s.status, s.error, s.created_at";

async fn hydrate(db: &PgPool, rows: Vec<Row>) -> AppResult<Vec<Scheduled>> {
    let ids: Vec<Uuid> = rows.iter().flat_map(|r| r.5.iter().copied()).collect();
    let files: Vec<(Uuid, String, String)> = if ids.is_empty() { vec![] } else {
        sqlx::query_as("SELECT id, filename, content_type FROM attachments WHERE id = ANY($1)").bind(&ids).fetch_all(db).await?
    };
    Ok(rows.into_iter().map(|(id, channel_id, guild_id, content, reply_to, att, send_at, status, error, created_at)| Scheduled {
        id, channel_id, guild_id, content, reply_to, send_at, status, error, created_at,
        attachments: att.iter().filter_map(|a| files.iter().find(|f| f.0 == *a).map(|f| ScheduledAttachment { id: f.0, filename: f.1.clone(), content_type: f.2.clone() })).collect(),
    }).collect())
}

async fn fetch(db: &PgPool, id: Uuid, uid: Uuid) -> AppResult<Scheduled> {
    let row: Option<Row> = sqlx::query_as(&format!("SELECT {COLS} FROM scheduled_messages s JOIN channels c ON c.id = s.channel_id WHERE s.id = $1 AND s.user_id = $2"))
        .bind(id).bind(uid).fetch_optional(db).await?;
    let row = row.ok_or_else(|| AppError::NotFound("Scheduled message not found".into()))?;
    Ok(hydrate(db, vec![row]).await?.remove(0))
}

/// May `uid` schedule into this channel? Servers: Send Messages and Schedule Messages there, and not turned off.
async fn check_allowed(db: &PgPool, c: &Channel, p: u64) -> AppResult<()> {
    perms::check(p, perms::SEND_MESSAGES)?;
    if matches!(c.kind.as_str(), "category" | "forum" | "directory") {
        return Err(AppError::BadRequest("Messages can't be scheduled here".into()));
    }
    if let Some(gid) = c.guild_id {
        let (off,): (bool,) = sqlx::query_as("SELECT scheduled_off FROM guilds WHERE id = $1").bind(gid).fetch_one(db).await?;
        if off { return Err(AppError::BadRequest("Scheduled messages are turned off in this server".into())) }
        if !perms::has(p, perms::SCHEDULE_MESSAGES) {
            return Err(AppError::BadRequest("You can't schedule messages in this channel".into()));
        }
    }
    Ok(())
}

fn check_time(at: DateTime<Utc>) -> AppResult<()> {
    let now = Utc::now();
    if at < now + Duration::seconds(30) { return Err(AppError::BadRequest("Pick a time in the future".into())) }
    if at > now + Duration::days(MAX_AHEAD_DAYS) { return Err(AppError::BadRequest("Messages can be scheduled up to a year ahead".into())) }
    Ok(())
}

fn tidy(content: &str, has_files: bool) -> AppResult<String> {
    let content = crate::routes::channels::tidy_content(content);
    if (content.trim().is_empty() && !has_files) || content.chars().count() > 2000 {
        return Err(AppError::BadRequest("Message must be 1-2000 characters".into()));
    }
    Ok(content)
}

fn emit(state: &AppState, uid: Uuid, t: &str, d: serde_json::Value) {
    state.hub.emit(Target::Users(vec![uid]), t, d);
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Scheduled>>> {
    let rows: Vec<Row> = sqlx::query_as(&format!("SELECT {COLS} FROM scheduled_messages s JOIN channels c ON c.id = s.channel_id WHERE s.user_id = $1 ORDER BY s.send_at"))
        .bind(uid).fetch_all(&state.db).await?;
    Ok(Json(hydrate(&state.db, rows).await?))
}

#[derive(Deserialize)]
struct CreateScheduled {
    #[serde(default)]
    content: String,
    send_at: DateTime<Utc>,
    reply_to: Option<Uuid>,
    #[serde(default)]
    attachment_ids: Vec<Uuid>,
}

async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(cid): Path<Uuid>, Json(req): Json<CreateScheduled>) -> AppResult<(StatusCode, Json<Scheduled>)> {
    let (c, p) = require_channel_perms(&state.db, cid, uid).await?;
    check_allowed(&state.db, &c, p).await?;
    crate::signup_guard::require_can_post(&state, uid).await?;
    check_time(req.send_at)?;
    let content = tidy(&req.content, !req.attachment_ids.is_empty())?;
    let (queued,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM scheduled_messages WHERE user_id = $1").bind(uid).fetch_one(&state.db).await?;
    if queued >= MAX_QUEUED {
        return Err(AppError::BadRequest(format!("You can have up to {MAX_QUEUED} scheduled messages at a time")));
    }
    if let Some(r) = req.reply_to {
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM messages WHERE id = $1 AND channel_id = $2").bind(r).bind(cid).fetch_optional(&state.db).await?;
        if ok.is_none() { return Err(AppError::BadRequest("Reply target not in this channel".into())) }
    }
    if !req.attachment_ids.is_empty() {
        if c.guild_id.is_some() { perms::check(p, perms::ATTACH_FILES)?; }
        if req.attachment_ids.len() > crate::routes::attachments::MAX_PER_MESSAGE {
            return Err(AppError::BadRequest(format!("At most {} attachments per message", crate::routes::attachments::MAX_PER_MESSAGE)));
        }
        // Uploaded by them, to this channel, not sent and not already waiting in another scheduled message.
        let (n,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM attachments a WHERE a.id = ANY($1) AND a.channel_id = $2 AND a.uploader_id = $3 AND a.message_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM scheduled_messages s WHERE a.id = ANY(s.attachment_ids))",
        ).bind(&req.attachment_ids).bind(cid).bind(uid).fetch_one(&state.db).await?;
        if n as usize != req.attachment_ids.len() { return Err(AppError::BadRequest("Unknown or already used attachment".into())) }
    }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO scheduled_messages (id, user_id, channel_id, content, reply_to, attachment_ids, send_at) VALUES ($1, $2, $3, $4, $5, $6, $7)")
        .bind(id).bind(uid).bind(cid).bind(&content).bind(req.reply_to).bind(&req.attachment_ids).bind(req.send_at)
        .execute(&state.db).await?;
    let s = fetch(&state.db, id, uid).await?;
    emit(&state, uid, "SCHEDULED_MESSAGE_CREATE", json!(s));
    Ok((StatusCode::CREATED, Json(s)))
}

#[derive(Deserialize)]
struct UpdateScheduled {
    content: Option<String>,
    send_at: Option<DateTime<Utc>>,
}

/// Change the text or the time. A failed message edited this way is queued again (its time must be in the future).
async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<UpdateScheduled>) -> AppResult<Json<Scheduled>> {
    let cur = fetch(&state.db, id, uid).await?;
    if cur.status == "sending" { return Err(AppError::Conflict("It's being sent right now".into())) }
    let content = match &req.content { Some(c) => tidy(c, !cur.attachments.is_empty())?, None => cur.content.clone() };
    let send_at = req.send_at.unwrap_or(cur.send_at);
    check_time(send_at)?;
    let res = sqlx::query("UPDATE scheduled_messages SET content = $3, send_at = $4, status = 'pending', error = NULL WHERE id = $1 AND user_id = $2 AND status <> 'sending'")
        .bind(id).bind(uid).bind(&content).bind(send_at).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::Conflict("It's being sent right now".into())) }
    let s = fetch(&state.db, id, uid).await?;
    emit(&state, uid, "SCHEDULED_MESSAGE_UPDATE", json!(s));
    Ok(Json(s))
}

async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let res = sqlx::query("DELETE FROM scheduled_messages WHERE id = $1 AND user_id = $2 AND status <> 'sending'").bind(id).bind(uid).execute(&state.db).await?;
    if res.rows_affected() == 0 {
        fetch(&state.db, id, uid).await?;
        return Err(AppError::Conflict("It's being sent right now".into()));
    }
    // Its files go back to being unsent uploads, which the orphan sweep clears.
    emit(&state, uid, "SCHEDULED_MESSAGE_DELETE", json!({ "id": id }));
    Ok(StatusCode::NO_CONTENT)
}

/// Send it now instead of at its time.
async fn send_now(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Message>> {
    let claimed: Option<Claimed> = sqlx::query_as(
        "UPDATE scheduled_messages SET status = 'sending', claimed_at = now() WHERE id = $1 AND user_id = $2 AND status <> 'sending'
         RETURNING id, user_id, channel_id, content, reply_to, attachment_ids",
    ).bind(id).bind(uid).fetch_optional(&state.db).await?;
    let Some(row) = claimed else {
        fetch(&state.db, id, uid).await?;
        return Err(AppError::Conflict("It's being sent right now".into()));
    };
    deliver(&state, row).await.map(Json)
}

type Claimed = (Uuid, Uuid, Uuid, String, Option<Uuid>, Vec<Uuid>);

/// Send a claimed scheduled message as its author. Sent: it leaves the list. Not: it stays, failed, with the reason.
async fn deliver(state: &AppState, (id, uid, cid, content, reply_to, attachment_ids): Claimed) -> AppResult<Message> {
    let sent = async {
        let (c, p) = require_channel_perms(&state.db, cid, uid).await?;
        check_allowed(&state.db, &c, p).await?;
        // A reply whose message is gone since goes out as a plain message.
        let reply_to = match reply_to {
            Some(r) => sqlx::query_as::<_, (Uuid,)>("SELECT id FROM messages WHERE id = $1 AND channel_id = $2").bind(r).bind(cid).fetch_optional(&state.db).await?.map(|(r,)| r),
            None => None,
        };
        let req: CreateMessage = serde_json::from_value(json!({ "content": content, "reply_to": reply_to, "attachment_ids": attachment_ids }))
            .map_err(|e| AppError::Other(e.into()))?;
        let (_, Json(m)) = create_message(State(state.clone()), AuthUser(uid), Path(cid), Json(req)).await?;
        Ok::<Message, AppError>(m)
    }.await;
    match sent {
        Ok(m) => {
            sqlx::query("DELETE FROM scheduled_messages WHERE id = $1").bind(id).execute(&state.db).await?;
            emit(state, uid, "SCHEDULED_MESSAGE_DELETE", json!({ "id": id, "message_id": m.id, "channel_id": cid }));
            Ok(m)
        }
        Err(e) => {
            sqlx::query("UPDATE scheduled_messages SET status = 'failed', error = $2 WHERE id = $1").bind(id).bind(reason(&e)).execute(&state.db).await?;
            if let Ok(s) = fetch(&state.db, id, uid).await { emit(state, uid, "SCHEDULED_MESSAGE_UPDATE", json!(s)); }
            Err(e)
        }
    }
}

/// Why a send failed, in words for the author's list.
fn reason(e: &AppError) -> String {
    match e {
        AppError::BadRequest(m) | AppError::Blocked(m) | AppError::Conflict(m) | AppError::TooMany(m) => m.clone(),
        AppError::NotFound(_) => "The channel is gone or you can no longer see it".into(),
        AppError::Forbidden => "You can no longer send messages there".into(),
        AppError::Undeliverable => "This message can't be delivered to them".into(),
        AppError::RulesRequired => "Accept the server rules first".into(),
        AppError::AgeGate(_) => "That channel is age-restricted".into(),
        AppError::ServerUnavailable(_) => "That server is no longer available".into(),
        AppError::EmailUnverified => "Verify your email address first".into(),
        _ => "Something went wrong sending it".into(),
    }
}

/// Send what's due, every few seconds. Rows are claimed with SKIP LOCKED, so several backends never send one twice.
/// A send that a crash interrupted (claimed long ago, never finished) is reported as failed rather than resent,
/// since it may have gone out.
pub async fn send_loop(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let stuck: Vec<(Uuid, Uuid)> = sqlx::query_as(
            "UPDATE scheduled_messages SET status = 'failed', error = 'Sending was interrupted: check the channel before trying again'
             WHERE status = 'sending' AND claimed_at < now() - interval '5 minutes' RETURNING id, user_id",
        ).fetch_all(&state.db).await.unwrap_or_default();
        for (id, uid) in stuck {
            if let Ok(s) = fetch(&state.db, id, uid).await { emit(&state, uid, "SCHEDULED_MESSAGE_UPDATE", json!(s)); }
        }
        let due: Vec<Claimed> = sqlx::query_as(
            "UPDATE scheduled_messages SET status = 'sending', claimed_at = now()
             WHERE id IN (SELECT id FROM scheduled_messages WHERE status = 'pending' AND send_at <= now() ORDER BY send_at LIMIT 50 FOR UPDATE SKIP LOCKED)
             RETURNING id, user_id, channel_id, content, reply_to, attachment_ids",
        ).fetch_all(&state.db).await.unwrap_or_default();
        for row in due {
            if let Err(e) = deliver(&state, row).await { tracing::debug!("scheduled message not sent: {e}") }
        }
    }
}
