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

/// The EXIF orientation of an image file (JPEG, WebP, PNG eXIf); NoTransforms when there is none or it can't be read.
pub fn image_orientation(path: &std::path::Path) -> image::metadata::Orientation {
    use image::metadata::Orientation;
    let Ok(reader) = image::ImageReader::open(path).and_then(|r| r.with_guessed_format()) else { return Orientation::NoTransforms };
    reader.into_decoder().ok().and_then(|mut d| image::ImageDecoder::orientation(&mut d).ok()).unwrap_or(Orientation::NoTransforms)
}

/// Whether an orientation turns the picture by 90°, so the displayed width and height are the stored ones swapped.
pub fn swaps_axes(o: image::metadata::Orientation) -> bool {
    use image::metadata::Orientation::*;
    matches!(o, Rotate90 | Rotate270 | Rotate90FlipH | Rotate270FlipH)
}

/// One-off repair of image attachments uploaded before orientation was honoured: width/height swapped for photos
/// turned by 90°, and thumbnails rebuilt upright. One instance runs it (advisory lock); a marker file in UPLOAD_DIR
/// keeps later starts from rescanning.
pub async fn fix_orientation_backlog(state: AppState) {
    const LOCK: i64 = 0x7061_726c_6579_6f72; // "parleyor"
    let marker = state.config.upload_dir.join(".orientation-fixed-v1");
    if tokio::fs::metadata(&marker).await.is_ok() { return; }
    let Ok(mut conn) = state.db.acquire().await else { return };
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)").bind(LOCK).fetch_one(&mut *conn).await.unwrap_or(false);
    if !locked { return; }
    type Row = (Uuid, String, Option<i32>, Option<i32>, Option<String>); // id, type, width, height, thumb type
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT id, content_type, width, height, thumb_type FROM attachments WHERE content_type IN ('image/jpeg', 'image/webp', 'image/png')",
    ).fetch_all(&state.db).await.unwrap_or_default();
    let (mut fixed, mut scanned) = (0, 0);
    for (id, ct, w, h, thumb) in rows {
        let path = state.config.upload_dir.join(id.to_string());
        if tokio::fs::metadata(&path).await.is_err() { continue; }
        scanned += 1;
        let p = path.clone();
        let o = tokio::task::spawn_blocking(move || image_orientation(&p)).await.unwrap_or(image::metadata::Orientation::NoTransforms);
        if o == image::metadata::Orientation::NoTransforms { continue; }
        let (mut w, mut h) = (w, h);
        if swaps_axes(o) {
            if let (Some(a), Some(b)) = (w, h) {
                (w, h) = (Some(b), Some(a));
                let _ = sqlx::query("UPDATE attachments SET width = $2, height = $3 WHERE id = $1").bind(id).bind(w).bind(h).execute(&state.db).await;
            }
        }
        if thumb.is_some() {
            let _ = make_thumbnail(path, &ct, w, h).await;
        }
        fixed += 1;
    }
    if fixed > 0 { tracing::info!(fixed, scanned, "fixed orientation of stored photos"); }
    let _ = tokio::fs::write(&marker, b"").await;
    let _ = sqlx::query("SELECT pg_advisory_unlock($1)").bind(LOCK).execute(&mut *conn).await;
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
        // Uploads are stored without an extension, so sniff the format from the bytes. Phone photos are stored
        // sideways with an EXIF orientation tag; apply it, as browsers do for the original.
        let mut decoder = image::ImageReader::open(&path).ok()?.with_guessed_format().ok()?.into_decoder().ok()?;
        let orientation = image::ImageDecoder::orientation(&mut decoder).unwrap_or(image::metadata::Orientation::NoTransforms);
        let mut img = image::DynamicImage::from_decoder(decoder).ok()?;
        img.apply_orientation(orientation);
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

#[cfg(test)]
mod orientation_tests {
    use super::*;

    /// An 800x400 JPEG (left half red, right half blue) carrying EXIF orientation 6 ("rotate 90° clockwise").
    fn sideways_jpeg() -> Vec<u8> {
        let img = image::RgbImage::from_fn(800, 400, |x, _| if x < 400 { image::Rgb([255, 0, 0]) } else { image::Rgb([0, 0, 255]) });
        let mut jpg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg, 90).encode_image(&img).unwrap();
        // APP1 "Exif": big-endian TIFF header, one IFD entry: Orientation (0x0112), SHORT, 1, value 6.
        let tiff: Vec<u8> = [b"MM\0*".as_slice(), &[0, 0, 0, 8], &[0, 1], &[0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0], &[0, 0, 0, 0]].concat();
        let payload = [b"Exif\0\0".as_slice(), &tiff].concat();
        let len = (payload.len() + 2) as u16;
        [&jpg[..2], &[0xFF, 0xE1], &len.to_be_bytes(), &payload, &jpg[2..]].concat()
    }

    #[tokio::test]
    async fn thumbnails_follow_exif_orientation() {
        let dir = std::env::temp_dir().join(format!("parley-orient-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("photo");
        std::fs::write(&path, sideways_jpeg()).unwrap();
        let o = image_orientation(&path);
        assert_eq!(o, image::metadata::Orientation::Rotate90);
        assert!(swaps_axes(o));
        assert_eq!(make_thumbnail(path.clone(), "image/jpeg", Some(400), Some(800)).await.as_deref(), Some("image/jpeg"));
        let thumb = image::load_from_memory(&std::fs::read(dir.join("photo.thumb")).unwrap()).unwrap().to_rgb8();
        // Upright: taller than wide, and the red half (left when stored) is now on top.
        assert_eq!((thumb.width(), thumb.height()), (200, 400));
        let top = thumb.get_pixel(100, 50); let bottom = thumb.get_pixel(100, 350);
        assert!(top[0] > 200 && top[2] < 60 && bottom[2] > 200 && bottom[0] < 60, "{top:?} {bottom:?}");
        let plain = dir.join("plain");
        std::fs::write(&plain, b"not an image").unwrap();
        assert_eq!(image_orientation(&plain), image::metadata::Orientation::NoTransforms);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
