//! Active logins: list them, log one out, log everything else out. Admins can clear a user's sessions.

use crate::{
    auth::{revoke_sessions, AuthSession, AuthUser},
    error::{AppError, AppResult},
    routes::users::require_admin,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/sessions", get(list).delete(logout_others))
        .route("/users/@me/sessions/:id", delete(logout_one))
        .route("/admin/users/:id/sessions", get(admin_list).delete(admin_logout_all))
        .route("/admin/users/:id/sessions/:sid", delete(admin_logout_one))
}

#[derive(Debug, Serialize, FromRow)]
pub struct Session {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub ip: String,
    pub user_agent: String,
    #[sqlx(skip)]
    pub current: bool,
}

async fn active(state: &AppState, uid: Uuid, current: Option<Uuid>) -> AppResult<Vec<Session>> {
    let mut rows = sqlx::query_as::<_, Session>(
        "SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND created_at > now() - interval '30 days' ORDER BY last_seen_at DESC",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await?;
    for r in &mut rows {
        r.current = Some(r.id) == current;
    }
    Ok(rows)
}

async fn list(State(state): State<AppState>, AuthSession(uid, sid): AuthSession) -> AppResult<Json<Vec<Session>>> {
    Ok(Json(active(&state, uid, Some(sid)).await?))
}

async fn logout_one(State(state): State<AppState>, AuthSession(uid, sid): AuthSession, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let reason = if id == sid { "You logged out." } else { "This device was logged out from another session." };
    if revoke_sessions(&state, uid, Some(id), None, reason).await?.is_empty() {
        return Err(AppError::NotFound("Session not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Log out every other device; the caller keeps this session.
async fn logout_others(State(state): State<AppState>, AuthSession(uid, sid): AuthSession) -> AppResult<Json<serde_json::Value>> {
    let n = revoke_sessions(&state, uid, None, Some(sid), "This device was logged out from another session.").await?.len();
    Ok(Json(serde_json::json!({ "revoked": n })))
}

async fn admin_list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Session>>> {
    require_admin(&state, uid).await?;
    Ok(Json(active(&state, id, None).await?))
}

async fn admin_logout_all(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<serde_json::Value>> {
    require_admin(&state, uid).await?;
    let n = revoke_sessions(&state, id, None, None, "An administrator logged you out of all devices.").await?.len();
    crate::audit::record(&state, uid, "user.logout_all", "user", Some(id), &crate::audit::username(&state, id).await, serde_json::json!({ "revoked": n })).await;
    Ok(Json(serde_json::json!({ "revoked": n })))
}

/// Log one device out of a user's account.
async fn admin_logout_one(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, sid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    require_admin(&state, uid).await?;
    if revoke_sessions(&state, id, Some(sid), None, "An administrator logged this device out.").await?.is_empty() {
        return Err(AppError::NotFound("Session not found".into()));
    }
    crate::audit::record(&state, uid, "user.logout_session", "user", Some(id), &crate::audit::username(&state, id).await, serde_json::json!({ "session": sid })).await;
    Ok(StatusCode::NO_CONTENT)
}
