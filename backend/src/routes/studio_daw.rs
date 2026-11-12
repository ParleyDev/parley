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
    perms,
    routes::studio::{broadcast, channel_json, config_of, is_crew, studio_channel, studio_container, track_path, Track, TRACK_SELECT},
    state::AppState,
};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{types::Json as SqlJson, FromRow, Postgres, Transaction};
use serde_json::Value;
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
        .route("/channels/:id/studio/audio", get(list_audio).post(import_audio).layer(DefaultBodyLimit::max(MAX_IMPORT_BYTES + 1024)))
        .route("/studio/projects/:pid", get(get_project).patch(update_project).delete(delete_project))
        .route("/studio/projects/:pid/ops", post(apply_ops))
        .route("/studio/projects/:pid/presence", post(presence))
        .route("/studio/projects/:pid/comments", get(list_comments).post(add_comment))
        .route("/studio/comments/:cid", axum::routing::patch(resolve_comment).delete(delete_comment))
        .route("/studio/projects/:pid/versions", get(list_versions).post(save_version))
        .route("/studio/versions/:vid/restore", post(restore_version))
        .route("/studio/versions/:vid", axum::routing::delete(delete_version))
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
    /// The master bus's insert effects.
    pub master_effects: SqlJson<Value>,
    /// Tempo and time signature changes: [{bar, bpm, beats}] (bar 0 is the project's own).
    pub tempo_map: SqlJson<Value>,
    pub loop_on: bool,
    pub loop_start_ms: Option<i32>,
    pub loop_end_ms: Option<i32>,
    /// Recording keeps only what falls in the loop range.
    pub punch_on: bool,
    /// [{id, ms, name}]
    pub markers: SqlJson<Value>,
    /// Where it stands in its studio's list: writing, tracking, mixing, done (or empty).
    pub tag: String,
    pub archived_at: Option<DateTime<Utc>>,
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
    /// audio (holds clips) or bus (a return the others send to).
    pub kind: String,
    /// Insert effects in order: [{id, type, on, params: {name: number}}].
    pub effects: SqlJson<Value>,
    /// Send levels to buses: {bus lane id: 0..2}.
    pub sends: SqlJson<Value>,
    /// Breakpoints per parameter: {"gain" | "pan" | "send:<bus>" | "fx:<effect>:<param>": [[ms, value], ...]}.
    pub automation: SqlJson<Value>,
    /// Where it goes: a bus lane, or the master (None).
    pub output_id: Option<Uuid>,
    /// Shifts its clips in time (a latency fix), ms.
    pub nudge_ms: i32,
    /// A MIDI track's instrument: {type: synth | drums | sampler, params, audio_id?, root?}.
    pub instrument: Option<SqlJson<Value>>,
    /// When someone last made it theirs: their takes land on their most recently claimed lane.
    pub claimed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, FromRow, Clone)]
pub struct Clip {
    pub id: Uuid,
    pub project_id: Uuid,
    pub lane_id: Uuid,
    /// The audio it plays; None for a MIDI clip.
    pub audio_id: Option<Uuid>,
    pub start_ms: i32,
    pub in_ms: i32,
    pub length_ms: i32,
    pub gain: f32,
    pub fade_in_ms: i32,
    pub fade_out_ms: i32,
    pub muted: bool,
    pub created_by: Option<Uuid>,
    /// A MIDI clip's notes: [{p, t, d, v}] (pitch, start and length in ms from the clip's start, velocity).
    pub notes: Option<SqlJson<Value>>,
    /// Takes of one loop recording: one plays, the others are muted alternatives.
    pub group_id: Option<Uuid>,
}

const PROJECT_COLS: &str = "id, channel_id, name, bpm, beats, master_gain, created_by, created_at, updated_at, version, master_effects, tempo_map, loop_on, loop_start_ms, loop_end_ms, punch_on, markers, tag, archived_at";
const LANE_COLS: &str = "id, project_id, name, color, position, gain, pan, mute, solo, user_id, kind, effects, sends, automation, output_id, nudge_ms, instrument, claimed_at";
const CLIP_COLS: &str = "id, project_id, lane_id, audio_id, start_ms, in_ms, length_ms, gain, fade_in_ms, fade_out_ms, muted, created_by, notes, group_id";

/// The project's band (engineers and artists, in its voice room or not), and Manage Projects.
async fn can_edit(state: &AppState, channel_id: Uuid, uid: Uuid, p: u64) -> AppResult<bool> {
    if is_crew(state, channel_id, uid, p).await? { return Ok(true); }
    Ok(perms::band_role(&state.db, channel_id, uid).await?.is_some())
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

/// A project in its studio's list: the project, its band, and how much has been recorded in it.
#[derive(Serialize)]
pub struct ProjectCard { #[serde(flatten)] project: Project, band: Vec<Uuid>, takes: i64, live: i64, session: Option<String> }

/// `GET /channels/:id/studio/projects?archived=`: a studio's projects, newest activity first.
async fn list_projects(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Query(q): Query<ListQuery>) -> AppResult<Json<Vec<ProjectCard>>> {
    let (c, _) = studio_container(&state.db, id, uid).await?;
    // Only the projects this member can see (a project may have overwrites of its own).
    let visible: Vec<Uuid> = perms::visible_channels(&state.db, c.guild_id.unwrap(), uid).await?.into_iter().filter(|x| x.parent_id == Some(id) && x.kind == "project").map(|x| x.id).collect();
    let projects = sqlx::query_as::<_, Project>(&format!("SELECT {PROJECT_COLS} FROM studio_projects WHERE channel_id = ANY($1) AND (archived_at IS NOT NULL) = $2 ORDER BY updated_at DESC LIMIT 200"))
        .bind(&visible).bind(q.archived).fetch_all(&state.db).await?;
    let rooms: Vec<Uuid> = projects.iter().map(|p| p.channel_id).collect();
    let band: Vec<(Uuid, Uuid)> = sqlx::query_as("SELECT channel_id, user_id FROM studio_engineers WHERE channel_id = ANY($1) ORDER BY role DESC, added_at").bind(&rooms).fetch_all(&state.db).await?;
    let takes: Vec<(Uuid, i64)> = sqlx::query_as("SELECT channel_id, COUNT(*) FROM studio_tracks WHERE channel_id = ANY($1) AND done GROUP BY channel_id").bind(&rooms).fetch_all(&state.db).await?;
    let voice = state.hub.voice_states_for_channels(&rooms);
    let open: Vec<(Uuid, String)> = sqlx::query_as("SELECT channel_id, title FROM studio_gatherings WHERE channel_id = ANY($1) AND ended_at IS NULL").bind(&rooms).fetch_all(&state.db).await?;
    Ok(Json(projects.into_iter().map(|p| {
        let room = p.channel_id;
        ProjectCard { band: band.iter().filter(|b| b.0 == room).map(|b| b.1).collect(), takes: takes.iter().find(|t| t.0 == room).map_or(0, |t| t.1), live: voice.iter().filter(|v| v.channel_id == room).count() as i64, session: open.iter().find(|o| o.0 == room).map(|o| o.1.clone()), project: p }
    }).collect()))
}

#[derive(Deserialize)]
struct ListQuery { #[serde(default)] archived: bool }

#[derive(Deserialize)]
struct NewProject { #[serde(default)] name: String, #[serde(default)] tag: String, #[serde(default = "default_bpm")] bpm: i32, #[serde(default = "default_beats")] beats: i32 }
fn default_bpm() -> i32 { 120 }
fn default_beats() -> i32 { 4 }

const TAGS: [&str; 5] = ["", "writing", "tracking", "mixing", "done"];

/// `POST /channels/:id/studio/projects {name, tag, bpm, beats}` on a studio (Create Projects): a new empty project,
/// its own channel under the studio, with its creator as its engineer.
async fn create_project(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<NewProject>) -> AppResult<(StatusCode, Json<Project>)> {
    let (studio, p) = studio_container(&state.db, id, uid).await?;
    perms::check(p, perms::CREATE_PROJECTS)?;
    let gid = studio.guild_id.unwrap();
    if !TAGS.contains(&req.tag.as_str()) { return Err(AppError::BadRequest("Unknown tag".into())); }
    if !(40..=300).contains(&req.bpm) || !(1..=12).contains(&req.beats) { return Err(AppError::BadRequest("Tempo must be 40 to 300 BPM and 1 to 12 beats per bar".into())); }
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM channels WHERE parent_id = $1").bind(id).fetch_one(&state.db).await?;
    if count >= 500 { return Err(AppError::BadRequest("This studio has too many projects; archive or delete some".into())); }
    let name = clean_name(&req.name, &format!("Song {}", Utc::now().format("%Y-%m-%d %H:%M")));
    let (room, pid) = (Uuid::now_v7(), Uuid::now_v7());
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO channels (id, guild_id, name, kind, topic, position, parent_id, audio_mode, audio_low_latency) VALUES ($1, $2, $3, 'project', '', $4, $5, 'music', true)")
        .bind(room).bind(gid).bind(&name).bind(count as i32).bind(id).execute(&mut *tx).await?;
    let project = sqlx::query_as::<_, Project>(&format!("INSERT INTO studio_projects (id, channel_id, name, bpm, beats, created_by, tag) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING {PROJECT_COLS}"))
        .bind(pid).bind(room).bind(&name).bind(req.bpm).bind(req.beats).bind(uid).bind(&req.tag).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO studio_config (channel_id, bpm, beats, project_id) VALUES ($1, $2, $3, $4)").bind(room).bind(req.bpm).bind(req.beats).bind(pid).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO studio_engineers (channel_id, user_id, role) VALUES ($1, $2, 'engineer')").bind(room).bind(uid).execute(&mut *tx).await?;
    tx.commit().await?;
    let c = channel_json(&state, room).await?;
    let target = perms::channel_audience(&state.db, &c).await?;
    state.hub.emit(target, "CHANNEL_CREATE", json!(c));
    broadcast(&state, &studio, "STUDIO_PROJECTS", json!({ "channel_id": id })).await?;
    crate::audit::guild(&state, gid, uid, "studio.project_create", "channel", Some(room), &name, json!({ "project": pid, "studio": id })).await;
    Ok((StatusCode::CREATED, Json(project)))
}

#[derive(Deserialize)]
struct ProjectPatch { name: Option<String>, tag: Option<String>, archived: Option<bool> }

/// `PATCH /studio/projects/:pid {name, tag, archived}`: the project's engineers and Manage Projects.
async fn update_project(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>, Json(req): Json<ProjectPatch>) -> AppResult<Json<Project>> {
    let project = project_row(&state.db, pid).await?;
    let (c, p) = studio_channel(&state.db, project.channel_id, uid).await?;
    if !is_crew(&state, c.id, uid, p).await? { return Err(AppError::Forbidden); }
    if let Some(t) = &req.tag { if !TAGS.contains(&t.as_str()) { return Err(AppError::BadRequest("Unknown tag".into())); } }
    let name = req.name.as_deref().map(|n| clean_name(n, &project.name));
    let updated = sqlx::query_as::<_, Project>(&format!("UPDATE studio_projects SET name = COALESCE($2, name), tag = COALESCE($3, tag),
        archived_at = CASE WHEN $4::bool IS NULL THEN archived_at WHEN $4 THEN COALESCE(archived_at, now()) ELSE NULL END WHERE id = $1 RETURNING {PROJECT_COLS}"))
        .bind(pid).bind(&name).bind(&req.tag).bind(req.archived).fetch_one(&state.db).await?;
    if let Some(n) = &name { sqlx::query("UPDATE channels SET name = $2 WHERE id = $1").bind(c.id).bind(n.chars().take(100).collect::<String>()).execute(&state.db).await?; }
    let room = channel_json(&state, c.id).await?;
    state.hub.emit_guild(c.guild_id.unwrap(), "CHANNEL_UPDATE", json!(room));
    if let Some(sid) = c.parent_id { if let Ok(studio) = channel_json(&state, sid).await { broadcast(&state, &studio, "STUDIO_PROJECTS", json!({ "channel_id": sid })).await?; } }
    broadcast(&state, &c, "STUDIO_PROJECT", json!({ "project_id": pid, "version": updated.version, "ops": [], "reload": true })).await?;
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.project_update", "channel", Some(c.id), &updated.name, json!({ "project": pid, "tag": req.tag, "archived": req.archived })).await;
    Ok(Json(updated))
}

#[derive(Serialize)]
pub struct ProjectFull { project: Project, lanes: Vec<Lane>, clips: Vec<Clip>, audio: Vec<Track> }

async fn get_project(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>) -> AppResult<Json<ProjectFull>> {
    let project = project_row(&state.db, pid).await?;
    studio_channel(&state.db, project.channel_id, uid).await?;
    let lanes = sqlx::query_as::<_, Lane>(&format!("SELECT {LANE_COLS} FROM studio_lanes WHERE project_id = $1 ORDER BY position, created_at")).bind(pid).fetch_all(&state.db).await?;
    let clips = sqlx::query_as::<_, Clip>(&format!("SELECT {CLIP_COLS} FROM studio_clips WHERE project_id = $1 ORDER BY start_ms")).bind(pid).fetch_all(&state.db).await?;
    // The audio its clips and samplers use.
    let mut audio = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.id IN (SELECT audio_id FROM studio_clips WHERE project_id = $1 AND audio_id IS NOT NULL)
        OR t.id IN (SELECT (instrument->>'audio_id')::uuid FROM studio_lanes WHERE project_id = $1 AND instrument->>'audio_id' IS NOT NULL)")).bind(pid).fetch_all(&state.db).await?;
    for a in &mut audio { a.url = format!("/api/studio/tracks/{}", a.id); }
    Ok(Json(ProjectFull { project, lanes, clips, audio }))
}

/// `DELETE /studio/projects/:pid` (Delete Projects): the project with everything in it — its channel and chat, takes
/// and imported audio (files too), comments and versions.
async fn delete_project(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>) -> AppResult<StatusCode> {
    let project = project_row(&state.db, pid).await?;
    let (c, p) = studio_channel(&state.db, project.channel_id, uid).await?;
    perms::check(p, perms::DELETE_PROJECTS)?;
    let gid = c.guild_id.unwrap();
    crate::routes::channels::remove_channel(&state, gid, c.id).await?;
    if let Some(sid) = c.parent_id { if let Ok(studio) = channel_json(&state, sid).await { broadcast(&state, &studio, "STUDIO_PROJECTS", json!({ "channel_id": sid })).await?; } }
    crate::audit::guild(&state, gid, uid, "studio.project_delete", "channel", Some(c.id), &project.name, json!({ "project": pid })).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct LanePatch { id: Uuid, name: Option<String>, color: Option<String>, position: Option<f32>, gain: Option<f32>, pan: Option<f32>, mute: Option<bool>, solo: Option<bool>, user_id: Option<Uuid>,
    #[serde(default)] kind: Option<String>, #[serde(default)] effects: Option<Value>, #[serde(default)] sends: Option<Value>, #[serde(default)] automation: Option<Value>,
    /// A bus lane's id, or "" / null for the master.
    #[serde(default)] output_id: Option<Value>, #[serde(default)] nudge_ms: Option<i32>, #[serde(default)] instrument: Option<Value> }

#[derive(Deserialize)]
struct ClipPatch { id: Uuid, lane_id: Option<Uuid>, audio_id: Option<Uuid>, start_ms: Option<i32>, in_ms: Option<i32>, length_ms: Option<i32>, gain: Option<f32>, fade_in_ms: Option<i32>, fade_out_ms: Option<i32>, muted: Option<bool>,
    #[serde(default)] notes: Option<Value>,
    /// A group's id, or "" / null for none.
    #[serde(default)] group_id: Option<Value> }

#[derive(Deserialize)]
#[serde(tag = "op")]
enum Op {
    #[serde(rename = "project")]
    Project { name: Option<String>, bpm: Option<i32>, beats: Option<i32>, master_gain: Option<f32>, #[serde(default)] master_effects: Option<Value>,
        #[serde(default)] tempo_map: Option<Value>, #[serde(default)] loop_on: Option<bool>, #[serde(default)] loop_start_ms: Option<i32>, #[serde(default)] loop_end_ms: Option<i32>,
        #[serde(default)] punch_on: Option<bool>, #[serde(default)] markers: Option<Value> },
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

const LANE_KINDS: [&str; 3] = ["audio", "midi", "bus"];
/// The effects the clients implement.
pub const EFFECTS: [&str; 8] = ["eq", "compressor", "reverb", "delay", "drive", "filter", "limiter", "chorus"];

/// An effect chain: at most 16, each {id, type, on, params} with numeric params; anything else is dropped.
fn effects(v: Value) -> AppResult<Value> {
    let Value::Array(list) = v else { return Err(AppError::BadRequest("Effects must be a list".into())) };
    if list.len() > 16 { return Err(AppError::BadRequest("At most 16 effects".into())); }
    let mut out = Vec::with_capacity(list.len());
    for e in list {
        let id = e.get("id").and_then(Value::as_str).filter(|s| !s.is_empty() && s.len() <= 40).ok_or_else(|| AppError::BadRequest("An effect needs an id".into()))?;
        let ty = e.get("type").and_then(Value::as_str).filter(|t| EFFECTS.contains(t)).ok_or_else(|| AppError::BadRequest("Unknown effect".into()))?;
        let on = e.get("on").and_then(Value::as_bool).unwrap_or(true);
        let mut params = serde_json::Map::new();
        if let Some(Value::Object(p)) = e.get("params") {
            if p.len() > 24 { return Err(AppError::BadRequest("Too many effect parameters".into())); }
            for (k, x) in p { if k.len() <= 32 { if let Some(n) = x.as_f64().filter(|n| n.is_finite() && n.abs() <= 1e6) { params.insert(k.clone(), json!(n)); } } }
        }
        out.push(json!({ "id": id, "type": ty, "on": on, "params": params }));
    }
    Ok(Value::Array(out))
}

/// Send levels: {bus id: 0..2}, at most 16.
fn sends(v: Value) -> AppResult<Value> {
    let Value::Object(m) = v else { return Err(AppError::BadRequest("Sends must be an object".into())) };
    if m.len() > 16 { return Err(AppError::BadRequest("At most 16 sends".into())); }
    let mut out = serde_json::Map::new();
    for (k, x) in m {
        if k.parse::<Uuid>().is_err() { return Err(AppError::BadRequest("A send names a bus".into())); }
        let n = x.as_f64().filter(|n| n.is_finite() && (0.0..=2.0).contains(n)).ok_or_else(|| AppError::BadRequest("Send level is out of range".into()))?;
        out.insert(k, json!(n));
    }
    Ok(Value::Object(out))
}

/// Automation: {param: [[ms, value], ...]}, at most 32 parameters of 4000 points, sorted by time.
fn automation(v: Value) -> AppResult<Value> {
    let Value::Object(m) = v else { return Err(AppError::BadRequest("Automation must be an object".into())) };
    if m.len() > 32 { return Err(AppError::BadRequest("At most 32 automated parameters".into())); }
    let mut out = serde_json::Map::new();
    for (k, pts) in m {
        if k.is_empty() || k.len() > 80 { return Err(AppError::BadRequest("Bad automation parameter".into())); }
        let Value::Array(pts) = pts else { return Err(AppError::BadRequest("Automation points must be a list".into())) };
        if pts.len() > 4000 { return Err(AppError::BadRequest("At most 4000 automation points".into())); }
        let mut clean: Vec<(i64, f64)> = Vec::with_capacity(pts.len());
        for p in pts {
            let t = p.get(0).and_then(Value::as_i64).filter(|t| (0..=MAX_MS as i64).contains(t));
            let x = p.get(1).and_then(Value::as_f64).filter(|x| x.is_finite() && x.abs() <= 1e6);
            let (Some(t), Some(x)) = (t, x) else { return Err(AppError::BadRequest("Bad automation point".into())) };
            clean.push((t, x));
        }
        clean.sort_by_key(|p| p.0);
        if !clean.is_empty() { out.insert(k, json!(clean.iter().map(|(t, x)| json!([t, x])).collect::<Vec<_>>())); }
    }
    Ok(Value::Object(out))
}

/// A tempo map: at most 64 changes {bar 1.., bpm 40-300, beats 1-12}, sorted, one per bar.
fn tempo_map(v: Value) -> AppResult<Value> {
    let Value::Array(list) = v else { return Err(AppError::BadRequest("The tempo map must be a list".into())) };
    if list.len() > 64 { return Err(AppError::BadRequest("At most 64 tempo changes".into())); }
    let mut out: Vec<(i64, i64, i64)> = Vec::new();
    for c in list {
        let bar = c.get("bar").and_then(Value::as_i64).filter(|b| (1..=10_000).contains(b));
        let bpm = c.get("bpm").and_then(Value::as_i64).filter(|b| (40..=300).contains(b));
        let beats = c.get("beats").and_then(Value::as_i64).filter(|b| (1..=12).contains(b));
        let (Some(bar), Some(bpm), Some(beats)) = (bar, bpm, beats) else { return Err(AppError::BadRequest("A tempo change needs a bar (from 2), 40-300 BPM and 1-12 beats".into())) };
        out.retain(|x| x.0 != bar);
        out.push((bar, bpm, beats));
    }
    out.sort();
    Ok(json!(out.into_iter().map(|(bar, bpm, beats)| json!({ "bar": bar, "bpm": bpm, "beats": beats })).collect::<Vec<_>>()))
}

/// Markers: at most 200 {id, ms, name}.
fn markers(v: Value) -> AppResult<Value> {
    let Value::Array(list) = v else { return Err(AppError::BadRequest("Markers must be a list".into())) };
    if list.len() > 200 { return Err(AppError::BadRequest("At most 200 markers".into())); }
    let mut out = Vec::new();
    for m in list {
        let id = m.get("id").and_then(Value::as_str).filter(|s| !s.is_empty() && s.len() <= 40).ok_or_else(|| AppError::BadRequest("A marker needs an id".into()))?;
        let ms = m.get("ms").and_then(Value::as_i64).filter(|t| (0..=MAX_MS as i64).contains(t)).ok_or_else(|| AppError::BadRequest("A marker needs a time".into()))?;
        let name: String = m.get("name").and_then(Value::as_str).unwrap_or("").chars().filter(|c| !c.is_control()).take(60).collect();
        out.push(json!({ "id": id, "ms": ms, "name": name }));
    }
    Ok(Value::Array(out))
}

/// MIDI notes: at most 10 000 {p 0-127, t >= 0 ms, d > 0 ms, v 1-127}.
fn notes(v: Value) -> AppResult<Value> {
    let Value::Array(list) = v else { return Err(AppError::BadRequest("Notes must be a list".into())) };
    if list.len() > 10_000 { return Err(AppError::BadRequest("At most 10000 notes in a clip".into())); }
    let mut out = Vec::with_capacity(list.len());
    for n in list {
        let p = n.get("p").and_then(Value::as_i64).filter(|x| (0..=127).contains(x));
        let t = n.get("t").and_then(Value::as_i64).filter(|x| (0..=MAX_MS as i64).contains(x));
        let d = n.get("d").and_then(Value::as_i64).filter(|x| (1..=MAX_MS as i64).contains(x));
        let vel = n.get("v").and_then(Value::as_i64).filter(|x| (1..=127).contains(x)).unwrap_or(100);
        let (Some(p), Some(t), Some(d)) = (p, t, d) else { return Err(AppError::BadRequest("Bad note".into())) };
        out.push(json!({ "p": p, "t": t, "d": d, "v": vel }));
    }
    Ok(Value::Array(out))
}

/// A MIDI track's instrument: {type, params (numbers)}, a sampler's audio (of this studio) and root note.
async fn instrument(tx: &mut Transaction<'_, Postgres>, channel_id: Uuid, v: Value) -> AppResult<Value> {
    let ty = v.get("type").and_then(Value::as_str).filter(|t| ["synth", "drums", "sampler"].contains(t)).ok_or_else(|| AppError::BadRequest("Unknown instrument".into()))?;
    let mut params = serde_json::Map::new();
    if let Some(Value::Object(p)) = v.get("params") {
        for (k, x) in p.iter().take(32) { if let Some(n) = x.as_f64().filter(|n| n.is_finite() && n.abs() <= 1e6) { params.insert(k.chars().take(32).collect(), json!(n)); } }
    }
    let mut out = json!({ "type": ty, "params": params });
    if ty == "sampler" {
        let audio = match v.get("audio_id").and_then(Value::as_str) {
            Some(a) => {
                let id: Uuid = a.parse().map_err(|_| AppError::BadRequest("Bad sample".into()))?;
                let ch: Option<(Option<Uuid>,)> = sqlx::query_as("SELECT COALESCE(t.channel_id, s.channel_id) FROM studio_tracks t LEFT JOIN studio_sessions s ON s.id = t.session_id WHERE t.id = $1").bind(id).fetch_optional(&mut **tx).await?;
                if ch.and_then(|c| c.0) != Some(channel_id) { return Err(AppError::BadRequest("No such audio in this studio".into())); }
                json!(id)
            }
            None => Value::Null,
        };
        out["audio_id"] = audio;
        out["root"] = json!(v.get("root").and_then(Value::as_i64).filter(|r| (0..=127).contains(r)).unwrap_or(60));
    }
    Ok(out)
}

/// Is `id` a bus of the project (and not the lane itself)?
async fn is_bus(tx: &mut Transaction<'_, Postgres>, pid: Uuid, id: &str, me: Uuid) -> AppResult<bool> {
    let Ok(id) = id.parse::<Uuid>() else { return Ok(false) };
    if id == me { return Ok(false); }
    let row: Option<(String,)> = sqlx::query_as("SELECT kind FROM studio_lanes WHERE id = $1 AND project_id = $2").bind(id).bind(pid).fetch_optional(&mut **tx).await?;
    Ok(row.is_some_and(|r| r.0 == "bus"))
}

/// Apply one op inside the transaction; the entity it leaves (as broadcast), or what it removed.
async fn apply(tx: &mut Transaction<'_, Postgres>, project: &mut Project, uid: Uuid, op: Op) -> AppResult<serde_json::Value> {
    let pid = project.id;
    match op {
        Op::Project { name, bpm, beats, master_gain, master_effects, tempo_map: tm, loop_on, loop_start_ms, loop_end_ms, punch_on, markers: mk } => {
            if let Some(v) = master_effects { project.master_effects = SqlJson(effects(v)?); }
            if let Some(v) = tm { project.tempo_map = SqlJson(tempo_map(v)?); }
            if let Some(v) = mk { project.markers = SqlJson(markers(v)?); }
            if let Some(v) = loop_start_ms { project.loop_start_ms = Some(range(v, 0, MAX_MS, "Loop start")?); }
            if let Some(v) = loop_end_ms { project.loop_end_ms = Some(range(v, 0, MAX_MS, "Loop end")?); }
            if let (Some(a), Some(b)) = (project.loop_start_ms, project.loop_end_ms) { if b <= a { return Err(AppError::BadRequest("The loop ends after it starts".into())); } }
            if let Some(v) = loop_on { project.loop_on = v; }
            if let Some(v) = punch_on { project.punch_on = v; }
            if (project.loop_on || project.punch_on) && project.loop_end_ms.is_none() { return Err(AppError::BadRequest("Set a loop range first".into())); }
            if let Some(n) = name { project.name = clean_name(&n, &project.name); }
            if let Some(v) = bpm { project.bpm = range(v, 40, 300, "Tempo")?; }
            if let Some(v) = beats { project.beats = range(v, 1, 12, "Beats per bar")?; }
            if let Some(v) = master_gain { project.master_gain = finite(v, 0.0, 2.0, "Master level")?; }
            sqlx::query("UPDATE studio_projects SET name = $2, bpm = $3, beats = $4, master_gain = $5, master_effects = $6, tempo_map = $7, loop_on = $8, loop_start_ms = $9, loop_end_ms = $10, punch_on = $11, markers = $12 WHERE id = $1")
                .bind(pid).bind(&project.name).bind(project.bpm).bind(project.beats).bind(project.master_gain).bind(&project.master_effects)
                .bind(&project.tempo_map).bind(project.loop_on).bind(project.loop_start_ms).bind(project.loop_end_ms).bind(project.punch_on).bind(&project.markers).execute(&mut **tx).await?;
            Ok(json!({ "op": "project", "project": { "name": project.name, "bpm": project.bpm, "beats": project.beats, "master_gain": project.master_gain, "master_effects": project.master_effects,
                "tempo_map": project.tempo_map, "loop_on": project.loop_on, "loop_start_ms": project.loop_start_ms, "loop_end_ms": project.loop_end_ms, "punch_on": project.punch_on, "markers": project.markers } }))
        }
        Op::LanePut { lane: l } => {
            let cur = sqlx::query_as::<_, Lane>(&format!("SELECT {LANE_COLS} FROM studio_lanes WHERE id = $1")).bind(l.id).fetch_optional(&mut **tx).await?;
            if cur.as_ref().is_some_and(|c| c.project_id != pid) { return Err(AppError::BadRequest("That lane is in another project".into())); }
            let new = cur.is_none();
            let mut v = cur.unwrap_or(Lane { id: l.id, project_id: pid, name: "Track".into(), color: None, position: 0.0, gain: 1.0, pan: 0.0, mute: false, solo: false, user_id: None,
                kind: "audio".into(), effects: SqlJson(json!([])), sends: SqlJson(json!({})), automation: SqlJson(json!({})), output_id: None, nudge_ms: 0, instrument: None, claimed_at: None });
            // What a lane is stays what it was made as.
            if let Some(k) = l.kind { if new { if !LANE_KINDS.contains(&k.as_str()) { return Err(AppError::BadRequest("Unknown track kind".into())); } v.kind = k; } }
            if let Some(x) = l.effects { v.effects = SqlJson(effects(x)?); }
            if let Some(x) = l.nudge_ms { v.nudge_ms = range(x, -1000, 1000, "Nudge")?; }
            if let Some(x) = l.instrument { v.instrument = if x.is_null() { None } else { Some(SqlJson(instrument(tx, project.channel_id, x).await?)) }; }
            if new && v.kind == "midi" && v.instrument.is_none() { v.instrument = Some(SqlJson(json!({ "type": "synth", "params": {} }))); }
            if let Some(x) = l.automation { v.automation = SqlJson(automation(x)?); }
            if let Some(x) = l.sends {
                let sends = sends(x)?;
                for bus in sends.as_object().unwrap().keys() { if !is_bus(tx, pid, bus, l.id).await? { return Err(AppError::BadRequest("Sends go to a bus of this project".into())); } }
                v.sends = SqlJson(sends);
            }
            if let Some(x) = l.output_id {
                v.output_id = match x.as_str() { None | Some("") => None, Some(id) => { if !is_bus(tx, pid, id, l.id).await? { return Err(AppError::BadRequest("A track outputs to a bus of this project or the master".into())); } Some(id.parse().unwrap()) } };
            }
            // Buses go to the master and send nowhere, so nothing loops.
            if v.kind == "bus" { v.output_id = None; v.sends = SqlJson(json!({})); }
            if let Some(n) = l.name { v.name = clean_name(&n, "Track"); }
            if let Some(c) = l.color { v.color = color(&c)?; }
            if let Some(x) = l.position { v.position = finite(x, -1e6, 1e6, "Position")?; }
            if let Some(x) = l.gain { v.gain = finite(x, 0.0, 2.0, "Volume")?; }
            if let Some(x) = l.pan { v.pan = finite(x, -1.0, 1.0, "Pan")?; }
            if let Some(x) = l.mute { v.mute = x; }
            if let Some(x) = l.solo { v.solo = x; }
            // Making a lane someone's makes it where their takes land from now on.
            if let Some(x) = l.user_id { v.user_id = Some(x); v.claimed_at = Some(Utc::now()); }
            sqlx::query("INSERT INTO studio_lanes (id, project_id, name, color, position, gain, pan, mute, solo, user_id, kind, effects, sends, automation, output_id, nudge_ms, instrument, claimed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                ON CONFLICT (id) DO UPDATE SET name = $3, color = $4, position = $5, gain = $6, pan = $7, mute = $8, solo = $9, user_id = $10, effects = $12, sends = $13, automation = $14, output_id = $15, nudge_ms = $16, instrument = $17, claimed_at = $18")
                .bind(v.id).bind(pid).bind(&v.name).bind(&v.color).bind(v.position).bind(v.gain).bind(v.pan).bind(v.mute).bind(v.solo).bind(v.user_id)
                .bind(&v.kind).bind(&v.effects).bind(&v.sends).bind(&v.automation).bind(v.output_id).bind(v.nudge_ms).bind(&v.instrument).bind(v.claimed_at).execute(&mut **tx).await?;
            Ok(json!({ "op": "lane.put", "lane": v }))
        }
        Op::LaneDel { id } => {
            sqlx::query("DELETE FROM studio_lanes WHERE id = $1 AND project_id = $2").bind(id).bind(pid).execute(&mut **tx).await?;
            // Tracks that went to a deleted bus go to the master; its sends go too (the clients drop them as well).
            sqlx::query("UPDATE studio_lanes SET output_id = NULL WHERE project_id = $1 AND output_id = $2").bind(pid).bind(id).execute(&mut **tx).await?;
            sqlx::query("UPDATE studio_lanes SET sends = sends - $2 WHERE project_id = $1 AND sends ? $2").bind(pid).bind(id.to_string()).execute(&mut **tx).await?;
            Ok(json!({ "op": "lane.del", "id": id }))
        }
        Op::ClipPut { clip: c } => {
            let cur = sqlx::query_as::<_, Clip>(&format!("SELECT {CLIP_COLS} FROM studio_clips WHERE id = $1")).bind(c.id).fetch_optional(&mut **tx).await?;
            if cur.as_ref().is_some_and(|x| x.project_id != pid) { return Err(AppError::BadRequest("That clip is in another project".into())); }
            let mut v = match cur {
                Some(x) => x,
                None => {
                    let (Some(lane_id), Some(length_ms)) = (c.lane_id, c.length_ms) else { return Err(AppError::BadRequest("A new clip needs a lane and a length".into())) };
                    Clip { id: c.id, project_id: pid, lane_id, audio_id: None, start_ms: 0, in_ms: 0, length_ms, gain: 1.0, fade_in_ms: 0, fade_out_ms: 0, muted: false, created_by: Some(uid), notes: None, group_id: None }
                }
            };
            if let Some(x) = c.lane_id { v.lane_id = x; }
            if let Some(x) = c.audio_id { v.audio_id = Some(x); }
            if let Some(x) = c.notes { v.notes = if x.is_null() { None } else { Some(SqlJson(notes(x)?)) }; }
            if let Some(x) = c.group_id { v.group_id = match x.as_str() { None | Some("") => None, Some(g) => Some(g.parse().map_err(|_| AppError::BadRequest("Bad take group".into()))?) }; }
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
            let lane: Option<(Uuid, String)> = sqlx::query_as("SELECT project_id, kind FROM studio_lanes WHERE id = $1").bind(v.lane_id).fetch_optional(&mut **tx).await?;
            let kind = match lane { Some((p, k)) if p == pid => k, _ => return Err(AppError::BadRequest("No such lane in this project".into())) };
            match kind.as_str() {
                "bus" => return Err(AppError::BadRequest("Buses don't hold clips".into())),
                // A MIDI track holds note clips; an audio track holds audio.
                "midi" => { if v.notes.is_none() { v.notes = Some(SqlJson(json!([]))); } v.audio_id = None; }
                _ => {
                    v.notes = None;
                    let Some(aid) = v.audio_id else { return Err(AppError::BadRequest("An audio clip needs audio".into())) };
                    let audio: Option<(Option<Uuid>, Option<i32>)> = sqlx::query_as("SELECT COALESCE(t.channel_id, s.channel_id), t.duration_ms FROM studio_tracks t LEFT JOIN studio_sessions s ON s.id = t.session_id WHERE t.id = $1").bind(aid).fetch_optional(&mut **tx).await?;
                    let Some((Some(ch), dur)) = audio else { return Err(AppError::BadRequest("No such audio in this studio".into())) };
                    if ch != project.channel_id { return Err(AppError::BadRequest("No such audio in this studio".into())); }
                    // A little slack: durations are measured on the client.
                    if let Some(d) = dur.filter(|d| *d > 0) { if v.in_ms + v.length_ms > d + 250 { return Err(AppError::BadRequest("The clip runs past the end of its audio".into())); } }
                }
            }
            sqlx::query("INSERT INTO studio_clips (id, project_id, lane_id, audio_id, start_ms, in_ms, length_ms, gain, fade_in_ms, fade_out_ms, muted, created_by, notes, group_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                ON CONFLICT (id) DO UPDATE SET lane_id = $3, audio_id = $4, start_ms = $5, in_ms = $6, length_ms = $7, gain = $8, fade_in_ms = $9, fade_out_ms = $10, muted = $11, notes = $13, group_id = $14")
                .bind(v.id).bind(pid).bind(v.lane_id).bind(v.audio_id).bind(v.start_ms).bind(v.in_ms).bind(v.length_ms).bind(v.gain).bind(v.fade_in_ms).bind(v.fade_out_ms).bind(v.muted).bind(v.created_by)
                .bind(&v.notes).bind(v.group_id).execute(&mut **tx).await?;
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
    commit(state, &c, pid, uid, vec![Op::Project { name: None, bpm: Some(bpm), beats: Some(beats), master_gain: None, master_effects: None, tempo_map: None, loop_on: None, loop_start_ms: None, loop_end_ms: None, punch_on: None, markers: None }]).await?;
    Ok(())
}

/// A take recorded into a project finished uploading: put it on its member's lane (made for them if they have none),
/// where they played it. The count-in's pre-roll is trimmed off, so the clip starts at the playhead it was recorded
/// from. A take recorded over a loop becomes one clip per pass, stacked as takes of one group with the last whole
/// pass playing; a punched take keeps only what falls in the punch range.
pub async fn place_take(state: &AppState, c: &crate::models::Channel, sid: Uuid, t: &Track) -> AppResult<()> {
    let Some((Some(pid), position, la, lb, punch)) = sqlx::query_as::<_, (Option<Uuid>, i32, Option<i32>, Option<i32>, bool)>("SELECT project_id, position_ms, loop_start_ms, loop_end_ms, punch FROM studio_sessions WHERE id = $1").bind(sid).fetch_optional(&state.db).await? else { return Ok(()) };
    let (Some(uid), Some(dur)) = (t.user_id, t.duration_ms.filter(|d| *d > 0)) else { return Ok(()) };
    let mut ops = Vec::new();
    let lane: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM studio_lanes WHERE project_id = $1 AND user_id = $2 AND kind = 'audio' ORDER BY claimed_at DESC NULLS LAST, position, created_at LIMIT 1").bind(pid).bind(uid).fetch_optional(&state.db).await?;
    let lane_id = match lane {
        Some((id,)) => id,
        None => {
            let (next,): (Option<f32>,) = sqlx::query_as("SELECT (MAX(position) + 1)::real FROM studio_lanes WHERE project_id = $1").bind(pid).fetch_one(&state.db).await?;
            let id = Uuid::now_v7();
            ops.push(Op::LanePut { lane: LanePatch { id, name: Some(t.display_name.clone()), color: None, position: Some(next.unwrap_or(0.0)), gain: None, pan: None, mute: None, solo: None, user_id: Some(uid), kind: None, effects: None, sends: None, automation: None, output_id: None, nudge_ms: None, instrument: None } });
            id
        }
    };
    let clip = |start: i32, inn: i32, len: i32, group: Option<Uuid>, muted: bool| Op::ClipPut { clip: ClipPatch { id: Uuid::now_v7(), lane_id: Some(lane_id), audio_id: Some(t.id), start_ms: Some(start), in_ms: Some(inn), length_ms: Some(len), gain: None, fade_in_ms: None, fade_out_ms: None, muted: Some(muted), notes: None, group_id: group.map(|g| json!(g.to_string())) } };
    let mut start = position + t.offset_ms;
    let mut skip = 0;
    if start < position { skip = position - start; start = position; }
    if dur - skip <= 0 { return Ok(()); }
    match (la, lb) {
        (Some(a), Some(b)) if b > a && !punch => {
            // Loop recording: the passes, each laid over the loop range.
            let pass = b - a;
            let first = start - a;
            let mut takes: Vec<(i32, i32, i32)> = Vec::new();
            let mut inn = skip;
            let mut at = a + first.rem_euclid(pass);
            while inn < dur {
                let len = (b - at).min(dur - inn);
                if len >= 200 { takes.push((at, inn, len)); }
                inn += b - at;
                at = a;
            }
            if takes.len() <= 1 {
                if let Some((s0, i0, l0)) = takes.first() { ops.push(clip(*s0, *i0, *l0, None, false)); }
            } else {
                let group = Uuid::now_v7();
                // The last pass that is mostly there plays.
                let keep = takes.iter().rposition(|x| x.2 * 2 >= pass).unwrap_or(takes.len() - 1);
                for (i, (s0, i0, l0)) in takes.iter().enumerate() { ops.push(clip(*s0, *i0, *l0, Some(group), i != keep)); }
            }
        }
        (Some(a), Some(b)) if b > a => {
            // Punch: only what falls in the range.
            let end = start + dur - skip;
            let (s0, e0) = (start.max(a), end.min(b));
            if e0 - s0 >= 50 { ops.push(clip(s0, skip + (s0 - start), e0 - s0, None, false)); }
        }
        _ => ops.push(clip(start, skip, dur - skip, None, false)),
    }
    if ops.iter().all(|o| !matches!(o, Op::ClipPut { .. })) { return Ok(()); }
    commit(state, c, pid, uid, ops).await?;
    Ok(())
}

/// `GET /channels/:id/studio/audio`: everything recorded or imported into the project, newest first.
async fn list_audio(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Track>>> {
    studio_channel(&state.db, id, uid).await?;
    let mut list = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.channel_id = $1 AND t.done ORDER BY t.created_at DESC LIMIT 500")).bind(id).fetch_all(&state.db).await?;
    for a in &mut list { a.url = format!("/api/studio/tracks/{}", a.id); }
    Ok(Json(list))
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

#[cfg(test)]
mod tests {
    use super::{automation, effects, markers, notes, sends, tempo_map};
    use serde_json::json;

    #[test]
    fn effect_chains_are_cleaned() {
        let v = effects(json!([{ "id": "a", "type": "eq", "params": { "low": 3, "bad": "x" }, "extra": 1 }])).unwrap();
        assert_eq!(v, json!([{ "id": "a", "type": "eq", "on": true, "params": { "low": 3.0 } }]));
        assert!(effects(json!([{ "id": "a", "type": "flanger9000" }])).is_err());
        assert!(effects(json!([{ "type": "eq" }])).is_err());
        assert!(effects(json!((0..17).map(|i| json!({ "id": i.to_string(), "type": "eq" })).collect::<Vec<_>>())).is_err());
    }

    #[test]
    fn sends_and_automation_are_checked() {
        let bus = uuid::Uuid::now_v7().to_string();
        assert!(sends(json!({ bus.clone(): 0.5 })).is_ok());
        assert!(sends(json!({ bus: 3.0 })).is_err());
        assert!(sends(json!({ "not-a-bus": 0.5 })).is_err());
        assert_eq!(automation(json!({ "gain": [[2000, 0.5], [0, 1]] })).unwrap(), json!({ "gain": [[0, 1.0], [2000, 0.5]] }));
        assert!(automation(json!({ "gain": [[-1, 1]] })).is_err());
    }

    #[test]
    fn tempo_markers_and_notes() {
        assert_eq!(tempo_map(json!([{ "bar": 8, "bpm": 90, "beats": 3 }, { "bar": 4, "bpm": 140, "beats": 4 }, { "bar": 8, "bpm": 100, "beats": 4 }])).unwrap(),
            json!([{ "bar": 4, "bpm": 140, "beats": 4 }, { "bar": 8, "bpm": 100, "beats": 4 }]));
        assert!(tempo_map(json!([{ "bar": 0, "bpm": 90, "beats": 3 }])).is_err());
        assert!(tempo_map(json!([{ "bar": 2, "bpm": 900, "beats": 3 }])).is_err());
        assert_eq!(markers(json!([{ "id": "m", "ms": 1000, "name": "Chorus\n" }])).unwrap(), json!([{ "id": "m", "ms": 1000, "name": "Chorus" }]));
        assert_eq!(notes(json!([{ "p": 60, "t": 0, "d": 250 }])).unwrap(), json!([{ "p": 60, "t": 0, "d": 250, "v": 100 }]));
        assert!(notes(json!([{ "p": 200, "t": 0, "d": 250 }])).is_err());
        assert!(notes(json!([{ "p": 60, "t": 0, "d": 0 }])).is_err());
    }
}

#[derive(Deserialize)]
struct Presence { #[serde(default)] pos_ms: i32, #[serde(default)] playing: bool, #[serde(default)] sel: Vec<Uuid> }

/// `POST /studio/projects/:pid/presence {pos_ms, playing, sel}`: where an editor is (playhead, selected clips), for
/// the others to see. Not stored; sent on to the studio as STUDIO_PRESENCE.
async fn presence(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>, Json(req): Json<Presence>) -> AppResult<StatusCode> {
    let project = project_row(&state.db, pid).await?;
    let c = editor(&state, project.channel_id, uid).await?;
    let sel: Vec<Uuid> = req.sel.into_iter().take(50).collect();
    broadcast(&state, &c, "STUDIO_PRESENCE", json!({ "channel_id": c.id, "project_id": pid, "user_id": uid, "pos_ms": req.pos_ms.clamp(0, MAX_MS), "playing": req.playing, "sel": sel })).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, FromRow)]
pub struct Comment { id: Uuid, project_id: Uuid, user_id: Option<Uuid>, ms: i32, lane_id: Option<Uuid>, body: String, resolved: bool, created_at: DateTime<Utc> }
const COMMENT_COLS: &str = "id, project_id, user_id, ms, lane_id, body, resolved, created_at";

async fn list_comments(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>) -> AppResult<Json<Vec<Comment>>> {
    let project = project_row(&state.db, pid).await?;
    studio_channel(&state.db, project.channel_id, uid).await?;
    Ok(Json(sqlx::query_as::<_, Comment>(&format!("SELECT {COMMENT_COLS} FROM studio_comments WHERE project_id = $1 ORDER BY ms, created_at LIMIT 500")).bind(pid).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
struct NewComment { ms: i32, lane_id: Option<Uuid>, body: String }

/// `POST /studio/projects/:pid/comments {ms, lane_id?, body}`: a comment pinned to a moment of the song. Anyone who
/// can talk in the studio may comment, the audience included.
async fn add_comment(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>, Json(req): Json<NewComment>) -> AppResult<(StatusCode, Json<Comment>)> {
    let project = project_row(&state.db, pid).await?;
    let (c, p) = studio_channel(&state.db, project.channel_id, uid).await?;
    if !perms::has(p, perms::SEND_MESSAGES) { return Err(AppError::Forbidden); }
    let body: String = req.body.trim().chars().take(2000).collect();
    if body.is_empty() { return Err(AppError::BadRequest("Write something".into())); }
    let n: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM studio_comments WHERE project_id = $1").bind(pid).fetch_one(&state.db).await?;
    if n.0 >= 500 { return Err(AppError::BadRequest("This project has too many comments".into())); }
    let cm = sqlx::query_as::<_, Comment>(&format!("INSERT INTO studio_comments (id, project_id, user_id, ms, lane_id, body) VALUES ($1, $2, $3, $4, $5, $6) RETURNING {COMMENT_COLS}"))
        .bind(Uuid::now_v7()).bind(pid).bind(uid).bind(req.ms.clamp(0, MAX_MS)).bind(req.lane_id).bind(&body).fetch_one(&state.db).await?;
    broadcast(&state, &c, "STUDIO_COMMENTS", json!({ "channel_id": c.id, "project_id": pid })).await?;
    Ok((StatusCode::CREATED, Json(cm)))
}

async fn comment_ctx(state: &AppState, cid: Uuid, uid: Uuid) -> AppResult<(Comment, crate::models::Channel, bool)> {
    let cm = sqlx::query_as::<_, Comment>(&format!("SELECT {COMMENT_COLS} FROM studio_comments WHERE id = $1")).bind(cid).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Comment not found".into()))?;
    let project = project_row(&state.db, cm.project_id).await?;
    let (c, p) = studio_channel(&state.db, project.channel_id, uid).await?;
    let crew = is_crew(state, c.id, uid, p).await?;
    Ok((cm, c, crew))
}

#[derive(Deserialize)]
struct Resolve { resolved: bool }

/// Resolve or reopen a comment: its author, editors.
async fn resolve_comment(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(cid): Path<Uuid>, Json(req): Json<Resolve>) -> AppResult<StatusCode> {
    let (cm, c, _) = comment_ctx(&state, cid, uid).await?;
    let (_, p) = studio_channel(&state.db, c.id, uid).await?;
    if cm.user_id != Some(uid) && !can_edit(&state, c.id, uid, p).await? { return Err(AppError::Forbidden); }
    sqlx::query("UPDATE studio_comments SET resolved = $2 WHERE id = $1").bind(cid).bind(req.resolved).execute(&state.db).await?;
    broadcast(&state, &c, "STUDIO_COMMENTS", json!({ "channel_id": c.id, "project_id": cm.project_id })).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_comment(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(cid): Path<Uuid>) -> AppResult<StatusCode> {
    let (cm, c, crew) = comment_ctx(&state, cid, uid).await?;
    if cm.user_id != Some(uid) && !crew { return Err(AppError::Forbidden); }
    sqlx::query("DELETE FROM studio_comments WHERE id = $1").bind(cid).execute(&state.db).await?;
    broadcast(&state, &c, "STUDIO_COMMENTS", json!({ "channel_id": c.id, "project_id": cm.project_id })).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, FromRow)]
pub struct Version { id: Uuid, project_id: Uuid, name: String, created_by: Option<Uuid>, created_at: DateTime<Utc> }
const MAX_VERSIONS: i64 = 100;

async fn list_versions(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>) -> AppResult<Json<Vec<Version>>> {
    let project = project_row(&state.db, pid).await?;
    studio_channel(&state.db, project.channel_id, uid).await?;
    Ok(Json(sqlx::query_as::<_, Version>("SELECT id, project_id, name, created_by, created_at FROM studio_versions WHERE project_id = $1 ORDER BY created_at DESC").bind(pid).fetch_all(&state.db).await?))
}

/// The project as it is: its settings, lanes and clips.
async fn snapshot(db: &sqlx::PgPool, pid: Uuid) -> AppResult<Value> {
    let p = project_row(db, pid).await?;
    let lanes = sqlx::query_as::<_, Lane>(&format!("SELECT {LANE_COLS} FROM studio_lanes WHERE project_id = $1")).bind(pid).fetch_all(db).await?;
    let clips = sqlx::query_as::<_, Clip>(&format!("SELECT {CLIP_COLS} FROM studio_clips WHERE project_id = $1")).bind(pid).fetch_all(db).await?;
    Ok(json!({ "project": { "bpm": p.bpm, "beats": p.beats, "master_gain": p.master_gain, "master_effects": p.master_effects, "tempo_map": p.tempo_map, "loop_on": p.loop_on, "loop_start_ms": p.loop_start_ms, "loop_end_ms": p.loop_end_ms, "punch_on": p.punch_on, "markers": p.markers }, "lanes": lanes, "clips": clips }))
}

async fn store_version(db: &sqlx::PgPool, pid: Uuid, uid: Uuid, name: &str) -> AppResult<Version> {
    let data = snapshot(db, pid).await?;
    let v = sqlx::query_as::<_, Version>("INSERT INTO studio_versions (id, project_id, name, created_by, data) VALUES ($1, $2, $3, $4, $5) RETURNING id, project_id, name, created_by, created_at")
        .bind(Uuid::now_v7()).bind(pid).bind(name).bind(uid).bind(&data).fetch_one(db).await?;
    // The oldest go once there are too many.
    sqlx::query("DELETE FROM studio_versions WHERE project_id = $1 AND id NOT IN (SELECT id FROM studio_versions WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2)").bind(pid).bind(MAX_VERSIONS).execute(db).await?;
    Ok(v)
}

#[derive(Deserialize)]
struct NewVersion { #[serde(default)] name: String }

/// `POST /studio/projects/:pid/versions {name}`: save the project as it is now, to go back to.
async fn save_version(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>, Json(req): Json<NewVersion>) -> AppResult<(StatusCode, Json<Version>)> {
    let project = project_row(&state.db, pid).await?;
    let c = editor(&state, project.channel_id, uid).await?;
    let v = store_version(&state.db, pid, uid, &clean_name(&req.name, &format!("Version {}", Utc::now().format("%Y-%m-%d %H:%M")))).await?;
    broadcast(&state, &c, "STUDIO_VERSIONS", json!({ "channel_id": c.id, "project_id": pid })).await?;
    Ok((StatusCode::CREATED, Json(v)))
}

/// `POST /studio/versions/:vid/restore`: put the project back as it was in a version (saving how it is now first).
/// Clips whose audio has gone since are left out. Everyone reloads it.
async fn restore_version(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(vid): Path<Uuid>) -> AppResult<Json<Value>> {
    let row: Option<(Uuid, String, Value)> = sqlx::query_as("SELECT project_id, name, data FROM studio_versions WHERE id = $1").bind(vid).fetch_optional(&state.db).await?;
    let Some((pid, name, data)) = row else { return Err(AppError::NotFound("Version not found".into())) };
    let project = project_row(&state.db, pid).await?;
    let c = editor(&state, project.channel_id, uid).await?;
    store_version(&state.db, pid, uid, &clean_name(&format!("Before restoring {name}"), "Before restoring")).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("SELECT 1 FROM studio_projects WHERE id = $1 FOR UPDATE").bind(pid).execute(&mut *tx).await?;
    let p = &data["project"];
    sqlx::query("UPDATE studio_projects SET bpm = $2, beats = $3, master_gain = $4, master_effects = $5, tempo_map = $6, loop_on = $7, loop_start_ms = $8, loop_end_ms = $9, punch_on = $10, markers = $11 WHERE id = $1")
        .bind(pid).bind(p["bpm"].as_i64().unwrap_or(120) as i32).bind(p["beats"].as_i64().unwrap_or(4) as i32).bind(p["master_gain"].as_f64().unwrap_or(1.0) as f32)
        .bind(p.get("master_effects").cloned().unwrap_or(json!([]))).bind(p.get("tempo_map").cloned().unwrap_or(json!([]))).bind(p["loop_on"].as_bool().unwrap_or(false))
        .bind(p["loop_start_ms"].as_i64().map(|x| x as i32)).bind(p["loop_end_ms"].as_i64().map(|x| x as i32)).bind(p["punch_on"].as_bool().unwrap_or(false)).bind(p.get("markers").cloned().unwrap_or(json!([])))
        .execute(&mut *tx).await?;
    sqlx::query("DELETE FROM studio_lanes WHERE project_id = $1").bind(pid).execute(&mut *tx).await?;
    for l in data["lanes"].as_array().cloned().unwrap_or_default() {
        sqlx::query("INSERT INTO studio_lanes (id, project_id, name, color, position, gain, pan, mute, solo, user_id, kind, effects, sends, automation, output_id, nudge_ms, instrument, claimed_at)
            SELECT x.id, $1, x.name, x.color, x.position, x.gain, x.pan, x.mute, x.solo, x.user_id, x.kind, x.effects, x.sends, x.automation, x.output_id, x.nudge_ms, x.instrument, x.claimed_at
            FROM jsonb_to_record($2) AS x(id uuid, name text, color text, position real, gain real, pan real, mute bool, solo bool, user_id uuid, kind text, effects jsonb, sends jsonb, automation jsonb, output_id uuid, nudge_ms int, instrument jsonb, claimed_at timestamptz)
            WHERE x.user_id IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = x.user_id)")
            .bind(pid).bind(&l).execute(&mut *tx).await?;
    }
    for cl in data["clips"].as_array().cloned().unwrap_or_default() {
        sqlx::query("INSERT INTO studio_clips (id, project_id, lane_id, audio_id, start_ms, in_ms, length_ms, gain, fade_in_ms, fade_out_ms, muted, created_by, notes, group_id)
            SELECT x.id, $1, x.lane_id, x.audio_id, x.start_ms, x.in_ms, x.length_ms, x.gain, x.fade_in_ms, x.fade_out_ms, x.muted, NULL, x.notes, x.group_id
            FROM jsonb_to_record($2) AS x(id uuid, lane_id uuid, audio_id uuid, start_ms int, in_ms int, length_ms int, gain real, fade_in_ms int, fade_out_ms int, muted bool, notes jsonb, group_id uuid)
            WHERE EXISTS (SELECT 1 FROM studio_lanes WHERE id = x.lane_id AND project_id = $1) AND (x.audio_id IS NULL OR EXISTS (SELECT 1 FROM studio_tracks WHERE id = x.audio_id))")
            .bind(pid).bind(&cl).execute(&mut *tx).await?;
    }
    let (version,): (i64,) = sqlx::query_as("UPDATE studio_projects SET version = version + 1, updated_at = now() WHERE id = $1 RETURNING version").bind(pid).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    broadcast(&state, &c, "STUDIO_PROJECT", json!({ "channel_id": c.id, "project_id": pid, "version": version, "by": uid, "ops": [], "reload": true })).await?;
    broadcast(&state, &c, "STUDIO_VERSIONS", json!({ "channel_id": c.id, "project_id": pid })).await?;
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.project_restore", "channel", Some(c.id), &c.name, json!({ "project": pid, "version": vid, "name": name })).await;
    Ok(Json(json!({ "version": version })))
}

async fn delete_version(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(vid): Path<Uuid>) -> AppResult<StatusCode> {
    let row: Option<(Uuid, Option<Uuid>)> = sqlx::query_as("SELECT project_id, created_by FROM studio_versions WHERE id = $1").bind(vid).fetch_optional(&state.db).await?;
    let Some((pid, by)) = row else { return Err(AppError::NotFound("Version not found".into())) };
    let project = project_row(&state.db, pid).await?;
    let (c, p) = studio_channel(&state.db, project.channel_id, uid).await?;
    if by != Some(uid) && !is_crew(&state, c.id, uid, p).await? { return Err(AppError::Forbidden); }
    sqlx::query("DELETE FROM studio_versions WHERE id = $1").bind(vid).execute(&state.db).await?;
    broadcast(&state, &c, "STUDIO_VERSIONS", json!({ "channel_id": c.id, "project_id": pid })).await?;
    Ok(StatusCode::NO_CONTENT)
}
