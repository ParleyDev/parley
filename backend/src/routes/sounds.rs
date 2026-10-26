//! Soundboard: per-server sounds (MP3/OGG/WAV/WebM, 512 KB) uploaded by Manage Server, played into a voice channel
//! by anyone connected to it with Speak. Playing is a broadcast: every client in the channel plays the file locally.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    perms,
    ratelimit::rl_uploads,
    routes::channels::require_channel_perms,
    state::AppState,
};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::{header, HeaderValue, StatusCode},
    middleware::from_fn,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

pub const MAX_SOUND_BYTES: usize = 512 * 1024;
pub const MAX_SOUNDS_PER_GUILD: i64 = 48;
const SOUND_COLS: &str = "id, guild_id, name, emoji, content_type, size, volume, creator_id, created_at";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/sounds", get(list).post(create).route_layer(from_fn(rl_uploads)).layer(DefaultBodyLimit::max(MAX_SOUND_BYTES + 64 * 1024)))
        .route("/guilds/:id/sounds/:sid", delete(remove))
        .route("/sounds/:sid", get(serve))
        .route("/channels/:id/soundboard/:sid", post(play))
}

/// Sounds every soundboard has, synthesised by the client: (id, name, emoji).
pub const BUILTINS: &[(&str, &str, &str)] = &[
    ("airhorn", "Airhorn", "📯"), ("crickets", "Crickets", "🦗"), ("rimshot", "Ba Dum Tss", "🥁"),
    ("clap", "Golf Clap", "👏"), ("quack", "Quack", "🦆"), ("boing", "Boing", "🎈"), ("tada", "Tada", "🎉"), ("sadtrombone", "Sad Trombone", "🎺"),
];

/// A playable sound by id: `builtin:<name>`, or a sound from any server `uid` is in. JSON as SOUNDBOARD_PLAY sends it.
pub async fn resolve(db: &PgPool, uid: Uuid, sid: &str) -> AppResult<Option<serde_json::Value>> {
    if let Some(name) = sid.strip_prefix("builtin:") {
        return Ok(BUILTINS.iter().find(|b| b.0 == name).map(|(id, label, emoji)| json!({ "id": format!("builtin:{id}"), "name": label, "emoji": emoji, "volume": 1.0, "url": "", "builtin": true })));
    }
    let Ok(id) = sid.parse::<Uuid>() else { return Ok(None) };
    let s = sqlx::query_as::<_, Sound>(&format!("SELECT {SOUND_COLS} FROM sounds s WHERE id = $1 AND EXISTS (SELECT 1 FROM guild_members m WHERE m.guild_id = s.guild_id AND m.user_id = $2)"))
        .bind(id).bind(uid).fetch_optional(db).await?;
    Ok(s.map(|s| json!(with_url(s))))
}

#[derive(Debug, Serialize, FromRow)]
pub struct Sound {
    pub id: Uuid,
    pub guild_id: Uuid,
    pub name: String,
    pub emoji: String,
    pub content_type: String,
    pub size: i64,
    pub volume: f32,
    pub creator_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub url: String,
}

fn with_url(mut s: Sound) -> Sound { s.url = format!("/api/sounds/{}", s.id); s }

async fn require_member(db: &PgPool, guild_id: Uuid, uid: Uuid) -> AppResult<()> {
    let row: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2").bind(guild_id).bind(uid).fetch_optional(db).await?;
    if row.is_some() { Ok(()) } else { Err(AppError::NotFound("Server not found".into())) }
}

pub async fn sounds_for(db: &PgPool, guild_id: Uuid) -> AppResult<Vec<Sound>> {
    let rows = sqlx::query_as::<_, Sound>(&format!("SELECT {SOUND_COLS} FROM sounds WHERE guild_id = $1 ORDER BY name")).bind(guild_id).fetch_all(db).await?;
    Ok(rows.into_iter().map(with_url).collect())
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Sound>>> {
    require_member(&state.db, id, uid).await?;
    Ok(Json(sounds_for(&state.db, id).await?))
}

async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, mut multipart: Multipart) -> AppResult<(StatusCode, Json<Sound>)> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check_any(p, perms::MANAGE_GUILD | perms::MANAGE_EXPRESSIONS)?;
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sounds WHERE guild_id = $1").bind(id).fetch_one(&state.db).await?;
    if count >= MAX_SOUNDS_PER_GUILD {
        return Err(AppError::BadRequest(format!("A server can have at most {MAX_SOUNDS_PER_GUILD} sounds")));
    }
    let mut name = String::new();
    let mut emoji = String::new();
    let mut volume: f32 = 1.0;
    let mut data: Option<(Vec<u8>, String)> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(format!("Bad upload: {e}")))? {
        match field.name() {
            Some("file") => {
                let declared = field.content_type().unwrap_or("").to_string();
                let bytes = field.bytes().await.map_err(|e| AppError::BadRequest(format!("Upload interrupted: {e}")))?;
                if bytes.len() > MAX_SOUND_BYTES { return Err(AppError::BadRequest("Sounds must be under 512 KB".into())); }
                data = Some((bytes.to_vec(), declared));
            }
            Some("name") => name = field.text().await.unwrap_or_default(),
            Some("emoji") => emoji = field.text().await.unwrap_or_default(),
            Some("volume") => volume = field.text().await.ok().and_then(|v| v.trim().parse().ok()).unwrap_or(1.0),
            _ => {}
        }
    }
    let (bytes, declared) = data.ok_or_else(|| AppError::BadRequest("Missing 'file' field".into()))?;
    if bytes.is_empty() { return Err(AppError::BadRequest("Empty file".into())); }
    let sniffed = infer::get(&bytes).map(|t| t.mime_type().to_string());
    let content_type = match sniffed.as_deref() {
        Some(t @ ("audio/mpeg" | "audio/ogg" | "audio/x-wav" | "audio/wav" | "audio/webm" | "audio/x-m4a" | "audio/mp4")) => t.to_string(),
        Some("video/webm") if declared.starts_with("audio/") => "audio/webm".into(),
        _ => return Err(AppError::BadRequest("Sound must be an MP3, OGG, WAV, WebM or M4A file".into())),
    };
    let name: String = name.trim().chars().take(32).collect();
    if name.chars().count() < 2 { return Err(AppError::BadRequest("Name must be 2-32 characters".into())); }
    let emoji: String = emoji.trim().chars().take(8).collect();
    let volume = volume.clamp(0.05, 1.0);
    crate::av::check(&state, &bytes, "sound").await?;
    let sid = Uuid::new_v4();
    let dir = &state.config.upload_dir;
    tokio::fs::create_dir_all(dir).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    tokio::fs::write(dir.join(sid.to_string()), &bytes).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let res = sqlx::query_as::<_, Sound>(&format!(
        "INSERT INTO sounds (id, guild_id, name, emoji, content_type, size, volume, creator_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {SOUND_COLS}"
    ))
    .bind(sid).bind(id).bind(&name).bind(&emoji).bind(&content_type).bind(bytes.len() as i64).bind(volume).bind(uid)
    .fetch_one(&state.db)
    .await;
    let sound = match res {
        Ok(s) => with_url(s),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            let _ = tokio::fs::remove_file(dir.join(sid.to_string())).await;
            return Err(AppError::Conflict("A sound with that name already exists".into()));
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(dir.join(sid.to_string())).await;
            return Err(e.into());
        }
    };
    state.hub.emit_guild(id, "SOUNDBOARD_UPDATE", json!({ "guild_id": id, "sounds": sounds_for(&state.db, id).await? }));
    crate::audit::guild(&state, id, uid, "sound.create", "sound", Some(sound.id), &sound.name, json!({})).await;
    Ok((StatusCode::CREATED, Json(sound)))
}

async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, sid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check_any(p, perms::MANAGE_GUILD | perms::MANAGE_EXPRESSIONS)?;
    let name: Option<(String,)> = sqlx::query_as("DELETE FROM sounds WHERE id = $1 AND guild_id = $2 RETURNING name").bind(sid).bind(id).fetch_optional(&state.db).await?;
    let Some((name,)) = name else { return Err(AppError::NotFound("Sound not found".into())) };
    let _ = tokio::fs::remove_file(state.config.upload_dir.join(sid.to_string())).await;
    state.hub.emit_guild(id, "SOUNDBOARD_UPDATE", json!({ "guild_id": id, "sounds": sounds_for(&state.db, id).await? }));
    crate::audit::guild(&state, id, uid, "sound.delete", "sound", Some(sid), &name, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Sound files are served without auth (like attachments) under an unguessable id.
async fn serve(State(state): State<AppState>, Path(sid): Path<Uuid>) -> AppResult<Response> {
    let s = sqlx::query_as::<_, Sound>(&format!("SELECT {SOUND_COLS} FROM sounds WHERE id = $1")).bind(sid).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Sound not found".into()))?;
    let file = tokio::fs::File::open(state.config.upload_dir.join(sid.to_string())).await.map_err(|_| AppError::NotFound("Sound file missing".into()))?;
    let mut resp = Response::new(Body::from_stream(tokio_util::io::ReaderStream::new(file)));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&s.content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(s.size as u64));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_static("inline"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
    Ok(resp.into_response())
}

/// `POST /channels/:id/soundboard/:sid`: play a sound into the call the caller is in (a server voice channel, or a
/// DM / group call). Needs Speak in a server (and not to be suppressed). The sound can be a built-in or come from any
/// server the caller is in.
async fn play(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, sid)): Path<(Uuid, String)>) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    if c.guild_id.is_some() {
        if c.kind != "voice" { return Err(AppError::BadRequest("Not a voice channel".into())); }
        perms::check(p, perms::SPEAK)?;
    }
    let vs = state.hub.voice_state(uid).filter(|v| v.channel_id == id).ok_or_else(|| AppError::BadRequest("Join the call first".into()))?;
    if vs.suppress || vs.mute { return Err(AppError::Forbidden); }
    let sound = resolve(&state.db, uid, &sid).await?.ok_or_else(|| AppError::NotFound("Sound not found".into()))?;
    emit_play(&state, &c, uid, sound, false).await
}

/// Tell everyone in the call to play `sound` (entrance sounds say so, so clients can respect their own setting).
pub async fn emit_play(state: &AppState, c: &crate::models::Channel, uid: Uuid, sound: serde_json::Value, entrance: bool) -> AppResult<StatusCode> {
    let d = json!({ "channel_id": c.id, "guild_id": c.guild_id, "user_id": uid, "sound": sound, "entrance": entrance });
    let target = crate::routes::channels::target_for(&state.db, c).await?;
    state.hub.emit(target, "SOUNDBOARD_PLAY", d);
    Ok(StatusCode::NO_CONTENT)
}
