//! Server moderation tools: warnings, the moderator view of a member, and bulk bans.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    perms,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/members/:uid/warnings", get(list_warnings).post(warn))
        .route("/guilds/:id/members/:uid/warnings/:wid", delete(delete_warning))
        .route("/guilds/:id/members/:uid/mod-info", get(mod_info))
        .route("/guilds/:id/bulk-ban", post(bulk_ban))
}

/// Anyone who can kick, ban or time out members counts as a moderator here.
fn is_moderator(p: u64) -> bool {
    perms::has(p, perms::KICK_MEMBERS) || perms::has(p, perms::BAN_MEMBERS) || perms::has(p, perms::MODERATE_MEMBERS)
}

#[derive(Deserialize)]
struct WarnReq { reason: String }

/// `POST /guilds/:id/members/:uid/warnings`: warn a member. They see the reason; it counts toward their standing.
async fn warn(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>, Json(req): Json<WarnReq>) -> AppResult<(StatusCode, Json<Value>)> {
    let (ctx, p) = perms::guild_perms(&state.db, id, uid).await?;
    if !is_moderator(p) { return Err(AppError::Forbidden) }
    if target == uid { return Err(AppError::BadRequest("You can't warn yourself".into())) }
    if !ctx.is_member(target) { return Err(AppError::NotFound("Member not found".into())) }
    if ctx.is_owner(target) || !ctx.outranks_member(uid, target) { return Err(AppError::Forbidden) }
    let reason: String = req.reason.trim().chars().take(512).collect();
    if reason.is_empty() { return Err(AppError::BadRequest("Say why you're warning them".into())) }
    let wid = Uuid::now_v7();
    sqlx::query("INSERT INTO member_warnings (id, guild_id, user_id, moderator_id, reason) VALUES ($1, $2, $3, $4, $5)")
        .bind(wid).bind(id).bind(target).bind(uid).bind(&reason).execute(&state.db).await?;
    let (name, guild_name): (String, String) = sqlx::query_as("SELECT u.username, g.name FROM users u, guilds g WHERE u.id = $1 AND g.id = $2").bind(target).bind(id).fetch_one(&state.db).await?;
    crate::audit::guild(&state, id, uid, "member.warn", "user", Some(target), &name, json!({ "reason": reason })).await;
    let ev = json!({ "id": wid, "guild_id": id, "guild_name": guild_name, "reason": reason });
    state.hub.emit_users(vec![target], "MEMBER_WARNING", ev.clone());
    if !crate::ws::bus::online_users(&state.db).await.contains(&target) {
        crate::push::notify(&state, &[target], &format!("Warning from {guild_name}"), &reason, json!({ "kind": "warning", "guild_id": id })).await;
    }
    Ok((StatusCode::CREATED, Json(ev)))
}

async fn list_warnings(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<Json<Vec<Value>>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    if !is_moderator(p) { return Err(AppError::Forbidden) }
    Ok(Json(warnings(&state, id, target).await?))
}

async fn warnings(state: &AppState, guild: Uuid, target: Uuid) -> AppResult<Vec<Value>> {
    let rows: Vec<(Uuid, String, chrono::DateTime<chrono::Utc>, Option<Uuid>, Option<String>)> = sqlx::query_as(
        "SELECT w.id, w.reason, w.created_at, w.moderator_id, u.display_name FROM member_warnings w LEFT JOIN users u ON u.id = w.moderator_id
         WHERE w.guild_id = $1 AND w.user_id = $2 ORDER BY w.created_at DESC LIMIT 50")
        .bind(guild).bind(target).fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|(id, reason, at, mid, mname)| json!({ "id": id, "reason": reason, "created_at": at, "moderator_id": mid, "moderator_name": mname })).collect())
}

async fn delete_warning(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target, wid)): Path<(Uuid, Uuid, Uuid)>) -> AppResult<StatusCode> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    if !is_moderator(p) { return Err(AppError::Forbidden) }
    let n = sqlx::query("DELETE FROM member_warnings WHERE id = $1 AND guild_id = $2 AND user_id = $3").bind(wid).bind(id).bind(target).execute(&state.db).await?.rows_affected();
    if n == 0 { return Err(AppError::NotFound("Warning not found".into())) }
    let (name,): (String,) = sqlx::query_as("SELECT username FROM users WHERE id = $1").bind(target).fetch_one(&state.db).await?;
    crate::audit::guild(&state, id, uid, "member.warn_remove", "user", Some(target), &name, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /guilds/:id/members/:uid/mod-info`: what a moderator needs about a member at a glance.
async fn mod_info(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<Json<Value>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    if !is_moderator(p) && !perms::has(p, perms::MANAGE_GUILD) { return Err(AppError::Forbidden) }
    let row: Option<(chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>, Option<String>, Option<String>, bool, Option<chrono::DateTime<chrono::Utc>>, bool)> = sqlx::query_as(
        "SELECT m.joined_at, u.created_at, m.joined_via, i.display_name, m.temporary, m.timeout_until, u.email_verified_at IS NOT NULL
         FROM guild_members m JOIN users u ON u.id = m.user_id LEFT JOIN users i ON i.id = m.inviter_id WHERE m.guild_id = $1 AND m.user_id = $2")
        .bind(id).bind(target).fetch_optional(&state.db).await?;
    let Some((joined_at, created_at, via, inviter, temporary, timeout_until, verified)) = row else { return Err(AppError::NotFound("Member not found".into())) };
    let history: Vec<(String, Option<String>, Value, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT action, actor_name, details, created_at FROM guild_audit WHERE guild_id = $1 AND target_id = $2 AND action LIKE 'member.%' ORDER BY created_at DESC LIMIT 20")
        .bind(id).bind(target).fetch_all(&state.db).await?;
    let (messages,): (i64,) = sqlx::query_as("SELECT count(*) FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.guild_id = $1 AND m.author_id = $2 AND m.kind = 'default'")
        .bind(id).bind(target).fetch_one(&state.db).await?;
    Ok(Json(json!({
        "joined_at": joined_at, "account_created_at": created_at, "joined_via": via, "inviter_name": inviter, "temporary": temporary,
        "timeout_until": timeout_until, "email_verified": verified, "messages": messages,
        "warnings": warnings(&state, id, target).await?,
        "history": history.into_iter().map(|(action, actor, details, at)| json!({ "action": action, "actor_name": actor, "details": details, "created_at": at })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
struct BulkBanReq {
    user_ids: Vec<Uuid>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    delete_message_seconds: i64,
}

/// `POST /guilds/:id/bulk-ban`: ban up to 200 people at once; each is checked as a single ban would be.
async fn bulk_ban(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<BulkBanReq>) -> AppResult<Json<Value>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::BAN_MEMBERS)?;
    if req.user_ids.is_empty() || req.user_ids.len() > 200 { return Err(AppError::BadRequest("Pick 1 to 200 people".into())) }
    let mut banned = Vec::new();
    let mut failed = Vec::new();
    for target in req.user_ids {
        match crate::routes::guilds::ban_one(&state, uid, id, target, req.reason.clone(), req.delete_message_seconds).await {
            Ok(_) => banned.push(target),
            Err(e) => failed.push(json!({ "user_id": target, "error": e.to_string() })),
        }
    }
    Ok(Json(json!({ "banned": banned, "failed": failed })))
}
