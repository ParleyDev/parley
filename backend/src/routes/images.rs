//! Profile and server images (avatars, banners, icons) and the files behind custom emoji and
//! stickers. Uploaded as multipart to `POST /images?kind=…`, stored under `UPLOAD_DIR/<id>` and
//! served at `/api/images/<id>` without auth (unguessable v4 id, immutable cache), so animated
//! GIF/APNG/WebP avatars stay animated instead of being flattened into a data URL.

use crate::{auth::AuthUser, error::{AppError, AppResult}, state::AppState};
use crate::ratelimit::rl_uploads;
use axum::{middleware::from_fn,
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Avatars, banners and icons (static ones are resized client-side; animated ones arrive as-is).
pub const MAX_PROFILE_IMAGE: usize = 8 * 1024 * 1024;
pub const MAX_EMOJI: usize = 512 * 1024;
pub const MAX_STICKER: usize = 1024 * 1024;
pub const ORPHAN_TTL_SECS: f64 = 3600.0;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/images", post(upload).route_layer(from_fn(rl_uploads)).layer(DefaultBodyLimit::max(MAX_PROFILE_IMAGE + 64 * 1024)))
        .route("/images/:id", get(serve))
        .route("/images/:id/static", get(serve_static))
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Image {
    pub id: Uuid,
    #[serde(skip)]
    pub owner_id: Uuid,
    pub kind: String,
    pub content_type: String,
    pub size: i64,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub animated: bool,
    pub created_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub url: String,
}

pub const IMAGE_COLS: &str = "id, owner_id, kind, content_type, size, width, height, animated, created_at";

pub fn image_url(id: Uuid) -> String {
    format!("/api/images/{id}")
}

/// The image id behind one of our own `/api/images/<id>` URLs, if that's what it is.
pub fn image_id(url: &str) -> Option<Uuid> {
    url.strip_prefix("/api/images/").and_then(|rest| rest.split(['?', '/']).next()).and_then(|s| Uuid::parse_str(s).ok())
}

/// Does a GIF/PNG/WebP file carry more than one frame?
fn is_animated(content_type: &str, bytes: &[u8]) -> bool {
    match content_type {
        // Graphic Control Extension blocks precede each frame; two or more means animation.
        "image/gif" => bytes.windows(3).filter(|w| *w == [0x21, 0xF9, 0x04]).count() >= 2,
        // APNG declares an animation control chunk before the first IDAT.
        "image/png" => {
            let idat = bytes.windows(4).position(|w| w == b"IDAT").unwrap_or(bytes.len());
            bytes[..idat].windows(4).any(|w| w == b"acTL")
        }
        "image/webp" => bytes.len() > 16 && bytes[12..].windows(4).any(|w| w == b"ANIM"),
        _ => false,
    }
}

/// Read one multipart `file` field fully (bounded by `max`), verify it's a raster image we can
/// render, write it to disk and record it. Shared with emoji/sticker creation.
pub async fn store_image(state: &AppState, uid: Uuid, kind: &str, mut multipart: Multipart, max: usize) -> AppResult<(Image, std::collections::HashMap<String, String>)> {
    let mut fields: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut data: Option<Vec<u8>> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| AppError::BadRequest(format!("Bad upload: {e}")))? {
        match field.name() {
            Some("file") => {
                let bytes = field.bytes().await.map_err(|e| AppError::BadRequest(format!("Upload interrupted: {e}")))?;
                if bytes.len() > max {
                    return Err(AppError::BadRequest(format!("Image too large (max {} KB)", max / 1024)));
                }
                data = Some(bytes.to_vec());
            }
            Some(name) => {
                let name = name.to_string();
                let text = field.text().await.map_err(|e| AppError::BadRequest(format!("Bad upload: {e}")))?;
                fields.insert(name, text);
            }
            None => {}
        }
    }
    let bytes = data.ok_or_else(|| AppError::BadRequest("Missing 'file' field".into()))?;
    let img = store_bytes(state, uid, kind, bytes).await?;
    Ok((img, fields))
}

/// Validate, write to disk and record an image from raw bytes (uploads and the legacy data-URL conversion).
pub async fn store_bytes(state: &AppState, uid: Uuid, kind: &str, bytes: Vec<u8>) -> AppResult<Image> {
    if bytes.is_empty() {
        return Err(AppError::BadRequest("Empty file".into()));
    }
    let content_type = match infer::get(&bytes).map(|t| t.mime_type()) {
        Some(t @ ("image/png" | "image/jpeg" | "image/gif" | "image/webp")) => t.to_string(),
        _ => return Err(AppError::BadRequest("Image must be a PNG, JPEG, GIF or WebP".into())),
    };
    let (width, height) = match imagesize::blob_size(&bytes) {
        Ok(d) => (Some(d.width as i32), Some(d.height as i32)),
        Err(_) => (None, None),
    };
    let animated = is_animated(&content_type, &bytes);
    crate::routes::storage::check_quota(state, uid, bytes.len() as i64).await?;
    crate::av::check(state, &bytes, "image").await?;

    let id = Uuid::new_v4();
    let dir = &state.config.upload_dir;
    tokio::fs::create_dir_all(dir).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    tokio::fs::write(dir.join(id.to_string()), &bytes).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    let mut img = sqlx::query_as::<_, Image>(&format!(
        "INSERT INTO images (id, owner_id, kind, content_type, size, width, height, animated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {IMAGE_COLS}"
    ))
    .bind(id)
    .bind(uid)
    .bind(kind)
    .bind(&content_type)
    .bind(bytes.len() as i64)
    .bind(width)
    .bind(height)
    .bind(animated)
    .fetch_one(&state.db)
    .await?;
    img.url = image_url(id);
    Ok(img)
}

/// One-off at startup: avatars and banners that older clients saved as `data:` URLs become uploaded images.
/// Rows that cannot be decoded are cleared rather than left as data URLs (the API no longer accepts them).
pub async fn convert_data_urls(state: &AppState) {
    use base64::Engine;
    let rows: Vec<(Uuid, Option<String>, Option<String>)> = match sqlx::query_as("SELECT id, avatar_url, banner_url FROM users WHERE avatar_url LIKE 'data:%' OR banner_url LIKE 'data:%'").fetch_all(&state.db).await {
        Ok(r) => r,
        Err(e) => { tracing::warn!(error = ?e, "data-URL scan failed"); return; }
    };
    let mut converted = 0;
    for (uid, avatar, banner) in rows {
        for (col, kind, val) in [("avatar_url", "avatar", avatar), ("banner_url", "banner", banner)] {
            let Some(v) = val.filter(|v| v.starts_with("data:")) else { continue };
            let decoded = v.split_once(',').filter(|(head, _)| head.contains(";base64")).and_then(|(_, b64)| base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok());
            let new_url: Option<String> = match decoded {
                Some(bytes) => match store_bytes(state, uid, kind, bytes).await {
                    Ok(img) => { converted += 1; Some(img.url) }
                    Err(e) => { tracing::warn!(user = %uid, col, error = %e, "data-URL image rejected; clearing"); None }
                },
                None => None,
            };
            let _ = sqlx::query(&format!("UPDATE users SET {col} = $2 WHERE id = $1")).bind(uid).bind(new_url).execute(&state.db).await;
        }
    }
    if converted > 0 {
        tracing::info!(converted, "converted legacy data-URL profile images to uploads");
    }
}

#[derive(Deserialize)]
struct UploadQuery {
    kind: String,
}

async fn upload(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Query(q): Query<UploadQuery>,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Image>)> {
    if !matches!(q.kind.as_str(), "avatar" | "banner" | "icon") {
        return Err(AppError::BadRequest("kind must be avatar, banner or icon".into()));
    }
    let (img, _) = store_image(&state, uid, &q.kind, multipart, MAX_PROFILE_IMAGE).await?;
    Ok((StatusCode::CREATED, Json(img)))
}

async fn serve(State(state): State<AppState>, Path(id): Path<Uuid>) -> AppResult<Response> {
    let img = sqlx::query_as::<_, Image>(&format!("SELECT {IMAGE_COLS} FROM images WHERE id = $1"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Image not found".into()))?;
    let file = tokio::fs::File::open(state.config.upload_dir.join(id.to_string())).await.map_err(|_| AppError::NotFound("Image file missing".into()))?;
    let mut resp = Response::new(Body::from_stream(tokio_util::io::ReaderStream::new(file)));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&img.content_type).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(img.size as u64));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_static("inline"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'"));
    Ok(resp.into_response())
}

/// The first frame of an image file as PNG (APNG's default image, a GIF's or animated WebP's first frame).
pub fn first_frame_png(path: &std::path::Path) -> anyhow::Result<Vec<u8>> {
    // Uploads are stored without an extension, so pick the decoder from the bytes.
    let img = image::ImageReader::open(path)?.with_guessed_format()?.decode()?;
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png)?;
    Ok(out.into_inner())
}

/// A still version of an animated avatar, banner or icon, so clients can show it frozen until it is hovered
/// (Discord-style) without downloading the animation. Made once and kept next to the original as `<id>.still.png`;
/// still images, and files that cannot be decoded, are served as they are.
async fn serve_static(State(state): State<AppState>, Path(id): Path<Uuid>) -> AppResult<Response> {
    let img = sqlx::query_as::<_, Image>(&format!("SELECT {IMAGE_COLS} FROM images WHERE id = $1"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Image not found".into()))?;
    if !img.animated { return serve(State(state), Path(id)).await; }
    let cache = state.config.upload_dir.join(format!("{id}.still.png"));
    let bytes = match tokio::fs::read(&cache).await {
        Ok(b) => b,
        Err(_) => {
            let src = state.config.upload_dir.join(id.to_string());
            match tokio::task::spawn_blocking(move || first_frame_png(&src)).await.map_err(anyhow::Error::from)? {
                Ok(b) => { let _ = tokio::fs::write(&cache, &b).await; b }
                Err(e) => { tracing::warn!(image = %id, "still frame failed: {e}"); return serve(State(state), Path(id)).await; }
            }
        }
    };
    let mut resp = Response::new(Body::from(bytes));
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
    h.insert(header::CONTENT_DISPOSITION, HeaderValue::from_static("inline"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=31536000, immutable"));
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'"));
    Ok(resp.into_response())
}

/// Drop an image row and its file (and its cached still frame). Used when a profile picture is replaced or an emoji deleted.
pub async fn delete_image(state: &AppState, id: Uuid) {
    let _ = sqlx::query("DELETE FROM images WHERE id = $1").bind(id).execute(&state.db).await;
    let _ = tokio::fs::remove_file(state.config.upload_dir.join(id.to_string())).await;
    let _ = tokio::fs::remove_file(state.config.upload_dir.join(format!("{id}.still.png"))).await;
}

/// If `old` was one of ours and is no longer referenced by `new`, remove it.
pub async fn release_replaced(state: &AppState, old: Option<&str>, new: Option<&str>) {
    if let Some(id) = old.and_then(image_id) {
        if new.and_then(image_id) != Some(id) {
            delete_image(state, id).await;
        }
    }
}

/// Images nothing points at any more: not a user's avatar/banner, a server's icon/banner, a Discover
/// listing's banner, an emoji or a sticker. `min_age_secs` keeps uploads that are still being attached.
pub async fn orphan_image_ids(db: &sqlx::PgPool, min_age_secs: f64) -> Vec<Uuid> {
    sqlx::query_as::<_, (Uuid,)>(
        "SELECT i.id FROM images i WHERE i.created_at < now() - make_interval(secs => $1)
           AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_url = '/api/images/' || i.id::text OR u.banner_url = '/api/images/' || i.id::text OR '/api/images/' || i.id::text = ANY(u.avatar_history))
           AND NOT EXISTS (SELECT 1 FROM guilds g WHERE g.icon_url = '/api/images/' || i.id::text OR g.banner_url = '/api/images/' || i.id::text)
           AND NOT EXISTS (SELECT 1 FROM guild_discovery d WHERE d.banner_url = '/api/images/' || i.id::text)
           AND NOT EXISTS (SELECT 1 FROM emojis e WHERE e.id = i.id)
           AND NOT EXISTS (SELECT 1 FROM stickers s WHERE s.id = i.id)",
    )
    .bind(min_age_secs)
    .fetch_all(db)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|r| r.0)
    .collect()
}

/// Delete every orphan image; returns how many went.
pub async fn sweep_now(state: &AppState, min_age_secs: f64) -> usize {
    let stale = orphan_image_ids(&state.db, min_age_secs).await;
    let n = stale.len();
    for id in stale {
        delete_image(state, id).await;
    }
    n
}

/// Periodic sweep: uploads that never got attached to a profile, server, listing, emoji or sticker.
pub async fn sweep_orphans(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(900)).await;
        let n = sweep_now(&state, ORPHAN_TTL_SECS as f64).await;
        if n > 0 {
            tracing::info!(removed = n, "swept orphan images");
        }
    }
}
