//! Polls: created with a message (`poll` in POST /channels/:id/messages), voted on per option, closed early
//! by the author or a moderator, expired by time. Vote changes fan out as POLL_UPDATE (counts without `me`).

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Poll, PollOption},
    perms::{self, has},
    routes::channels::{require_channel_perms, target_for},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::{post, put},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/messages/:mid/poll/close", post(close))
        .route("/channels/:id/messages/:mid/poll/:oid", put(vote).delete(unvote))
}

#[derive(Deserialize, Debug, Clone)]
pub struct PollInput {
    pub question: String,
    pub options: Vec<String>,
    #[serde(default)]
    pub multi: bool,
    /// Hours until the poll closes on its own (1..=168); None = open until closed.
    pub duration_hours: Option<i64>,
}

/// Validate and insert a poll for a freshly created message (inside the caller's transaction).
pub async fn insert(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, message_id: Uuid, input: &PollInput) -> AppResult<()> {
    let question: String = input.question.trim().chars().take(300).collect();
    if question.is_empty() {
        return Err(AppError::BadRequest("A poll needs a question".into()));
    }
    let options: Vec<String> = input.options.iter().map(|o| o.trim().chars().take(100).collect::<String>()).filter(|o| !o.is_empty()).collect();
    if !(2..=10).contains(&options.len()) {
        return Err(AppError::BadRequest("A poll needs 2 to 10 options".into()));
    }
    if let Some(h) = input.duration_hours {
        if !(1..=24 * 7).contains(&h) {
            return Err(AppError::BadRequest("Poll duration must be between 1 hour and 1 week".into()));
        }
    }
    let expires: Option<DateTime<Utc>> = input.duration_hours.map(|h| Utc::now() + Duration::hours(h));
    sqlx::query("INSERT INTO polls (message_id, question, multi, expires_at) VALUES ($1, $2, $3, $4)")
        .bind(message_id).bind(&question).bind(input.multi).bind(expires)
        .execute(&mut **tx)
        .await?;
    for (i, text) in options.iter().enumerate() {
        sqlx::query("INSERT INTO poll_options (id, message_id, position, text) VALUES ($1, $2, $3, $4)")
            .bind(Uuid::now_v7()).bind(message_id).bind(i as i32).bind(text)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

/// Polls for a batch of messages, with counts and the viewer's own votes.
pub async fn polls_for(db: &PgPool, message_ids: &[Uuid], me: Uuid) -> AppResult<HashMap<Uuid, Poll>> {
    let mut out = HashMap::new();
    if message_ids.is_empty() {
        return Ok(out);
    }
    let polls: Vec<(Uuid, String, bool, Option<DateTime<Utc>>, Option<DateTime<Utc>>)> =
        sqlx::query_as("SELECT message_id, question, multi, expires_at, closed_at FROM polls WHERE message_id = ANY($1)").bind(message_ids).fetch_all(db).await?;
    if polls.is_empty() {
        return Ok(out);
    }
    let opts: Vec<(Uuid, Uuid, String, i64, bool)> = sqlx::query_as(
        "SELECT o.message_id, o.id, o.text,
                (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes,
                EXISTS (SELECT 1 FROM poll_votes v WHERE v.option_id = o.id AND v.user_id = $2) AS me
         FROM poll_options o WHERE o.message_id = ANY($1) ORDER BY o.message_id, o.position",
    )
    .bind(message_ids)
    .bind(me)
    .fetch_all(db)
    .await?;
    let voters: Vec<(Uuid, i64)> = sqlx::query_as("SELECT message_id, COUNT(DISTINCT user_id) FROM poll_votes WHERE message_id = ANY($1) GROUP BY message_id").bind(message_ids).fetch_all(db).await?;
    let voters: HashMap<Uuid, i64> = voters.into_iter().collect();
    let now = Utc::now();
    for (mid, question, multi, expires_at, closed_at) in polls {
        let options: Vec<PollOption> = opts.iter().filter(|o| o.0 == mid).map(|o| PollOption { id: o.1, text: o.2.clone(), votes: o.3, me: o.4 }).collect();
        let total_votes = options.iter().map(|o| o.votes).sum();
        let closed = closed_at.is_some() || expires_at.map(|e| e <= now).unwrap_or(false);
        out.insert(mid, Poll { question, multi, expires_at, closed_at, closed, total_votes, voters: voters.get(&mid).copied().unwrap_or(0), options });
    }
    Ok(out)
}

/// Broadcast the poll's current state (with `me` cleared; clients keep their own flags) to the channel.
async fn broadcast(state: &AppState, channel_id: Uuid, message_id: Uuid) -> AppResult<()> {
    let c = sqlx::query_as::<_, crate::models::Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS)).bind(channel_id).fetch_one(&state.db).await?;
    let mut polls = polls_for(&state.db, &[message_id], Uuid::nil()).await?;
    if let Some(p) = polls.remove(&message_id) {
        let target = target_for(&state.db, &c).await?;
        state.hub.emit(target, "POLL_UPDATE", json!({ "channel_id": channel_id, "message_id": message_id, "poll": p }));
    }
    Ok(())
}

async fn open_poll(db: &PgPool, channel_id: Uuid, message_id: Uuid) -> AppResult<(bool, Uuid)> {
    let row: Option<(bool, Option<DateTime<Utc>>, Option<DateTime<Utc>>, Uuid)> = sqlx::query_as(
        "SELECT p.multi, p.expires_at, p.closed_at, m.author_id FROM polls p JOIN messages m ON m.id = p.message_id WHERE p.message_id = $1 AND m.channel_id = $2",
    )
    .bind(message_id)
    .bind(channel_id)
    .fetch_optional(db)
    .await?;
    let Some((multi, expires_at, closed_at, author)) = row else { return Err(AppError::NotFound("Poll not found".into())) };
    if closed_at.is_some() || expires_at.map(|e| e <= Utc::now()).unwrap_or(false) {
        return Err(AppError::BadRequest("This poll is closed".into()));
    }
    Ok((multi, author))
}

/// Vote for an option: in a single-choice poll this replaces any earlier vote.
async fn vote(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, mid, oid)): Path<(Uuid, Uuid, Uuid)>) -> AppResult<Json<Poll>> {
    let (_, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::VIEW_CHANNEL)?;
    let (multi, _) = open_poll(&state.db, id, mid).await?;
    let valid: Option<(bool,)> = sqlx::query_as("SELECT true FROM poll_options WHERE id = $1 AND message_id = $2").bind(oid).bind(mid).fetch_optional(&state.db).await?;
    if valid.is_none() {
        return Err(AppError::NotFound("Option not found".into()));
    }
    let mut tx = state.db.begin().await?;
    if !multi {
        sqlx::query("DELETE FROM poll_votes WHERE message_id = $1 AND user_id = $2").bind(mid).bind(uid).execute(&mut *tx).await?;
    }
    sqlx::query("INSERT INTO poll_votes (message_id, option_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING").bind(mid).bind(oid).bind(uid).execute(&mut *tx).await?;
    tx.commit().await?;
    broadcast(&state, id, mid).await?;
    Ok(Json(polls_for(&state.db, &[mid], uid).await?.remove(&mid).ok_or(AppError::NotFound("Poll not found".into()))?))
}

async fn unvote(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, mid, oid)): Path<(Uuid, Uuid, Uuid)>) -> AppResult<Json<Poll>> {
    require_channel_perms(&state.db, id, uid).await?;
    open_poll(&state.db, id, mid).await?;
    sqlx::query("DELETE FROM poll_votes WHERE message_id = $1 AND option_id = $2 AND user_id = $3").bind(mid).bind(oid).bind(uid).execute(&state.db).await?;
    broadcast(&state, id, mid).await?;
    Ok(Json(polls_for(&state.db, &[mid], uid).await?.remove(&mid).ok_or(AppError::NotFound("Poll not found".into()))?))
}

/// End the poll now: the author, or anyone with Manage Messages in a server channel.
async fn close(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, mid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Poll>> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    let (_, author) = open_poll(&state.db, id, mid).await?;
    if author != uid && !(c.guild_id.is_some() && has(p, perms::MANAGE_MESSAGES)) {
        return Err(AppError::Forbidden);
    }
    sqlx::query("UPDATE polls SET closed_at = now() WHERE message_id = $1").bind(mid).execute(&state.db).await?;
    broadcast(&state, id, mid).await?;
    Ok(Json(polls_for(&state.db, &[mid], uid).await?.remove(&mid).ok_or(AppError::NotFound("Poll not found".into()))?))
}
