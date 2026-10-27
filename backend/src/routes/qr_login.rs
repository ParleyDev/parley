//! Log in with a QR code. A signed-out screen asks for a code (`POST /auth/qr`) and shows it; you open it on a device
//! where you're signed in (`/login/qr/:id`), see which browser is asking, and approve; the waiting screen then gets a
//! session (`GET /auth/qr/:id?secret=`). Codes last two minutes, and the session needs the secret only that screen has.

use crate::{auth::AuthUser, error::{AppError, AppResult}, state::AppState};
use axum::{extract::{Path, Query, State}, http::{HeaderMap, StatusCode}, middleware::from_fn, routing::{get, post}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/qr", post(create).route_layer(from_fn(crate::ratelimit::rl_login)))
        .route("/auth/qr/:id", get(poll))
        .route("/auth/qr/:id/info", get(info))
        .route("/auth/qr/:id/approve", post(approve))
        .route("/auth/qr/:id/deny", post(deny))
}

const LIFETIME: &str = "2 minutes";

async fn create(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Json<Value>> {
    sqlx::query("DELETE FROM qr_logins WHERE created_at < now() - interval '10 minutes'").execute(&state.db).await?;
    let id = Uuid::now_v7();
    let secret = crate::mail::new_token();
    let device: String = headers.get(axum::http::header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("").chars().take(200).collect();
    sqlx::query("INSERT INTO qr_logins (id, secret_hash, device, ip) VALUES ($1, $2, $3, $4)")
        .bind(id).bind(crate::routes::applications::hash(&secret)).bind(&device).bind(crate::ratelimit::client_ip(&headers)).execute(&state.db).await?;
    Ok(Json(json!({ "id": id, "secret": secret, "expires_in": 120 })))
}

#[derive(Deserialize)]
struct PollQ { secret: String }

/// The waiting screen polls: pending, scanned, denied, expired, or (once) approved with a session.
async fn poll(State(state): State<AppState>, headers: HeaderMap, Path(id): Path<Uuid>, Query(q): Query<PollQ>) -> AppResult<Json<Value>> {
    let row: Option<(String, String, Option<Uuid>, bool)> = sqlx::query_as(&format!("SELECT secret_hash, status, user_id, created_at < now() - interval '{LIFETIME}' FROM qr_logins WHERE id = $1")).bind(id).fetch_optional(&state.db).await?;
    let Some((hash, status, user, expired)) = row else { return Ok(Json(json!({ "status": "expired" }))) };
    if hash != crate::routes::applications::hash(&q.secret) { return Err(AppError::NotFound("Unknown code".into())) }
    if status == "approved" {
        // Hand out the session once.
        let taken = sqlx::query("UPDATE qr_logins SET status = 'used' WHERE id = $1 AND status = 'approved'").bind(id).execute(&state.db).await?;
        if taken.rows_affected() == 1 { if let Some(uid) = user { let mut v = crate::routes::auth::session(&state, uid, &headers).await?.0; v["status"] = json!("approved"); return Ok(Json(v)) } }
        return Ok(Json(json!({ "status": "used" })));
    }
    if expired && status != "used" { return Ok(Json(json!({ "status": "expired" }))) }
    let who = match (status.as_str(), user) {
        ("scanned", Some(u)) => sqlx::query_as::<_, (String, Option<String>)>("SELECT display_name, avatar_url FROM users WHERE id = $1").bind(u).fetch_optional(&state.db).await?.map(|(n, a)| json!({ "display_name": n, "avatar_url": a })),
        _ => None,
    };
    Ok(Json(json!({ "status": status, "user": who })))
}

/// What the approving device shows: which browser, from where, when.
async fn info(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let row: Option<(String, String, String, chrono::DateTime<chrono::Utc>, bool)> = sqlx::query_as(&format!("SELECT status, device, ip, created_at, created_at < now() - interval '{LIFETIME}' FROM qr_logins WHERE id = $1")).bind(id).fetch_optional(&state.db).await?;
    let Some((status, device, ip, at, expired)) = row else { return Err(AppError::NotFound("This code has expired".into())) };
    if expired || !(status == "pending" || status == "scanned") { return Err(AppError::NotFound("This code has expired".into())) }
    // Scanning shows the waiting screen whose account is about to sign in.
    sqlx::query("UPDATE qr_logins SET status = 'scanned', user_id = $2 WHERE id = $1 AND status = 'pending'").bind(id).bind(uid).execute(&state.db).await?;
    Ok(Json(json!({ "device": device, "ip": ip, "created_at": at })))
}

async fn approve(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let (bot,): (bool,) = sqlx::query_as("SELECT bot FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if bot { return Err(AppError::Forbidden) }
    let r = sqlx::query(&format!("UPDATE qr_logins SET status = 'approved', user_id = $2 WHERE id = $1 AND status IN ('pending', 'scanned') AND (user_id IS NULL OR user_id = $2) AND created_at > now() - interval '{LIFETIME}'"))
        .bind(id).bind(uid).execute(&state.db).await?;
    if r.rows_affected() == 0 { return Err(AppError::NotFound("This code has expired".into())) }
    crate::audit::record(&state, uid, "user.qr_login", "user", Some(uid), "", json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn deny(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    sqlx::query("UPDATE qr_logins SET status = 'denied' WHERE id = $1 AND (user_id IS NULL OR user_id = $2) AND status IN ('pending', 'scanned')").bind(id).bind(uid).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
