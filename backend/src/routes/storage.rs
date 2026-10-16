//! Upload quotas (attachments + profile images per user) and thumbnails for image attachments.

use crate::{auth::AuthUser, error::{AppError, AppResult}, state::AppState};
use axum::{extract::State, routing::get, Json, Router};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/users/@me/storage", get(my_storage))
}

pub const THUMB_MAX: u32 = 400;
/// Refuse to decode anything bigger than this (decompression bombs).
const MAX_PIXELS: u64 = 50_000_000;

pub struct Usage {
    pub attachment_bytes: i64,
    pub image_bytes: i64,
    pub attachments: i64,
    pub images: i64,
}

impl Usage {
    pub fn used(&self) -> i64 { self.attachment_bytes + self.image_bytes }
}

pub async fn usage(db: &PgPool, uid: Uuid) -> AppResult<Usage> {
    let (attachment_bytes, attachments): (i64, i64) = sqlx::query_as("SELECT COALESCE(SUM(size), 0)::bigint, COUNT(*) FROM attachments WHERE uploader_id = $1").bind(uid).fetch_one(db).await?;
    let (image_bytes, images): (i64, i64) = sqlx::query_as("SELECT COALESCE(SUM(size), 0)::bigint, COUNT(*) FROM images WHERE owner_id = $1").bind(uid).fetch_one(db).await?;
    Ok(Usage { attachment_bytes, image_bytes, attachments, images })
}

/// The user's quota in bytes: their override, else the instance default; None = unlimited.
pub async fn quota(state: &AppState, uid: Uuid) -> AppResult<Option<i64>> {
    let (over,): (Option<i64>,) = sqlx::query_as("SELECT upload_quota_bytes FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    let q = over.unwrap_or(state.config.upload_quota_bytes);
    Ok(if q <= 0 { None } else { Some(q) })
}

pub fn human(bytes: i64) -> String {
    let b = bytes as f64;
    if b >= 1e9 { format!("{:.1} GB", b / 1e9) } else if b >= 1e6 { format!("{:.1} MB", b / 1e6) } else if b >= 1e3 { format!("{:.0} KB", b / 1e3) } else { format!("{bytes} B") }
}

/// Error unless `incoming` more bytes fit under the user's quota.
pub async fn check_quota(state: &AppState, uid: Uuid, incoming: i64) -> AppResult<()> {
    let Some(q) = quota(state, uid).await? else { return Ok(()) };
    let used = usage(&state.db, uid).await?.used();
    if used + incoming > q {
        return Err(AppError::BadRequest(format!("Storage quota exceeded: {} of {} used. Delete some uploads to free space.", human(used), human(q))));
    }
    Ok(())
}

async fn my_storage(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    let u = usage(&state.db, uid).await?;
    Ok(Json(json!({ "used": u.used(), "quota": quota(&state, uid).await?, "attachment_bytes": u.attachment_bytes, "image_bytes": u.image_bytes, "attachments": u.attachments, "images": u.images })))
}

/// Make a thumbnail (longest side `THUMB_MAX`) for an image attachment; returns its content type.
/// Runs on the blocking pool. Small images need none. Any failure just means "no thumbnail".
pub async fn make_thumbnail(path: std::path::PathBuf, content_type: &str, width: Option<i32>, height: Option<i32>) -> Option<String> {
    if !matches!(content_type, "image/png" | "image/jpeg" | "image/gif" | "image/webp") {
        return None;
    }
    let (w, h) = (width? as u64, height? as u64);
    if w.max(h) <= THUMB_MAX as u64 || w * h > MAX_PIXELS {
        return None;
    }
    let jpeg = content_type == "image/jpeg";
    tokio::task::spawn_blocking(move || -> Option<String> {
        // Uploads are stored without an extension, so sniff the format from the bytes.
        let img = image::ImageReader::open(&path).ok()?.with_guessed_format().ok()?.decode().ok()?;
        let thumb = img.thumbnail(THUMB_MAX, THUMB_MAX);
        let out = path.with_extension("thumb");
        let mut f = std::io::BufWriter::new(std::fs::File::create(&out).ok()?);
        if jpeg {
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut f, 82);
            enc.encode_image(&thumb.to_rgb8()).ok()?;
            Some("image/jpeg".into())
        } else {
            thumb.write_to(&mut f, image::ImageFormat::Png).ok()?;
            Some("image/png".into())
        }
    })
    .await
    .ok()
    .flatten()
}
