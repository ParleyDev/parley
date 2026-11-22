//! Instance bans and the abuse review queue (Admin Console → Bans & Limits, and each account's page).
//! The rules themselves are in `crate::abuse`.

use crate::{
    abuse::{self, NewSanction},
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{require_perm, Perm},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/users/:id/sanctions", get(list_for_user).post(create))
        .route("/admin/sanctions", get(list_active))
        .route("/admin/sanctions/:id/lift", post(lift))
        .route("/admin/abuse/flags", get(list_flags))
        .route("/admin/abuse/flags/:id", post(review_flag))
        .route("/admin/abuse/settings", get(get_settings).put(put_settings))
        .route("/admin/servers/:id/invites-paused", post(pause_invites))
}

type Row = (Uuid, Option<Uuid>, Option<String>, String, String, String, String, bool, Option<chrono::DateTime<chrono::Utc>>, Option<String>, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>, Option<String>, String);
const SELECT: &str = "SELECT s.id, s.user_id, u.username, s.kind, s.reason, s.note, s.source, s.hard, s.expires_at, (SELECT username FROM users WHERE id = s.created_by), s.created_at, s.lifted_at,
    (SELECT username FROM users WHERE id = s.lifted_by), s.lift_note FROM account_sanctions s LEFT JOIN users u ON u.id = s.user_id";

fn row_json(r: Row) -> Value {
    let live = r.11.is_none() && r.8.map(|e| e > chrono::Utc::now()).unwrap_or(true);
    json!({ "id": r.0, "user_id": r.1, "username": r.2, "kind": r.3, "reason": r.4, "note": r.5, "source": r.6, "hard": r.7, "expires_at": r.8, "by": r.9, "created_at": r.10, "lifted_at": r.11, "lifted_by": r.12, "lift_note": r.13, "active": live })
}

async fn list_for_user(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    require_perm(&state, uid, Perm::ContentAction).await?;
    let rows: Vec<Row> = sqlx::query_as(&format!("{SELECT} WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT 100")).bind(id).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(row_json).collect()))
}

async fn list_active(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Value>>> {
    require_perm(&state, uid, Perm::ContentAction).await?;
    let rows: Vec<Row> = sqlx::query_as(&format!("{SELECT} WHERE s.lifted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now()) ORDER BY s.created_at DESC LIMIT 300")).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(row_json).collect()))
}

#[derive(Deserialize)]
struct Create { kind: String, reason: String, #[serde(default)] note: String, #[serde(default)] days: i64, #[serde(default)] hard: bool }

/// `POST /admin/users/:id/sanctions {kind, reason, note, days, hard}`. `days: 0` means until lifted.
async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<Create>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::ContentAction).await?;
    if !abuse::KINDS.contains(&req.kind.as_str()) { return Err(AppError::BadRequest("kind is limit, quiet or suspend".into())) }
    if !abuse::REASONS.contains(&req.reason.as_str()) { return Err(AppError::BadRequest("reason is spam, underage, evasion, abuse or other".into())) }
    if !(0..=3650).contains(&req.days) { return Err(AppError::BadRequest("days is between 0 and 3650".into())) }
    if id == uid { return Err(AppError::BadRequest("You cannot act against your own account".into())) }
    let note: String = req.note.trim().chars().take(1000).collect();
    if note.chars().count() < 3 { return Err(AppError::BadRequest("Say why (it is kept with the action and in the audit log).".into())) }
    if req.hard && req.kind != "suspend" { return Err(AppError::BadRequest("Only a suspension can be a hard ban".into())) }
    // An account that says it is under 13 stays suspended until a person approves it: no expiry.
    if req.reason == "underage" && (req.kind != "suspend" || req.days != 0) { return Err(AppError::BadRequest("An under-age account is suspended until a member of staff approves it".into())) }
    let who: Option<(bool, bool)> = sqlx::query_as("SELECT system, account_state = 'active' FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    match who { Some((false, true)) => {}, Some((true, _)) => return Err(AppError::BadRequest("The system account cannot be sanctioned".into())), _ => return Err(AppError::NotFound("User not found".into())) }
    let sid = abuse::impose(&state, NewSanction { user: id, kind: &req.kind, reason: &req.reason, note: &note, source: "staff", hard: req.hard, days: Some(req.days), by: Some(uid) }).await?;
    audit::record(&state, uid, "sanction.create", "user", Some(id), &audit::username(&state, id).await, json!({ "kind": req.kind, "reason": req.reason, "days": req.days, "hard": req.hard, "note": note })).await;
    Ok(Json(json!({ "id": sid })))
}

#[derive(Deserialize)]
struct Lift { #[serde(default)] note: String }

/// `POST /admin/sanctions/:id/lift {note}`: end it now. An under-age suspension needs a real note: it is the
/// record that a person looked and approved the account.
async fn lift(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<Lift>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::ContentAction).await?;
    let note: String = req.note.trim().chars().take(1000).collect();
    let reason: Option<(String,)> = sqlx::query_as("SELECT reason FROM account_sanctions WHERE id = $1 AND lifted_at IS NULL").bind(id).fetch_optional(&state.db).await?;
    let Some((reason,)) = reason else { return Err(AppError::NotFound("That action is not in force".into())) };
    if reason == "underage" && note.chars().count() < 10 { return Err(AppError::BadRequest("Say what showed the account holder is 13 or older (it is kept in the audit log).".into())) }
    let Some((user, kind, reason)) = abuse::lift(&state, id, Some(uid), &note).await? else { return Err(AppError::NotFound("That action is not in force".into())) };
    audit::record(&state, uid, "sanction.lift", "user", Some(user), &audit::username(&state, user).await, json!({ "kind": kind, "reason": reason, "note": note })).await;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct FlagsQuery { #[serde(default)] reviewed: bool }

async fn list_flags(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<FlagsQuery>) -> AppResult<Json<Vec<Value>>> {
    require_perm(&state, uid, Perm::ContentAction).await?;
    let rows: Vec<(Uuid, Uuid, String, String, chrono::DateTime<chrono::Utc>, String, Value, Option<Uuid>, Option<String>, Option<bool>, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>, String, bool)> = sqlx::query_as(
        "SELECT f.id, u.id, u.username, u.display_name, u.created_at, f.kind, f.details, f.sanction_id, s.kind,
                (s.lifted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())), f.created_at, f.reviewed_at, f.outcome, u.suspended_at IS NOT NULL
           FROM abuse_flags f JOIN users u ON u.id = f.user_id LEFT JOIN account_sanctions s ON s.id = f.sanction_id
          WHERE (f.reviewed_at IS NOT NULL) = $1 ORDER BY f.created_at DESC LIMIT 200",
    ).bind(q.reviewed).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|r| json!({
        "id": r.0, "user": { "id": r.1, "username": r.2, "display_name": r.3, "created_at": r.4, "suspended": r.13 }, "kind": r.5, "details": r.6,
        "sanction_id": r.7, "action": r.8, "action_active": r.9.unwrap_or(false), "created_at": r.10, "reviewed_at": r.11, "outcome": r.12,
    })).collect()))
}

#[derive(Deserialize)]
struct Review { outcome: String }

/// `POST /admin/abuse/flags/:id {outcome}`: `kept` (the automatic action was right), `undone` (lift it: a mistake),
/// `dismissed` (nothing was done and nothing needs doing).
async fn review_flag(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<Review>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::ContentAction).await?;
    if !["kept", "undone", "dismissed"].contains(&req.outcome.as_str()) { return Err(AppError::BadRequest("outcome is kept, undone or dismissed".into())) }
    let Some((user, kind, sanction)): Option<(Uuid, String, Option<Uuid>)> = sqlx::query_as("UPDATE abuse_flags SET reviewed_at = now(), reviewed_by = $2, outcome = $3 WHERE id = $1 AND reviewed_at IS NULL RETURNING user_id, kind, sanction_id")
        .bind(id).bind(uid).bind(&req.outcome).fetch_optional(&state.db).await? else { return Err(AppError::NotFound("Already reviewed".into())) };
    if req.outcome == "undone" { if let Some(sid) = sanction { abuse::lift(&state, sid, Some(uid), "Undone on review").await?; } }
    audit::record(&state, uid, "abuse.review", "user", Some(user), &audit::username(&state, user).await, json!({ "detector": kind, "outcome": req.outcome })).await;
    Ok(Json(json!({ "ok": true })))
}

async fn settings_json(state: &AppState) -> Value {
    let auto = sqlx::query_as::<_, (Value,)>("SELECT value FROM instance_settings WHERE key = 'abuse_auto_actions'").fetch_optional(&state.db).await.ok().flatten().and_then(|r| r.0.as_bool()).unwrap_or(true);
    let (open,): (i64,) = sqlx::query_as("SELECT count(*) FROM abuse_flags WHERE reviewed_at IS NULL").fetch_one(&state.db).await.unwrap_or((0,));
    json!({ "auto_actions": auto, "open_flags": open })
}

async fn get_settings(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::ContentAction).await?;
    Ok(Json(settings_json(&state).await))
}

#[derive(Deserialize)]
struct PutSettings { auto_actions: bool }

async fn put_settings(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<PutSettings>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    sqlx::query("INSERT INTO instance_settings (key, value) VALUES ('abuse_auto_actions', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(json!(req.auto_actions)).execute(&state.db).await?;
    audit::record(&state, uid, "abuse.settings.update", "instance", None, "", json!({ "auto_actions": req.auto_actions })).await;
    Ok(Json(settings_json(&state).await))
}

#[derive(Deserialize)]
struct Pause { paused: bool }

/// `POST /admin/servers/:id/invites-paused {paused}`: stop (or allow again) new members joining a server that is
/// being used to gather people for spam, without taking the server down.
async fn pause_invites(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<Pause>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::ContentAction).await?;
    let g = sqlx::query_as::<_, crate::models::Guild>(&format!("UPDATE guilds SET invites_paused = $2 WHERE id = $1 RETURNING {}", crate::routes::guilds::GUILD_COLS)).bind(id).bind(req.paused).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Server not found".into()))?;
    state.hub.emit_guild(id, "GUILD_UPDATE", json!(g));
    audit::record(&state, uid, if req.paused { "guild.invites_pause" } else { "guild.invites_resume" }, "guild", Some(id), &g.name, json!({})).await;
    Ok(Json(json!({ "invites_paused": req.paused })))
}
