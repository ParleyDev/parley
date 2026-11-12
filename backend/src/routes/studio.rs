//! Recording Studio: a studio channel holds projects, each a channel of kind 'project' under it with its own voice
//! room, chat, console and band: engineers (run recordings, manage the band) and artists (edit and record); everyone
//! else in its voice room is the audience. Recording is multitrack and client-side: when a take starts every armed
//! band member's client records its own mic and streams chunks up as its own track, so each artist ends up as a clean
//! separate file, placed in the project (studio_daw).

use crate::{auth::AuthUser, error::{AppError, AppResult}, perms, routes::channels::require_channel_perms, state::AppState};
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
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
        .route("/channels/:id/studio/role/:uid", put(set_role))
        .route("/channels/:id/studio/engineer/:uid", put(set_engineer).delete(clear_engineer))
        .route("/channels/:id/studio/config", patch(set_config))
        .route("/channels/:id/studio/arm/:uid", put(set_arm))
        .route("/channels/:id/studio/sessions", get(list_sessions).post(start_session))
        .route("/channels/:id/studio/sessions/:sid/stop", post(stop_session))
        .route("/channels/:id/studio/sessions/:sid", delete(delete_session))
        .route("/studio/sessions/:sid/tracks", post(create_track))
        .route("/studio/sessions/:sid/tracks/:tid/chunks", post(append_chunk).layer(DefaultBodyLimit::max(8 * 1024 * 1024)))
        .route("/studio/sessions/:sid/tracks/:tid/finish", post(finish_track))
        .route("/studio/tracks/:tid", get(serve_track))
        .route("/channels/:id/studio/gatherings", get(list_gatherings).post(start_gathering))
        .route("/channels/:id/studio/gatherings/:gid/end", post(end_gathering))
}

#[derive(Debug, Serialize, FromRow)]
pub struct Track {
    pub id: Uuid,
    /// None for an imported file.
    pub session_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub content_type: String,
    pub size: i64,
    pub duration_ms: Option<i32>,
    pub offset_ms: i32,
    pub done: bool,
    pub created_at: DateTime<Utc>,
    /// take (recorded in a session) or import (a file brought into the studio).
    pub kind: String,
    /// An import's file name.
    pub name: Option<String>,
    pub latency_ms: i32,
    /// The project track a take was recorded for (a member records each of their armed tracks as its own take).
    pub lane_id: Option<Uuid>,
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
    /// Band members armed when this take started; `None` on takes from before arming.
    pub armed: Option<Vec<Uuid>>,
    /// Tempo and metronome the take was recorded with; `started_at` is the downbeat after `count_in_ms`.
    pub bpm: i32,
    pub beats: i32,
    pub click: bool,
    pub count_in_ms: i32,
    /// Recorded into this project, its downbeat at `position_ms` on the project's timeline.
    pub project_id: Option<Uuid>,
    pub position_ms: i32,
    /// A loop or punch range the take was recorded with.
    pub loop_start_ms: Option<i32>,
    pub loop_end_ms: Option<i32>,
    pub punch: bool,
    /// Recorded alone: only its starter records and hears the backing.
    pub solo: bool,
    #[sqlx(skip)]
    #[serde(default)]
    pub tracks: Vec<Track>,
}

pub const TRACK_SELECT: &str = "SELECT t.id, t.session_id, t.user_id, t.content_type, t.size, t.duration_ms, t.offset_ms, t.done, t.created_at, t.kind, t.name, t.latency_ms, t.lane_id, COALESCE(u.display_name, 'Unknown') AS display_name
    FROM studio_tracks t LEFT JOIN users u ON u.id = t.user_id";
const SESSION_COLS: &str = "id, channel_id, guild_id, name, started_by, started_at, ended_at, armed, bpm, beats, click, count_in_ms, project_id, position_ms, loop_start_ms, loop_end_ms, punch, solo";

pub fn track_path(state: &AppState, tid: Uuid) -> std::path::PathBuf { state.config.upload_dir.join(format!("studio-{tid}.webm")) }

/// Studio audio stored for these channels (takes and imports), to remove from disk once their rows are gone.
pub async fn files_of(db: &PgPool, channels: &[Uuid]) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as("SELECT t.id FROM studio_tracks t LEFT JOIN studio_sessions s ON s.id = t.session_id WHERE t.channel_id = ANY($1) OR s.channel_id = ANY($1)").bind(channels).fetch_all(db).await?;
    Ok(rows.into_iter().map(|(t,)| t).collect())
}

pub async fn remove_files(state: &AppState, tracks: Vec<Uuid>) {
    for tid in tracks { let _ = tokio::fs::remove_file(track_path(state, tid)).await; }
}

/// A project's channel (its voice room, console and band), as seen by `uid`.
pub async fn studio_channel(db: &PgPool, id: Uuid, uid: Uuid) -> AppResult<(crate::models::Channel, u64)> {
    let (c, p) = require_channel_perms(db, id, uid).await?;
    if c.kind != "project" { return Err(AppError::BadRequest("Not a studio project".into())); }
    Ok((c, p))
}

/// A studio channel (the list of projects), as seen by `uid`.
pub async fn studio_container(db: &PgPool, id: Uuid, uid: Uuid) -> AppResult<(crate::models::Channel, u64)> {
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
        if let Some(s) = sessions.iter_mut().find(|s| Some(s.id) == t.session_id) { s.tracks.push(t); }
    }
    Ok(sessions)
}

pub async fn broadcast(state: &AppState, c: &crate::models::Channel, event: &str, payload: serde_json::Value) -> AppResult<()> {
    let target = perms::channel_audience(&state.db, c).await?;
    state.hub.emit(target, event, payload);
    Ok(())
}

pub async fn channel_json(state: &AppState, id: Uuid) -> AppResult<crate::models::Channel> {
    let mut c = sqlx::query_as::<_, crate::models::Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS)).bind(id).fetch_one(&state.db).await?;
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut c)).await?;
    Ok(c)
}

/// Runs the project: its engineers, and Manage Projects.
pub async fn is_crew(state: &AppState, id: Uuid, uid: Uuid, p: u64) -> AppResult<bool> {
    Ok(perms::has(p, perms::MANAGE_PROJECTS) || perms::is_engineer(&state.db, id, uid).await?)
}

#[derive(Deserialize)]
struct RoleReq { role: String }

/// `PUT /channels/:id/studio/role/:uid {role: engineer|artist|audience}`: a project's band. Engineers and Manage
/// Projects set anyone's role (a project may have several engineers); anyone may step down themselves (engineer →
/// artist, artist → audience, which leaves the band). The band is heard in the voice room; the audience is not.
async fn set_role(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>, Json(req): Json<RoleReq>) -> AppResult<Json<crate::models::Channel>> {
    let (c, p) = studio_channel(&state.db, id, uid).await?;
    let role = req.role.as_str();
    if !["engineer", "artist", "audience"].contains(&role) { return Err(AppError::BadRequest("Role must be engineer, artist or audience".into())); }
    let crew = is_crew(&state, id, uid, p).await?;
    // Without running the project you may only step down: engineer → artist, or out of the band.
    let stepping_down = uid == target && (role == "audience" || (role == "artist" && perms::is_engineer(&state.db, id, uid).await?));
    if !crew && !stepping_down { return Err(AppError::Forbidden); }
    apply_role(&state, &c, target, role).await?;
    let updated = channel_json(&state, id).await?;
    state.hub.emit_guild(c.guild_id.unwrap(), "CHANNEL_UPDATE", json!(updated));
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.role", "channel", Some(id), &c.name, json!({ "user": target, "role": role })).await;
    Ok(Json(updated))
}

async fn apply_role(state: &AppState, c: &crate::models::Channel, target: Uuid, role: &str) -> AppResult<()> {
    let member: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2").bind(c.guild_id).bind(target).fetch_optional(&state.db).await?;
    if member.is_none() { return Err(AppError::BadRequest("That user is not in the server".into())); }
    if role != "audience" {
        sqlx::query("INSERT INTO studio_engineers (channel_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (channel_id, user_id) DO UPDATE SET role = $3").bind(c.id).bind(target).bind(role).execute(&state.db).await?;
    } else {
        sqlx::query("DELETE FROM studio_engineers WHERE channel_id = $1 AND user_id = $2").bind(c.id).bind(target).execute(&state.db).await?;
    }
    if role != "audience" {
        // Being heard still needs Speak in the channel.
        if let Ok((_, tp)) = require_channel_perms(&state.db, c.id, target).await { if !perms::has(tp, perms::SPEAK) { return Err(AppError::BadRequest("That member cannot speak in this channel".into())); } }
    }
    let suppress = role == "audience";
    if let Some(vs) = state.hub.voice_update(target, |v| { if v.channel_id == c.id { v.suppress = suppress; v.request_to_speak = false; } }) {
        if vs.channel_id == c.id { broadcast(state, c, "VOICE_STATE_UPDATE", json!(vs)).await?; }
    }
    Ok(())
}

pub async fn config_of(db: &PgPool, id: Uuid) -> AppResult<crate::models::StudioConfig> {
    Ok(sqlx::query_as::<_, crate::models::StudioConfig>("SELECT bpm, beats, click, count_in, disarmed, project_id FROM studio_config WHERE channel_id = $1").bind(id).fetch_optional(db).await?.unwrap_or_default())
}

#[derive(Deserialize)]
struct ConfigReq { bpm: Option<i32>, beats: Option<i32>, click: Option<bool>, count_in: Option<i32> }

/// `PATCH /channels/:id/studio/config`: the console's tempo, beats per bar, metronome and count-in bars (engineers and
/// Manage Projects). Everyone in the studio gets the channel back via CHANNEL_UPDATE.
async fn set_config(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<ConfigReq>) -> AppResult<Json<crate::models::Channel>> {
    let (c, p) = studio_channel(&state.db, id, uid).await?;
    if !is_crew(&state, id, uid, p).await? { return Err(AppError::Forbidden); }
    let mut cfg = config_of(&state.db, id).await?;
    if let Some(v) = req.bpm { if !(40..=300).contains(&v) { return Err(AppError::BadRequest("Tempo must be 40 to 300 BPM".into())); } cfg.bpm = v; }
    if let Some(v) = req.beats { if !(1..=12).contains(&v) { return Err(AppError::BadRequest("Beats per bar must be 1 to 12".into())); } cfg.beats = v; }
    if let Some(v) = req.count_in { if !(0..=4).contains(&v) { return Err(AppError::BadRequest("Count-in must be 0 to 4 bars".into())); } cfg.count_in = v; }
    if let Some(v) = req.click { cfg.click = v; }
    sqlx::query("INSERT INTO studio_config (channel_id, bpm, beats, click, count_in) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (channel_id) DO UPDATE SET bpm = $2, beats = $3, click = $4, count_in = $5")
        .bind(id).bind(cfg.bpm).bind(cfg.beats).bind(cfg.click).bind(cfg.count_in).execute(&state.db).await?;
    // The open project keeps the tempo it is made at.
    if let Some(pid) = cfg.project_id { crate::routes::studio_daw::set_tempo(&state, pid, uid, cfg.bpm, cfg.beats).await?; }
    let updated = channel_json(&state, id).await?;
    state.hub.emit_guild(c.guild_id.unwrap(), "CHANNEL_UPDATE", json!(updated));
    Ok(Json(updated))
}

#[derive(Deserialize)]
struct ArmReq { armed: bool }

/// `PUT /channels/:id/studio/arm/:uid {armed}`: record-arm a band member (engineers and Manage Projects). Shared by
/// every engineer; changing it during a take punches that member in or out.
async fn set_arm(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>, Json(req): Json<ArmReq>) -> AppResult<Json<crate::models::Channel>> {
    let (c, p) = studio_channel(&state.db, id, uid).await?;
    if !is_crew(&state, id, uid, p).await? { return Err(AppError::Forbidden); }
    sqlx::query("INSERT INTO studio_config (channel_id) VALUES ($1) ON CONFLICT DO NOTHING").bind(id).execute(&state.db).await?;
    let q = if req.armed { "UPDATE studio_config SET disarmed = array_remove(disarmed, $2) WHERE channel_id = $1" } else { "UPDATE studio_config SET disarmed = array_append(array_remove(disarmed, $2), $2) WHERE channel_id = $1" };
    sqlx::query(q).bind(id).bind(target).execute(&state.db).await?;
    let updated = channel_json(&state, id).await?;
    state.hub.emit_guild(c.guild_id.unwrap(), "CHANNEL_UPDATE", json!(updated));
    Ok(Json(updated))
}

/// Older shape: PUT makes an engineer, DELETE demotes one to artist.
async fn set_engineer(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<Json<crate::models::Channel>> {
    set_role(State(state), AuthUser(uid), Path((id, target)), Json(RoleReq { role: "engineer".into() })).await
}
async fn clear_engineer(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<Json<crate::models::Channel>> {
    set_role(State(state), AuthUser(uid), Path((id, target)), Json(RoleReq { role: "artist".into() })).await
}

async fn list_sessions(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Session>>> {
    studio_channel(&state.db, id, uid).await?;
    Ok(Json(sessions_for(&state.db, id).await?))
}

#[derive(Deserialize)]
struct StartReq { #[serde(default)] name: String, armed: Option<Vec<Uuid>>, #[serde(default)] position_ms: i32, #[serde(default)] solo: bool }

/// The engineer starts a recording session: everyone in the channel learns the session id and server start time;
/// band members' clients begin recording their own mic and upload it as a track. The armed members are the band
/// minus the console's disarmed (or `armed`, when given). With a count-in, `started_at` is the downbeat after it: the
/// band hears the click from count-in and recording starts right away, so takes carry a little pre-roll.
async fn start_session(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<StartReq>) -> AppResult<(StatusCode, Json<Session>)> {
    let (c, _) = studio_channel(&state.db, id, uid).await?;
    // Anyone in the band may record a take alone; a take for the band is the engineers'.
    let in_band = state.hub.voice_state(uid).is_some_and(|v| v.channel_id == id && !v.suppress);
    if req.solo { if !in_band { return Err(AppError::BadRequest("Join the band to record".into())); } }
    else if !perms::is_engineer(&state.db, id, uid).await? { return Err(AppError::Forbidden); }
    let open: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM studio_sessions WHERE channel_id = $1 AND ended_at IS NULL").bind(id).fetch_optional(&state.db).await?;
    if open.is_some() { return Err(AppError::Conflict("A session is already recording".into())); }
    let name: String = { let n: String = req.name.trim().chars().take(80).collect(); if n.is_empty() { format!("Session {}", Utc::now().format("%Y-%m-%d %H:%M")) } else { n } };
    let cfg = config_of(&state.db, id).await?;
    let mut armed = if req.solo { vec![uid] } else { req.armed.clone().unwrap_or_else(|| state.hub.voice_states_for_channels(&[id]).into_iter().filter(|v| !v.suppress && !cfg.disarmed.contains(&v.user_id)).map(|v| v.user_id).collect()) };
    armed.sort(); armed.dedup(); armed.truncate(64);
    if armed.is_empty() { return Err(AppError::BadRequest("Arm at least one track".into())); }
    let count_in_ms = if cfg.count_in > 0 { cfg.count_in * cfg.beats * 60_000 / cfg.bpm } else { 0 };
    let started_at = Utc::now() + chrono::Duration::milliseconds(count_in_ms as i64);
    let sid = Uuid::now_v7();
    // With a project open the take records into it, from the playhead: everyone hears the project from there.
    let mut position_ms = if cfg.project_id.is_some() { req.position_ms.clamp(0, 4 * 3600 * 1000) } else { 0 };
    // The project's loop: loop recording (takes per pass, from the loop's start) or punch recording (only the range).
    let (mut la, mut lb, mut punch) = (None, None, false);
    if let Some(pid) = cfg.project_id {
        let r: Option<(bool, bool, Option<i32>, Option<i32>)> = sqlx::query_as("SELECT loop_on, punch_on, loop_start_ms, loop_end_ms FROM studio_projects WHERE id = $1").bind(pid).fetch_optional(&state.db).await?;
        if let Some((loop_on, punch_on, Some(a), Some(b))) = r { if (loop_on || punch_on) && b > a {
            la = Some(a); lb = Some(b); punch = punch_on;
            if !punch && (position_ms < a || position_ms >= b) { position_ms = a; }
        } }
    }
    let s = sqlx::query_as::<_, Session>(&format!("INSERT INTO studio_sessions (id, channel_id, guild_id, name, started_by, armed, started_at, bpm, beats, click, count_in_ms, project_id, position_ms, loop_start_ms, loop_end_ms, punch, solo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING {SESSION_COLS}"))
        .bind(sid).bind(id).bind(c.guild_id).bind(&name).bind(uid).bind(&armed).bind(started_at).bind(cfg.bpm).bind(cfg.beats).bind(cfg.click).bind(count_in_ms).bind(cfg.project_id).bind(position_ms)
        .bind(la).bind(lb).bind(punch).bind(req.solo).fetch_one(&state.db).await?;
    broadcast(&state, &c, "STUDIO_SESSION", json!({ "channel_id": id, "action": "start", "session_id": sid, "name": name, "started_at": s.started_at, "armed": armed, "bpm": s.bpm, "beats": s.beats, "click": s.click, "count_in_ms": count_in_ms, "project_id": cfg.project_id, "position_ms": position_ms, "loop_start_ms": la, "loop_end_ms": lb, "punch": punch, "solo": req.solo, "started_by": uid })).await?;
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.record", "channel", Some(id), &c.name, json!({ "session": sid })).await;
    Ok((StatusCode::CREATED, Json(s)))
}

async fn stop_session(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, sid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Session>> {
    let (c, p) = studio_channel(&state.db, id, uid).await?;
    let own: Option<(bool,)> = sqlx::query_as("SELECT solo FROM studio_sessions WHERE id = $1 AND started_by = $2").bind(sid).bind(uid).fetch_optional(&state.db).await?;
    if !own.is_some_and(|o| o.0) && !is_crew(&state, id, uid, p).await? { return Err(AppError::Forbidden); }
    let res = sqlx::query("UPDATE studio_sessions SET ended_at = now() WHERE id = $1 AND channel_id = $2 AND ended_at IS NULL").bind(sid).bind(id).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::NotFound("No recording session with that id".into())); }
    broadcast(&state, &c, "STUDIO_SESSION", json!({ "channel_id": id, "action": "stop", "session_id": sid })).await?;
    let s = sessions_for(&state.db, id).await?.into_iter().find(|s| s.id == sid).ok_or_else(|| AppError::NotFound("Session not found".into()))?;
    Ok(Json(s))
}

async fn delete_session(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, sid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    let (c, p) = studio_channel(&state.db, id, uid).await?;
    if !is_crew(&state, id, uid, p).await? { return Err(AppError::Forbidden); }
    // Takes used in a project stay (as audio of the studio's); the rest go with the session.
    sqlx::query("UPDATE studio_tracks SET session_id = NULL WHERE session_id = $1 AND EXISTS (SELECT 1 FROM studio_clips c WHERE c.audio_id = studio_tracks.id)").bind(sid).execute(&state.db).await?;
    let tracks: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM studio_tracks WHERE session_id = $1").bind(sid).fetch_all(&state.db).await?;
    let res = sqlx::query("DELETE FROM studio_sessions WHERE id = $1 AND channel_id = $2").bind(sid).bind(id).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::NotFound("Session not found".into())); }
    for (tid,) in tracks { let _ = tokio::fs::remove_file(track_path(&state, tid)).await; }
    broadcast(&state, &c, "STUDIO_UPDATE", json!({ "channel_id": id })).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct NewTrack { #[serde(default)] offset_ms: i32, content_type: Option<String>, #[serde(default)] latency_ms: i32, lane_id: Option<Uuid> }

/// A band member registers a track (clip) for the open session while armed.
async fn create_track(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(sid): Path<Uuid>, Json(req): Json<NewTrack>) -> AppResult<(StatusCode, Json<Track>)> {
    let sess: Option<(Uuid, Option<DateTime<Utc>>)> = sqlx::query_as("SELECT channel_id, ended_at FROM studio_sessions WHERE id = $1").bind(sid).fetch_optional(&state.db).await?;
    let Some((channel_id, ended)) = sess else { return Err(AppError::NotFound("Session not found".into())) };
    if ended.is_some() { return Err(AppError::BadRequest("That session has ended".into())); }
    let (c, _) = studio_channel(&state.db, channel_id, uid).await?;
    let vs = state.hub.voice_state(uid).filter(|v| v.channel_id == channel_id).ok_or_else(|| AppError::BadRequest("Join the studio first".into()))?;
    if vs.suppress { return Err(AppError::Forbidden); }
    // A take for a track needs the track armed; a member's take without one, the member not disarmed.
    if req.lane_id.is_none() {
        if config_of(&state.db, channel_id).await?.disarmed.contains(&uid) { return Err(AppError::BadRequest("Your track is not armed".into())); }
        // A member with tracks of their own records onto those (each armed one), not as a take of their own.
        let has: Option<(bool,)> = sqlx::query_as("SELECT true FROM studio_lanes l JOIN studio_projects p ON p.id = l.project_id WHERE p.channel_id = $1 AND l.user_id = $2 AND l.kind = 'audio' LIMIT 1").bind(channel_id).bind(uid).fetch_optional(&state.db).await?;
        if has.is_some() { return Err(AppError::BadRequest("Your track is not armed".into())); }
    }
    let solo: Option<(bool, Option<Uuid>)> = sqlx::query_as("SELECT solo, started_by FROM studio_sessions WHERE id = $1").bind(sid).fetch_optional(&state.db).await?;
    if solo.is_some_and(|(solo, by)| solo && by != Some(uid)) { return Err(AppError::BadRequest("Someone is recording alone".into())); }
    // A take for one of the project's tracks: it must be one of its audio tracks.
    if let Some(lane) = req.lane_id {
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM studio_lanes l JOIN studio_projects p ON p.id = l.project_id WHERE l.id = $1 AND p.channel_id = $2 AND l.kind = 'audio'").bind(lane).bind(channel_id).fetch_optional(&state.db).await?;
        if ok.is_none() { return Err(AppError::BadRequest("Record onto an audio track of this project".into())); }
        let armed: Option<(bool,)> = sqlx::query_as("SELECT armed FROM studio_lanes WHERE id = $1").bind(lane).fetch_optional(&state.db).await?;
        if !armed.is_some_and(|a| a.0) { return Err(AppError::BadRequest("That track is not armed".into())); }
    }
    // Punching out and back in gives a member several clips in one take, one open at a time per track.
    let open: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM studio_tracks WHERE session_id = $1 AND user_id = $2 AND NOT done AND lane_id IS NOT DISTINCT FROM $3").bind(sid).bind(uid).bind(req.lane_id).fetch_optional(&state.db).await?;
    if open.is_some() { return Err(AppError::Conflict("You are already recording in this session".into())); }
    let ct = req.content_type.filter(|t| t.starts_with("audio/")).unwrap_or_else(|| "audio/webm".into());
    let tid = Uuid::now_v7();
    // What the recording client measured from hearing the music to its mic capturing what was played back: the take is
    // that much late, so it is placed that much earlier.
    let latency = req.latency_ms.clamp(0, 1000);
    sqlx::query("INSERT INTO studio_tracks (id, session_id, user_id, content_type, offset_ms, channel_id, latency_ms, lane_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)").bind(tid).bind(sid).bind(uid).bind(&ct).bind(req.offset_ms.clamp(-120_000, 600_000) - latency).bind(channel_id).bind(latency).bind(req.lane_id).execute(&state.db).await?;
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

/// Append a MediaRecorder chunk (raw bytes) to the caller's track. The studio hears `STUDIO_TRACK` with the new size so
/// the engineer's console can draw the take growing.
async fn append_chunk(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((sid, tid)): Path<(Uuid, Uuid)>, body: Bytes) -> AppResult<Json<serde_json::Value>> {
    let size = own_open_track(&state.db, sid, tid, uid).await?;
    if size + body.len() as i64 > MAX_TRACK_BYTES { return Err(AppError::BadRequest("Track too large".into())); }
    let mut f = tokio::fs::OpenOptions::new().append(true).create(true).open(track_path(&state, tid)).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    f.write_all(&body).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    f.flush().await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let (new_size,): (i64,) = sqlx::query_as("UPDATE studio_tracks SET size = size + $3 WHERE id = $1 AND session_id = $2 RETURNING size").bind(tid).bind(sid).bind(body.len() as i64).fetch_one(&state.db).await?;
    let (channel_id,): (Uuid,) = sqlx::query_as("SELECT channel_id FROM studio_sessions WHERE id = $1").bind(sid).fetch_one(&state.db).await?;
    if let Ok(c) = channel_json(&state, channel_id).await { broadcast(&state, &c, "STUDIO_TRACK", json!({ "channel_id": channel_id, "session_id": sid, "track_id": tid, "user_id": uid, "size": new_size })).await?; }
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
    if let Ok(c) = channel_json(&state, channel_id.0).await {
        broadcast(&state, &c, "STUDIO_UPDATE", json!({ "channel_id": channel_id.0 })).await?;
        // The take is in either way; placing it in the project is a bonus that must not fail the upload.
        if let Err(e) = crate::routes::studio_daw::place_take(&state, &c, sid, &t).await { tracing::warn!(error = ?e, track = %tid, "could not place take in project"); }
    }
    Ok(Json(t))
}

/// Tracks are served to anyone who can see the channel.
async fn serve_track(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(tid): Path<Uuid>) -> AppResult<Response> {
    let row: Option<(Uuid, String, i64)> = sqlx::query_as("SELECT COALESCE(t.channel_id, s.channel_id), t.content_type, t.size FROM studio_tracks t LEFT JOIN studio_sessions s ON s.id = t.session_id WHERE t.id = $1").bind(tid).fetch_optional(&state.db).await?;
    let Some((channel_id, ct, size)) = row else { return Err(AppError::NotFound("Track not found".into())) };
    studio_channel(&state.db, channel_id, uid).await?;
    let file = tokio::fs::File::open(track_path(&state, tid)).await.map_err(|_| AppError::NotFound("Track file missing".into()))?;
    let mut resp = Response::new(Body::from_stream(tokio_util::io::ReaderStream::new(file)));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&ct).unwrap_or(HeaderValue::from_static("audio/webm")));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(size as u64));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&format!("inline; filename=\"track-{tid}\"")).unwrap());
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=0"));
    Ok(resp.into_response())
}

/// A project's session: a live gathering in its voice room, from when an engineer starts it to when one ends it.
#[derive(Debug, Serialize, FromRow)]
pub struct Gathering {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub title: String,
    pub started_by: Option<Uuid>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    /// Everyone who was in the room while it ran.
    pub people: Vec<Uuid>,
    /// Takes recorded during it.
    #[sqlx(default)]
    pub takes: i64,
}
const GATHERING_SELECT: &str = "SELECT g.id, g.channel_id, g.title, g.started_by, g.started_at, g.ended_at, g.people,
    (SELECT COUNT(*) FROM studio_tracks t JOIN studio_sessions s ON s.id = t.session_id WHERE s.channel_id = g.channel_id AND t.done AND s.started_at >= g.started_at AND s.started_at <= COALESCE(g.ended_at, now())) AS takes
    FROM studio_gatherings g";

/// `GET /channels/:id/studio/gatherings`: the project's sessions, the one running (if any) first.
async fn list_gatherings(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Gathering>>> {
    studio_channel(&state.db, id, uid).await?;
    Ok(Json(sqlx::query_as::<_, Gathering>(&format!("{GATHERING_SELECT} WHERE g.channel_id = $1 ORDER BY g.ended_at IS NULL DESC, g.started_at DESC LIMIT 50")).bind(id).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
struct GatheringReq { #[serde(default)] title: String }

/// `POST /channels/:id/studio/gatherings {title}`: an engineer (or Manage Projects) starts a session. Those already in
/// the room are noted, and everyone who joins later.
async fn start_gathering(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<GatheringReq>) -> AppResult<(StatusCode, Json<Gathering>)> {
    let (c, p) = studio_channel(&state.db, id, uid).await?;
    if !is_crew(&state, id, uid, p).await? { return Err(AppError::Forbidden); }
    let title: String = { let n: String = req.title.trim().chars().filter(|c| !c.is_control()).take(100).collect(); if n.is_empty() { format!("Session {}", Utc::now().format("%Y-%m-%d")) } else { n } };
    let mut people: Vec<Uuid> = state.hub.voice_states_for_channels(&[id]).into_iter().map(|v| v.user_id).collect();
    people.push(uid); people.sort(); people.dedup();
    let gid = Uuid::now_v7();
    let res = sqlx::query("INSERT INTO studio_gatherings (id, channel_id, title, started_by, people) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING").bind(gid).bind(id).bind(&title).bind(uid).bind(&people).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::Conflict("A session is already running".into())); }
    let g = sqlx::query_as::<_, Gathering>(&format!("{GATHERING_SELECT} WHERE g.id = $1")).bind(gid).fetch_one(&state.db).await?;
    broadcast(&state, &c, "STUDIO_GATHERING", json!({ "channel_id": id, "gathering": g })).await?;
    gathering_changed(&state, &c).await;
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.session_start", "channel", Some(id), &title, json!({ "session": gid })).await;
    Ok((StatusCode::CREATED, Json(g)))
}

/// `POST /channels/:id/studio/gatherings/:gid/end`: its starter, an engineer or Manage Projects ends it.
async fn end_gathering(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, gid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Gathering>> {
    let (c, p) = studio_channel(&state.db, id, uid).await?;
    let starter: Option<(Option<Uuid>,)> = sqlx::query_as("SELECT started_by FROM studio_gatherings WHERE id = $1 AND channel_id = $2").bind(gid).bind(id).fetch_optional(&state.db).await?;
    let Some((by,)) = starter else { return Err(AppError::NotFound("Session not found".into())) };
    if by != Some(uid) && !is_crew(&state, id, uid, p).await? { return Err(AppError::Forbidden); }
    sqlx::query("UPDATE studio_gatherings SET ended_at = COALESCE(ended_at, now()) WHERE id = $1").bind(gid).execute(&state.db).await?;
    let g = sqlx::query_as::<_, Gathering>(&format!("{GATHERING_SELECT} WHERE g.id = $1")).bind(gid).fetch_one(&state.db).await?;
    broadcast(&state, &c, "STUDIO_GATHERING", json!({ "channel_id": id, "gathering": g })).await?;
    gathering_changed(&state, &c).await;
    Ok(Json(g))
}

/// The studio's list shows which projects have a session on.
async fn gathering_changed(state: &AppState, c: &crate::models::Channel) {
    if let Some(sid) = c.parent_id { if let Ok(studio) = channel_json(state, sid).await { let _ = broadcast(state, &studio, "STUDIO_PROJECTS", json!({ "channel_id": sid })).await; } }
}

/// Someone joined a project's voice room: note them in its running session.
pub async fn note_in_gathering(db: &PgPool, channel_id: Uuid, user: Uuid) {
    let _ = sqlx::query("UPDATE studio_gatherings SET people = array_append(people, $2) WHERE channel_id = $1 AND ended_at IS NULL AND NOT ($2 = ANY(people))").bind(channel_id).bind(user).execute(db).await;
}

/// Sessions nobody ended run at most a day.
pub async fn end_stale_gatherings(state: AppState) {
    loop {
        let _ = sqlx::query("UPDATE studio_gatherings SET ended_at = started_at + interval '24 hours' WHERE ended_at IS NULL AND started_at < now() - interval '24 hours'").execute(&state.db).await;
        tokio::time::sleep(std::time::Duration::from_secs(600)).await;
    }
}
