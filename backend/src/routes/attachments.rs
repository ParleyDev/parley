//! File attachments: uploaded first (`POST /channels/:id/attachments`), then referenced by
//! `attachment_ids` when the message is created. Files live on disk under `UPLOAD_DIR/<id>`;
//! metadata in the `attachments` table. Served at `/api/attachments/:id/:filename` without
//! auth, relying on the unguessable v4 id (Discord-CDN style) so `<img>` tags work.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::Attachment,
    perms,
    routes::channels::require_channel_perms,
    state::AppState,
};
use crate::ratelimit::rl_uploads;
use axum::{middleware::from_fn,
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

pub const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;
/// Hard ceiling for the request body (per-user limits can be raised up to this).
pub const BODY_CEILING: usize = 4 * 1024 * 1024 * 1024 + 1024 * 1024;

/// The largest single upload this user may make: their override, else the instance setting, else 25 MB.
pub async fn max_upload_bytes(state: &AppState, uid: Uuid) -> AppResult<usize> {
    let (over,): (Option<i64>,) = sqlx::query_as("SELECT max_upload_bytes FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if let Some(v) = over.filter(|v| *v > 0) { return Ok(v as usize) }
    let inst = crate::routes::admin::load_settings(&state.db).await?.max_upload_bytes;
    Ok(if inst > 0 { inst as usize } else { MAX_FILE_BYTES })
}
pub const MAX_PER_MESSAGE: usize = 10;
/// Pending (unlinked) uploads older than this are swept.
const ORPHAN_TTL_SECS: i64 = 60 * 60;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/attachments", post(upload).route_layer(from_fn(rl_uploads)).layer(DefaultBodyLimit::max(BODY_CEILING)))
        .route("/attachments/:id/thumb", get(serve_thumb))
        .route("/attachments/:id/viz", get(serve_viz))
        .route("/attachments/:id/listened", post(mark_listened))
        .route("/attachments/:id/played", post(mark_played))
        .route("/attachments/:id/transcribe", post(retranscribe))
        .route("/attachments/:id/:filename", get(serve))
}

pub const ATTACHMENT_COLS: &str = "id, message_id, uploader_id, channel_id, filename, content_type, size, width, height, created_at, thumb_type, duration_ms, waveform, transcript, transcript_status, description, plays, media_ms";

fn sanitize_filename(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("file");
    let cleaned: String = base.chars().filter(|c| !c.is_control()).take(200).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." { "file".to_string() } else { trimmed.to_string() }
}

/// Browsers will render these inline; everything else is forced to download.
fn inline_type(ct: &str) -> bool {
    matches!(ct, "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif" | "video/mp4" | "video/webm" | "video/quicktime" | "audio/mpeg" | "audio/ogg" | "audio/wav" | "audio/x-wav" | "audio/wave" | "audio/flac" | "audio/x-flac" | "audio/aac" | "audio/x-m4a" | "audio/webm" | "audio/mp4" | "application/pdf" | "text/plain")
}

async fn upload(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(channel_id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<Attachment>)> {
    let (c, p) = require_channel_perms(&state.db, channel_id, uid).await?;
    perms::check(p, perms::SEND_MESSAGES)?;
    if c.guild_id.is_some() {
        perms::check(p, perms::ATTACH_FILES)?;
    }

    // Voice messages send their metadata as text fields *before* the file.
    let mut duration_ms: Option<i32> = None;
    let mut waveform: Option<String> = None;
    let mut field = loop {
        match multipart.next_field().await.map_err(|e| AppError::BadRequest(format!("Bad upload: {e}")))? {
            Some(f) if f.name() == Some("file") => break f,
            Some(f) if f.name() == Some("duration_ms") => { duration_ms = f.text().await.ok().and_then(|t| t.trim().parse::<i32>().ok()).filter(|d| (1..=20 * 60 * 1000).contains(d)); }
            Some(f) if f.name() == Some("waveform") => { waveform = f.text().await.ok().map(|t| t.trim().chars().take(200).collect::<String>()).filter(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')); }
            Some(_) => continue,
            None => return Err(AppError::BadRequest("Missing 'file' field".into())),
        }
    };
    let mut filename = sanitize_filename(field.file_name().unwrap_or("file"));
    let declared = field.content_type().unwrap_or("application/octet-stream").to_string();

    // Stream to disk, enforcing the size cap as we go.
    let id = Uuid::new_v4();
    let dir = &state.config.upload_dir;
    tokio::fs::create_dir_all(dir).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let path = dir.join(id.to_string());
    let mut file = tokio::fs::File::create(&path).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let limit = max_upload_bytes(&state, uid).await?;
    let mut size: usize = 0;
    let mut too_big = false;
    let mut head: Vec<u8> = Vec::with_capacity(8192);
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = field.chunk().await.map_err(|e| AppError::BadRequest(format!("Upload interrupted: {e}")))? {
        size += chunk.len();
        if size > limit {
            // Keep draining so the client (and nginx) see a clean 400 instead of a reset connection.
            too_big = true;
            continue;
        }
        if head.len() < 8192 {
            head.extend_from_slice(&chunk[..chunk.len().min(8192 - head.len())]);
        }
        file.write_all(&chunk).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    }
    file.flush().await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    if too_big {
        drop(file);
        let _ = tokio::fs::remove_file(&path).await;
        return Err(AppError::BadRequest(format!("File too large (max {})", crate::routes::storage::human(limit as i64))));
    }
    if size == 0 {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(AppError::BadRequest("Empty file".into()));
    }
    if let Err(e) = crate::routes::storage::check_quota(&state, uid, size as i64).await {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(e);
    }
    // Antivirus (when configured): the file is scanned before it is recorded, so it is never served unscanned.
    if let Ok(bytes) = tokio::fs::read(&path).await {
        if let Err(e) = crate::av::check(&state, &bytes, "attachment").await {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(e);
        }
    }

    // Trust magic bytes over the declared type for anything we'd render inline.
    let sniffed = infer::get(&head).map(|t| t.mime_type().to_string());
    let mut content_type = match sniffed {
        // Audio-only WebM and MP4 (iPhone recordings) sniff as video; trust the declared audio type for recordings.
        Some(s) if (s.starts_with("video/webm") || s.starts_with("video/mp4") || s.starts_with("video/quicktime")) && declared.starts_with("audio/") => declared.clone(),
        Some(s) => s,
        None if declared.starts_with("text/") => declared,
        None => "application/octet-stream".to_string(),
    };
    let (width, height) = if content_type.starts_with("image/") {
        match imagesize::blob_size(&head).or_else(|_| imagesize::size(&path)) {
            Ok(d) => {
                // Phone photos stored sideways (EXIF orientation 5-8) display with width and height swapped.
                let p = path.clone();
                let turned = tokio::task::spawn_blocking(move || crate::routes::storage::swaps_axes(crate::routes::storage::image_orientation(&p))).await.unwrap_or(false);
                if turned { (Some(d.height as i32), Some(d.width as i32)) } else { (Some(d.width as i32), Some(d.height as i32)) }
            }
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };

    // Voice messages recorded as WebM/Ogg become AAC .m4a so iPhones can play them (see voice_audio.rs).
    if duration_ms.is_some() && content_type.starts_with("audio/") && crate::voice_audio::needs_conversion(&content_type) {
        match crate::voice_audio::convert_in_place(&path).await {
            Ok(n) => { content_type = "audio/mp4".into(); filename = crate::voice_audio::m4a_name(&filename); size = n as usize; }
            Err(e) => tracing::warn!(attachment = %id, error = %e, "voice message kept in its recorded format"),
        }
    }
    let mut thumb_type = crate::routes::storage::make_thumbnail(path.clone(), &content_type, width, height).await;
    // Videos: a poster frame, which is also where their size comes from.
    let (width, height) = if crate::video_thumb::is_video(&content_type) {
        match crate::video_thumb::make(&path).await { Some((w, h)) => { thumb_type = Some("image/jpeg".into()); (Some(w), Some(h)) } None => (width, height) }
    } else { (width, height) };
    crate::metrics::METRICS.uploads.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    crate::metrics::METRICS.upload_bytes.fetch_add(size as u64, std::sync::atomic::Ordering::Relaxed);
    let voice = content_type.starts_with("audio/") && duration_ms.is_some();
    let att = sqlx::query_as::<_, Attachment>(&format!(
        "INSERT INTO attachments (id, uploader_id, channel_id, filename, content_type, size, width, height, thumb_type, duration_ms, waveform)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING {ATTACHMENT_COLS}"
    ))
    .bind(id)
    .bind(uid)
    .bind(channel_id)
    .bind(&filename)
    .bind(&content_type)
    .bind(size as i64)
    .bind(width)
    .bind(height)
    .bind(thumb_type)
    .bind(if voice { duration_ms } else { None })
    .bind(if voice { waveform } else { None })
    .fetch_one(&state.db)
    .await?;
    // Visualiser data, ready before anyone presses play (see audio_viz.rs).
    if crate::audio_viz::is_audio(&att.content_type) {
        tokio::spawn(crate::audio_viz::ensure_recorded(state.db.clone(), state.config.upload_dir.clone(), id));
    }
    Ok((StatusCode::CREATED, Json(att)))
}

/// `Range: bytes=a-b` / `a-` / `-n` against a file of `len` bytes (single ranges only, as media players send).
/// Some(Ok(range)) to serve part, Some(Err(())) when unsatisfiable, None to serve the whole file.
fn byte_range(headers: &HeaderMap, len: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = headers.get(header::RANGE)?.to_str().ok()?.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || len == 0 { return None; }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => { let n: u64 = n.parse().ok()?; if n == 0 { return Some(Err(())) } (len.saturating_sub(n), len - 1) }
        (s, "") => (s.parse().ok()?, len - 1),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(len - 1)),
    };
    if start > end || start >= len { return Some(Err(())); }
    Some(Ok((start, end)))
}

/// `?download=1` asks for the file as a download even when it could play or show inline (phones' Save button: the
/// Android app hands such responses to the system's download manager).
#[derive(Deserialize, Default)]
struct ServeQuery { #[serde(default)] download: Option<String> }

async fn serve(State(state): State<AppState>, Path((id, _filename)): Path<(Uuid, String)>, Query(q): Query<ServeQuery>, headers: HeaderMap) -> AppResult<Response> {
    let att = sqlx::query_as::<_, Attachment>(&format!("SELECT {ATTACHMENT_COLS} FROM attachments WHERE id = $1"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;
    let path = state.config.upload_dir.join(id.to_string());
    let mut file = tokio::fs::File::open(&path).await.map_err(|_| AppError::NotFound("Attachment file missing".into()))?;
    let len = file.metadata().await.map(|m| m.len()).unwrap_or(att.size as u64);
    // Byte ranges: iOS will not play audio or video from a server that ignores them, and seeking needs them.
    let range = byte_range(&headers, len);
    if let Some(Err(())) = range {
        let mut resp = StatusCode::RANGE_NOT_SATISFIABLE.into_response();
        resp.headers_mut().insert(header::CONTENT_RANGE, HeaderValue::from_str(&format!("bytes */{len}")).unwrap_or(HeaderValue::from_static("bytes */0")));
        return Ok(resp);
    }
    let part = match range { Some(Ok(r)) => Some(r), _ => None };
    if let Some((start, _)) = part {
        use tokio::io::AsyncSeekExt;
        file.seek(std::io::SeekFrom::Start(start)).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    }
    let body_len = part.map(|(s, e)| e - s + 1).unwrap_or(len);
    use tokio::io::AsyncReadExt;
    let stream = tokio_util::io::ReaderStream::new(file.take(body_len));
    let disposition = if inline_type(&att.content_type) && q.download.is_none() { "inline" } else { "attachment" };
    let ascii_name: String = att.filename.chars().map(|c| if c.is_ascii_graphic() || c == ' ' { c } else { '_' }).collect::<String>().replace('"', "_");
    let mut resp = Response::new(Body::from_stream(stream));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&att.content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(body_len));
    h.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Some((start, end)) = part {
        if let Ok(v) = HeaderValue::from_str(&format!("bytes {start}-{end}/{len}")) { h.insert(header::CONTENT_RANGE, v); }
    }
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&format!("{disposition}; filename=\"{ascii_name}\"")).unwrap_or(HeaderValue::from_static("attachment")));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable"));
    // Never let an uploaded HTML/SVG run script in our origin.
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'"));
    if part.is_some() { *resp.status_mut() = StatusCode::PARTIAL_CONTENT; }
    Ok(resp.into_response())
}

#[derive(Deserialize, Default)]
struct VizQuery { #[serde(default)] peaks: Option<String> }

/// An audio attachment's visualiser data (audio_viz.rs), made on first request for files uploaded before it existed.
/// `?peaks=1` returns only the waveform for seek bars.
async fn serve_viz(State(state): State<AppState>, Path(id): Path<Uuid>, Query(q): Query<VizQuery>) -> AppResult<Response> {
    let ct: Option<String> = sqlx::query_scalar("SELECT content_type FROM attachments WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let ct = ct.ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;
    if !crate::audio_viz::is_audio(&ct) { return Err(AppError::NotFound("Not audio".into())); }
    let bytes = crate::audio_viz::ensure_recorded(state.db.clone(), state.config.upload_dir.clone(), id).await
        .ok_or_else(|| AppError::NotFound("No visualiser data".into()))?;
    let body = if q.peaks.is_some() { crate::audio_viz::peaks_only(&bytes).to_vec() } else { bytes };
    let mut resp = Response::new(Body::from(body));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable"));
    Ok(resp)
}

/// The server-made thumbnail of an image attachment, or a video's poster frame (same caching as the file itself).
async fn serve_thumb(State(state): State<AppState>, Path(id): Path<Uuid>) -> AppResult<Response> {
    let att = sqlx::query_as::<_, Attachment>(&format!("SELECT {ATTACHMENT_COLS} FROM attachments WHERE id = $1"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;
    let ct = att.thumb_type.ok_or_else(|| AppError::NotFound("No thumbnail".into()))?;
    let path = state.config.upload_dir.join(format!("{id}.thumb"));
    let file = tokio::fs::File::open(&path).await.map_err(|_| AppError::NotFound("Thumbnail missing".into()))?;
    let mut resp = Response::new(Body::from_stream(tokio_util::io::ReaderStream::new(file)));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&ct).unwrap_or(HeaderValue::from_static("image/png")));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_static("inline"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable"));
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'"));
    Ok(resp.into_response())
}

/// Attachments for a batch of messages.
pub async fn attachments_for(db: &PgPool, message_ids: &[Uuid]) -> AppResult<HashMap<Uuid, Vec<Attachment>>> {
    let mut map: HashMap<Uuid, Vec<Attachment>> = HashMap::new();
    if message_ids.is_empty() {
        return Ok(map);
    }
    let rows = sqlx::query_as::<_, Attachment>(&format!(
        "SELECT {ATTACHMENT_COLS} FROM attachments WHERE message_id = ANY($1) ORDER BY created_at"
    ))
    .bind(message_ids)
    .fetch_all(db)
    .await?;
    // Who has listened: voice messages and audio files.
    let voice: Vec<Uuid> = rows.iter().filter(|a| a.duration_ms.is_some() || crate::audio_viz::is_audio(&a.content_type)).map(|a| a.id).collect();
    let mut listens: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    if !voice.is_empty() {
        let l: Vec<(Uuid, Uuid)> = sqlx::query_as("SELECT attachment_id, user_id FROM attachment_listens WHERE attachment_id = ANY($1) ORDER BY created_at").bind(&voice).fetch_all(db).await?;
        for (att, u) in l { listens.entry(att).or_default().push(u); }
    }
    for mut a in rows {
        a.listened_by = listens.remove(&a.id).unwrap_or_default();
        map.entry(a.message_id.unwrap()).or_default().push(a);
    }
    Ok(map)
}

/// Link pending uploads to a freshly created message. They must belong to the author, be for this
/// channel and still be unlinked; anything else is rejected so users can't reuse others' files.
pub async fn link(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, message_id: Uuid, channel_id: Uuid, uploader: Uuid, ids: &[Uuid]) -> AppResult<()> {
    if ids.len() > MAX_PER_MESSAGE {
        return Err(AppError::BadRequest(format!("At most {MAX_PER_MESSAGE} attachments per message")));
    }
    for id in ids {
        let res = sqlx::query(
            "UPDATE attachments SET message_id = $1 WHERE id = $2 AND channel_id = $3 AND uploader_id = $4 AND message_id IS NULL",
        )
        .bind(message_id)
        .bind(id)
        .bind(channel_id)
        .bind(uploader)
        .execute(&mut **tx)
        .await?;
        if res.rows_affected() == 0 {
            return Err(AppError::BadRequest("Unknown or already used attachment".into()));
        }
    }
    Ok(())
}

/// Periodic sweep: uploads never attached to a message, and files whose rows are gone.
pub async fn sweep_orphans(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(600)).await;
        let stale: Vec<(Uuid,)> = sqlx::query_as(
            "DELETE FROM attachments WHERE message_id IS NULL AND created_at < now() - make_interval(secs => $1)
               AND NOT EXISTS (SELECT 1 FROM scheduled_messages s WHERE attachments.id = ANY(s.attachment_ids)) RETURNING id",
        )
        .bind(ORPHAN_TTL_SECS as f64)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();
        for (id,) in stale {
            let _ = tokio::fs::remove_file(state.config.upload_dir.join(id.to_string())).await;
        }
    }
}

/// `POST /attachments/:id/listened`: the caller played most of a voice message. Idempotent; tells the channel so the sender's card updates.
async fn mark_listened(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let att: Option<(Uuid, Option<Uuid>, Option<i32>)> = sqlx::query_as("SELECT channel_id, message_id, duration_ms FROM attachments WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let (channel_id, message_id, duration) = att.ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;
    let (Some(message_id), Some(_)) = (message_id, duration) else { return Err(AppError::NotFound("Not a voice message".into())) };
    let c = crate::routes::channels::require_channel(&state.db, channel_id, uid).await?;
    let res = sqlx::query("INSERT INTO attachment_listens (attachment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(id).bind(uid).execute(&state.db).await?;
    if res.rows_affected() > 0 {
        let target = crate::routes::channels::target_for(&state.db, &c).await?;
        state.hub.emit(target, "VOICE_LISTENED", serde_json::json!({ "channel_id": channel_id, "message_id": message_id, "attachment_id": id, "user_id": uid, "guild_id": c.guild_id }));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(serde::Deserialize, Default)]
struct PlayedBody {
    /// The client's listening session: a play retried after a dropped connection counts once.
    session: Option<Uuid>,
    /// When the play counted on the client (ms since the epoch): plays sent late (offline, app restarted) keep their time.
    at: Option<i64>,
}

/// `POST /attachments/:id/played`: the caller has listened to an audio file for 30 s (or half of a shorter track) in
/// one listening session, from wherever it started. Every session counts, the uploader's included; the same session
/// counts once, and one listener's plays must be at least as far apart as a play at double speed takes. Tells the
/// channel so every card's count moves.
async fn mark_played(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, body: Option<Json<PlayedBody>>) -> AppResult<StatusCode> {
    let body = body.map(|b| b.0).unwrap_or_default();
    let att: Option<(Uuid, Option<Uuid>, String, Option<i32>, Option<i32>)> = sqlx::query_as("SELECT channel_id, message_id, content_type, duration_ms, media_ms FROM attachments WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let (channel_id, message_id, ct, voice, media_ms) = att.ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;
    let Some(message_id) = message_id else { return Err(AppError::NotFound("Attachment not found".into())) };
    if !crate::audio_viz::is_audio(&ct) || voice.is_some() { return Err(AppError::BadRequest("Not an audio file".into())); }
    let c = crate::routes::channels::require_channel(&state.db, channel_id, uid).await?;
    let secs = match media_ms {
        Some(ms) => Some(ms as f32 / 1000.0),
        None => crate::audio_viz::seconds(&crate::audio_viz::viz_path(&state.config.upload_dir, id)).await,
    };
    let need = secs.map(|s| (s / 2.0).min(30.0)).unwrap_or(30.0).max(1.0);
    // Players go up to double speed.
    let gap = need / 2.0 * 0.9;
    let now = chrono::Utc::now();
    let at = body.at.and_then(chrono::DateTime::from_timestamp_millis).map(|t| t.clamp(now - chrono::Duration::days(7), now)).unwrap_or(now);
    let session = body.session.unwrap_or_else(Uuid::new_v4);
    let mut tx = state.db.begin().await?;
    // One listener's plays of one file, one at a time.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text || $2::text, 0))").bind(id).bind(uid).execute(&mut *tx).await?;
    let close: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM attachment_plays WHERE attachment_id = $1 AND user_id = $2 AND id <> $3 AND played_at > $4 - make_interval(secs => $5) AND played_at < $4 + make_interval(secs => $5))")
        .bind(id).bind(uid).bind(session).bind(at).bind(gap as f64).fetch_one(&mut *tx).await?;
    if close { return Ok(StatusCode::NO_CONTENT); }
    let new = sqlx::query("INSERT INTO attachment_plays (id, attachment_id, user_id, played_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING")
        .bind(session).bind(id).bind(uid).bind(at).execute(&mut *tx).await?.rows_affected() > 0;
    if !new { return Ok(StatusCode::NO_CONTENT); }
    let first = sqlx::query("INSERT INTO attachment_listens (attachment_id, user_id, last_played_at) VALUES ($1, $2, $3) ON CONFLICT (attachment_id, user_id) DO UPDATE SET last_played_at = GREATEST(attachment_listens.last_played_at, EXCLUDED.last_played_at) RETURNING (xmax = 0)")
        .bind(id).bind(uid).bind(at).fetch_one(&mut *tx).await.map(|r| sqlx::Row::get::<bool, _>(&r, 0))?;
    let plays: i32 = sqlx::query_scalar("UPDATE attachments SET plays = plays + 1 WHERE id = $1 RETURNING plays").bind(id).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    let target = crate::routes::channels::target_for(&state.db, &c).await?;
    state.hub.emit(target, "AUDIO_PLAYED", serde_json::json!({ "channel_id": channel_id, "message_id": message_id, "attachment_id": id, "user_id": uid, "plays": plays, "first": first, "guild_id": c.guild_id }));
    Ok(StatusCode::NO_CONTENT)
}

/// Ask for a (new) transcript of one voice message: anyone who can read the channel may, e.g. when transcription was
/// off at upload time or the last attempt failed. Marks it pending at once so clients show progress.
async fn retranscribe(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<serde_json::Value>> {
    let row: Option<(Uuid, Uuid, Uuid, Option<i32>, Option<String>)> = sqlx::query_as(
        "SELECT a.message_id, a.channel_id, m.author_id, a.duration_ms, a.transcript_status FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = $1",
    ).bind(id).fetch_optional(&state.db).await?;
    let (mid, channel_id, author, duration, status) = row.ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;
    let c = crate::routes::channels::require_channel(&state.db, channel_id, uid).await?;
    if duration.is_none() { return Err(AppError::BadRequest("Only voice messages can be transcribed".into())); }
    let settings = crate::routes::admin::load_settings(&state.db).await?;
    if !settings.stt_configured() { return Err(AppError::BadRequest("Transcription is not set up on this server.".into())); }
    if status.as_deref() == Some("pending") { return Ok(Json(serde_json::json!({ "status": "pending" }))); }
    sqlx::query("UPDATE attachments SET transcript_status = 'pending', transcript = NULL WHERE id = $1").bind(id).execute(&state.db).await?;
    if let (Ok(msg), Ok(target)) = (crate::routes::channels::fetch_message(&state.db, mid, author).await, crate::routes::channels::target_for(&state.db, &c).await) {
        state.hub.emit(target, "MESSAGE_UPDATE", serde_json::json!({ "message": msg, "guild_id": c.guild_id }));
    }
    let st = state.clone();
    let (url, key, model) = (settings.stt_url.clone(), settings.stt_api_key.clone(), settings.stt_model.clone());
    tokio::spawn(async move { transcribe(st, id, mid, author, c, url, key, model).await });
    Ok(Json(serde_json::json!({ "status": "pending" })))
}

/// Voice messages just attached to `mid`: mark them pending and transcribe in the background when an STT server is configured.
pub async fn queue_transcriptions(state: &AppState, mid: Uuid, author: Uuid, c: &crate::models::Channel) -> AppResult<()> {
    let settings = crate::routes::admin::load_settings(&state.db).await?;
    if !settings.stt_configured() { return Ok(()); }
    let ids: Vec<(Uuid,)> = sqlx::query_as("UPDATE attachments SET transcript_status = 'pending' WHERE message_id = $1 AND duration_ms IS NOT NULL AND transcript_status IS NULL RETURNING id").bind(mid).fetch_all(&state.db).await?;
    for (id,) in ids {
        let st = state.clone(); let ch = c.clone();
        let (url, key, model) = (settings.stt_url.clone(), settings.stt_api_key.clone(), settings.stt_model.clone());
        tokio::spawn(async move { transcribe(st, id, mid, author, ch, url, key, model).await });
    }
    Ok(())
}

/// Posts the file to an OpenAI-compatible `/v1/audio/transcriptions` endpoint (faster-whisper-server, speaches, OpenAI, Groq...).
async fn transcribe(state: AppState, id: Uuid, mid: Uuid, author: Uuid, c: crate::models::Channel, url: String, key: String, model: String) {
    let status = match transcribe_once(&state, id, &url, &key, &model).await {
        Ok(text) => {
            let _ = sqlx::query("UPDATE attachments SET transcript = $2, transcript_status = 'done' WHERE id = $1").bind(id).bind(&text).execute(&state.db).await;
            "done"
        }
        Err(e) => {
            tracing::warn!(attachment = %id, error = %e, "transcription failed");
            let _ = sqlx::query("UPDATE attachments SET transcript_status = 'failed' WHERE id = $1").bind(id).execute(&state.db).await;
            "failed"
        }
    };
    tracing::debug!(attachment = %id, status, "transcription finished");
    if let (Ok(msg), Ok(target)) = (crate::routes::channels::fetch_message(&state.db, mid, author).await, crate::routes::channels::target_for(&state.db, &c).await) {
        state.hub.emit(target, "MESSAGE_UPDATE", serde_json::json!({ "message": msg, "guild_id": c.guild_id }));
    }
}

async fn transcribe_once(state: &AppState, id: Uuid, url: &str, key: &str, model: &str) -> Result<String, String> {
    let (filename, content_type): (String, String) = sqlx::query_as("SELECT filename, content_type FROM attachments WHERE id = $1").bind(id).fetch_one(&state.db).await.map_err(|e| e.to_string())?;
    let bytes = tokio::fs::read(state.config.upload_dir.join(id.to_string())).await.map_err(|e| e.to_string())?;
    stt(bytes, filename, &content_type, url, key, model, 300).await
}

/// One OpenAI-compatible `/v1/audio/transcriptions` call: the recognised text (trimmed, at most 4000 characters).
pub async fn stt(bytes: Vec<u8>, filename: String, content_type: &str, url: &str, key: &str, model: &str, timeout_secs: u64) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(bytes).file_name(filename).mime_str(content_type).map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().text("model", model.to_string()).text("response_format", "json").part("file", part);
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(timeout_secs)).build().map_err(|e| e.to_string())?;
    let mut req = client.post(format!("{}/v1/audio/transcriptions", url.trim_end_matches('/'))).multipart(form);
    if !key.is_empty() { req = req.bearer_auth(key); }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("{status}: {}", body.chars().take(200).collect::<String>())); }
    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let text = v.get("text").and_then(|t| t.as_str()).unwrap_or("").trim().chars().take(4000).collect::<String>();
    Ok(text)
}

#[cfg(test)]
mod range_tests {
    use super::*;
    fn r(v: &str, len: u64) -> Option<Result<(u64, u64), ()>> { let mut h = HeaderMap::new(); h.insert(header::RANGE, HeaderValue::from_str(v).unwrap()); byte_range(&h, len) }
    #[test]
    fn ranges() {
        assert_eq!(r("bytes=0-1", 10), Some(Ok((0, 1))));
        assert_eq!(r("bytes=4-", 10), Some(Ok((4, 9))));
        assert_eq!(r("bytes=-3", 10), Some(Ok((7, 9))));
        assert_eq!(r("bytes=5-99", 10), Some(Ok((5, 9))));
        assert_eq!(r("bytes=10-", 10), Some(Err(())));
        assert_eq!(r("bytes=0-1,4-5", 10), None);
        assert_eq!(r("items=0-1", 10), None);
        assert_eq!(byte_range(&HeaderMap::new(), 10), None);
    }
}
