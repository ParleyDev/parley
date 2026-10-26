//! Ban appeals: someone banned from a server asks its moderators to reconsider, once per ban. Accepting unbans them.

use crate::{auth::AuthUser, error::{AppError, AppResult}, perms, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::{get, post}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/bans", get(my_bans))
        .route("/guilds/:id/appeal", post(appeal))
        .route("/guilds/:id/appeals", get(list))
        .route("/guilds/:id/appeals/:uid/accept", post(accept))
        .route("/guilds/:id/appeals/:uid/deny", post(deny))
}

/// `GET /users/@me/bans`: the servers you're banned from, why, and where your appeal stands.
async fn my_bans(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Value>>> {
    let rows: Vec<(Uuid, String, Option<String>, String, chrono::DateTime<chrono::Utc>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT g.id, g.name, g.icon_url, b.reason, b.created_at, a.status, a.reason FROM guild_bans b JOIN guilds g ON g.id = b.guild_id
         LEFT JOIN ban_appeals a ON a.guild_id = b.guild_id AND a.user_id = b.user_id WHERE b.user_id = $1 ORDER BY b.created_at DESC")
        .bind(uid).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(id, name, icon, reason, at, status, answer)| json!({ "guild_id": id, "name": name, "icon_url": icon, "reason": reason, "banned_at": at, "appeal": status.map(|s| json!({ "status": s, "reason": answer })) })).collect()))
}

#[derive(Deserialize)]
struct AppealIn { text: String }

async fn appeal(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<AppealIn>) -> AppResult<StatusCode> {
    let text: String = req.text.trim().chars().take(1000).collect();
    if text.chars().count() < 10 { return Err(AppError::BadRequest("Tell the moderators a little more (at least 10 characters)".into())) }
    let banned: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_bans WHERE guild_id = $1 AND user_id = $2").bind(gid).bind(uid).fetch_optional(&state.db).await?;
    if banned.is_none() { return Err(AppError::NotFound("You aren't banned from that server".into())) }
    let res = sqlx::query("INSERT INTO ban_appeals (guild_id, user_id, text) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING").bind(gid).bind(uid).bind(&text).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::Conflict("You've already appealed this ban".into())) }
    Ok(StatusCode::CREATED)
}

/// `GET /guilds/:id/appeals` (Ban Members): pending appeals, oldest first, with the ban they're about.
async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::BAN_MEMBERS)?;
    let rows: Vec<(Uuid, String, String, Option<String>, String, chrono::DateTime<chrono::Utc>, String, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT u.id, u.username, u.display_name, u.avatar_url, a.text, a.created_at, COALESCE(b.reason, ''), b.created_at FROM ban_appeals a JOIN users u ON u.id = a.user_id
         LEFT JOIN guild_bans b ON b.guild_id = a.guild_id AND b.user_id = a.user_id WHERE a.guild_id = $1 AND a.status = 'pending' ORDER BY a.created_at")
        .bind(gid).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(id, username, name, avatar, text, at, ban_reason, banned_at)| json!({
        "user": { "id": id, "username": username, "display_name": name, "avatar_url": avatar }, "text": text, "created_at": at, "ban_reason": ban_reason, "banned_at": banned_at })).collect()))
}

async fn decide(state: &AppState, gid: Uuid, uid: Uuid, target: Uuid, status: &str, reason: &str) -> AppResult<()> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::BAN_MEMBERS)?;
    let res = sqlx::query("UPDATE ban_appeals SET status = $3, reason = $4, decided_by = $5, decided_at = now() WHERE guild_id = $1 AND user_id = $2 AND status = 'pending'")
        .bind(gid).bind(target).bind(status).bind(reason).bind(uid).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::NotFound("No pending appeal".into())) }
    let gname = crate::audit::guild_name(state, gid).await;
    state.hub.emit_users(vec![target], "APPEAL_UPDATE", json!({ "guild_id": gid, "guild_name": gname, "status": status, "reason": reason }));
    let name = crate::audit::username(state, target).await;
    crate::audit::guild(state, gid, uid, &format!("member.appeal_{status}"), "user", Some(target), &name, json!({ "reason": reason })).await;
    Ok(())
}

/// Accept: the ban is lifted (they can rejoin with an invite).
async fn accept(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, target)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    decide(&state, gid, uid, target, "accepted", "").await?;
    sqlx::query("DELETE FROM guild_bans WHERE guild_id = $1 AND user_id = $2").bind(gid).bind(target).execute(&state.db).await?;
    state.hub.emit_guild(gid, "GUILD_BAN_REMOVE", json!({ "guild_id": gid, "user_id": target }));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct DenyIn { #[serde(default)] reason: String }

async fn deny(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, target)): Path<(Uuid, Uuid)>, body: Option<Json<DenyIn>>) -> AppResult<StatusCode> {
    let reason: String = body.map(|Json(b)| b.reason).unwrap_or_default().trim().chars().take(300).collect();
    decide(&state, gid, uid, target, "denied", &reason).await
        .map(|_| StatusCode::NO_CONTENT)
}
