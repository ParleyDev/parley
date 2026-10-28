//! Phase 0 of admin access controls (docs/admin-access-and-server-deletion.md): searching or reading message content
//! from the admin console needs the `SUPER_ADMIN_TEMP` role, a written justification every time, and leaves an entry
//! in the append-only `admin_access_log` (the query, its filters, the justification and the message ids returned or
//! opened, with IP and user agent). User-facing search (`routes/search.rs`) is a separate path and is not affected.
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::Message,
    ratelimit::client_ip,
    routes::users::require_admin,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

pub const SUPER_ADMIN_TEMP: &str = "SUPER_ADMIN_TEMP";
/// Shortest justification accepted: enough to say why, not just "x".
pub const MIN_JUSTIFICATION: usize = 10;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/access", get(my_access))
        .route("/admin/access-log", get(read_log))
        .route("/admin/messages/:id/open", get(open_message))
}

/// The roles an admin holds: rows in `admin_roles`, plus `SUPER_ADMIN_TEMP` for admins listed in `ADMIN_EMAILS`.
pub async fn roles(state: &AppState, uid: Uuid) -> AppResult<Vec<String>> {
    let mut out: Vec<String> = sqlx::query_as::<_, (String,)>("SELECT role FROM admin_roles WHERE user_id = $1 ORDER BY role").bind(uid).fetch_all(&state.db).await?.into_iter().map(|r| r.0).collect();
    let email: Option<(Option<String>,)> = sqlx::query_as("SELECT email FROM users WHERE id = $1").bind(uid).fetch_optional(&state.db).await?;
    let listed = email.and_then(|e| e.0).is_some_and(|e| state.config.admin_emails.iter().any(|a| a.eq_ignore_ascii_case(&e)));
    if listed && !out.iter().any(|r| r == SUPER_ADMIN_TEMP) { out.push(SUPER_ADMIN_TEMP.into()) }
    Ok(out)
}

/// An admin who may read message content (Phase 0: only `SUPER_ADMIN_TEMP`). Returns their roles for the log.
pub async fn require_content_access(state: &AppState, uid: Uuid) -> AppResult<Vec<String>> {
    require_admin(state, uid).await?;
    let r = roles(state, uid).await?;
    if r.iter().any(|x| x == SUPER_ADMIN_TEMP) { Ok(r) } else { Err(AppError::Forbidden) }
}

/// A justification for a content access: required, trimmed, at least `MIN_JUSTIFICATION` characters, at most 1000.
pub fn justification(raw: Option<&str>) -> AppResult<String> {
    let j: String = raw.unwrap_or_default().trim().chars().take(1000).collect();
    if j.chars().count() < MIN_JUSTIFICATION {
        return Err(AppError::BadRequest(format!("Say why you need this (at least {MIN_JUSTIFICATION} characters). Every content access is logged.")));
    }
    Ok(j)
}

/// One entry in the append-only access log. Failing to log fails the request: no log, no content.
pub struct Entry<'a> { pub action: &'a str, pub query: &'a str, pub filters: Value, pub justification: &'a str, pub targets: &'a [Uuid] }

pub async fn log(state: &AppState, uid: Uuid, roles: &[String], headers: &HeaderMap, e: Entry<'_>) -> AppResult<()> {
    let ua: String = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or_default().chars().take(400).collect();
    sqlx::query("INSERT INTO admin_access_log (id, actor_id, actor_roles, action, query, filters, justification, target_ids, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)")
        .bind(Uuid::now_v7()).bind(uid).bind(roles).bind(e.action).bind(e.query).bind(&e.filters).bind(e.justification).bind(e.targets)
        .bind(client_ip(headers)).bind(ua).execute(&state.db).await?;
    Ok(())
}

/// `GET /admin/access`: what this admin may do (the console hides what it can't; the server enforces it regardless).
async fn my_access(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_admin(&state, uid).await?;
    let r = roles(&state, uid).await?;
    Ok(Json(json!({ "roles": r, "content_search": r.iter().any(|x| x == SUPER_ADMIN_TEMP) })))
}

#[derive(Serialize, sqlx::FromRow)]
struct LogRow { id: Uuid, at: DateTime<Utc>, actor_id: Uuid, actor_roles: Vec<String>, action: String, query: String, filters: Value, justification: String, target_ids: Vec<Uuid>, case_id: Option<Uuid>, ip: String, user_agent: String }

#[derive(Deserialize)]
struct LogQuery { actor_id: Option<Uuid>, before: Option<DateTime<Utc>>, limit: Option<i64> }

/// `GET /admin/access-log`: the log, newest first (Phase 0: content-access holders; Phase 4 adds auditors).
async fn read_log(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<LogQuery>) -> AppResult<Json<Vec<LogRow>>> {
    require_content_access(&state, uid).await?;
    Ok(Json(sqlx::query_as::<_, LogRow>("SELECT id, at, actor_id, actor_roles, action, query, filters, justification, target_ids, case_id, ip, user_agent FROM admin_access_log
        WHERE ($1::uuid IS NULL OR actor_id = $1) AND ($2::timestamptz IS NULL OR at < $2) ORDER BY at DESC LIMIT $3")
        .bind(q.actor_id).bind(q.before).bind(q.limit.unwrap_or(100).clamp(1, 500)).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
pub struct Justified { pub justification: Option<String> }

/// `GET /admin/messages/:id/open?justification=`: one message in full (from a search result), logged as opened.
async fn open_message(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path(id): Path<Uuid>, Query(q): Query<Justified>) -> AppResult<Json<Message>> {
    let roles = require_content_access(&state, uid).await?;
    let why = justification(q.justification.as_deref())?;
    let m = crate::routes::channels::fetch_message(&state.db, id, uid).await?;
    log(&state, uid, &roles, &headers, Entry { action: "content.open", query: "", filters: json!({ "channel_id": m.channel_id }), justification: &why, targets: &[id] }).await?;
    Ok(Json(m))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn justification_is_required_and_trimmed() {
        assert!(justification(None).is_err());
        assert!(justification(Some("   short  ")).is_err());
        assert_eq!(justification(Some("  report #42 follow-up ")).unwrap(), "report #42 follow-up");
        assert_eq!(justification(Some(&"x".repeat(2000))).unwrap().len(), 1000);
    }
}
