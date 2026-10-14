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
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

pub const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_PER_MESSAGE: usize = 10;
/// Pending (unlinked) uploads older than this are swept.
const ORPHAN_TTL_SECS: i64 = 60 * 60;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/attachments", post(upload).layer(DefaultBodyLimit::max(32 * 1024 * 1024)))
        .route("/attachments/:id/:filename", get(serve))
}

pub const ATTACHMENT_COLS: &str = "id, message_id, uploader_id, channel_id, filename, content_type, size, width, height, created_at";

fn sanitize_filename(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("file");
    let cleaned: String = base.chars().filter(|c| !c.is_control()).take(200).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." { "file".to_string() } else { trimmed.to_string() }
}

/// Browsers will render these inline; everything else is forced to download.
fn inline_type(ct: &str) -> bool {
    matches!(ct, "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif" | "video/mp4" | "video/webm" | "audio/mpeg" | "audio/ogg" | "audio/wav" | "audio/webm" | "audio/mp4" | "application/pdf" | "text/plain")
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

    let mut field = loop {
        match multipart.next_field().await.map_err(|e| AppError::BadRequest(format!("Bad upload: {e}")))? {
            Some(f) if f.name() == Some("file") => break f,
            Some(_) => continue,
            None => return Err(AppError::BadRequest("Missing 'file' field".into())),
        }
    };
    let filename = sanitize_filename(field.file_name().unwrap_or("file"));
    let declared = field.content_type().unwrap_or("application/octet-stream").to_string();

    // Stream to disk, enforcing the size cap as we go.
    let id = Uuid::new_v4();
    let dir = &state.config.upload_dir;
    tokio::fs::create_dir_all(dir).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let path = dir.join(id.to_string());
    let mut file = tokio::fs::File::create(&path).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let mut size: usize = 0;
    let mut too_big = false;
    let mut head: Vec<u8> = Vec::with_capacity(8192);
    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = field.chunk().await.map_err(|e| AppError::BadRequest(format!("Upload interrupted: {e}")))? {
        size += chunk.len();
        if size > MAX_FILE_BYTES {
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
        return Err(AppError::BadRequest("File too large (max 25 MB)".into()));
    }
    if size == 0 {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(AppError::BadRequest("Empty file".into()));
    }

    // Trust magic bytes over the declared type for anything we'd render inline.
    let sniffed = infer::get(&head).map(|t| t.mime_type().to_string());
    let content_type = match sniffed {
        Some(s) => s,
        None if declared.starts_with("text/") => declared,
        None => "application/octet-stream".to_string(),
    };
    let (width, height) = if content_type.starts_with("image/") {
        match imagesize::blob_size(&head).or_else(|_| imagesize::size(&path)) {
            Ok(d) => (Some(d.width as i32), Some(d.height as i32)),
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };

    let att = sqlx::query_as::<_, Attachment>(&format!(
        "INSERT INTO attachments (id, uploader_id, channel_id, filename, content_type, size, width, height)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {ATTACHMENT_COLS}"
    ))
    .bind(id)
    .bind(uid)
    .bind(channel_id)
    .bind(&filename)
    .bind(&content_type)
    .bind(size as i64)
    .bind(width)
    .bind(height)
    .fetch_one(&state.db)
    .await?;
    Ok((StatusCode::CREATED, Json(att)))
}

async fn serve(State(state): State<AppState>, Path((id, _filename)): Path<(Uuid, String)>) -> AppResult<Response> {
    let att = sqlx::query_as::<_, Attachment>(&format!("SELECT {ATTACHMENT_COLS} FROM attachments WHERE id = $1"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;
    let path = state.config.upload_dir.join(id.to_string());
    let file = tokio::fs::File::open(&path).await.map_err(|_| AppError::NotFound("Attachment file missing".into()))?;
    let stream = tokio_util::io::ReaderStream::new(file);
    let disposition = if inline_type(&att.content_type) { "inline" } else { "attachment" };
    let ascii_name: String = att.filename.chars().map(|c| if c.is_ascii_graphic() || c == ' ' { c } else { '_' }).collect::<String>().replace('"', "_");
    let mut resp = Response::new(Body::from_stream(stream));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&att.content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(att.size as u64));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&format!("{disposition}; filename=\"{ascii_name}\"")).unwrap_or(HeaderValue::from_static("attachment")));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable"));
    // Never let an uploaded HTML/SVG run script in our origin.
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'"));
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
    for a in rows {
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

/// Remove files for attachments of a message about to be deleted (rows cascade in the DB).
pub async fn delete_files_for_message(state: &AppState, message_id: Uuid) {
    if let Ok(ids) = sqlx::query_as::<_, (Uuid,)>("SELECT id FROM attachments WHERE message_id = $1").bind(message_id).fetch_all(&state.db).await {
        for (id,) in ids {
            let _ = tokio::fs::remove_file(state.config.upload_dir.join(id.to_string())).await;
        }
    }
}

/// Periodic sweep: uploads never attached to a message, and files whose rows are gone.
pub async fn sweep_orphans(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(600)).await;
        let stale: Vec<(Uuid,)> = sqlx::query_as(
            "DELETE FROM attachments WHERE message_id IS NULL AND created_at < now() - make_interval(secs => $1) RETURNING id",
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
