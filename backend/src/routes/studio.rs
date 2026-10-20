//! Recording Studio: a studio channel has one engineer (assigned by Manage Channels), a band (artists the engineer
//! adds; they are heard and recorded) and an audience. Recording is multitrack and client-side: when the engineer
//! starts a session every band member's client records its own mic and streams chunks up as its own track, so each
//! artist ends up as a clean separate file. Tracks are served back for the in-browser multitrack player.

use crate::{auth::AuthUser, error::{AppError, AppResult}, perms, routes::channels::require_channel_perms, state::AppState};
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

/// Per-track cap (about an hour of Opus at 64 kbps).
pub const MAX_TRACK_BYTES: i64 = 30 * 1024 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/studio/engineer/:uid", put(set_engineer).delete(clear_engineer))
        .route("/channels/:id/studio/sessions", get(list_sessions).post(start_session))
        .route("/channels/:id/studio/sessions/:sid/stop", post(stop_session))
        .route("/channels/:id/studio/sessions/:sid", delete(delete_session))
        .route("/studio/sessions/:sid/tracks", post(create_track))
        .route("/studio/sessions/:sid/tracks/:tid/chunks", post(append_chunk).layer(DefaultBodyLimit::max(8 * 1024 * 1024)))
        .route("/studio/sessions/:sid/tracks/:tid/finish", post(finish_track))
        .route("/studio/tracks/:tid", get(serve_track))
}

#[derive(Debug, Serialize, FromRow)]
pub struct Track {
    pub id: Uuid,
    pub session_id: Uuid,
    pub user_id: Option<Uuid>,
    pub content_type: String,
    pub size: i64,
    pub duration_ms: Option<i32>,
    pub offset_ms: i32,
    pub done: bool,
    pub created_at: DateTime<Utc>,
    #[sqlx(default)]
    pub display_name: String,
    #[sqlx(skip)]
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Session {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub guild_id: Uuid,
    pub name: String,
    pub started_by: Option<Uuid>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    #[sqlx(skip)]
    #[serde(default)]
    pub tracks: Vec<Track>,
}

const TRACK_SELECT: &str = "SELECT t.id, t.session_id, t.user_id, t.content_type, t.size, t.duration_ms, t.offset_ms, t.done, t.created_at, COALESCE(u.display_name, 'Unknown') AS display_name
    FROM studio_tracks t LEFT JOIN users u ON u.id = t.user_id";
const SESSION_COLS: &str = "id, channel_id, guild_id, name, started_by, started_at, ended_at";

fn track_path(state: &AppState, tid: Uuid) -> std::path::PathBuf { state.config.upload_dir.join(format!("studio-{tid}.webm")) }

async fn studio_channel(db: &PgPool, id: Uuid, uid: Uuid) -> AppResult<(crate::models::Channel, u64)> {
    let (c, p) = require_channel_perms(db, id, uid).await?;
    if c.kind != "studio" { return Err(AppError::BadRequest("Not a studio channel".into())); }
    Ok((c, p))
}

async fn sessions_for(db: &PgPool, channel_id: Uuid) -> AppResult<Vec<Session>> {
    let mut sessions = sqlx::query_as::<_, Session>(&format!("SELECT {SESSION_COLS} FROM studio_sessions WHERE channel_id = $1 ORDER BY started_at DESC LIMIT 50")).bind(channel_id).fetch_all(db).await?;
    if sessions.is_empty() { return Ok(sessions); }
    let ids: Vec<Uuid> = sessions.iter().map(|s| s.id).collect();
    let tracks = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.session_id = ANY($1) ORDER BY t.created_at")).bind(&ids).fetch_all(db).await?;
    for mut t in tracks {
        t.url = format!("/api/studio/tracks/{}", t.id);
        if let Some(s) = sessions.iter_mut().find(|s| s.id == t.session_id) { s.tracks.push(t); }
    }
    Ok(sessions)
}

async fn broadcast(state: &AppState, c: &crate::models::Channel, event: &str, payload: serde_json::Value) -> AppResult<()> {
    let target = perms::channel_audience(&state.db, c).await?;
    state.hub.emit(target, event, payload);
    Ok(())
}

async fn channel_json(state: &AppState, id: Uuid) -> AppResult<crate::models::Channel> {
    let mut c = sqlx::query_as::<_, crate::models::Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS)).bind(id).fetch_one(&state.db).await?;
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut c)).await?;
    Ok(c)
}

/// Manage Channels picks the engineer; the engineer joins (or is moved) into the band.
async fn set_engineer(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<Json<crate::models::Channel>> {
    let (c, p) = studio_channel(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    let member: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2").bind(c.guild_id).bind(target).fetch_optional(&state.db).await?;
    if member.is_none() { return Err(AppError::BadRequest("That user is not in the server".into())); }
    sqlx::query("UPDATE channels SET engineer_id = $2 WHERE id = $1").bind(id).bind(target).execute(&state.db).await?;
    if let Some(vs) = state.hub.voice_update(target, |v| { if v.channel_id == id { v.suppress = false; v.request_to_speak = false; } }) {
        if vs.channel_id == id { broadcast(&state, &c, "VOICE_STATE_UPDATE", json!(vs)).await?; }
    }
    let updated = channel_json(&state, id).await?;
    state.hub.emit_guild(c.guild_id.unwrap(), "CHANNEL_UPDATE", json!(updated));
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.engineer", "channel", Some(id), &c.name, json!({ "engineer": target })).await;
    Ok(Json(updated))
}

async fn clear_engineer(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<Json<crate::models::Channel>> {
    let (c, p) = studio_channel(&state.db, id, uid).await?;
    if c.engineer_id != Some(uid) || target != uid { perms::check(p, perms::MANAGE_CHANNELS)?; }   // the engineer may step down
    sqlx::query("UPDATE channels SET engineer_id = NULL WHERE id = $1 AND engineer_id = $2").bind(id).bind(target).execute(&state.db).await?;
    let updated = channel_json(&state, id).await?;
    state.hub.emit_guild(c.guild_id.unwrap(), "CHANNEL_UPDATE", json!(updated));
    Ok(Json(updated))
}

async fn list_sessions(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Session>>> {
    studio_channel(&state.db, id, uid).await?;
    Ok(Json(sessions_for(&state.db, id).await?))
}

#[derive(Deserialize)]
struct StartReq { #[serde(default)] name: String }

/// The engineer starts a recording session: everyone in the channel learns the session id and server start time;
/// band members' clients begin recording their own mic and upload it as a track.
async fn start_session(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<StartReq>) -> AppResult<(StatusCode, Json<Session>)> {
    let (c, _) = studio_channel(&state.db, id, uid).await?;
    if c.engineer_id != Some(uid) { return Err(AppError::Forbidden); }
    let open: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM studio_sessions WHERE channel_id = $1 AND ended_at IS NULL").bind(id).fetch_optional(&state.db).await?;
    if open.is_some() { return Err(AppError::Conflict("A session is already recording".into())); }
    let name: String = { let n: String = req.name.trim().chars().take(80).collect(); if n.is_empty() { format!("Session {}", Utc::now().format("%Y-%m-%d %H:%M")) } else { n } };
    let sid = Uuid::now_v7();
    let s = sqlx::query_as::<_, Session>(&format!("INSERT INTO studio_sessions (id, channel_id, guild_id, name, started_by) VALUES ($1, $2, $3, $4, $5) RETURNING {SESSION_COLS}"))
        .bind(sid).bind(id).bind(c.guild_id).bind(&name).bind(uid).fetch_one(&state.db).await?;
    broadcast(&state, &c, "STUDIO_SESSION", json!({ "channel_id": id, "action": "start", "session_id": sid, "name": name, "started_at": s.started_at })).await?;
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.record", "channel", Some(id), &c.name, json!({ "session": sid })).await;
    Ok((StatusCode::CREATED, Json(s)))
}

async fn stop_session(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, sid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Session>> {
    let (c, p) = studio_channel(&state.db, id, uid).await?;
    if c.engineer_id != Some(uid) { perms::check(p, perms::MANAGE_CHANNELS)?; }
    let res = sqlx::query("UPDATE studio_sessions SET ended_at = now() WHERE id = $1 AND channel_id = $2 AND ended_at IS NULL").bind(sid).bind(id).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::NotFound("No recording session with that id".into())); }
    broadcast(&state, &c, "STUDIO_SESSION", json!({ "channel_id": id, "action": "stop", "session_id": sid })).await?;
    let s = sessions_for(&state.db, id).await?.into_iter().find(|s| s.id == sid).ok_or_else(|| AppError::NotFound("Session not found".into()))?;
    Ok(Json(s))
}

async fn delete_session(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, sid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    let (c, p) = studio_channel(&state.db, id, uid).await?;
    if c.engineer_id != Some(uid) { perms::check(p, perms::MANAGE_CHANNELS)?; }
    let tracks: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM studio_tracks WHERE session_id = $1").bind(sid).fetch_all(&state.db).await?;
    let res = sqlx::query("DELETE FROM studio_sessions WHERE id = $1 AND channel_id = $2").bind(sid).bind(id).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::NotFound("Session not found".into())); }
    for (tid,) in tracks { let _ = tokio::fs::remove_file(track_path(&state, tid)).await; }
    broadcast(&state, &c, "STUDIO_UPDATE", json!({ "channel_id": id })).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct NewTrack { #[serde(default)] offset_ms: i32, content_type: Option<String> }

/// A band member registers its track for the open session (one per user per session).
async fn create_track(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(sid): Path<Uuid>, Json(req): Json<NewTrack>) -> AppResult<(StatusCode, Json<Track>)> {
    let sess: Option<(Uuid, Option<DateTime<Utc>>)> = sqlx::query_as("SELECT channel_id, ended_at FROM studio_sessions WHERE id = $1").bind(sid).fetch_optional(&state.db).await?;
    let Some((channel_id, ended)) = sess else { return Err(AppError::NotFound("Session not found".into())) };
    if ended.is_some() { return Err(AppError::BadRequest("That session has ended".into())); }
    let (c, _) = studio_channel(&state.db, channel_id, uid).await?;
    let vs = state.hub.voice_state(uid).filter(|v| v.channel_id == channel_id).ok_or_else(|| AppError::BadRequest("Join the studio first".into()))?;
    if vs.suppress { return Err(AppError::Forbidden); }
    let existing: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM studio_tracks WHERE session_id = $1 AND user_id = $2").bind(sid).bind(uid).fetch_optional(&state.db).await?;
    if existing.is_some() { return Err(AppError::Conflict("You already have a track in this session".into())); }
    let ct = req.content_type.filter(|t| t.starts_with("audio/")).unwrap_or_else(|| "audio/webm".into());
    let tid = Uuid::now_v7();
    sqlx::query("INSERT INTO studio_tracks (id, session_id, user_id, content_type, offset_ms) VALUES ($1, $2, $3, $4, $5)").bind(tid).bind(sid).bind(uid).bind(&ct).bind(req.offset_ms.clamp(-60_000, 600_000)).execute(&state.db).await?;
    tokio::fs::create_dir_all(&state.config.upload_dir).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    tokio::fs::write(track_path(&state, tid), b"").await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let mut t = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.id = $1")).bind(tid).fetch_one(&state.db).await?;
    t.url = format!("/api/studio/tracks/{tid}");
    broadcast(&state, &c, "STUDIO_UPDATE", json!({ "channel_id": channel_id })).await?;
    Ok((StatusCode::CREATED, Json(t)))
}

async fn own_open_track(db: &PgPool, sid: Uuid, tid: Uuid, uid: Uuid) -> AppResult<i64> {
    let row: Option<(Option<Uuid>, bool, i64)> = sqlx::query_as("SELECT user_id, done, size FROM studio_tracks WHERE id = $1 AND session_id = $2").bind(tid).bind(sid).fetch_optional(db).await?;
    let Some((owner, done, size)) = row else { return Err(AppError::NotFound("Track not found".into())) };
    if owner != Some(uid) { return Err(AppError::Forbidden); }
    if done { return Err(AppError::BadRequest("Track already finished".into())); }
    Ok(size)
}

/// Append a MediaRecorder chunk (raw bytes) to the caller's track.
async fn append_chunk(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((sid, tid)): Path<(Uuid, Uuid)>, body: Bytes) -> AppResult<Json<serde_json::Value>> {
    let size = own_open_track(&state.db, sid, tid, uid).await?;
    if size + body.len() as i64 > MAX_TRACK_BYTES { return Err(AppError::BadRequest("Track too large".into())); }
    let mut f = tokio::fs::OpenOptions::new().append(true).create(true).open(track_path(&state, tid)).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    f.write_all(&body).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    f.flush().await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let (new_size,): (i64,) = sqlx::query_as("UPDATE studio_tracks SET size = size + $3 WHERE id = $1 AND session_id = $2 RETURNING size").bind(tid).bind(sid).bind(body.len() as i64).fetch_one(&state.db).await?;
    Ok(Json(json!({ "size": new_size })))
}

#[derive(Deserialize)]
struct FinishReq { duration_ms: Option<i32> }

async fn finish_track(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((sid, tid)): Path<(Uuid, Uuid)>, Json(req): Json<FinishReq>) -> AppResult<Json<Track>> {
    own_open_track(&state.db, sid, tid, uid).await?;
    sqlx::query("UPDATE studio_tracks SET done = true, duration_ms = $3 WHERE id = $1 AND session_id = $2").bind(tid).bind(sid).bind(req.duration_ms.map(|d| d.max(0))).execute(&state.db).await?;
    let mut t = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.id = $1")).bind(tid).fetch_one(&state.db).await?;
    t.url = format!("/api/studio/tracks/{tid}");
    let channel_id: (Uuid,) = sqlx::query_as("SELECT channel_id FROM studio_sessions WHERE id = $1").bind(sid).fetch_one(&state.db).await?;
    if let Ok(c) = channel_json(&state, channel_id.0).await { broadcast(&state, &c, "STUDIO_UPDATE", json!({ "channel_id": channel_id.0 })).await?; }
    Ok(Json(t))
}

/// Tracks are served to anyone who can see the channel.
async fn serve_track(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(tid): Path<Uuid>) -> AppResult<Response> {
    let row: Option<(Uuid, String, i64)> = sqlx::query_as("SELECT s.channel_id, t.content_type, t.size FROM studio_tracks t JOIN studio_sessions s ON s.id = t.session_id WHERE t.id = $1").bind(tid).fetch_optional(&state.db).await?;
    let Some((channel_id, ct, size)) = row else { return Err(AppError::NotFound("Track not found".into())) };
    studio_channel(&state.db, channel_id, uid).await?;
    let file = tokio::fs::File::open(track_path(&state, tid)).await.map_err(|_| AppError::NotFound("Track file missing".into()))?;
    let mut resp = Response::new(Body::from_stream(tokio_util::io::ReaderStream::new(file)));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&ct).unwrap_or(HeaderValue::from_static("audio/webm")));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(size as u64));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&format!("inline; filename=\"track-{tid}.webm\"")).unwrap());
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=0"));
    Ok(resp.into_response())
}
