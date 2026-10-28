//! Report a message or a user; admins triage in the console (resolve / dismiss, delete the message, suspend).

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::{channels::require_channel, users::require_admin},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::FromRow;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/reports", post(create))
        .route("/admin/reports", get(list))
        .route("/guilds/:id/reports", get(guild_reports))
        .route("/guilds/:id/reports/:rid", axum::routing::patch(guild_report_update))
        .route("/admin/reports/:id", axum::routing::patch(update))
        .route("/admin/messages/:id", axum::routing::delete(admin_delete_message))
}

#[derive(Deserialize)]
struct CreateReport {
    kind: String,
    message_id: Option<Uuid>,
    user_id: Option<Uuid>,
    /// Report a server, or (with a user report) the server the user was reported from.
    guild_id: Option<Uuid>,
    #[serde(default)]
    reason: String,
    /// Also send it to the server's moderators (message reports in a server, or user reports with a server).
    #[serde(default)]
    to_mods: bool,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Report {
    pub id: Uuid,
    pub reporter_id: Option<Uuid>,
    #[sqlx(default)]
    pub reporter_username: Option<String>,
    pub kind: String,
    pub target_user_id: Option<Uuid>,
    pub target_username: String,
    pub message_id: Option<Uuid>,
    pub channel_id: Option<Uuid>,
    pub channel_name: String,
    pub guild_id: Option<Uuid>,
    pub guild_name: String,
    pub content: String,
    pub reason: String,
    pub status: String,
    pub resolved_by: Option<Uuid>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub note: String,
    pub created_at: DateTime<Utc>,
    /// Whether the reported message still exists (admins can delete it from the console).
    #[sqlx(default)]
    pub message_exists: bool,
    #[sqlx(default)]
    pub target_suspended: bool,
    #[sqlx(default)]
    pub to_mods: bool,
    #[sqlx(default)]
    pub mod_status: String,
    #[sqlx(default)]
    pub mod_note: String,
}

const REPORT_SELECT: &str = "SELECT r.id, r.reporter_id, u.username AS reporter_username, r.kind, r.target_user_id, r.target_username, r.message_id, r.channel_id, r.channel_name,
    r.guild_id, r.guild_name, r.content, r.reason, r.status, r.resolved_by, r.resolved_at, r.note, r.created_at, r.to_mods, r.mod_status, r.mod_note,
    EXISTS (SELECT 1 FROM messages m WHERE m.id = r.message_id) AS message_exists,
    EXISTS (SELECT 1 FROM users t WHERE t.id = r.target_user_id AND t.suspended_at IS NOT NULL) AS target_suspended
    FROM reports r LEFT JOIN users u ON u.id = r.reporter_id";

async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<CreateReport>) -> AppResult<(StatusCode, Json<Value>)> {
    let reason: String = req.reason.trim().chars().take(1000).collect();
    if reason.is_empty() {
        return Err(AppError::BadRequest("Please say why you are reporting this".into()));
    }
    let id = Uuid::now_v7();
    match req.kind.as_str() {
        "message" => {
            let mid = req.message_id.ok_or(AppError::BadRequest("message_id is required".into()))?;
            let row: Option<(Uuid, Uuid, String)> = sqlx::query_as("SELECT channel_id, author_id, content FROM messages WHERE id = $1").bind(mid).fetch_optional(&state.db).await?;
            let Some((cid, author, content)) = row else { return Err(AppError::NotFound("Message not found".into())) };
            if author == uid {
                return Err(AppError::BadRequest("You cannot report your own message".into()));
            }
            let c = require_channel(&state.db, cid, uid).await?;
            let guild_name = match c.guild_id { Some(g) => audit::guild_name(&state, g).await, None => String::new() };
            sqlx::query(
                "INSERT INTO reports (id, reporter_id, kind, target_user_id, target_username, message_id, channel_id, channel_name, guild_id, guild_name, content, reason, to_mods)
                 VALUES ($1, $2, 'message', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
            )
            .bind(id).bind(uid).bind(author).bind(audit::username(&state, author).await).bind(mid).bind(cid).bind(&c.name).bind(c.guild_id).bind(guild_name).bind(content).bind(&reason).bind(req.to_mods && c.guild_id.is_some())
            .execute(&state.db)
            .await?;
        }
        "user" => {
            let target = req.user_id.ok_or(AppError::BadRequest("user_id is required".into()))?;
            if target == uid {
                return Err(AppError::BadRequest("You cannot report yourself".into()));
            }
            let name = audit::username(&state, target).await;
            if name.is_empty() {
                return Err(AppError::NotFound("User not found".into()));
            }
            // Reported from a server you're both in: that server's moderators can get it too.
            let gid = match req.guild_id { Some(g) => sqlx::query_as::<_, (bool,)>("SELECT COUNT(*) = 2 FROM guild_members WHERE guild_id = $1 AND user_id IN ($2, $3)").bind(g).bind(uid).bind(target).fetch_one(&state.db).await?.0.then_some(g), None => None };
            let guild_name = match gid { Some(g) => audit::guild_name(&state, g).await, None => String::new() };
            sqlx::query("INSERT INTO reports (id, reporter_id, kind, target_user_id, target_username, reason, guild_id, guild_name, to_mods) VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, $8)")
                .bind(id).bind(uid).bind(target).bind(name).bind(&reason).bind(gid).bind(guild_name).bind(req.to_mods && gid.is_some())
                .execute(&state.db)
                .await?;
        }
        "guild" => {
            let gid = req.guild_id.ok_or(AppError::BadRequest("guild_id is required".into()))?;
            let row: Option<(String, Uuid)> = sqlx::query_as("SELECT name, owner_id FROM guilds WHERE id = $1").bind(gid).fetch_optional(&state.db).await?;
            let Some((gname, owner)) = row else { return Err(AppError::NotFound("Server not found".into())) };
            sqlx::query("INSERT INTO reports (id, reporter_id, kind, target_user_id, target_username, guild_id, guild_name, reason) VALUES ($1, $2, 'guild', $3, $4, $5, $6, $7)")
                .bind(id).bind(uid).bind(owner).bind(audit::username(&state, owner).await).bind(gid).bind(gname).bind(&reason)
                .execute(&state.db)
                .await?;
        }
        _ => return Err(AppError::BadRequest("kind must be message, user or guild".into())),
    }
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default = "open")]
    status: String,
}
fn open() -> String { "open".into() }

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<ListQuery>) -> AppResult<Json<Vec<Report>>> {
    require_admin(&state, uid).await?;
    let status = if q.status == "all" { None } else { Some(q.status) };
    Ok(Json(
        sqlx::query_as::<_, Report>(&format!("{REPORT_SELECT} WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.id DESC LIMIT 200"))
            .bind(status)
            .fetch_all(&state.db)
            .await?,
    ))
}

#[derive(Deserialize)]
struct UpdateReport {
    status: String,
    #[serde(default)]
    note: String,
    /// Official notices sent from the system account ("Parley") with the decision: to whoever reported it, and to the
    /// reported user. Empty or absent: nothing is sent.
    #[serde(default)]
    message_reporter: Option<String>,
    #[serde(default)]
    message_target: Option<String>,
}

async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<UpdateReport>) -> AppResult<Json<Report>> {
    require_admin(&state, uid).await?;
    if !["open", "resolved", "dismissed"].contains(&req.status.as_str()) {
        return Err(AppError::BadRequest("status must be open, resolved or dismissed".into()));
    }
    let note: String = req.note.trim().chars().take(500).collect();
    let res = sqlx::query("UPDATE reports SET status = $2, note = $3, resolved_by = CASE WHEN $2 = 'open' THEN NULL ELSE $4 END, resolved_at = CASE WHEN $2 = 'open' THEN NULL ELSE now() END WHERE id = $1")
        .bind(id).bind(&req.status).bind(&note).bind(uid)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Report not found".into()));
    }
    let r = sqlx::query_as::<_, Report>(&format!("{REPORT_SELECT} WHERE r.id = $1")).bind(id).fetch_one(&state.db).await?;
    let clean = |m: &Option<String>| m.as_deref().map(str::trim).filter(|m| !m.is_empty()).map(|m| m.chars().take(crate::routes::notices::MAX_NOTICE).collect::<String>());
    let (to_reporter, to_target) = (clean(&req.message_reporter), clean(&req.message_target));
    let mut notified = Vec::new();
    if let (Some(text), Some(who)) = (&to_reporter, r.reporter_id) { crate::routes::notices::send(&state, who, text).await?; notified.push("reporter") }
    if let (Some(text), Some(who)) = (&to_target, r.target_user_id) { crate::routes::notices::send(&state, who, text).await?; notified.push("target") }
    audit::record(&state, uid, &format!("report.{}", req.status), "report", Some(id), &r.target_username,
        json!({ "kind": r.kind, "note": note, "notified": notified, "message_reporter": to_reporter, "message_target": to_target })).await;
    Ok(Json(r))
}

/// Admins may delete any message anywhere (reported content, spam); members of the channel see it vanish.
async fn admin_delete_message(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    require_admin(&state, uid).await?;
    let row: Option<(Uuid, Uuid)> = sqlx::query_as("SELECT channel_id, author_id FROM messages WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let Some((cid, author)) = row else { return Err(AppError::NotFound("Message not found".into())) };
    let c = sqlx::query_as::<_, crate::models::Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS)).bind(cid).fetch_one(&state.db).await?;
    let files: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM attachments WHERE message_id = $1").bind(id).fetch_all(&state.db).await?;
    sqlx::query("DELETE FROM messages WHERE id = $1").bind(id).execute(&state.db).await?;
    for (fid,) in files {
        let _ = tokio::fs::remove_file(state.config.upload_dir.join(fid.to_string())).await; let _ = tokio::fs::remove_file(state.config.upload_dir.join(format!("{fid}.thumb"))).await;
    }
    let target = crate::routes::channels::target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_DELETE", json!({ "id": id, "channel_id": cid, "guild_id": c.guild_id }));
    audit::record(&state, uid, "message.delete", "user", Some(author), &audit::username(&state, author).await, json!({ "message_id": id, "channel": c.name })).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Moderators of a server: anyone who can manage messages, kick, ban, time out or manage the server.
async fn require_mod(state: &AppState, gid: Uuid, uid: Uuid) -> AppResult<()> {
    let (_, p) = crate::perms::guild_perms(&state.db, gid, uid).await?;
    crate::perms::check_any(p, crate::perms::MANAGE_MESSAGES | crate::perms::KICK_MEMBERS | crate::perms::BAN_MEMBERS | crate::perms::MODERATE_MEMBERS | crate::perms::MANAGE_GUILD)
}

#[derive(Deserialize)]
struct GuildReportsQuery {
    #[serde(default = "open")]
    status: String,
}

/// `GET /guilds/:id/reports`: reports members sent to this server's moderators (the reporter isn't shown).
async fn guild_reports(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Query(q): Query<GuildReportsQuery>) -> AppResult<Json<Vec<Value>>> {
    require_mod(&state, gid, uid).await?;
    let status = if q.status == "all" { None } else { Some(q.status) };
    let rows = sqlx::query_as::<_, Report>(&format!("{REPORT_SELECT} WHERE r.guild_id = $1 AND r.to_mods AND ($2::text IS NULL OR r.mod_status = $2) ORDER BY r.id DESC LIMIT 200"))
        .bind(gid).bind(status).fetch_all(&state.db).await?;
    // Moderators don't learn who reported (only instance admins do).
    Ok(Json(rows.into_iter().map(|r| json!({ "id": r.id, "kind": r.kind, "target_user_id": r.target_user_id, "target_username": r.target_username, "message_id": r.message_id,
        "channel_id": r.channel_id, "channel_name": r.channel_name, "content": r.content, "reason": r.reason, "mod_status": r.mod_status, "mod_note": r.mod_note,
        "created_at": r.created_at, "message_exists": r.message_exists })).collect()))
}

#[derive(Deserialize)]
struct GuildReportUpdate { mod_status: String, #[serde(default)] mod_note: String }

/// `PATCH /guilds/:id/reports/:rid`: a moderator resolves or dismisses a report (instance admins keep their own status).
async fn guild_report_update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, rid)): Path<(Uuid, Uuid)>, Json(req): Json<GuildReportUpdate>) -> AppResult<StatusCode> {
    require_mod(&state, gid, uid).await?;
    if !["open", "resolved", "dismissed"].contains(&req.mod_status.as_str()) { return Err(AppError::BadRequest("mod_status must be open, resolved or dismissed".into())) }
    let note: String = req.mod_note.trim().chars().take(500).collect();
    let n = sqlx::query("UPDATE reports SET mod_status = $3, mod_note = $4, mod_by = $5 WHERE id = $1 AND guild_id = $2 AND to_mods").bind(rid).bind(gid).bind(&req.mod_status).bind(&note).bind(uid).execute(&state.db).await?.rows_affected();
    if n == 0 { return Err(AppError::NotFound("Report not found".into())) }
    let name = audit::guild_name(&state, gid).await;
    crate::audit::guild(&state, gid, uid, "report.update", "report", Some(rid), &name, json!({ "status": req.mod_status })).await;
    Ok(StatusCode::NO_CONTENT)
}
