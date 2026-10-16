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
        .route("/admin/reports/:id", axum::routing::patch(update))
        .route("/admin/messages/:id", axum::routing::delete(admin_delete_message))
}

#[derive(Deserialize)]
struct CreateReport {
    kind: String,
    message_id: Option<Uuid>,
    user_id: Option<Uuid>,
    #[serde(default)]
    reason: String,
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
}

const REPORT_SELECT: &str = "SELECT r.id, r.reporter_id, u.username AS reporter_username, r.kind, r.target_user_id, r.target_username, r.message_id, r.channel_id, r.channel_name,
    r.guild_id, r.guild_name, r.content, r.reason, r.status, r.resolved_by, r.resolved_at, r.note, r.created_at,
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
                "INSERT INTO reports (id, reporter_id, kind, target_user_id, target_username, message_id, channel_id, channel_name, guild_id, guild_name, content, reason)
                 VALUES ($1, $2, 'message', $3, $4, $5, $6, $7, $8, $9, $10, $11)",
            )
            .bind(id).bind(uid).bind(author).bind(audit::username(&state, author).await).bind(mid).bind(cid).bind(&c.name).bind(c.guild_id).bind(guild_name).bind(content).bind(&reason)
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
            sqlx::query("INSERT INTO reports (id, reporter_id, kind, target_user_id, target_username, reason) VALUES ($1, $2, 'user', $3, $4, $5)")
                .bind(id).bind(uid).bind(target).bind(name).bind(&reason)
                .execute(&state.db)
                .await?;
        }
        _ => return Err(AppError::BadRequest("kind must be message or user".into())),
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
    audit::record(&state, uid, &format!("report.{}", req.status), "report", Some(id), &r.target_username, json!({ "kind": r.kind, "note": note })).await;
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
        let _ = tokio::fs::remove_file(state.config.upload_dir.join(fid.to_string())).await;
    }
    let target = crate::routes::channels::target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_DELETE", json!({ "id": id, "channel_id": cid, "guild_id": c.guild_id }));
    audit::record(&state, uid, "message.delete", "user", Some(author), &audit::username(&state, author).await, json!({ "message_id": id, "channel": c.name })).await;
    Ok(StatusCode::NO_CONTENT)
}
