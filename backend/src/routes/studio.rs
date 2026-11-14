//! Recording Studio: a studio channel holds projects, each a channel of kind 'project' under it with its own voice
//! room, chat, console and band: engineers (run recordings, manage the band) and artists (edit and record); everyone
//! else in its voice room is the audience. Recording is multitrack and client-side: when a take starts every armed
//! band member's client records its own mic and streams chunks up as its own track, so each artist ends up as a clean
//! separate file, placed in the project (studio_daw).
//!
//! A take is lossless where the browser can capture PCM: the client sends 24-bit samples by byte offset (so a piece
//! sent twice, or out of turn, changes nothing), the server keeps the file a valid WAV after every piece and tells
//! the take's length from its size. Takes whose recorders have gone are finished here (`sweep_takes`).

use crate::{auth::AuthUser, error::{AppError, AppResult}, perms, routes::channels::require_channel_perms, state::AppState};
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use uuid::Uuid;

/// Per-track cap of a compressed take (about half an hour of Opus at 128 kbps).
pub const MAX_TRACK_BYTES: i64 = 30 * 1024 * 1024;
/// The longest take.
pub const MAX_TAKE_SECS: i64 = 30 * 60;
/// A PCM take's file starts with a WAV header of this many bytes; the client counts its offsets after it.
const WAV_HEADER: i64 = 44;
/// A take nobody has been recording for this long is ended: its starter may have gone without stopping it.
const ABANDONED_SECS: f64 = 45.0;
/// A track that has received nothing for this long is finished with what arrived.
const IDLE_SECS: f64 = 90.0;
/// How long after it began a finished PCM track still takes the rest of its audio from a recorder that was away.
const LATE_HOURS: i64 = 24;

/// What a PCM take holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pcm { pub rate: i32, pub channels: i16, pub bits: i16 }

impl Pcm {
    /// Bytes of one frame (a sample of every channel).
    pub fn frame(self) -> i64 { self.channels as i64 * (self.bits as i64 / 8) }
    /// The most audio bytes a take may hold.
    pub fn max_bytes(self) -> i64 { MAX_TAKE_SECS * self.rate as i64 * self.frame() }
    /// How long `data` bytes of audio play, in whole ms.
    pub fn duration_ms(self, data: i64) -> i32 { ((data.max(0) / self.frame()) * 1000 / self.rate as i64).min(i32::MAX as i64) as i32 }
}

/// The 44-byte header of a PCM WAV file holding `data` bytes of audio.
pub fn wav_header(f: Pcm, data: i64) -> [u8; 44] {
    let data = data.clamp(0, u32::MAX as i64 - 36) as u32;
    let align = f.frame() as u16;
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data).to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes());
    h[22..24].copy_from_slice(&(f.channels as u16).to_le_bytes());
    h[24..28].copy_from_slice(&(f.rate as u32).to_le_bytes());
    h[28..32].copy_from_slice(&(f.rate as u32 * align as u32).to_le_bytes());
    h[32..34].copy_from_slice(&align.to_le_bytes());
    h[34..36].copy_from_slice(&(f.bits as u16).to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data.to_le_bytes());
    h
}

/// What to do with a piece of a PCM take.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Append {
    /// It continues the take: write it.
    Write,
    /// It does not start where the take ends (sent twice, or after a piece that was lost): the take holds this many
    /// bytes, and the client carries on from there.
    At(i64),
    /// It does not hold whole frames.
    Ragged,
    /// The take would run past the limit.
    TooLong,
}

/// Whether `len` bytes offered at `offset` continue a take holding `stored` bytes of `f`.
pub fn append_at(f: Pcm, stored: i64, offset: i64, len: i64) -> Append {
    if offset != stored { return Append::At(stored); }
    if len % f.frame() != 0 { return Append::Ragged; }
    if stored + len > f.max_bytes() { return Append::TooLong; }
    Append::Write
}

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
        .route("/studio/sessions/:sid/tracks/:tid", get(track_status))
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
    /// A lossless take's format (all `None` for a compressed one).
    pub sample_rate: Option<i32>,
    pub channels: Option<i16>,
    pub bits: Option<i16>,
    /// Captured from the call's microphone path with its processing on.
    pub processed: bool,
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

pub const TRACK_SELECT: &str = "SELECT t.id, t.session_id, t.user_id, t.content_type, t.size, t.duration_ms, t.offset_ms, t.done, t.created_at, t.kind, t.name, t.latency_ms, t.lane_id, t.sample_rate, t.channels, t.bits, t.processed, COALESCE(u.display_name, 'Unknown') AS display_name
    FROM studio_tracks t LEFT JOIN users u ON u.id = t.user_id";
const SESSION_COLS: &str = "id, channel_id, guild_id, name, started_by, started_at, ended_at, armed, bpm, beats, click, count_in_ms, project_id, position_ms, loop_start_ms, loop_end_ms, punch, solo";

/// Is this `studio_tracks` row's audio referred to: by a clip, by a sampler, or by a saved version holding either?
pub const AUDIO_IN_USE: &str = "(EXISTS (SELECT 1 FROM studio_clips c WHERE c.audio_id = studio_tracks.id)
    OR EXISTS (SELECT 1 FROM studio_lanes l WHERE l.instrument->>'audio_id' = studio_tracks.id::text)
    OR EXISTS (SELECT 1 FROM studio_versions v, jsonb_array_elements(CASE WHEN jsonb_typeof(v.data->'clips') = 'array' THEN v.data->'clips' ELSE '[]'::jsonb END) x WHERE x->>'audio_id' = studio_tracks.id::text)
    OR EXISTS (SELECT 1 FROM studio_versions v, jsonb_array_elements(CASE WHEN jsonb_typeof(v.data->'lanes') = 'array' THEN v.data->'lanes' ELSE '[]'::jsonb END) x WHERE x->'instrument'->>'audio_id' = studio_tracks.id::text))";

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
    broadcast(&state, &c, "CHANNEL_UPDATE", json!(updated)).await?;
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.role", "channel", Some(id), &c.name, json!({ "user": target, "role": role })).await;
    Ok(Json(updated))
}

async fn apply_role(state: &AppState, c: &crate::models::Channel, target: Uuid, role: &str) -> AppResult<()> {
    let member: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2").bind(c.guild_id).bind(target).fetch_optional(&state.db).await?;
    if member.is_none() { return Err(AppError::BadRequest("That user is not in the server".into())); }
    if role != "audience" {
        // Being heard still needs Speak in the channel: checked before anything is stored.
        if let Ok((_, tp)) = require_channel_perms(&state.db, c.id, target).await { if !perms::has(tp, perms::SPEAK) { return Err(AppError::BadRequest("That member cannot speak in this channel".into())); } }
        sqlx::query("INSERT INTO studio_engineers (channel_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (channel_id, user_id) DO UPDATE SET role = $3").bind(c.id).bind(target).bind(role).execute(&state.db).await?;
    } else {
        sqlx::query("DELETE FROM studio_engineers WHERE channel_id = $1 AND user_id = $2").bind(c.id).bind(target).execute(&state.db).await?;
    }
    let suppress = role == "audience";
    if let Some(vs) = state.hub.voice_update(target, |v| { if v.channel_id == c.id { v.suppress = suppress; v.request_to_speak = false; } }) {
        if vs.channel_id == c.id { broadcast(state, c, "VOICE_STATE_UPDATE", json!(vs)).await?; }
    }
    Ok(())
}

/// The console's settings. Tempo and beats per bar are the project's (it owns them); the console keeps the metronome,
/// the count-in bars and who is disarmed.
pub async fn config_of(db: &PgPool, id: Uuid) -> AppResult<crate::models::StudioConfig> {
    Ok(sqlx::query_as::<_, crate::models::StudioConfig>("SELECT COALESCE(p.bpm, c.bpm) AS bpm, COALESCE(p.beats, c.beats) AS beats, c.click, c.count_in, c.disarmed, c.project_id
        FROM studio_config c LEFT JOIN studio_projects p ON p.id = c.project_id WHERE c.channel_id = $1").bind(id).fetch_optional(db).await?.unwrap_or_default())
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
    // The tempo is the project's: set there (which tells everyone), and read from there.
    if let Some(pid) = cfg.project_id { crate::routes::studio_daw::set_tempo(&state, pid, uid, cfg.bpm, cfg.beats).await?; }
    let updated = channel_json(&state, id).await?;
    broadcast(&state, &c, "CHANNEL_UPDATE", json!(updated)).await?;
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
    broadcast(&state, &c, "CHANNEL_UPDATE", json!(updated)).await?;
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
    if armed.is_empty() {
        // Takes are recorded on the devices of the people in the session: with no one in it there is no one to record.
        let present = state.hub.voice_states_for_channels(&[id]).iter().any(|v| !v.suppress);
        return Err(AppError::BadRequest(if present { "Arm at least one track" } else { "Join the session to record: takes are recorded by the people in it" }.into()));
    }
    let sid = Uuid::now_v7();
    // With a project open the take records into it, from the playhead: everyone hears the project from there.
    let mut position_ms = if cfg.project_id.is_some() { req.position_ms.clamp(0, 4 * 3600 * 1000) } else { 0 };
    // The project's loop: loop recording (takes per pass, from the loop's start) or punch recording (only the range).
    let (mut la, mut lb, mut punch) = (None, None, false);
    // The take's tempo is the project's where the take starts (its tempo map may have changed it by then).
    let (mut bpm, mut beats) = (cfg.bpm, cfg.beats);
    if let Some(pid) = cfg.project_id {
        let r: Option<(bool, bool, Option<i32>, Option<i32>, i32, i32, sqlx::types::Json<serde_json::Value>)> = sqlx::query_as("SELECT loop_on, punch_on, loop_start_ms, loop_end_ms, bpm, beats, tempo_map FROM studio_projects WHERE id = $1").bind(pid).fetch_optional(&state.db).await?;
        if let Some((loop_on, punch_on, a, b, pb, pn, map)) = r {
            if let (Some(a), Some(b)) = (a, b) { if (loop_on || punch_on) && b > a {
                la = Some(a); lb = Some(b); punch = punch_on;
                if !punch && (position_ms < a || position_ms >= b) { position_ms = a; }
            } }
            (bpm, beats) = crate::routes::studio_daw::tempo_at(pb, pn, &map.0, position_ms);
        }
    }
    let count_in_ms = if cfg.count_in > 0 { cfg.count_in * beats * 60_000 / bpm } else { 0 };
    let started_at = Utc::now() + chrono::Duration::milliseconds(count_in_ms as i64);
    let s = sqlx::query_as::<_, Session>(&format!("INSERT INTO studio_sessions (id, channel_id, guild_id, name, started_by, armed, started_at, bpm, beats, click, count_in_ms, project_id, position_ms, loop_start_ms, loop_end_ms, punch, solo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING {SESSION_COLS}"))
        .bind(sid).bind(id).bind(c.guild_id).bind(&name).bind(uid).bind(&armed).bind(started_at).bind(bpm).bind(beats).bind(cfg.click).bind(count_in_ms).bind(cfg.project_id).bind(position_ms)
        .bind(la).bind(lb).bind(punch).bind(req.solo).fetch_one(&state.db).await
        // One take at a time in a project: the index decides when two start at once.
        .map_err(|e| match e { sqlx::Error::Database(d) if d.is_unique_violation() => AppError::Conflict("A session is already recording".into()), e => e.into() })?;
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
    let open: Option<(bool,)> = sqlx::query_as("SELECT ended_at IS NULL FROM studio_sessions WHERE id = $1 AND channel_id = $2").bind(sid).bind(id).fetch_optional(&state.db).await?;
    match open {
        None => return Err(AppError::NotFound("Session not found".into())),
        Some((true,)) => return Err(AppError::Conflict("Stop the take before deleting it".into())),
        Some((false,)) => {}
    }
    // Takes still referred to stay (as audio of the project's): by a clip, by a sampler, or by a saved version that
    // would restore either. The rest go with the session.
    sqlx::query(&format!("UPDATE studio_tracks SET session_id = NULL WHERE session_id = $1 AND {AUDIO_IN_USE}")).bind(sid).execute(&state.db).await?;
    let tracks: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM studio_tracks WHERE session_id = $1").bind(sid).fetch_all(&state.db).await?;
    let res = sqlx::query("DELETE FROM studio_sessions WHERE id = $1 AND channel_id = $2").bind(sid).bind(id).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::NotFound("Session not found".into())); }
    for (tid,) in tracks { let _ = tokio::fs::remove_file(track_path(&state, tid)).await; }
    broadcast(&state, &c, "STUDIO_UPDATE", json!({ "channel_id": id })).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct NewTrack {
    /// Chosen by the recorder, so asking again after a lost answer gives the same track.
    id: Option<Uuid>,
    #[serde(default)] offset_ms: i32, content_type: Option<String>, #[serde(default)] latency_ms: i32, lane_id: Option<Uuid>,
    /// A PCM take (`content_type` audio/wav) says what it sends: its sample rate, channels (1 or 2) and bits (24).
    sample_rate: Option<i32>, channels: Option<i16>, bits: Option<i16>, #[serde(default)] processed: bool }

/// A band member registers a track (clip) for the open session while armed.
async fn create_track(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(sid): Path<Uuid>, Json(req): Json<NewTrack>) -> AppResult<(StatusCode, Json<Track>)> {
    let sess: Option<(Uuid, Option<DateTime<Utc>>)> = sqlx::query_as("SELECT channel_id, ended_at FROM studio_sessions WHERE id = $1").bind(sid).fetch_optional(&state.db).await?;
    let Some((channel_id, ended)) = sess else { return Err(AppError::NotFound("Session not found".into())) };
    if let Some(id) = req.id {
        let have: Option<(Option<Uuid>, Option<Uuid>)> = sqlx::query_as("SELECT user_id, session_id FROM studio_tracks WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
        if let Some((owner, session)) = have {
            if owner != Some(uid) || session != Some(sid) { return Err(AppError::Conflict("That track exists".into())); }
            let mut t = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.id = $1")).bind(id).fetch_one(&state.db).await?;
            t.url = format!("/api/studio/tracks/{id}");
            return Ok((StatusCode::OK, Json(t)));
        }
    }
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
    // A take for one of the project's tracks: it must be one of its audio tracks, and the member's own.
    if let Some(lane) = req.lane_id {
        let row: Option<(Option<Uuid>, bool)> = sqlx::query_as("SELECT l.user_id, l.armed FROM studio_lanes l JOIN studio_projects p ON p.id = l.project_id WHERE l.id = $1 AND p.channel_id = $2 AND l.kind = 'audio'").bind(lane).bind(channel_id).fetch_optional(&state.db).await?;
        let Some((owner, armed)) = row else { return Err(AppError::BadRequest("Record onto an audio track of this project".into())) };
        if owner != Some(uid) { return Err(AppError::Forbidden); }
        if !armed { return Err(AppError::BadRequest("That track is not armed".into())); }
    }
    // Punching out and back in gives a member several clips in one take, one open at a time per track.
    let open: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM studio_tracks WHERE session_id = $1 AND user_id = $2 AND NOT done AND lane_id IS NOT DISTINCT FROM $3").bind(sid).bind(uid).bind(req.lane_id).fetch_optional(&state.db).await?;
    if open.is_some() { return Err(AppError::Conflict("You are already recording in this session".into())); }
    let ct = req.content_type.filter(|t| t.starts_with("audio/")).unwrap_or_else(|| "audio/webm".into());
    let pcm = if ct == "audio/wav" {
        let f = Pcm { rate: req.sample_rate.unwrap_or(0), channels: req.channels.unwrap_or(0), bits: req.bits.unwrap_or(0) };
        if !(8000..=192_000).contains(&f.rate) || !(1..=2).contains(&f.channels) || f.bits != 24 { return Err(AppError::BadRequest("A PCM take is 24-bit, mono or stereo".into())); }
        Some(f)
    } else { None };
    let tid = req.id.unwrap_or_else(Uuid::now_v7);
    // What the recording client measured from hearing the music to its mic capturing what was played back: the take is
    // that much late, so it is placed that much earlier.
    let latency = req.latency_ms.clamp(0, 1000);
    let head: Vec<u8> = pcm.map(|f| wav_header(f, 0).to_vec()).unwrap_or_default();
    sqlx::query("INSERT INTO studio_tracks (id, session_id, user_id, content_type, offset_ms, channel_id, latency_ms, lane_id, size, sample_rate, channels, bits, processed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)")
        .bind(tid).bind(sid).bind(uid).bind(&ct).bind(req.offset_ms.clamp(-120_000, 600_000) - latency).bind(channel_id).bind(latency).bind(req.lane_id)
        .bind(head.len() as i64).bind(pcm.map(|f| f.rate)).bind(pcm.map(|f| f.channels)).bind(pcm.map(|f| f.bits)).bind(req.processed).execute(&state.db).await?;
    tokio::fs::create_dir_all(&state.config.upload_dir).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    tokio::fs::write(track_path(&state, tid), &head).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let mut t = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.id = $1")).bind(tid).fetch_one(&state.db).await?;
    t.url = format!("/api/studio/tracks/{tid}");
    broadcast(&state, &c, "STUDIO_UPDATE", json!({ "channel_id": channel_id })).await?;
    Ok((StatusCode::CREATED, Json(t)))
}

/// The caller's own track in a session.
struct OwnTrack { done: bool, size: i64, pcm: Option<Pcm>, created_at: DateTime<Utc>, duration_ms: Option<i32> }

async fn own_track(db: &PgPool, sid: Uuid, tid: Uuid, uid: Uuid) -> AppResult<OwnTrack> {
    let row: Option<(Option<Uuid>, bool, i64, Option<i32>, Option<i16>, Option<i16>, DateTime<Utc>, Option<i32>)> = sqlx::query_as("SELECT user_id, done, size, sample_rate, channels, bits, created_at, duration_ms FROM studio_tracks WHERE id = $1 AND session_id = $2").bind(tid).bind(sid).fetch_optional(db).await?;
    let Some((owner, done, size, rate, channels, bits, created_at, duration_ms)) = row else { return Err(AppError::NotFound("Track not found".into())) };
    if owner != Some(uid) { return Err(AppError::Forbidden); }
    let pcm = match (rate, channels, bits) { (Some(rate), Some(channels), Some(bits)) => Some(Pcm { rate, channels, bits }), _ => None };
    Ok(OwnTrack { done, size, pcm, created_at, duration_ms })
}

fn io(e: std::io::Error) -> AppError { AppError::Other(anyhow::anyhow!(e)) }

/// 409 with how much of the take the server holds, for a piece that does not continue it.
fn held(received: i64, done: bool) -> Response {
    (StatusCode::CONFLICT, Json(json!({ "error": "That is not where the take continues", "received": received, "done": done }))).into_response()
}

/// `GET /studio/sessions/:sid/tracks/:tid`: how much of the caller's take has arrived (a recorder that was away asks
/// before sending the rest).
async fn track_status(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((sid, tid)): Path<(Uuid, Uuid)>) -> AppResult<Json<serde_json::Value>> {
    let t = own_track(&state.db, sid, tid, uid).await?;
    Ok(Json(json!({ "size": t.size, "received": if t.pcm.is_some() { t.size - WAV_HEADER } else { t.size }, "done": t.done })))
}

#[derive(Deserialize)]
struct ChunkQuery { offset: Option<i64> }

/// Append a piece (raw bytes) to the caller's track. A PCM take says where the piece goes (`?offset=`, in bytes of
/// audio): it is written only where the take ends, and anything else is answered 409 with what the server holds, so
/// a piece sent again after a lost answer does no harm. The studio hears `STUDIO_TRACK` with the new size so the
/// engineer's console can draw the take growing.
async fn append_chunk(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((sid, tid)): Path<(Uuid, Uuid)>, Query(q): Query<ChunkQuery>, body: Bytes) -> AppResult<Response> {
    let t = own_track(&state.db, sid, tid, uid).await?;
    let len = body.len() as i64;
    let new_size = match t.pcm {
        Some(f) => {
            let Some(offset) = q.offset else { return Err(AppError::BadRequest("A PCM take is sent by offset".into())) };
            let stored = t.size - WAV_HEADER;
            // A finished take still takes the rest from a recorder that was away when the server finished it.
            if t.done && Utc::now() - t.created_at > chrono::Duration::hours(LATE_HOURS) { return Ok(held(stored, true)); }
            match append_at(f, stored, offset, len) {
                Append::Write => {}
                Append::At(n) => return Ok(held(n, t.done)),
                Append::Ragged => return Err(AppError::BadRequest("A piece holds whole frames".into())),
                Append::TooLong => return Err(AppError::BadRequest("Take too long".into())),
            }
            if len == 0 { return Ok(Json(json!({ "size": t.size, "received": stored })).into_response()); }
            // Written at its place (not appended), then the header: two requests with the same piece write the same
            // bytes, and the file is a whole WAV after every piece.
            let mut file = tokio::fs::OpenOptions::new().write(true).create(true).truncate(false).open(track_path(&state, tid)).await.map_err(io)?;
            file.seek(std::io::SeekFrom::Start((WAV_HEADER + offset) as u64)).await.map_err(io)?;
            file.write_all(&body).await.map_err(io)?;
            file.seek(std::io::SeekFrom::Start(0)).await.map_err(io)?;
            file.write_all(&wav_header(f, stored + len)).await.map_err(io)?;
            file.flush().await.map_err(io)?;
            let dur = f.duration_ms(stored + len);
            let moved: Option<(i64,)> = sqlx::query_as("UPDATE studio_tracks SET size = size + $3, chunk_at = now(), duration_ms = CASE WHEN done THEN $5 ELSE duration_ms END WHERE id = $1 AND session_id = $2 AND size = $4 RETURNING size")
                .bind(tid).bind(sid).bind(len).bind(t.size).bind(dur).fetch_optional(&state.db).await?;
            // Another request with this piece got there first.
            let Some((size,)) = moved else {
                let (size, done): (i64, bool) = sqlx::query_as("SELECT size, done FROM studio_tracks WHERE id = $1").bind(tid).fetch_one(&state.db).await?;
                return Ok(held(size - WAV_HEADER, done));
            };
            if t.done {
                let (channel_id,): (Uuid,) = sqlx::query_as("SELECT channel_id FROM studio_sessions WHERE id = $1").bind(sid).fetch_one(&state.db).await?;
                if let Ok(c) = channel_json(&state, channel_id).await {
                    let track = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.id = $1")).bind(tid).fetch_one(&state.db).await?;
                    if let Err(e) = crate::routes::studio_daw::extend_take(&state, &c, sid, &track, t.duration_ms.unwrap_or(0)).await { tracing::warn!(error = ?e, track = %tid, "could not extend take in project"); }
                    broadcast(&state, &c, "STUDIO_UPDATE", json!({ "channel_id": channel_id })).await?;
                }
            }
            size
        }
        None => {
            if t.done { return Err(AppError::BadRequest("Track already finished".into())); }
            if t.size + len > MAX_TRACK_BYTES { return Err(AppError::BadRequest("Track too large".into())); }
            let mut f = tokio::fs::OpenOptions::new().append(true).create(true).open(track_path(&state, tid)).await.map_err(io)?;
            f.write_all(&body).await.map_err(io)?;
            f.flush().await.map_err(io)?;
            let (size,): (i64,) = sqlx::query_as("UPDATE studio_tracks SET size = size + $3, chunk_at = now() WHERE id = $1 AND session_id = $2 RETURNING size").bind(tid).bind(sid).bind(len).fetch_one(&state.db).await?;
            size
        }
    };
    let (channel_id,): (Uuid,) = sqlx::query_as("SELECT channel_id FROM studio_sessions WHERE id = $1").bind(sid).fetch_one(&state.db).await?;
    if let Ok(c) = channel_json(&state, channel_id).await { broadcast(&state, &c, "STUDIO_TRACK", json!({ "channel_id": channel_id, "session_id": sid, "track_id": tid, "user_id": uid, "size": new_size })).await?; }
    Ok(Json(json!({ "size": new_size, "received": if t.pcm.is_some() { new_size - WAV_HEADER } else { new_size } })).into_response())
}

/// Finish a track that is still open, and put it in the project: a PCM take's length is told from its size, a
/// compressed one's is `duration_ms` (what its recorder measured). `None` when it was finished already.
async fn finalize(state: &AppState, tid: Uuid, duration_ms: Option<i32>) -> AppResult<Option<Track>> {
    let row: Option<(Option<Uuid>, i64, Option<i16>)> = sqlx::query_as("UPDATE studio_tracks SET done = true,
        duration_ms = CASE WHEN bits IS NOT NULL THEN (((size - 44) / (channels * (bits / 8))) * 1000 / sample_rate)::int ELSE $2 END
        WHERE id = $1 AND NOT done RETURNING session_id, size, bits").bind(tid).bind(duration_ms.map(|d| d.max(0))).fetch_optional(&state.db).await?;
    let Some((sid, size, bits)) = row else { return Ok(None) };
    // Anything past what was acknowledged is a piece whose write was cut short.
    if bits.is_some() { if let Ok(f) = tokio::fs::OpenOptions::new().write(true).open(track_path(state, tid)).await { let _ = f.set_len(size as u64).await; } }
    let mut t = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.id = $1")).bind(tid).fetch_one(&state.db).await?;
    t.url = format!("/api/studio/tracks/{tid}");
    let Some(sid) = sid else { return Ok(Some(t)) };
    let channel_id: (Uuid,) = sqlx::query_as("SELECT channel_id FROM studio_sessions WHERE id = $1").bind(sid).fetch_one(&state.db).await?;
    if let Ok(c) = channel_json(state, channel_id.0).await {
        // The take is in either way; placing it in the project is a bonus that must not fail the upload.
        if let Err(e) = crate::routes::studio_daw::place_take(state, &c, sid, &t).await { tracing::warn!(error = ?e, track = %tid, "could not place take in project"); }
        broadcast(state, &c, "STUDIO_UPDATE", json!({ "channel_id": channel_id.0 })).await?;
    }
    Ok(Some(t))
}

#[derive(Deserialize)]
struct FinishReq { duration_ms: Option<i32>, bytes: Option<i64> }

/// The recorder has sent everything. A PCM take says how many bytes that was (`bytes`): if the server holds fewer
/// it answers 409 with what it holds and the recorder sends the rest first. Finishing a PCM take twice is fine.
async fn finish_track(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((sid, tid)): Path<(Uuid, Uuid)>, Json(req): Json<FinishReq>) -> AppResult<Response> {
    let t = own_track(&state.db, sid, tid, uid).await?;
    if t.pcm.is_some() {
        let stored = t.size - WAV_HEADER;
        if req.bytes.is_some_and(|b| b > stored) { return Ok(held(stored, t.done)); }
    } else if t.done { return Err(AppError::BadRequest("Track already finished".into())); }
    let track = match finalize(&state, tid, req.duration_ms).await? {
        Some(x) => x,
        None => { let mut x = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.id = $1")).bind(tid).fetch_one(&state.db).await?; x.url = format!("/api/studio/tracks/{tid}"); x }
    };
    Ok(Json(track).into_response())
}

/// Takes whose people have gone: a take nobody is recording any more (its starter left without stopping it, or it
/// has run past the limit) is ended, so the next one can start; a track that has stopped receiving is finished with
/// what arrived and put in the project. A recorder that comes back later still sends the rest (`append_chunk`).
pub async fn sweep_takes(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        let ended: Vec<(Uuid, Uuid)> = sqlx::query_as("UPDATE studio_sessions s SET ended_at = now() WHERE s.ended_at IS NULL AND (s.started_at < now() - make_interval(secs => $1)
            OR (s.started_at < now() - make_interval(secs => $2) AND NOT EXISTS (SELECT 1 FROM studio_tracks t WHERE t.session_id = s.id AND NOT t.done AND COALESCE(t.chunk_at, t.created_at) > now() - make_interval(secs => $2))))
            RETURNING s.id, s.channel_id").bind((MAX_TAKE_SECS + 60) as f64).bind(ABANDONED_SECS).fetch_all(&state.db).await.unwrap_or_default();
        for (sid, channel_id) in ended {
            if let Ok(c) = channel_json(&state, channel_id).await { let _ = broadcast(&state, &c, "STUDIO_SESSION", json!({ "channel_id": channel_id, "action": "stop", "session_id": sid })).await; }
        }
        // A compressed take's length, with its recorder gone, is how long its pieces kept coming.
        let idle: Vec<(Uuid, i32)> = sqlx::query_as("SELECT id, (EXTRACT(EPOCH FROM (COALESCE(chunk_at, created_at) - created_at)) * 1000)::int FROM studio_tracks
            WHERE NOT done AND kind = 'take' AND COALESCE(chunk_at, created_at) < now() - make_interval(secs => $1)").bind(IDLE_SECS).fetch_all(&state.db).await.unwrap_or_default();
        for (tid, ms) in idle {
            if let Err(e) = finalize(&state, tid, Some(ms)).await { tracing::warn!(error = ?e, track = %tid, "could not finish idle take"); }
        }
    }
}

/// Tracks are served to anyone who can see the channel.
async fn serve_track(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(tid): Path<Uuid>) -> AppResult<Response> {
    let row: Option<(Uuid, String, i64)> = sqlx::query_as("SELECT COALESCE(t.channel_id, s.channel_id), t.content_type, t.size FROM studio_tracks t LEFT JOIN studio_sessions s ON s.id = t.session_id WHERE t.id = $1").bind(tid).fetch_optional(&state.db).await?;
    let Some((channel_id, ct, size)) = row else { return Err(AppError::NotFound("Track not found".into())) };
    studio_channel(&state.db, channel_id, uid).await?;
    let file = tokio::fs::File::open(track_path(&state, tid)).await.map_err(|_| AppError::NotFound("Track file missing".into()))?;
    let mut resp = Response::new(Body::from_stream(tokio_util::io::ReaderStream::new(file.take(size.max(0) as u64))));
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

#[cfg(test)]
mod tests {
    use super::*;

    const STEREO: Pcm = Pcm { rate: 48_000, channels: 2, bits: 24 };
    const MONO: Pcm = Pcm { rate: 48_000, channels: 1, bits: 24 };

    #[test]
    fn a_piece_is_written_only_where_the_take_ends() {
        assert_eq!(append_at(STEREO, 0, 0, 288_000), Append::Write);
        assert_eq!(append_at(STEREO, 288_000, 288_000, 288_000), Append::Write);
        // Sent again after its answer was lost: nothing is written, and the client learns where the take is.
        assert_eq!(append_at(STEREO, 576_000, 288_000, 288_000), Append::At(576_000));
        // Sent after a piece that never arrived.
        assert_eq!(append_at(STEREO, 288_000, 576_000, 288_000), Append::At(288_000));
        assert_eq!(append_at(STEREO, 288_000, -6, 288_000), Append::At(288_000));
    }

    #[test]
    fn a_piece_holds_whole_frames_and_fits_the_limit() {
        assert_eq!(append_at(STEREO, 0, 0, 5), Append::Ragged);
        assert_eq!(append_at(MONO, 0, 0, 4), Append::Ragged);
        assert_eq!(append_at(MONO, 0, 0, 3), Append::Write);
        let max = STEREO.max_bytes();
        assert_eq!(max, 30 * 60 * 48_000 * 6);
        assert_eq!(append_at(STEREO, max - 6, max - 6, 6), Append::Write);
        assert_eq!(append_at(STEREO, max, max, 6), Append::TooLong);
    }

    #[test]
    fn length_is_told_from_size() {
        assert_eq!(STEREO.duration_ms(0), 0);
        assert_eq!(STEREO.duration_ms(48_000 * 6), 1000);
        assert_eq!(MONO.duration_ms(48_000 * 3 * 60), 60_000);
        // Whole frames only, whole milliseconds only.
        assert_eq!(MONO.duration_ms(48 * 3 + 2), 1);
        assert_eq!(MONO.duration_ms(47 * 3), 0);
        assert_eq!(Pcm { rate: 44_100, channels: 2, bits: 24 }.duration_ms(44_100 * 6 * 3), 3000);
    }

    #[test]
    fn the_header_describes_the_audio() {
        let h = wav_header(STEREO, 288_000);
        assert_eq!(&h[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(h[4..8].try_into().unwrap()), 36 + 288_000);
        assert_eq!(&h[8..16], b"WAVEfmt ");
        assert_eq!(u16::from_le_bytes(h[20..22].try_into().unwrap()), 1);
        assert_eq!(u16::from_le_bytes(h[22..24].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(h[24..28].try_into().unwrap()), 48_000);
        assert_eq!(u32::from_le_bytes(h[28..32].try_into().unwrap()), 288_000);
        assert_eq!(u16::from_le_bytes(h[32..34].try_into().unwrap()), 6);
        assert_eq!(u16::from_le_bytes(h[34..36].try_into().unwrap()), 24);
        assert_eq!(&h[36..40], b"data");
        assert_eq!(u32::from_le_bytes(h[40..44].try_into().unwrap()), 288_000);
        assert_eq!(wav_header(MONO, 0)[40..44], [0, 0, 0, 0]);
    }
}
