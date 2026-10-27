//! Live captions in calls. Members turn captions on for themselves (`voice_captions` on the socket); while anyone
//! in the call has them on, speakers' clients send a few seconds of their own speech at a time here, the server's
//! speech-to-text endpoint (the one voice messages use) transcribes it, and the line goes to everyone in the call
//! who has captions on. Nothing is stored. End-to-end encrypted calls never send audio to the server, so captions
//! are off there.

use crate::{auth::AuthUser, error::{AppError, AppResult}, state::AppState};
use axum::{body::Bytes, extract::{DefaultBodyLimit, Path, State}, http::{HeaderMap, StatusCode}, routing::post, Router};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/channels/:id/captions", post(caption).layer(DefaultBodyLimit::max(MAX_BYTES)))
}

const MAX_BYTES: usize = 512 * 1024;
static LAST: Mutex<Option<HashMap<Uuid, Instant>>> = Mutex::new(None);

/// `POST /channels/:id/captions` (body: a short audio clip, e.g. audio/webm): transcribe and fan out. 202 when sent
/// for transcription, 204 when nobody wants captions (the client should stop sending).
async fn caption(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, headers: HeaderMap, body: Bytes) -> AppResult<StatusCode> {
    let vs = state.hub.voice_state(uid).filter(|v| v.channel_id == id).ok_or_else(|| AppError::BadRequest("Join the call first".into()))?;
    if vs.suppress || vs.mute || vs.self_mute { return Err(AppError::Forbidden); }
    let (c, _) = crate::routes::channels::require_channel_perms(&state.db, id, uid).await?;
    if c.e2ee { return Err(AppError::BadRequest("Captions are off in end-to-end encrypted calls".into())); }
    let settings = crate::routes::admin::load_settings(&state.db).await?;
    if !settings.stt_configured() { return Err(AppError::BadRequest("Speech-to-text is not set up on this server".into())); }
    let wanting: Vec<Uuid> = state.hub.voice_states_for_channels(&[id]).into_iter().filter(|v| v.captions).map(|v| v.user_id).collect();
    if wanting.is_empty() { return Ok(StatusCode::NO_CONTENT); }
    if body.len() < 512 { return Err(AppError::BadRequest("Too short".into())); }
    {
        let mut g = LAST.lock().map_err(|_| AppError::Other(anyhow::anyhow!("lock")))?;
        let m = g.get_or_insert_with(HashMap::new);
        let now = Instant::now();
        if m.get(&uid).map(|t| now.duration_since(*t) < Duration::from_millis(1500)).unwrap_or(false) { return Err(AppError::TooMany("Slow down".into())); }
        m.insert(uid, now);
        if m.len() > 10_000 { m.retain(|_, t| now.duration_since(*t) < Duration::from_secs(60)); }
    }
    let ct = headers.get(axum::http::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("audio/webm").split(';').next().unwrap_or("audio/webm").to_string();
    if !ct.starts_with("audio/") { return Err(AppError::BadRequest("Send audio".into())); }
    let ext = if ct.contains("ogg") { "ogg" } else if ct.contains("mp4") || ct.contains("aac") { "m4a" } else if ct.contains("wav") { "wav" } else { "webm" };
    let at = chrono::Utc::now();
    let st = state.clone();
    tokio::spawn(async move {
        let text = match crate::routes::attachments::stt(body.to_vec(), format!("caption.{ext}"), &ct, &settings.stt_url, &settings.stt_api_key, &settings.stt_model, 20).await {
            Ok(t) => t,
            Err(e) => { tracing::debug!(error = %e, "caption transcription failed"); return }
        };
        // Whisper hears "Thank you." and the like in near-silence: drop empty and bracketed non-speech lines.
        let t = text.trim();
        if t.is_empty() || (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')')) { return }
        let now_wanting: Vec<Uuid> = st.hub.voice_states_for_channels(&[id]).into_iter().filter(|v| v.captions).map(|v| v.user_id).collect();
        st.hub.emit_users(now_wanting, "CALL_CAPTION", json!({ "channel_id": id, "user_id": uid, "text": t, "at": at }));
    });
    Ok(StatusCode::ACCEPTED)
}
