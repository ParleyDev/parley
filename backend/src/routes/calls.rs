//! Call extras: declining a DM call (the caller and your other devices are told), ringing chosen people in a group
//! call, and stream preview stills for "Watch Stream".

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::channels::require_channel,
    state::AppState,
};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

const MAX_PREVIEW: usize = 200 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/call/decline", post(decline))
        .route("/channels/:id/call/ring", post(ring))
        .route("/channels/:id/stream-preview", put(put_preview).layer(DefaultBodyLimit::max(MAX_PREVIEW + 1024)))
        .route("/channels/:id/stream-preview/:uid", get(get_preview))
}

async fn dm_members(state: &AppState, id: Uuid) -> AppResult<Vec<Uuid>> {
    Ok(sqlx::query_as::<_, (Uuid,)>("SELECT user_id FROM channel_members WHERE channel_id = $1").bind(id).fetch_all(&state.db).await?.into_iter().map(|r| r.0).collect())
}

/// `POST /channels/:id/call/decline`: say no to a ringing DM or group call.
async fn decline(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let c = require_channel(&state.db, id, uid).await?;
    if c.guild_id.is_some() { return Err(AppError::BadRequest("Only DM and group calls ring".into())) }
    state.hub.emit_users(dm_members(&state, id).await?, "CALL_DECLINE", json!({ "channel_id": id, "user_id": uid }));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct RingReq { user_ids: Vec<Uuid> }

/// `POST /channels/:id/call/ring`: from inside a DM or group call, ring members who aren't in it (again).
async fn ring(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<RingReq>) -> AppResult<StatusCode> {
    let c = require_channel(&state.db, id, uid).await?;
    if c.guild_id.is_some() { return Err(AppError::BadRequest("Only DM and group calls ring".into())) }
    if !state.hub.voice_state(uid).map(|v| v.channel_id == id).unwrap_or(false) { return Err(AppError::BadRequest("Start or join the call first".into())) }
    let members = dm_members(&state, id).await?;
    let targets: Vec<Uuid> = req.user_ids.into_iter().filter(|t| *t != uid && members.contains(t) && state.hub.voice_state(*t).map(|v| v.channel_id != id).unwrap_or(true)).collect();
    if targets.is_empty() { return Err(AppError::BadRequest("Nobody to ring".into())) }
    let (name,): (String,) = sqlx::query_as("SELECT display_name FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    state.hub.emit_users(targets.clone(), "CALL_RING", json!({ "channel_id": id, "user_id": uid }));
    let online = crate::ws::bus::online_users(&state.db).await;
    let offline: Vec<Uuid> = targets.into_iter().filter(|t| !online.contains(t)).collect();
    if !offline.is_empty() { crate::push::notify(&state, &offline, "Incoming call", &format!("{name} is calling you"), json!({ "kind": "call", "channel_id": id })).await; }
    Ok(StatusCode::NO_CONTENT)
}

/// `PUT /channels/:id/stream-preview`: the streamer's latest still (JPEG, PNG or WebP, up to 200 KB).
async fn put_preview(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, headers: HeaderMap, body: Bytes) -> AppResult<StatusCode> {
    let streaming = state.hub.voice_state(uid).map(|v| v.channel_id == id && v.self_stream).unwrap_or(false);
    if !streaming { return Err(AppError::BadRequest("Share your screen first".into())) }
    let ct = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
    if !["image/jpeg", "image/png", "image/webp"].contains(&ct) || body.is_empty() || body.len() > MAX_PREVIEW { return Err(AppError::BadRequest("Send a JPEG, PNG or WebP up to 200 KB".into())) }
    sqlx::query("INSERT INTO stream_previews (user_id, channel_id, content_type, image) VALUES ($1, $2, $3, $4)
                 ON CONFLICT (user_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, content_type = EXCLUDED.content_type, image = EXCLUDED.image, updated_at = now()")
        .bind(uid).bind(id).bind(ct).bind(body.to_vec()).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /channels/:id/stream-preview/:uid`: someone's recent stream still, for people who can see the channel.
async fn get_preview(State(state): State<AppState>, AuthUser(me): AuthUser, Path((id, uid)): Path<(Uuid, Uuid)>) -> AppResult<Response> {
    require_channel(&state.db, id, me).await?;
    let row: Option<(String, Vec<u8>)> = sqlx::query_as("SELECT content_type, image FROM stream_previews WHERE user_id = $1 AND channel_id = $2 AND updated_at > now() - interval '3 minutes'")
        .bind(uid).bind(id).fetch_optional(&state.db).await?;
    let Some((ct, img)) = row else { return Err(AppError::NotFound("No preview".into())) };
    let mut resp = Response::new(axum::body::Body::from(img));
    resp.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_str(&ct).unwrap_or(HeaderValue::from_static("image/jpeg")));
    resp.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(resp.into_response())
}
