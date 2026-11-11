//! The studio as a DAW. A studio has projects (songs) and one of them is open for everyone in it. A project holds
//! lanes (mixer tracks: name, colour, gain, pan, mute, solo, and whose recordings land there) and clips, each a window
//! onto an audio file of the studio's (a recorded take or an imported file) placed on the timeline, with its own gain
//! and fades.
//!
//! Editing is live and shared: every change is an op (`project`, `lane.put`, `lane.del`, `clip.put`, `clip.del`) sent
//! to `POST /studio/projects/:pid/ops`, applied in one transaction and broadcast to the studio as `STUDIO_PROJECT`
//! with the resulting entities and the project's new version, so every editor sees it at once. Puts are upserts by a
//! client-chosen id carrying only the fields that change, which makes undo a matter of sending the inverse ops. Last
//! write wins per field. The engineers, Manage Channels and everyone in the band (in the studio, not in the audience)
//! may edit; anyone who can see the studio may read.
//!
//! A take recorded while a project is open plays the project for everyone from the playhead (the backing) and lands
//! as a clip on each recording member's lane when their track finishes uploading (`place_take`).

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::studio::{broadcast, channel_json, config_of, is_crew, studio_channel, track_path, Track, TRACK_SELECT},
    state::AppState,
};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post, put},
    Json, Router,
};
use chrono::{DateTime, Utc};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, Postgres, Transaction};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

/// An imported audio file's cap (about ten minutes of 48 kHz 24-bit stereo WAV).
pub const MAX_IMPORT_BYTES: usize = 200 * 1024 * 1024;
/// Timeline and clip lengths stop at four hours.
const MAX_MS: i32 = 4 * 3600 * 1000;
const MAX_OPS: usize = 500;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/studio/projects", get(list_projects).post(create_project))
        .route("/channels/:id/studio/project", put(open_project))
        .route("/channels/:id/studio/audio", post(import_audio).layer(DefaultBodyLimit::max(MAX_IMPORT_BYTES + 1024)))
        .route("/studio/projects/:pid", get(get_project).delete(delete_project))
        .route("/studio/projects/:pid/ops", post(apply_ops))
}

#[derive(Debug, Serialize, FromRow, Clone)]
pub struct Project {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub name: String,
    pub bpm: i32,
    pub beats: i32,
    pub master_gain: f32,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: i64,
}

#[derive(Debug, Serialize, FromRow, Clone)]
pub struct Lane {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub position: f32,
    pub gain: f32,
    pub pan: f32,
    pub mute: bool,
    pub solo: bool,
    pub user_id: Option<Uuid>,
}

#[derive(Debug, Serialize, FromRow, Clone)]
pub struct Clip {
    pub id: Uuid,
    pub project_id: Uuid,
    pub lane_id: Uuid,
    pub audio_id: Uuid,
    pub start_ms: i32,
    pub in_ms: i32,
    pub length_ms: i32,
    pub gain: f32,
    pub fade_in_ms: i32,
    pub fade_out_ms: i32,
    pub muted: bool,
    pub created_by: Option<Uuid>,
}

const PROJECT_COLS: &str = "id, channel_id, name, bpm, beats, master_gain, created_by, created_at, updated_at, version";
const LANE_COLS: &str = "id, project_id, name, color, position, gain, pan, mute, solo, user_id";
const CLIP_COLS: &str = "id, project_id, lane_id, audio_id, start_ms, in_ms, length_ms, gain, fade_in_ms, fade_out_ms, muted, created_by";

/// The engineers, Manage Channels, and the band (in the studio's voice, not in its audience).
async fn can_edit(state: &AppState, channel_id: Uuid, uid: Uuid, p: u64) -> AppResult<bool> {
    if is_crew(state, channel_id, uid, p).await? { return Ok(true); }
    Ok(state.hub.voice_state(uid).is_some_and(|v| v.channel_id == channel_id && !v.suppress))
}

async fn editor(state: &AppState, channel_id: Uuid, uid: Uuid) -> AppResult<crate::models::Channel> {
    let (c, p) = studio_channel(&state.db, channel_id, uid).await?;
    if !can_edit(state, channel_id, uid, p).await? { return Err(AppError::Forbidden); }
    Ok(c)
}

async fn project_row(db: &sqlx::PgPool, pid: Uuid) -> AppResult<Project> {
    sqlx::query_as::<_, Project>(&format!("SELECT {PROJECT_COLS} FROM studio_projects WHERE id = $1")).bind(pid).fetch_optional(db).await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))
}

fn clean_name(s: &str, fallback: &str) -> String {
    let n: String = s.trim().chars().filter(|c| !c.is_control()).take(80).collect();
    if n.is_empty() { fallback.into() } else { n }
}

async fn list_projects(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Project>>> {
    studio_channel(&state.db, id, uid).await?;
    Ok(Json(sqlx::query_as::<_, Project>(&format!("SELECT {PROJECT_COLS} FROM studio_projects WHERE channel_id = $1 ORDER BY updated_at DESC LIMIT 100")).bind(id).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
struct NewProject { #[serde(default)] name: String, #[serde(default = "yes")] open: bool }
fn yes() -> bool { true }

/// `POST /channels/:id/studio/projects {name, open}`: a new empty project at the studio's tempo, opened for everyone
/// unless `open` is false.
async fn create_project(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<NewProject>) -> AppResult<(StatusCode, Json<Project>)> {
    let c = editor(&state, id, uid).await?;
    let cfg = config_of(&state.db, id).await?;
    let pid = Uuid::now_v7();
    let name = clean_name(&req.name, &format!("Song {}", Utc::now().format("%Y-%m-%d %H:%M")));
    let p = sqlx::query_as::<_, Project>(&format!("INSERT INTO studio_projects (id, channel_id, name, bpm, beats, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING {PROJECT_COLS}"))
        .bind(pid).bind(id).bind(&name).bind(cfg.bpm).bind(cfg.beats).bind(uid).fetch_one(&state.db).await?;
    if req.open { set_open(&state, &c, Some(&p)).await?; }
    broadcast(&state, &c, "STUDIO_PROJECTS", json!({ "channel_id": id })).await?;
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.project_create", "channel", Some(id), &c.name, json!({ "project": pid, "name": name })).await;
    Ok((StatusCode::CREATED, Json(p)))
}

/// Make `p` the studio's open project (or none), its tempo the studio's.
async fn set_open(state: &AppState, c: &crate::models::Channel, p: Option<&Project>) -> AppResult<()> {
    sqlx::query("INSERT INTO studio_config (channel_id) VALUES ($1) ON CONFLICT DO NOTHING").bind(c.id).execute(&state.db).await?;
    match p {
        Some(p) => sqlx::query("UPDATE studio_config SET project_id = $2, bpm = $3, beats = $4 WHERE channel_id = $1").bind(c.id).bind(p.id).bind(p.bpm).bind(p.beats).execute(&state.db).await?,
        None => sqlx::query("UPDATE studio_config SET project_id = NULL WHERE channel_id = $1").bind(c.id).execute(&state.db).await?,
    };
    let updated = channel_json(state, c.id).await?;
    state.hub.emit_guild(c.guild_id.unwrap(), "CHANNEL_UPDATE", json!(updated));
    Ok(())
}

#[derive(Deserialize)]
struct OpenReq { project_id: Option<Uuid> }

/// `PUT /channels/:id/studio/project {project_id}`: open a project for everyone in the studio (null closes it). Not
/// while a take is recording.
async fn open_project(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<OpenReq>) -> AppResult<Json<crate::models::Channel>> {
    let c = editor(&state, id, uid).await?;
    let recording: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM studio_sessions WHERE channel_id = $1 AND ended_at IS NULL").bind(id).fetch_optional(&state.db).await?;
    if recording.is_some() { return Err(AppError::Conflict("Stop recording first".into())); }
    let p = match req.project_id {
        Some(pid) => { let p = project_row(&state.db, pid).await?; if p.channel_id != id { return Err(AppError::NotFound("Project not found".into())); } Some(p) }
        None => None,
    };
    set_open(&state, &c, p.as_ref()).await?;
    Ok(Json(channel_json(&state, id).await?))
}

#[derive(Serialize)]
pub struct ProjectFull { project: Project, lanes: Vec<Lane>, clips: Vec<Clip>, audio: Vec<Track> }

async fn get_project(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>) -> AppResult<Json<ProjectFull>> {
    let project = project_row(&state.db, pid).await?;
    studio_channel(&state.db, project.channel_id, uid).await?;
    let lanes = sqlx::query_as::<_, Lane>(&format!("SELECT {LANE_COLS} FROM studio_lanes WHERE project_id = $1 ORDER BY position, created_at")).bind(pid).fetch_all(&state.db).await?;
    let clips = sqlx::query_as::<_, Clip>(&format!("SELECT {CLIP_COLS} FROM studio_clips WHERE project_id = $1 ORDER BY start_ms")).bind(pid).fetch_all(&state.db).await?;
    let mut audio = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.id IN (SELECT audio_id FROM studio_clips WHERE project_id = $1)")).bind(pid).fetch_all(&state.db).await?;
    for a in &mut audio { a.url = format!("/api/studio/tracks/{}", a.id); }
    Ok(Json(ProjectFull { project, lanes, clips, audio }))
}

async fn delete_project(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>) -> AppResult<StatusCode> {
    let project = project_row(&state.db, pid).await?;
    let (c, p) = studio_channel(&state.db, project.channel_id, uid).await?;
    if !is_crew(&state, c.id, uid, p).await? && project.created_by != Some(uid) { return Err(AppError::Forbidden); }
    let was_open = config_of(&state.db, c.id).await?.project_id == Some(pid);
    sqlx::query("DELETE FROM studio_projects WHERE id = $1").bind(pid).execute(&state.db).await?;
    if was_open { set_open(&state, &c, None).await?; }
    broadcast(&state, &c, "STUDIO_PROJECTS", json!({ "channel_id": c.id })).await?;
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.project_delete", "channel", Some(c.id), &c.name, json!({ "project": pid, "name": project.name })).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct LanePatch { id: Uuid, name: Option<String>, color: Option<String>, position: Option<f32>, gain: Option<f32>, pan: Option<f32>, mute: Option<bool>, solo: Option<bool>, user_id: Option<Uuid> }

#[derive(Deserialize)]
struct ClipPatch { id: Uuid, lane_id: Option<Uuid>, audio_id: Option<Uuid>, start_ms: Option<i32>, in_ms: Option<i32>, length_ms: Option<i32>, gain: Option<f32>, fade_in_ms: Option<i32>, fade_out_ms: Option<i32>, muted: Option<bool> }

#[derive(Deserialize)]
#[serde(tag = "op")]
enum Op {
    #[serde(rename = "project")]
    Project { name: Option<String>, bpm: Option<i32>, beats: Option<i32>, master_gain: Option<f32> },
    #[serde(rename = "lane.put")]
    LanePut { lane: LanePatch },
    #[serde(rename = "lane.del")]
    LaneDel { id: Uuid },
    #[serde(rename = "clip.put")]
    ClipPut { clip: ClipPatch },
    #[serde(rename = "clip.del")]
    ClipDel { id: Uuid },
}

#[derive(Deserialize)]
struct OpsReq { ops: Vec<Op> }

fn range<T: PartialOrd + Copy>(v: T, lo: T, hi: T, what: &str) -> AppResult<T> {
    if v >= lo && v <= hi { Ok(v) } else { Err(AppError::BadRequest(format!("{what} is out of range"))) }
}
fn finite(v: f32, lo: f32, hi: f32, what: &str) -> AppResult<f32> { if v.is_finite() { range(v, lo, hi, what) } else { Err(AppError::BadRequest(format!("{what} is not a number"))) } }
fn color(c: &str) -> AppResult<Option<String>> {
    if c.is_empty() { return Ok(None); }
    if c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit()) { Ok(Some(c.to_ascii_lowercase())) } else { Err(AppError::BadRequest("Colour must be #rrggbb".into())) }
}

/// Apply one op inside the transaction; the entity it leaves (as broadcast), or what it removed.
async fn apply(tx: &mut Transaction<'_, Postgres>, project: &mut Project, uid: Uuid, op: Op) -> AppResult<serde_json::Value> {
    let pid = project.id;
    match op {
        Op::Project { name, bpm, beats, master_gain } => {
            if let Some(n) = name { project.name = clean_name(&n, &project.name); }
            if let Some(v) = bpm { project.bpm = range(v, 40, 300, "Tempo")?; }
            if let Some(v) = beats { project.beats = range(v, 1, 12, "Beats per bar")?; }
            if let Some(v) = master_gain { project.master_gain = finite(v, 0.0, 2.0, "Master level")?; }
            sqlx::query("UPDATE studio_projects SET name = $2, bpm = $3, beats = $4, master_gain = $5 WHERE id = $1")
                .bind(pid).bind(&project.name).bind(project.bpm).bind(project.beats).bind(project.master_gain).execute(&mut **tx).await?;
            Ok(json!({ "op": "project", "project": { "name": project.name, "bpm": project.bpm, "beats": project.beats, "master_gain": project.master_gain } }))
        }
        Op::LanePut { lane: l } => {
            let cur = sqlx::query_as::<_, Lane>(&format!("SELECT {LANE_COLS} FROM studio_lanes WHERE id = $1")).bind(l.id).fetch_optional(&mut **tx).await?;
            if cur.as_ref().is_some_and(|c| c.project_id != pid) { return Err(AppError::BadRequest("That lane is in another project".into())); }
            let mut v = cur.unwrap_or(Lane { id: l.id, project_id: pid, name: "Track".into(), color: None, position: 0.0, gain: 1.0, pan: 0.0, mute: false, solo: false, user_id: None });
            if let Some(n) = l.name { v.name = clean_name(&n, "Track"); }
            if let Some(c) = l.color { v.color = color(&c)?; }
            if let Some(x) = l.position { v.position = finite(x, -1e6, 1e6, "Position")?; }
            if let Some(x) = l.gain { v.gain = finite(x, 0.0, 2.0, "Volume")?; }
            if let Some(x) = l.pan { v.pan = finite(x, -1.0, 1.0, "Pan")?; }
            if let Some(x) = l.mute { v.mute = x; }
            if let Some(x) = l.solo { v.solo = x; }
            if let Some(x) = l.user_id { v.user_id = Some(x); }
            sqlx::query("INSERT INTO studio_lanes (id, project_id, name, color, position, gain, pan, mute, solo, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (id) DO UPDATE SET name = $3, color = $4, position = $5, gain = $6, pan = $7, mute = $8, solo = $9, user_id = $10")
                .bind(v.id).bind(pid).bind(&v.name).bind(&v.color).bind(v.position).bind(v.gain).bind(v.pan).bind(v.mute).bind(v.solo).bind(v.user_id).execute(&mut **tx).await?;
            Ok(json!({ "op": "lane.put", "lane": v }))
        }
        Op::LaneDel { id } => {
            sqlx::query("DELETE FROM studio_lanes WHERE id = $1 AND project_id = $2").bind(id).bind(pid).execute(&mut **tx).await?;
            Ok(json!({ "op": "lane.del", "id": id }))
        }
        Op::ClipPut { clip: c } => {
            let cur = sqlx::query_as::<_, Clip>(&format!("SELECT {CLIP_COLS} FROM studio_clips WHERE id = $1")).bind(c.id).fetch_optional(&mut **tx).await?;
            if cur.as_ref().is_some_and(|x| x.project_id != pid) { return Err(AppError::BadRequest("That clip is in another project".into())); }
            let mut v = match cur {
                Some(x) => x,
                None => {
                    let (Some(lane_id), Some(audio_id), Some(length_ms)) = (c.lane_id, c.audio_id, c.length_ms) else { return Err(AppError::BadRequest("A new clip needs a lane, audio and a length".into())) };
                    Clip { id: c.id, project_id: pid, lane_id, audio_id, start_ms: 0, in_ms: 0, length_ms, gain: 1.0, fade_in_ms: 0, fade_out_ms: 0, muted: false, created_by: Some(uid) }
                }
            };
            if let Some(x) = c.lane_id { v.lane_id = x; }
            if let Some(x) = c.audio_id { v.audio_id = x; }
            if let Some(x) = c.start_ms { v.start_ms = range(x, 0, MAX_MS, "Clip start")?; }
            if let Some(x) = c.in_ms { v.in_ms = range(x, 0, MAX_MS, "Clip offset")?; }
            if let Some(x) = c.length_ms { v.length_ms = range(x, 1, MAX_MS, "Clip length")?; }
            if let Some(x) = c.gain { v.gain = finite(x, 0.0, 4.0, "Clip gain")?; }
            if let Some(x) = c.fade_in_ms { v.fade_in_ms = range(x, 0, MAX_MS, "Fade in")?; }
            if let Some(x) = c.fade_out_ms { v.fade_out_ms = range(x, 0, MAX_MS, "Fade out")?; }
            if let Some(x) = c.muted { v.muted = x; }
            // Fades fit in the clip together.
            v.fade_in_ms = v.fade_in_ms.min(v.length_ms);
            v.fade_out_ms = v.fade_out_ms.min(v.length_ms - v.fade_in_ms);
            let lane: Option<(Uuid,)> = sqlx::query_as("SELECT project_id FROM studio_lanes WHERE id = $1").bind(v.lane_id).fetch_optional(&mut **tx).await?;
            if lane.map(|l| l.0) != Some(pid) { return Err(AppError::BadRequest("No such lane in this project".into())); }
            let audio: Option<(Option<Uuid>, Option<i32>)> = sqlx::query_as("SELECT COALESCE(t.channel_id, s.channel_id), t.duration_ms FROM studio_tracks t LEFT JOIN studio_sessions s ON s.id = t.session_id WHERE t.id = $1").bind(v.audio_id).fetch_optional(&mut **tx).await?;
            let Some((Some(ch), dur)) = audio else { return Err(AppError::BadRequest("No such audio in this studio".into())) };
            if ch != project.channel_id { return Err(AppError::BadRequest("No such audio in this studio".into())); }
            // A little slack: durations are measured on the client.
            if let Some(d) = dur.filter(|d| *d > 0) { if v.in_ms + v.length_ms > d + 250 { return Err(AppError::BadRequest("The clip runs past the end of its audio".into())); } }
            sqlx::query("INSERT INTO studio_clips (id, project_id, lane_id, audio_id, start_ms, in_ms, length_ms, gain, fade_in_ms, fade_out_ms, muted, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (id) DO UPDATE SET lane_id = $3, audio_id = $4, start_ms = $5, in_ms = $6, length_ms = $7, gain = $8, fade_in_ms = $9, fade_out_ms = $10, muted = $11")
                .bind(v.id).bind(pid).bind(v.lane_id).bind(v.audio_id).bind(v.start_ms).bind(v.in_ms).bind(v.length_ms).bind(v.gain).bind(v.fade_in_ms).bind(v.fade_out_ms).bind(v.muted).bind(v.created_by).execute(&mut **tx).await?;
            Ok(json!({ "op": "clip.put", "clip": v }))
        }
        Op::ClipDel { id } => {
            sqlx::query("DELETE FROM studio_clips WHERE id = $1 AND project_id = $2").bind(id).bind(pid).execute(&mut **tx).await?;
            Ok(json!({ "op": "clip.del", "id": id }))
        }
    }
}

/// Apply ops to a project as one change, and tell the studio. The new version and what the ops left.
async fn commit(state: &AppState, c: &crate::models::Channel, pid: Uuid, uid: Uuid, ops: Vec<Op>) -> AppResult<(i64, Vec<serde_json::Value>)> {
    let mut tx = state.db.begin().await?;
    let mut project = sqlx::query_as::<_, Project>(&format!("SELECT {PROJECT_COLS} FROM studio_projects WHERE id = $1 FOR UPDATE")).bind(pid).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;
    let tempo = (project.bpm, project.beats);
    let mut out = Vec::with_capacity(ops.len());
    for op in ops { out.push(apply(&mut tx, &mut project, uid, op).await?); }
    let (version,): (i64,) = sqlx::query_as("UPDATE studio_projects SET version = version + 1, updated_at = now() WHERE id = $1 RETURNING version").bind(pid).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    // The open project's tempo is the studio's metronome.
    if (project.bpm, project.beats) != tempo && config_of(&state.db, c.id).await?.project_id == Some(pid) {
        sqlx::query("UPDATE studio_config SET bpm = $2, beats = $3 WHERE channel_id = $1").bind(c.id).bind(project.bpm).bind(project.beats).execute(&state.db).await?;
        let updated = channel_json(state, c.id).await?;
        state.hub.emit_guild(c.guild_id.unwrap(), "CHANNEL_UPDATE", json!(updated));
    }
    broadcast(state, c, "STUDIO_PROJECT", json!({ "channel_id": c.id, "project_id": pid, "version": version, "by": uid, "ops": out })).await?;
    Ok((version, out))
}

/// `POST /studio/projects/:pid/ops {ops}`: apply edits (all or none).
async fn apply_ops(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>, Json(req): Json<OpsReq>) -> AppResult<Json<serde_json::Value>> {
    if req.ops.is_empty() || req.ops.len() > MAX_OPS { return Err(AppError::BadRequest(format!("Send 1 to {MAX_OPS} ops"))); }
    let project = project_row(&state.db, pid).await?;
    let c = editor(&state, project.channel_id, uid).await?;
    let (version, ops) = commit(&state, &c, pid, uid, req.ops).await?;
    Ok(Json(json!({ "version": version, "ops": ops })))
}

/// The studio's tempo changed on the console: the open project follows.
pub async fn set_tempo(state: &AppState, pid: Uuid, uid: Uuid, bpm: i32, beats: i32) -> AppResult<()> {
    let project = project_row(&state.db, pid).await?;
    if (project.bpm, project.beats) == (bpm, beats) { return Ok(()); }
    let c = channel_json(state, project.channel_id).await?;
    commit(state, &c, pid, uid, vec![Op::Project { name: None, bpm: Some(bpm), beats: Some(beats), master_gain: None }]).await?;
    Ok(())
}

/// A take recorded into a project finished uploading: put it on its member's lane (made for them if they have none),
/// where they played it. The count-in's pre-roll is trimmed off, so the clip starts at the playhead it was recorded
/// from.
pub async fn place_take(state: &AppState, c: &crate::models::Channel, sid: Uuid, t: &Track) -> AppResult<()> {
    let Some((Some(pid), position)) = sqlx::query_as::<_, (Option<Uuid>, i32)>("SELECT project_id, position_ms FROM studio_sessions WHERE id = $1").bind(sid).fetch_optional(&state.db).await? else { return Ok(()) };
    let (Some(uid), Some(dur)) = (t.user_id, t.duration_ms.filter(|d| *d > 0)) else { return Ok(()) };
    let mut ops = Vec::new();
    let lane: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM studio_lanes WHERE project_id = $1 AND user_id = $2 ORDER BY position, created_at LIMIT 1").bind(pid).bind(uid).fetch_optional(&state.db).await?;
    let lane_id = match lane {
        Some((id,)) => id,
        None => {
            let (next,): (Option<f32>,) = sqlx::query_as("SELECT (MAX(position) + 1)::real FROM studio_lanes WHERE project_id = $1").bind(pid).fetch_one(&state.db).await?;
            let id = Uuid::now_v7();
            ops.push(Op::LanePut { lane: LanePatch { id, name: Some(t.display_name.clone()), color: None, position: Some(next.unwrap_or(0.0)), gain: None, pan: None, mute: None, solo: None, user_id: Some(uid) } });
            id
        }
    };
    let mut start = position + t.offset_ms;
    let mut skip = 0;
    if start < position { skip = position - start; start = position; }
    if dur - skip <= 0 { return Ok(()); }
    ops.push(Op::ClipPut { clip: ClipPatch { id: Uuid::now_v7(), lane_id: Some(lane_id), audio_id: Some(t.id), start_ms: Some(start), in_ms: Some(skip), length_ms: Some(dur - skip), gain: None, fade_in_ms: None, fade_out_ms: None, muted: None } });
    commit(state, c, pid, uid, ops).await?;
    Ok(())
}

#[derive(Deserialize)]
struct ImportQuery { #[serde(default)] name: String, duration_ms: Option<i32> }

/// `POST /channels/:id/studio/audio?name=&duration_ms=` with the file as the body (an audio/* type): import an audio
/// file into the studio, to place on the timeline as clips.
async fn import_audio(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Query(q): Query<ImportQuery>, headers: HeaderMap, body: Body) -> AppResult<(StatusCode, Json<Track>)> {
    let c = editor(&state, id, uid).await?;
    let ct = headers.get(axum::http::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if !ct.starts_with("audio/") && !matches!(ct.as_str(), "video/webm" | "video/mp4" | "video/ogg") { return Err(AppError::BadRequest("That is not an audio file".into())); }
    let tid = Uuid::now_v7();
    let path = track_path(&state, tid);
    tokio::fs::create_dir_all(&state.config.upload_dir).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let mut f = tokio::fs::File::create(&path).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let mut size = 0usize;
    let mut stream = body.into_data_stream();
    let res: AppResult<()> = async {
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| AppError::BadRequest("The upload was interrupted".into()))?;
            size += chunk.len();
            if size > MAX_IMPORT_BYTES { return Err(AppError::BadRequest(format!("Audio files can be up to {} MB", MAX_IMPORT_BYTES / 1024 / 1024))); }
            f.write_all(&chunk).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
        }
        f.flush().await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
        if size == 0 { return Err(AppError::BadRequest("The file is empty".into())); }
        Ok(())
    }.await;
    if let Err(e) = res { let _ = tokio::fs::remove_file(&path).await; return Err(e); }
    let name = clean_name(&q.name, "Audio");
    sqlx::query("INSERT INTO studio_tracks (id, session_id, channel_id, user_id, content_type, size, duration_ms, done, kind, name) VALUES ($1, NULL, $2, $3, $4, $5, $6, true, 'import', $7)")
        .bind(tid).bind(id).bind(uid).bind(&ct).bind(size as i64).bind(q.duration_ms.map(|d| d.clamp(0, MAX_MS))).bind(&name).execute(&state.db).await?;
    let mut t = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.id = $1")).bind(tid).fetch_one(&state.db).await?;
    t.url = format!("/api/studio/tracks/{tid}");
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.import", "channel", Some(id), &c.name, json!({ "audio": tid, "name": name, "size": size })).await;
    Ok((StatusCode::CREATED, Json(t)))
}
