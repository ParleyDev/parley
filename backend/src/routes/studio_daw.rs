//! The studio as a DAW. A studio has projects (songs) and one of them is open for everyone in it. A project holds
//! lanes (mixer tracks: name, colour, gain, pan, mute, solo, and whose recordings land there) and clips, each a window
//! onto an audio file of the studio's (a recorded take or an imported file) placed on the timeline, with its own gain
//! and fades.
//!
//! Editing is live and shared: every change is an op (`project`, `lane.put`, `lane.del`, `clip.put`, `clip.del`) sent
//! to `POST /studio/projects/:pid/ops`, applied in one transaction and broadcast to the studio as `STUDIO_PROJECT`
//! with the resulting entities and the project's new version, so every editor sees it at once. Puts are upserts by a
//! client-chosen id carrying only the fields that change, which makes undo a matter of sending the inverse ops. Last
//! write wins per field. The lists inside an item (a clip's notes, a lane's automation points, an effect chain, the
//! markers) have ops of their own (`notes`, `auto`, `fx.put`, `fx.del`, `marker.put`, `marker.del`) that say what
//! was added and taken away, so two members working in one list both keep what they did; they are answered and
//! broadcast as the put of the item they changed. The engineers, Manage Channels and everyone in the band (in the
//! studio, not in the audience) may edit; anyone who can see the studio may read. A protected track is its owner's
//! and the engineers' alone. Solo is not stored: it is each listener's own.
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
        .route("/studio/projects/:pid/transport", post(transport))
        .route("/studio/clock", get(clock))
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
    /// Shared playback: playing from `play_from_ms` since `play_at` (None: stopped there), started by `play_by`.
    pub play_from_ms: i32,
    pub play_at: Option<DateTime<Utc>>,
    pub play_by: Option<Uuid>,
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
    /// Where it records from: {device (an input's name on its owner's device; empty: their default), channel
    /// (mono | 1 | 2 | 1/2)}; None: the owner's default input, mono.
    pub input: Option<SqlJson<Value>>,
    /// Its owner hears the live input through it: in, auto (while armed) or off.
    pub monitor: String,
    pub armed: bool,
    /// Plays only through its sends, not to its output.
    pub sends_only: bool,
    /// Only its owner and the engineers edit it and what is on it.
    pub protected: bool,
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

const PROJECT_COLS: &str = "id, channel_id, name, bpm, beats, master_gain, created_by, created_at, updated_at, version, master_effects, tempo_map, loop_on, loop_start_ms, loop_end_ms, punch_on, markers, tag, archived_at, play_from_ms, play_at, play_by";
const LANE_COLS: &str = "id, project_id, name, color, position, gain, pan, mute, solo, user_id, kind, effects, sends, automation, output_id, nudge_ms, instrument, claimed_at, input, monitor, armed, sends_only, protected";
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
    let target = perms::channel_listing_audience(&state.db, &c).await?;
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
    broadcast(&state, &c, "CHANNEL_UPDATE", json!(room)).await?;
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

#[derive(Deserialize, Default)]
struct LanePatch { id: Uuid, name: Option<String>, color: Option<String>, position: Option<f32>, gain: Option<f32>, pan: Option<f32>, mute: Option<bool>, solo: Option<bool>,
    /// Whose input the track records: a user, or null for no one ("No input").
    #[serde(default, deserialize_with = "present_opt")] user_id: Option<Option<Uuid>>,
    #[serde(default)] kind: Option<String>, #[serde(default)] effects: Option<Value>, #[serde(default)] sends: Option<Value>, #[serde(default)] automation: Option<Value>,
    /// A bus lane's id, or "" / null for the master.
    #[serde(default, deserialize_with = "present")] output_id: Option<Value>, #[serde(default)] nudge_ms: Option<i32>, #[serde(default, deserialize_with = "present")] instrument: Option<Value>,
    #[serde(default, deserialize_with = "present")] input: Option<Value>, #[serde(default)] monitor: Option<String>, #[serde(default)] armed: Option<bool>, #[serde(default)] sends_only: Option<bool>, #[serde(default)] protected: Option<bool> }

#[derive(Deserialize, Default)]
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
        #[serde(default)] punch_on: Option<bool>, #[serde(default)] markers: Option<Value>,
        /// Drop the loop range, and loop and punch with it.
        #[serde(default)] clear_loop: Option<bool> },
    #[serde(rename = "lane.put")]
    LanePut { lane: LanePatch },
    #[serde(rename = "lane.del")]
    LaneDel { id: Uuid },
    #[serde(rename = "clip.put")]
    ClipPut { clip: ClipPatch },
    #[serde(rename = "clip.del")]
    ClipDel { id: Uuid },
    /// Notes put into a MIDI clip and taken out of it (each {p, t, d, v}).
    #[serde(rename = "notes")]
    Notes { clip: Uuid, #[serde(default)] add: Vec<Value>, #[serde(default)] del: Vec<Value> },
    /// Automation points ([ms, value]) put on one parameter of a lane and taken off it.
    #[serde(rename = "auto")]
    Auto { lane: Uuid, param: String, #[serde(default)] add: Vec<Value>, #[serde(default)] del: Vec<Value> },
    /// One effect of a lane's chain (no lane: the master's): what is given of {on, params} changes on the one with
    /// that id, a new one (it has a `type`) goes in at `at` or the end, and `at` moves one that is there.
    #[serde(rename = "fx.put")]
    FxPut { #[serde(default)] lane: Option<Uuid>, effect: Value, #[serde(default)] at: Option<usize> },
    #[serde(rename = "fx.del")]
    FxDel { #[serde(default)] lane: Option<Uuid>, id: String },
    /// One marker: {id, ms, name}, of which a marker that is there takes what is given.
    #[serde(rename = "marker.put")]
    MarkerPut { marker: Value },
    #[serde(rename = "marker.del")]
    MarkerDel { id: String },
}

/// `id`: the batch's own, chosen by its sender; a batch that comes again with the same id is not applied again.
#[derive(Deserialize)]
struct OpsReq { #[serde(default)] id: Option<Uuid>, ops: Vec<Op> }

/// A project op that changes only the lists the item ops work in.
fn project_op(master_effects: Option<Value>, markers: Option<Value>) -> Op {
    Op::Project { name: None, bpm: None, beats: None, master_gain: None, master_effects, tempo_map: None, loop_on: None, loop_start_ms: None, loop_end_ms: None, punch_on: None, markers, clear_loop: None }
}

/// A clip's notes with some taken out and some put in. A note taken out and the one put in at the same place in the
/// two lists are one note changed: it keeps its place. A note to take out that is no longer there is nobody's loss.
fn merge_notes(cur: Value, add: Vec<Value>, del: Vec<Value>) -> AppResult<Value> {
    let list = |v: Value| -> AppResult<Vec<Value>> { Ok(notes(v)?.as_array().cloned().unwrap_or_default()) };
    let (mut cur, mut add) = (list(cur)?, list(Value::Array(add))?.into_iter());
    for d in list(Value::Array(del))? {
        match (cur.iter().position(|n| *n == d), add.next()) {
            (Some(i), Some(a)) => cur[i] = a,
            (Some(i), None) => { cur.remove(i); }
            (None, Some(a)) => cur.push(a),
            (None, None) => {}
        }
    }
    cur.extend(add);
    notes(Value::Array(cur))
}

/// A lane's automation with points taken off one parameter and put on it (not yet in order: `automation` sorts).
fn merge_points(cur: &Value, param: &str, add: Vec<Value>, del: &[Value]) -> Value {
    let mut all = cur.as_object().cloned().unwrap_or_default();
    let mut pts = all.get(param).and_then(Value::as_array).cloned().unwrap_or_default();
    let same = |a: &Value, b: &Value| a.get(0).and_then(Value::as_i64) == b.get(0).and_then(Value::as_i64)
        && matches!((a.get(1).and_then(Value::as_f64), b.get(1).and_then(Value::as_f64)), (Some(x), Some(y)) if (x - y).abs() < 1e-6);
    for d in del { if let Some(i) = pts.iter().position(|p| same(p, d)) { pts.remove(i); } }
    pts.extend(add);
    all.insert(param.to_string(), Value::Array(pts));
    Value::Object(all)
}

fn fx_id(e: &Value) -> Option<&str> { e.get("id").and_then(Value::as_str) }

/// An effect chain with one effect changed, put in or moved.
fn merge_fx(cur: &Value, effect: &Value, at: Option<usize>) -> Value {
    let mut list = cur.as_array().cloned().unwrap_or_default();
    match list.iter().position(|e| fx_id(e).is_some() && fx_id(e) == fx_id(effect)) {
        Some(i) => {
            if let Some(on) = effect.get("on").filter(|v| v.is_boolean()) { list[i]["on"] = on.clone(); }
            if let Some(Value::Object(p)) = effect.get("params") {
                if !list[i]["params"].is_object() { list[i]["params"] = json!({}); }
                for (k, v) in p { list[i]["params"][k.as_str()] = v.clone(); }
            }
            if let Some(at) = at { let e = list.remove(i); list.insert(at.min(list.len()), e); }
        }
        // An effect that was deleted meanwhile stays deleted: only a whole one goes in.
        None if effect.get("type").is_some() => { let at = at.unwrap_or(list.len()).min(list.len()); list.insert(at, effect.clone()); }
        None => {}
    }
    Value::Array(list)
}

fn without_id(cur: &Value, id: &str) -> Value { Value::Array(cur.as_array().into_iter().flatten().filter(|e| fx_id(e) != Some(id)).cloned().collect()) }

/// The markers with one changed or put in.
fn merge_marker(cur: &Value, marker: &Value) -> Value {
    let mut list = cur.as_array().cloned().unwrap_or_default();
    match list.iter().position(|m| fx_id(m).is_some() && fx_id(m) == fx_id(marker)) {
        Some(i) => for k in ["ms", "name"] { if let Some(v) = marker.get(k) { list[i][k] = v.clone(); } },
        // One that was deleted meanwhile stays deleted: only a whole one goes in.
        None if marker.get("ms").is_some() && marker.get("name").is_some() => list.push(marker.clone()),
        None => {}
    }
    Value::Array(list)
}

async fn lane_effects(tx: &mut Transaction<'_, Postgres>, pid: Uuid, lane: Uuid) -> AppResult<Option<Value>> {
    let row: Option<(SqlJson<Value>,)> = sqlx::query_as("SELECT effects FROM studio_lanes WHERE id = $1 AND project_id = $2").bind(lane).bind(pid).fetch_optional(&mut **tx).await?;
    Ok(row.map(|r| r.0 .0))
}

/// A protected lane is its owner's and the crew's: anyone else is refused.
async fn guard(tx: &mut Transaction<'_, Postgres>, lane: Uuid, uid: Uuid, crew: bool) -> AppResult<()> {
    if crew { return Ok(()); }
    let row: Option<(bool, Option<Uuid>)> = sqlx::query_as("SELECT protected, user_id FROM studio_lanes WHERE id = $1").bind(lane).fetch_optional(&mut **tx).await?;
    if row.is_some_and(|(protected, owner)| protected && owner != Some(uid)) { return Err(AppError::Forbidden); }
    Ok(())
}

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
pub const EFFECTS: [&str; 9] = ["eq", "compressor", "reverb", "delay", "drive", "filter", "limiter", "chorus", "gate"];

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
/// A field that may be sent as null to clear it: Some(Null) then, None only when it is left out.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> { Ok(Some(Value::deserialize(d)?)) }
/// The same for a typed field: absent = None, null = Some(None), a value = Some(Some(v)).
fn present_opt<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<Option<T>>, D::Error> { Ok(Some(Option::<T>::deserialize(d)?)) }

/// A track's input: {device: an input's name (empty: the default), channel: mono | 1 | 2 | 1/2}.
fn track_input(v: Value) -> AppResult<Value> {
    let o = v.as_object().ok_or_else(|| AppError::BadRequest("A track's input is an object".into()))?;
    let device: String = o.get("device").and_then(|d| d.as_str()).unwrap_or("").chars().filter(|c| !c.is_control()).take(200).collect();
    let channel = o.get("channel").and_then(|c| c.as_str()).unwrap_or("mono");
    if !["mono", "1", "2", "1/2"].contains(&channel) { return Err(AppError::BadRequest("An input channel is mono, 1, 2 or 1/2".into())); }
    Ok(json!({ "device": device, "channel": channel }))
}

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
async fn apply(tx: &mut Transaction<'_, Postgres>, project: &mut Project, uid: Uuid, crew: bool, op: Op) -> AppResult<serde_json::Value> {
    let pid = project.id;
    match op {
        Op::Project { name, bpm, beats, master_gain, master_effects, tempo_map: tm, loop_on, loop_start_ms, loop_end_ms, punch_on, markers: mk, clear_loop } => {
            if clear_loop == Some(true) { project.loop_start_ms = None; project.loop_end_ms = None; project.loop_on = false; project.punch_on = false; }
            if let Some(v) = master_effects { project.master_effects = SqlJson(effects(v)?); }
            // The name and the tempo are the crew's to change (as on the console and in the project's menu): an
            // artist's op may carry them only as they already are (an undo does).
            let tm = match tm { Some(v) => { let v = tempo_map(v)?; if !crew && v != project.tempo_map.0 { return Err(AppError::Forbidden); } Some(v) } None => None };
            if !crew && (name.as_ref().is_some_and(|n| clean_name(n, &project.name) != project.name) || bpm.is_some_and(|v| v != project.bpm) || beats.is_some_and(|v| v != project.beats)) { return Err(AppError::Forbidden); }
            if let Some(v) = tm { project.tempo_map = SqlJson(v); }
            if let Some(v) = mk { project.markers = SqlJson(markers(v)?); }
            if let Some(v) = loop_start_ms { project.loop_start_ms = Some(range(v, 0, MAX_MS, "Loop start")?); }
            if let Some(v) = loop_end_ms { project.loop_end_ms = Some(range(v, 0, MAX_MS, "Loop end")?); }
            if let (Some(a), Some(b)) = (project.loop_start_ms, project.loop_end_ms) { if b <= a { return Err(AppError::BadRequest("The loop ends after it starts".into())); } }
            if let Some(v) = loop_on { project.loop_on = v; }
            if let Some(v) = punch_on { project.punch_on = v; }
            if (project.loop_on || project.punch_on) && project.loop_end_ms.is_none() { return Err(AppError::BadRequest("Set a loop range first".into())); }
            if let Some(n) = name {
                let n = clean_name(&n, &project.name);
                // The project's channel carries its name.
                if n != project.name { sqlx::query("UPDATE channels SET name = $2 WHERE id = $1").bind(project.channel_id).bind(n.chars().take(100).collect::<String>()).execute(&mut **tx).await?; }
                project.name = n;
            }
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
            // A put of some fields for a lane that is not there was meant for one that has been deleted since.
            if new && l.name.is_none() { return Err(AppError::BadRequest("That track was deleted".into())); }
            let mine = crew || match &cur { Some(c) => c.user_id == Some(uid), None => l.user_id == Some(Some(uid)) };
            if cur.as_ref().is_some_and(|c| c.protected) && !mine { return Err(AppError::Forbidden); }
            let mut v = cur.unwrap_or(Lane { id: l.id, project_id: pid, name: "Track".into(), color: None, position: 0.0, gain: 1.0, pan: 0.0, mute: false, solo: false, user_id: None,
                kind: "audio".into(), effects: SqlJson(json!([])), sends: SqlJson(json!({})), automation: SqlJson(json!({})), output_id: None, nudge_ms: 0, instrument: None, claimed_at: None, input: None, monitor: "off".into(), armed: false, sends_only: false, protected: false });
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
            // Solo is each listener's own: none is stored.
            let _ = l.solo;
            v.solo = false;
            // Making a lane someone's makes it where their takes land from now on.
            if let Some(x) = l.user_id {
                if x.is_some() { v.claimed_at = Some(Utc::now()); v.armed = true; }
                // No one's input any more: nothing to arm, and the device was the previous person's.
                if x.is_none() { v.claimed_at = None; v.armed = false; v.input = None; }
                v.user_id = x;
            }
            if let Some(x) = l.input { v.input = if x.is_null() { None } else { Some(SqlJson(track_input(x)?)) }; }
            if let Some(x) = l.monitor { if !["in", "auto", "off"].contains(&x.as_str()) { return Err(AppError::BadRequest("Monitor is in, auto or off".into())); } v.monitor = x; }
            if let Some(x) = l.armed { v.armed = x; }
            if let Some(x) = l.sends_only { v.sends_only = x; }
            if let Some(x) = l.protected { if x != v.protected && !mine { return Err(AppError::Forbidden); } v.protected = x; }
            sqlx::query("INSERT INTO studio_lanes (id, project_id, name, color, position, gain, pan, mute, solo, user_id, kind, effects, sends, automation, output_id, nudge_ms, instrument, claimed_at, input, monitor, armed, sends_only, protected) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
                ON CONFLICT (id) DO UPDATE SET name = $3, color = $4, position = $5, gain = $6, pan = $7, mute = $8, solo = $9, user_id = $10, effects = $12, sends = $13, automation = $14, output_id = $15, nudge_ms = $16, instrument = $17, claimed_at = $18, input = $19, monitor = $20, armed = $21, sends_only = $22, protected = $23")
                .bind(v.id).bind(pid).bind(&v.name).bind(&v.color).bind(v.position).bind(v.gain).bind(v.pan).bind(v.mute).bind(v.solo).bind(v.user_id)
                .bind(&v.kind).bind(&v.effects).bind(&v.sends).bind(&v.automation).bind(v.output_id).bind(v.nudge_ms).bind(&v.instrument).bind(v.claimed_at).bind(&v.input).bind(&v.monitor).bind(v.armed).bind(v.sends_only).bind(v.protected).execute(&mut **tx).await?;
            Ok(json!({ "op": "lane.put", "lane": v }))
        }
        Op::LaneDel { id } => {
            guard(tx, id, uid, crew).await?;
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
                Some(x) => { guard(tx, x.lane_id, uid, crew).await?; x }
                None => {
                    // A put of some fields for a clip that is not there was meant for one that has been deleted since.
                    let (Some(lane_id), Some(length_ms)) = (c.lane_id, c.length_ms) else { return Err(AppError::BadRequest("That clip was deleted".into())) };
                    Clip { id: c.id, project_id: pid, lane_id, audio_id: None, start_ms: 0, in_ms: 0, length_ms, gain: 1.0, fade_in_ms: 0, fade_out_ms: 0, muted: false, created_by: Some(uid), notes: None, group_id: None }
                }
            };
            if let Some(x) = c.lane_id { guard(tx, x, uid, crew).await?; v.lane_id = x; }
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
            if !crew {
                let lane: Option<(Uuid,)> = sqlx::query_as("SELECT lane_id FROM studio_clips WHERE id = $1 AND project_id = $2").bind(id).bind(pid).fetch_optional(&mut **tx).await?;
                if let Some((lane,)) = lane { guard(tx, lane, uid, crew).await?; }
            }
            sqlx::query("DELETE FROM studio_clips WHERE id = $1 AND project_id = $2").bind(id).bind(pid).execute(&mut **tx).await?;
            Ok(json!({ "op": "clip.del", "id": id }))
        }
        // The ops on what is inside an item: read the list as it stands now, change it, and put the item with it
        // (which checks it and who may). An item that has gone since is left gone, and said to be.
        Op::Notes { clip, add, del } => {
            let cur: Option<(Option<SqlJson<Value>>,)> = sqlx::query_as("SELECT notes FROM studio_clips WHERE id = $1 AND project_id = $2").bind(clip).bind(pid).fetch_optional(&mut **tx).await?;
            let Some((cur,)) = cur else { return Ok(json!({ "op": "clip.del", "id": clip })) };
            let merged = merge_notes(cur.map_or(json!([]), |n| n.0), add, del)?;
            Box::pin(apply(tx, project, uid, crew, Op::ClipPut { clip: ClipPatch { id: clip, notes: Some(merged), ..Default::default() } })).await
        }
        Op::Auto { lane, param, add, del } => {
            let cur: Option<(SqlJson<Value>,)> = sqlx::query_as("SELECT automation FROM studio_lanes WHERE id = $1 AND project_id = $2").bind(lane).bind(pid).fetch_optional(&mut **tx).await?;
            let Some((cur,)) = cur else { return Ok(json!({ "op": "lane.del", "id": lane })) };
            let merged = merge_points(&cur.0, &param, add, &del);
            Box::pin(apply(tx, project, uid, crew, Op::LanePut { lane: LanePatch { id: lane, automation: Some(merged), ..Default::default() } })).await
        }
        Op::FxPut { lane: None, effect, at } => { let merged = merge_fx(&project.master_effects.0, &effect, at); Box::pin(apply(tx, project, uid, crew, project_op(Some(merged), None))).await }
        Op::FxDel { lane: None, id } => { let merged = without_id(&project.master_effects.0, &id); Box::pin(apply(tx, project, uid, crew, project_op(Some(merged), None))).await }
        Op::FxPut { lane: Some(lane), effect, at } => {
            let Some(cur) = lane_effects(tx, pid, lane).await? else { return Ok(json!({ "op": "lane.del", "id": lane })) };
            Box::pin(apply(tx, project, uid, crew, Op::LanePut { lane: LanePatch { id: lane, effects: Some(merge_fx(&cur, &effect, at)), ..Default::default() } })).await
        }
        Op::FxDel { lane: Some(lane), id } => {
            let Some(cur) = lane_effects(tx, pid, lane).await? else { return Ok(json!({ "op": "lane.del", "id": lane })) };
            Box::pin(apply(tx, project, uid, crew, Op::LanePut { lane: LanePatch { id: lane, effects: Some(without_id(&cur, &id)), ..Default::default() } })).await
        }
        Op::MarkerPut { marker } => { let merged = merge_marker(&project.markers.0, &marker); Box::pin(apply(tx, project, uid, crew, project_op(None, Some(merged)))).await }
        Op::MarkerDel { id } => { let merged = without_id(&project.markers.0, &id); Box::pin(apply(tx, project, uid, crew, project_op(None, Some(merged)))).await }
    }
}

/// One at a time per project on this instance, from the change to its broadcast: the events leave in the order of
/// their versions. (Another instance's may still cross them on the way; clients put a late one back in order.)
fn project_lock(pid: Uuid) -> std::sync::Arc<tokio::sync::Mutex<()>> {
    static LOCKS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<Uuid, std::sync::Arc<tokio::sync::Mutex<()>>>>> = std::sync::OnceLock::new();
    let mut map = LOCKS.get_or_init(Default::default).lock().unwrap();
    // Locks nobody holds or waits for go, so the map stays the size of what is being edited.
    if map.len() > 256 { map.retain(|_, l| std::sync::Arc::strong_count(l) > 1); }
    map.entry(pid).or_default().clone()
}

/// The tempo in force at `ms` on a project's timeline: its own, as changed by its tempo map ({bar, bpm, beats} from
/// that bar on, bar 0 being the first).
pub fn tempo_at(bpm: i32, beats: i32, map: &Value, ms: i32) -> (i32, i32) {
    let mut changes: Vec<(i64, i64, i64)> = map.as_array().into_iter().flatten()
        .filter_map(|c| Some((c.get("bar")?.as_i64()?, c.get("bpm")?.as_i64()?, c.get("beats")?.as_i64()?))).filter(|c| c.0 > 0 && c.1 > 0 && c.2 > 0).collect();
    changes.sort();
    let (mut bar, mut sec, mut cur) = (0i64, 0f64, (bpm as i64, beats as i64));
    for (b, t, n) in changes {
        let at = sec + ((b - bar) * cur.1) as f64 * 60.0 / cur.0 as f64;
        if at > ms as f64 / 1000.0 + 1e-9 { break; }
        (bar, sec, cur) = (b, at, (t, n));
    }
    (cur.0 as i32, cur.1 as i32)
}

/// Apply ops to a project as one change, and tell the studio. The new version and what the ops left. `crew`: may
/// the one making it rename the project and change its tempo?
///
/// `batch`: the id its sender gave the change. One that has been applied already is not applied again: the answer
/// is the version it made, no ops, and `true`.
async fn commit(state: &AppState, c: &crate::models::Channel, pid: Uuid, uid: Uuid, crew: bool, batch: Option<Uuid>, ops: Vec<Op>) -> AppResult<(i64, Vec<serde_json::Value>, bool)> {
    let lock = project_lock(pid);
    let _held = lock.lock().await;
    // Before the change, and outside its transaction (a version refers to the project's row, which that locks).
    autosave(state, c, pid, uid).await;
    let mut tx = state.db.begin().await?;
    let mut project = sqlx::query_as::<_, Project>(&format!("SELECT {PROJECT_COLS} FROM studio_projects WHERE id = $1 FOR UPDATE")).bind(pid).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;
    if let Some(b) = batch {
        let done: Option<(i64,)> = sqlx::query_as("SELECT version FROM studio_op_batches WHERE id = $1 AND project_id = $2").bind(b).bind(pid).fetch_optional(&mut *tx).await?;
        if let Some((version,)) = done { return Ok((version, Vec::new(), true)); }
    }
    let (tempo, name) = ((project.bpm, project.beats), project.name.clone());
    let mut out = Vec::with_capacity(ops.len());
    for op in ops { out.push(apply(&mut tx, &mut project, uid, crew, op).await?); }
    let (version,): (i64,) = sqlx::query_as("UPDATE studio_projects SET version = version + 1, updated_at = now() WHERE id = $1 RETURNING version").bind(pid).fetch_one(&mut *tx).await?;
    if let Some(b) = batch {
        sqlx::query("INSERT INTO studio_op_batches (id, project_id, version) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING").bind(b).bind(pid).bind(version).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM studio_op_batches WHERE project_id = $1 AND created_at < now() - interval '1 day'").bind(pid).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    broadcast(state, c, "STUDIO_PROJECT", json!({ "channel_id": c.id, "project_id": pid, "version": version, "by": uid, "ops": out })).await?;
    // The channel shows the project's name, and its console the project's tempo.
    if (project.bpm, project.beats) != tempo || project.name != name {
        let updated = channel_json(state, c.id).await?;
        broadcast(state, &updated, "CHANNEL_UPDATE", json!(updated)).await?;
    }
    if project.name != name { if let Some(sid) = c.parent_id { if let Ok(studio) = channel_json(state, sid).await { broadcast(state, &studio, "STUDIO_PROJECTS", json!({ "channel_id": sid })).await?; } } }
    Ok((version, out, false))
}

/// `POST /studio/projects/:pid/ops {id, ops}`: apply edits (all or none). `repeat`: this batch had been applied.
async fn apply_ops(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>, Json(req): Json<OpsReq>) -> AppResult<Json<serde_json::Value>> {
    if req.ops.is_empty() || req.ops.len() > MAX_OPS { return Err(AppError::BadRequest(format!("Send 1 to {MAX_OPS} ops"))); }
    let project = project_row(&state.db, pid).await?;
    let (c, p) = studio_channel(&state.db, project.channel_id, uid).await?;
    if !can_edit(&state, c.id, uid, p).await? { return Err(AppError::Forbidden); }
    let crew = is_crew(&state, c.id, uid, p).await?;
    let (version, ops, repeat) = commit(&state, &c, pid, uid, crew, req.id, req.ops).await?;
    Ok(Json(json!({ "version": version, "ops": ops, "repeat": repeat })))
}

/// The studio's tempo changed on the console: the open project follows.
pub async fn set_tempo(state: &AppState, pid: Uuid, uid: Uuid, bpm: i32, beats: i32) -> AppResult<()> {
    let project = project_row(&state.db, pid).await?;
    if (project.bpm, project.beats) == (bpm, beats) { return Ok(()); }
    let c = channel_json(state, project.channel_id).await?;
    commit(state, &c, pid, uid, true, None, vec![Op::Project { name: None, bpm: Some(bpm), beats: Some(beats), master_gain: None, master_effects: None, tempo_map: None, loop_on: None, loop_start_ms: None, loop_end_ms: None, clear_loop: None, punch_on: None, markers: None }]).await?;
    Ok(())
}

/// One clip a take becomes on the timeline (all in ms): where it starts, how far into the take's audio, how long;
/// `grouped` clips are the passes of one loop recording, of which only the one not `muted` plays.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TakeClip { pub start_ms: i32, pub in_ms: i32, pub length_ms: i32, pub grouped: bool, pub muted: bool }

/// Where a finished take goes. It was recorded from `position` on the timeline; its audio starts `offset` ms after
/// that (negative: it began in the count-in, and that pre-roll is skipped) and runs `dur` ms. Over a loop `(a, b)`
/// it becomes one clip per pass (passes under 200 ms are dropped), the last pass that fills at least half the loop
/// playing; with `punch`, only what falls inside the range is kept (if at least 50 ms does).
pub fn take_clips(position: i32, offset: i32, dur: i32, range: Option<(i32, i32)>, punch: bool) -> Vec<TakeClip> {
    let mut start = position + offset;
    let mut skip = 0;
    if start < position { skip = position - start; start = position; }
    if dur - skip <= 0 { return Vec::new(); }
    let one = |start_ms, in_ms, length_ms| TakeClip { start_ms, in_ms, length_ms, grouped: false, muted: false };
    match range {
        Some((a, b)) if b > a && !punch => {
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
            if takes.len() <= 1 { return takes.first().map(|(s0, i0, l0)| one(*s0, *i0, *l0)).into_iter().collect(); }
            // The last pass that is mostly there plays.
            let keep = takes.iter().rposition(|x| x.2 * 2 >= pass).unwrap_or(takes.len() - 1);
            takes.iter().enumerate().map(|(i, (s0, i0, l0))| TakeClip { start_ms: *s0, in_ms: *i0, length_ms: *l0, grouped: true, muted: i != keep }).collect()
        }
        Some((a, b)) if b > a => {
            // Punch: only what falls in the range.
            let end = start + dur - skip;
            let (s0, e0) = (start.max(a), end.min(b));
            if e0 - s0 >= 50 { vec![one(s0, skip + (s0 - start), e0 - s0)] } else { Vec::new() }
        }
        _ => vec![one(start, skip, dur - skip)],
    }
}

/// A take recorded into a project finished uploading: put it on its member's lane (made for them if they have none),
/// where they played it. The count-in's pre-roll is trimmed off, so the clip starts at the playhead it was recorded
/// from. A take recorded over a loop becomes one clip per pass, stacked as takes of one group with the last whole
/// pass playing; a punched take keeps only what falls in the punch range.
pub async fn place_take(state: &AppState, c: &crate::models::Channel, sid: Uuid, t: &Track) -> AppResult<()> {
    let Some((Some(pid), position, la, lb, punch)) = sqlx::query_as::<_, (Option<Uuid>, i32, Option<i32>, Option<i32>, bool)>("SELECT project_id, position_ms, loop_start_ms, loop_end_ms, punch FROM studio_sessions WHERE id = $1").bind(sid).fetch_optional(&state.db).await? else { return Ok(()) };
    let (Some(uid), Some(dur)) = (t.user_id, t.duration_ms.filter(|d| *d > 0)) else { return Ok(()) };
    let mut ops = Vec::new();
    // The track it was recorded for, else where the member's takes land.
    let picked: Option<(Uuid,)> = match t.lane_id { Some(l) => sqlx::query_as("SELECT id FROM studio_lanes WHERE id = $1 AND project_id = $2 AND kind = 'audio'").bind(l).bind(pid).fetch_optional(&state.db).await?, None => None };
    let lane: Option<(Uuid,)> = match picked { Some(x) => Some(x), None => sqlx::query_as("SELECT id FROM studio_lanes WHERE project_id = $1 AND user_id = $2 AND kind = 'audio' ORDER BY claimed_at DESC NULLS LAST, position, created_at LIMIT 1").bind(pid).bind(uid).fetch_optional(&state.db).await? };
    let lane_id = match lane {
        Some((id,)) => id,
        None => {
            let (next,): (Option<f32>,) = sqlx::query_as("SELECT (MAX(position) + 1)::real FROM studio_lanes WHERE project_id = $1").bind(pid).fetch_one(&state.db).await?;
            let id = Uuid::now_v7();
            ops.push(Op::LanePut { lane: LanePatch { id, name: Some(t.display_name.clone()), color: None, position: Some(next.unwrap_or(0.0)), gain: None, pan: None, mute: None, solo: None, user_id: Some(Some(uid)), kind: None, effects: None, sends: None, automation: None, output_id: None, nudge_ms: None, instrument: None, input: None, monitor: None, armed: Some(true), sends_only: None, protected: None } });
            id
        }
    };
    let takes = take_clips(position, t.offset_ms, dur, la.zip(lb), punch);
    if takes.is_empty() { return Ok(()); }
    let group = takes.iter().any(|x| x.grouped).then(Uuid::now_v7);
    for x in &takes {
        ops.push(Op::ClipPut { clip: ClipPatch { id: Uuid::now_v7(), lane_id: Some(lane_id), audio_id: Some(t.id), start_ms: Some(x.start_ms), in_ms: Some(x.in_ms), length_ms: Some(x.length_ms), gain: None, fade_in_ms: None, fade_out_ms: None, muted: Some(x.muted), notes: None, group_id: group.filter(|_| x.grouped).map(|g| json!(g.to_string())) } });
    }
    commit(state, c, pid, uid, true, None, ops).await?;
    Ok(())
}

/// More of a take arrived after the server had finished and placed it (its recorder was away): the clip that ran to
/// the end of what there was then runs to the new end. Passes of a loop and punched ranges stay as they are (the
/// audio is there to drag out); a take that was too short to place before is placed now.
pub async fn extend_take(state: &AppState, c: &crate::models::Channel, sid: Uuid, t: &Track, was_ms: i32) -> AppResult<()> {
    if was_ms <= 0 { return place_take(state, c, sid, t).await; }
    let Some((Some(pid), la)) = sqlx::query_as::<_, (Option<Uuid>, Option<i32>)>("SELECT project_id, loop_start_ms FROM studio_sessions WHERE id = $1").bind(sid).fetch_optional(&state.db).await? else { return Ok(()) };
    let (Some(uid), Some(dur)) = (t.user_id, t.duration_ms) else { return Ok(()) };
    if la.is_some() || dur <= was_ms { return Ok(()); }
    let clips: Vec<(Uuid, i32)> = sqlx::query_as("SELECT id, in_ms FROM studio_clips WHERE audio_id = $1 AND project_id = $2 AND in_ms + length_ms = $3").bind(t.id).bind(pid).bind(was_ms).fetch_all(&state.db).await?;
    if clips.is_empty() { return Ok(()); }
    let ops = clips.into_iter().map(|(id, in_ms)| Op::ClipPut { clip: ClipPatch { id, lane_id: None, audio_id: None, start_ms: None, in_ms: None, length_ms: Some(dur - in_ms), gain: None, fade_in_ms: None, fade_out_ms: None, muted: None, notes: None, group_id: None } }).collect();
    commit(state, c, pid, uid, true, None, ops).await?;
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
    // Scanned before it is recorded, like any upload: antivirus and the known-material check (when set up).
    let name = clean_name(&q.name, "Audio");
    let scanned: AppResult<()> = async {
        let bytes = tokio::fs::read(&path).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
        crate::av::check(&state, &bytes, "attachment").await?;
        crate::routes::matching::check(&state, &bytes, crate::routes::matching::Ctx { user_id: uid, surface: "sound", channel_id: Some(id), filename: &name, content_type: &ct }).await
    }.await;
    if let Err(e) = scanned { let _ = tokio::fs::remove_file(&path).await; return Err(e); }
    sqlx::query("INSERT INTO studio_tracks (id, session_id, channel_id, user_id, content_type, size, duration_ms, done, kind, name) VALUES ($1, NULL, $2, $3, $4, $5, $6, true, 'import', $7)")
        .bind(tid).bind(id).bind(uid).bind(&ct).bind(size as i64).bind(q.duration_ms.map(|d| d.clamp(0, MAX_MS))).bind(&name).execute(&state.db).await?;
    let mut t = sqlx::query_as::<_, Track>(&format!("{TRACK_SELECT} WHERE t.id = $1")).bind(tid).fetch_one(&state.db).await?;
    t.url = format!("/api/studio/tracks/{tid}");
    crate::audit::guild(&state, c.guild_id.unwrap(), uid, "studio.import", "channel", Some(id), &c.name, json!({ "audio": tid, "name": name, "size": size })).await;
    Ok((StatusCode::CREATED, Json(t)))
}

#[cfg(test)]
mod tests {
    use super::{automation, autosave_due, effects, markers, merge_fx, merge_marker, merge_notes, merge_points, notes, sends, take_clips, tempo_at, tempo_map, without_id, TakeClip};
    use serde_json::json;

    fn one(start_ms: i32, in_ms: i32, length_ms: i32) -> TakeClip { TakeClip { start_ms, in_ms, length_ms, grouped: false, muted: false } }
    fn pass(start_ms: i32, in_ms: i32, length_ms: i32, muted: bool) -> TakeClip { TakeClip { start_ms, in_ms, length_ms, grouped: true, muted } }

    fn note(p: i64, t: i64) -> serde_json::Value { json!({ "p": p, "t": t, "d": 100, "v": 100 }) }

    #[test]
    fn notes_two_members_put_into_one_clip_are_both_kept() {
        let start = json!([note(60, 0)]);
        // Each adds one, knowing only the clip as it was.
        let after_a = merge_notes(start, vec![note(62, 100)], vec![]).unwrap();
        let after_b = merge_notes(after_a, vec![note(64, 200)], vec![]).unwrap();
        assert_eq!(after_b, json!([note(60, 0), note(62, 100), note(64, 200)]));
    }

    #[test]
    fn a_note_changed_keeps_its_place_and_one_already_gone_is_left_gone() {
        let start = json!([note(60, 0), note(62, 100), note(64, 200)]);
        // Moved: taken out and put in at the same place in the two lists.
        let moved = merge_notes(start.clone(), vec![note(62, 150)], vec![note(62, 100)]).unwrap();
        assert_eq!(moved, json!([note(60, 0), note(62, 150), note(64, 200)]));
        // Taken out twice (two members deleted it): once is all there is to take.
        let once = merge_notes(start.clone(), vec![], vec![note(62, 100)]).unwrap();
        assert_eq!(merge_notes(once.clone(), vec![], vec![note(62, 100)]).unwrap(), once);
        // Of two equal notes one goes.
        assert_eq!(merge_notes(json!([note(60, 0), note(60, 0)]), vec![], vec![note(60, 0)]).unwrap(), json!([note(60, 0)]));
        // A velocity left out is the default, as in the clip.
        assert_eq!(merge_notes(start, vec![], vec![json!({ "p": 60, "t": 0, "d": 100 })]).unwrap(), json!([note(62, 100), note(64, 200)]));
        // What is put in is checked like any note.
        assert!(merge_notes(json!([]), vec![json!({ "p": 200, "t": 0, "d": 1 })], vec![]).is_err());
    }

    #[test]
    fn points_two_members_put_on_one_parameter_are_both_kept() {
        let start = json!({ "gain": [[0, 1.0]], "pan": [[0, 0.0]] });
        let a = merge_points(&start, "gain", vec![json!([2000, 0.5])], &[]);
        let b = merge_points(&a, "gain", vec![json!([1000, 0.25])], &[]);
        assert_eq!(automation(b.clone()).unwrap(), json!({ "gain": [[0, 1.0], [1000, 0.25], [2000, 0.5]], "pan": [[0, 0.0]] }));
        // One moved by one member while the other's stays.
        let c = merge_points(&b, "gain", vec![json!([2500, 0.5])], &[json!([2000, 0.5])]);
        assert_eq!(automation(c.clone()).unwrap()["gain"], json!([[0, 1.0], [1000, 0.25], [2500, 0.5]]));
        // The last point of a parameter taken off: the parameter goes.
        let d = merge_points(&c, "pan", vec![], &[json!([0, 0.0])]);
        assert!(automation(d).unwrap().get("pan").is_none());
        // A parameter nobody had automated yet.
        assert_eq!(automation(merge_points(&json!({}), "pan", vec![json!([10, -1.0])], &[])).unwrap(), json!({ "pan": [[10, -1.0]] }));
    }

    #[test]
    fn an_effect_changed_by_one_member_keeps_what_another_changed() {
        let chain = json!([{ "id": "a", "type": "eq", "on": true, "params": { "low": 0.0, "high": 0.0 } }, { "id": "b", "type": "delay", "on": true, "params": {} }]);
        let one = merge_fx(&chain, &json!({ "id": "a", "params": { "low": 3.0 } }), None);
        let two = merge_fx(&one, &json!({ "id": "a", "params": { "high": -2.0 } }), None);
        assert_eq!(two[0]["params"], json!({ "low": 3.0, "high": -2.0 }));
        // Switched off without touching its parameters.
        assert_eq!(merge_fx(&two, &json!({ "id": "a", "on": false }), None)[0], json!({ "id": "a", "type": "eq", "on": false, "params": { "low": 3.0, "high": -2.0 } }));
        // A new one goes where it is put, or at the end; one that is there moves.
        let added = merge_fx(&two, &json!({ "id": "c", "type": "gate", "on": true, "params": {} }), Some(0));
        assert_eq!(added.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect::<Vec<_>>(), ["c", "a", "b"]);
        let moved = merge_fx(&added, &json!({ "id": "c" }), Some(9));
        assert_eq!(moved.as_array().unwrap().iter().map(|e| e["id"].as_str().unwrap()).collect::<Vec<_>>(), ["a", "b", "c"]);
        // A change to one that was deleted meanwhile does not bring it back.
        let gone = without_id(&moved, "b");
        assert_eq!(merge_fx(&gone, &json!({ "id": "b", "params": { "time": 1.0 } }), None), gone);
        assert!(effects(merge_fx(&gone, &json!({ "id": "d", "type": "reverb" }), None)).is_ok());
    }

    #[test]
    fn markers_are_changed_one_at_a_time() {
        let list = json!([{ "id": "m1", "ms": 0, "name": "Intro" }]);
        let two = merge_marker(&list, &json!({ "id": "m2", "ms": 8000, "name": "Verse" }));
        let renamed = merge_marker(&two, &json!({ "id": "m1", "name": "Start" }));
        assert_eq!(markers(renamed.clone()).unwrap(), json!([{ "id": "m1", "ms": 0, "name": "Start" }, { "id": "m2", "ms": 8000, "name": "Verse" }]));
        // A rename of one that was deleted meanwhile does nothing.
        assert_eq!(merge_marker(&without_id(&renamed, "m2"), &json!({ "id": "m2", "name": "Chorus" })), json!([{ "id": "m1", "ms": 0, "name": "Start" }]));
    }

    #[test]
    fn a_version_is_due_when_none_was_saved_for_the_interval() {
        let now = chrono::Utc::now();
        let every = std::time::Duration::from_secs(600);
        assert!(!autosave_due(0, None, now, every), "an untouched project has nothing to save");
        assert!(autosave_due(3, None, now, every));
        assert!(!autosave_due(3, Some(now - chrono::Duration::seconds(599)), now, every));
        assert!(autosave_due(3, Some(now - chrono::Duration::seconds(600)), now, every));
    }

    #[test]
    fn the_tempo_at_a_moment_follows_the_tempo_map() {
        // No map: the project's own, anywhere.
        assert_eq!(tempo_at(120, 4, &json!([]), 0), (120, 4));
        assert_eq!(tempo_at(120, 4, &json!(null), 90_000), (120, 4));
        // 60 from the third bar (bar 2): two bars of 4 at 120 are 4 s, so the change is in force from 4000 ms.
        let map = json!([{ "bar": 2, "bpm": 60, "beats": 3 }]);
        assert_eq!(tempo_at(120, 4, &map, 3999), (120, 4));
        assert_eq!(tempo_at(120, 4, &map, 4000), (60, 3));
        // Later changes are placed by the tempo before them, in bar order whatever order they are stored in: bar 4
        // is two bars of 3 at 60 (6 s) after bar 2, at 10 s.
        let map = json!([{ "bar": 4, "bpm": 180, "beats": 4 }, { "bar": 2, "bpm": 60, "beats": 3 }]);
        assert_eq!(tempo_at(120, 4, &map, 9999), (60, 3));
        assert_eq!(tempo_at(120, 4, &map, 10_000), (180, 4));
        // A change at the first bar, or one that is no tempo, is not a change.
        assert_eq!(tempo_at(120, 4, &json!([{ "bar": 0, "bpm": 60, "beats": 4 }, { "bar": 1, "bpm": 0, "beats": 4 }, { "bar": 1 }]), 60_000), (120, 4));
    }

    #[test]
    fn a_take_lands_where_it_was_played() {
        // Started late: it sits that much after the playhead, whole.
        assert_eq!(take_clips(4000, 120, 3000, None, false), vec![one(4120, 0, 3000)]);
        assert_eq!(take_clips(0, 0, 3000, None, false), vec![one(0, 0, 3000)]);
        // Started in the count-in: the pre-roll is skipped and the clip starts at the playhead.
        assert_eq!(take_clips(4000, -2000, 5000, None, false), vec![one(4000, 2000, 3000)]);
        // Nothing but pre-roll, or nothing at all.
        assert_eq!(take_clips(4000, -2000, 2000, None, false), vec![]);
        assert_eq!(take_clips(4000, -2000, 1500, None, false), vec![]);
        // Half a loop range, or an empty one, is no range.
        assert_eq!(take_clips(1000, 0, 3000, Some((2000, 2000)), false), vec![one(1000, 0, 3000)]);
        assert_eq!(take_clips(1000, 0, 3000, Some((5000, 2000)), true), vec![one(1000, 0, 3000)]);
    }

    #[test]
    fn a_looped_take_becomes_its_passes() {
        // Three whole passes of a 2 s loop: the last plays.
        assert_eq!(take_clips(1000, 0, 6000, Some((1000, 3000)), false), vec![pass(1000, 0, 2000, true), pass(1000, 2000, 2000, true), pass(1000, 4000, 2000, false)]);
        // A last pass under half the loop stays muted, the one before it plays.
        assert_eq!(take_clips(1000, 0, 4900, Some((1000, 3000)), false), vec![pass(1000, 0, 2000, true), pass(1000, 2000, 2000, false), pass(1000, 4000, 900, true)]);
        // A last pass under 200 ms is dropped.
        assert_eq!(take_clips(1000, 0, 4100, Some((1000, 3000)), false), vec![pass(1000, 0, 2000, true), pass(1000, 2000, 2000, false)]);
        // Under one pass: a plain clip, not a group.
        assert_eq!(take_clips(1000, 0, 1500, Some((1000, 3000)), false), vec![one(1000, 0, 1500)]);
        // Started mid-loop: the first pass runs to the loop's end, the rest from its start.
        assert_eq!(take_clips(2500, 0, 2500, Some((1000, 3000)), false), vec![pass(2500, 0, 500, true), pass(1000, 500, 2000, false)]);
        // With a count-in: the pre-roll is skipped, the audio offsets follow.
        assert_eq!(take_clips(1000, -1000, 5000, Some((1000, 3000)), false), vec![pass(1000, 1000, 2000, true), pass(1000, 3000, 2000, false)]);
        // No pass fills half the loop: the last one plays.
        assert_eq!(take_clips(2700, 0, 1000, Some((1000, 3000)), false), vec![pass(2700, 0, 300, true), pass(1000, 300, 700, false)]);
    }

    #[test]
    fn a_punched_take_keeps_what_is_in_range() {
        // Rolling from before the punch-in to after the punch-out.
        assert_eq!(take_clips(0, 0, 10_000, Some((4000, 6000)), true), vec![one(4000, 4000, 2000)]);
        // With a count-in before it.
        assert_eq!(take_clips(2000, -1000, 6000, Some((4000, 6000)), true), vec![one(4000, 3000, 2000)]);
        // Stopped inside the range, started inside it.
        assert_eq!(take_clips(0, 0, 5000, Some((4000, 6000)), true), vec![one(4000, 4000, 1000)]);
        assert_eq!(take_clips(5000, 0, 3000, Some((4000, 6000)), true), vec![one(5000, 0, 1000)]);
        // Never reached it, or barely.
        assert_eq!(take_clips(0, 0, 3000, Some((4000, 6000)), true), vec![]);
        assert_eq!(take_clips(0, 0, 4040, Some((4000, 6000)), true), vec![]);
    }

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
pub struct Version { id: Uuid, project_id: Uuid, name: String, created_by: Option<Uuid>, created_at: DateTime<Utc>,
    /// Saved by the server while the project was being edited, not by a member.
    auto: bool }
const MAX_VERSIONS: i64 = 100;
/// The server's own versions are kept apart from the members', and fewer of them.
const MAX_AUTO_VERSIONS: i64 = 20;
const VERSION_COLS: &str = "id, project_id, name, created_by, created_at, auto";

/// How long a project is edited before the server saves a version of it by itself (`STUDIO_AUTOSAVE_SECS`).
fn autosave_every() -> std::time::Duration {
    static EVERY: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    std::time::Duration::from_secs(*EVERY.get_or_init(|| std::env::var("STUDIO_AUTOSAVE_SECS").ok().and_then(|v| v.parse().ok()).filter(|s| *s > 0).unwrap_or(600)))
}

/// Is a version due? There is something to save, and nothing was saved (by anyone) for `every`.
fn autosave_due(version: i64, last: Option<DateTime<Utc>>, now: DateTime<Utc>, every: std::time::Duration) -> bool {
    version > 0 && last.is_none_or(|t| (now - t).num_milliseconds() >= every.as_millis() as i64)
}

/// A project about to be changed gets a version of how it is, if none was saved for a while: an edit that turns out
/// wrong an hour later has something to go back to. Asked of the database at most once a minute per project on this
/// instance. A failure is logged and the edit goes on.
async fn autosave(state: &AppState, c: &crate::models::Channel, pid: Uuid, uid: Uuid) {
    static CHECKED: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<Uuid, std::time::Instant>>> = std::sync::OnceLock::new();
    let every = autosave_every();
    {
        let mut map = CHECKED.get_or_init(Default::default).lock().unwrap();
        if map.get(&pid).is_some_and(|t| t.elapsed() < every.min(std::time::Duration::from_secs(60))) { return; }
        if map.len() > 4096 { map.retain(|_, t| t.elapsed() < every); }
        map.insert(pid, std::time::Instant::now());
    }
    let run = async {
        let row: Option<(i64, Option<DateTime<Utc>>)> = sqlx::query_as("SELECT p.version, (SELECT MAX(created_at) FROM studio_versions WHERE project_id = p.id) FROM studio_projects p WHERE p.id = $1").bind(pid).fetch_optional(&state.db).await?;
        let Some((version, last)) = row else { return Ok(()) };
        if !autosave_due(version, last, Utc::now(), every) { return Ok(()); }
        store_version(&state.db, pid, uid, &format!("Autosave {}", Utc::now().format("%Y-%m-%d %H:%M")), true).await?;
        broadcast(state, c, "STUDIO_VERSIONS", json!({ "channel_id": c.id, "project_id": pid })).await
    };
    let res: AppResult<()> = run.await;
    if let Err(e) = res { tracing::warn!(error = ?e, project = %pid, "could not save a version of a studio project"); }
}

async fn list_versions(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>) -> AppResult<Json<Vec<Version>>> {
    let project = project_row(&state.db, pid).await?;
    studio_channel(&state.db, project.channel_id, uid).await?;
    Ok(Json(sqlx::query_as::<_, Version>(&format!("SELECT {VERSION_COLS} FROM studio_versions WHERE project_id = $1 ORDER BY created_at DESC")).bind(pid).fetch_all(&state.db).await?))
}

/// The project as it is: its settings, lanes and clips.
async fn snapshot(db: &sqlx::PgPool, pid: Uuid) -> AppResult<Value> {
    let p = project_row(db, pid).await?;
    let lanes = sqlx::query_as::<_, Lane>(&format!("SELECT {LANE_COLS} FROM studio_lanes WHERE project_id = $1")).bind(pid).fetch_all(db).await?;
    let clips = sqlx::query_as::<_, Clip>(&format!("SELECT {CLIP_COLS} FROM studio_clips WHERE project_id = $1")).bind(pid).fetch_all(db).await?;
    Ok(json!({ "project": { "bpm": p.bpm, "beats": p.beats, "master_gain": p.master_gain, "master_effects": p.master_effects, "tempo_map": p.tempo_map, "loop_on": p.loop_on, "loop_start_ms": p.loop_start_ms, "loop_end_ms": p.loop_end_ms, "punch_on": p.punch_on, "markers": p.markers }, "lanes": lanes, "clips": clips }))
}

async fn store_version(db: &sqlx::PgPool, pid: Uuid, uid: Uuid, name: &str, auto: bool) -> AppResult<Version> {
    let data = snapshot(db, pid).await?;
    let v = sqlx::query_as::<_, Version>(&format!("INSERT INTO studio_versions (id, project_id, name, created_by, data, auto) VALUES ($1, $2, $3, $4, $5, $6) RETURNING {VERSION_COLS}"))
        .bind(Uuid::now_v7()).bind(pid).bind(name).bind(uid).bind(&data).bind(auto).fetch_one(db).await?;
    // The oldest of its kind go once there are too many: the server's never push out a member's.
    sqlx::query("DELETE FROM studio_versions WHERE project_id = $1 AND auto = $3 AND id NOT IN (SELECT id FROM studio_versions WHERE project_id = $1 AND auto = $3 ORDER BY created_at DESC LIMIT $2)")
        .bind(pid).bind(if auto { MAX_AUTO_VERSIONS } else { MAX_VERSIONS }).bind(auto).execute(db).await?;
    Ok(v)
}

#[derive(Deserialize)]
struct NewVersion { #[serde(default)] name: String }

/// `POST /studio/projects/:pid/versions {name}`: save the project as it is now, to go back to.
async fn save_version(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>, Json(req): Json<NewVersion>) -> AppResult<(StatusCode, Json<Version>)> {
    let project = project_row(&state.db, pid).await?;
    let c = editor(&state, project.channel_id, uid).await?;
    let v = store_version(&state.db, pid, uid, &clean_name(&req.name, &format!("Version {}", Utc::now().format("%Y-%m-%d %H:%M"))), false).await?;
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
    store_version(&state.db, pid, uid, &clean_name(&format!("Before restoring {name}"), "Before restoring"), false).await?;
    let lock = project_lock(pid);
    let _held = lock.lock().await;
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
        sqlx::query("INSERT INTO studio_lanes (id, project_id, name, color, position, gain, pan, mute, solo, user_id, kind, effects, sends, automation, output_id, nudge_ms, instrument, claimed_at, input, monitor, armed, sends_only, protected)
            SELECT x.id, $1, x.name, x.color, x.position, x.gain, x.pan, x.mute, false, x.user_id, x.kind, x.effects, x.sends, x.automation, x.output_id, x.nudge_ms, x.instrument, x.claimed_at, x.input, COALESCE(x.monitor, 'off'), COALESCE(x.armed, false), COALESCE(x.sends_only, false), COALESCE(x.protected, false)
            FROM jsonb_to_record($2) AS x(id uuid, name text, color text, position real, gain real, pan real, mute bool, solo bool, user_id uuid, kind text, effects jsonb, sends jsonb, automation jsonb, output_id uuid, nudge_ms int, instrument jsonb, claimed_at timestamptz, input jsonb, monitor text, armed bool, sends_only bool, protected bool)
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
    // The console shows the project's tempo, which the version may have changed.
    let updated = channel_json(&state, c.id).await?;
    broadcast(&state, &updated, "CHANNEL_UPDATE", json!(updated)).await?;
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

#[derive(Deserialize)]
struct TransportReq { playing: bool, #[serde(default)] position_ms: i32 }

/// `POST /studio/projects/:pid/transport {playing, position_ms}`: play (from a position) or stop for everyone in the
/// project. Anyone who edits it may; playback starts a moment ahead so every client can be there on time.
async fn transport(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(pid): Path<Uuid>, Json(req): Json<TransportReq>) -> AppResult<Json<Value>> {
    let project = project_row(&state.db, pid).await?;
    let c = editor(&state, project.channel_id, uid).await?;
    let pos = req.position_ms.clamp(0, MAX_MS);
    let at = req.playing.then(|| Utc::now() + chrono::Duration::milliseconds(250));
    sqlx::query("UPDATE studio_projects SET play_from_ms = $2, play_at = $3, play_by = $4 WHERE id = $1").bind(pid).bind(pos).bind(at).bind(uid).execute(&state.db).await?;
    let ev = json!({ "project_id": pid, "channel_id": c.id, "play_from_ms": pos, "play_at": at, "play_by": uid });
    broadcast(&state, &c, "STUDIO_TRANSPORT", ev.clone()).await?;
    Ok(Json(ev))
}

/// `GET /studio/clock`: the server's time in ms, for clients to line their clocks up with (shared playback, takes).
async fn clock() -> Json<Value> { Json(json!({ "now": Utc::now().timestamp_millis() })) }
