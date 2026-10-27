//! Browser push subscriptions and the actions a notification offers (see `crate::webpush`).

use crate::{
    auth::{AuthSession, AuthUser},
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{extract::State, http::StatusCode, routing::{get, post, put}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/push/web/key", get(key))
        .route("/users/@me/web-push", put(subscribe).delete(unsubscribe))
        .route("/push/action", post(action).route_layer(axum::middleware::from_fn(crate::ratelimit::rl_messages)))
}

/// `GET /push/web/key`: the VAPID public key a browser subscribes with.
async fn key(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let k = crate::webpush::public_key(&state).await.ok_or_else(|| AppError::Other(anyhow::anyhow!("push keys unavailable")))?;
    Ok(Json(json!({ "public_key": k })))
}

#[derive(Deserialize)]
struct Keys { p256dh: String, auth: String }
#[derive(Deserialize)]
struct Subscription { endpoint: String, keys: Keys }

/// `PUT /users/@me/web-push`: a `PushSubscription.toJSON()` from this browser, tied to the calling session.
async fn subscribe(State(state): State<AppState>, AuthSession(uid, sid): AuthSession, Json(req): Json<Subscription>) -> AppResult<StatusCode> {
    let endpoint = req.endpoint.trim().to_string();
    if endpoint.len() > 2048 { return Err(AppError::BadRequest("Invalid endpoint".into())); }
    let allow = &state.config.push_allow_hosts;
    let u = crate::routes::embeds::check_url(&endpoint, allow).map_err(|_| AppError::BadRequest("That push service is not reachable".into()))?;
    if u.scheme() != "https" && !allow.iter().any(|h| Some(h.as_str()) == u.host_str()) { return Err(AppError::BadRequest("Push endpoints must use https".into())); }
    use base64::Engine;
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let ok = b64.decode(req.keys.p256dh.trim_end_matches('=')).map(|k| k.len() == 65).unwrap_or(false)
        && b64.decode(req.keys.auth.trim_end_matches('=')).map(|a| a.len() == 16).unwrap_or(false);
    if !ok { return Err(AppError::BadRequest("Invalid subscription keys".into())); }
    sqlx::query(
        "INSERT INTO web_push_subs (endpoint, user_id, session_id, p256dh, auth) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth",
    ).bind(&endpoint).bind(uid).bind(sid).bind(req.keys.p256dh.trim()).bind(req.keys.auth.trim()).execute(&state.db).await?;
    // At most 10 browsers per account: the oldest go.
    sqlx::query("DELETE FROM web_push_subs WHERE user_id = $1 AND endpoint NOT IN (SELECT endpoint FROM web_push_subs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10)").bind(uid).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Unsub { endpoint: String }
async fn unsubscribe(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<Unsub>) -> AppResult<StatusCode> {
    sqlx::query("DELETE FROM web_push_subs WHERE endpoint = $1 AND user_id = $2").bind(req.endpoint.trim()).bind(uid).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ActionReq { token: String, action: String, #[serde(default)] content: String, message_id: Option<Uuid> }

/// `POST /push/action`: Mark as Read or Reply from a notification, authorised by the payload's action token.
async fn action(State(state): State<AppState>, Json(req): Json<ActionReq>) -> AppResult<StatusCode> {
    let (uid, sid, cid) = crate::webpush::verify_action(&state, &req.token).ok_or(AppError::Unauthorized)?;
    if !crate::auth::check_session(&state, uid, sid).await? { return Err(AppError::Unauthorized); }
    match req.action.as_str() {
        "read" => {
            let last: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM messages WHERE channel_id = $1 ORDER BY id DESC LIMIT 1").bind(cid).fetch_optional(&state.db).await?;
            let Some((mid,)) = last else { return Ok(StatusCode::NO_CONTENT) };
            crate::routes::channels::mark_read(State(state), crate::auth::AuthAny(uid, Some(sid)), axum::extract::Path(cid), Json(serde_json::from_value(json!({ "message_id": mid })).map_err(|e| AppError::Other(e.into()))?)).await
        }
        "reply" => {
            if req.content.trim().is_empty() { return Err(AppError::BadRequest("Write a reply".into())); }
            let body = serde_json::from_value(json!({ "content": req.content, "reply_to": req.message_id })).map_err(|e| AppError::BadRequest(e.to_string()))?;
            crate::routes::channels::create_message(State(state), AuthUser(uid), axum::extract::Path(cid), Json(body)).await.map(|_| StatusCode::NO_CONTENT)
        }
        _ => Err(AppError::BadRequest("Unknown action".into())),
    }
}
