//! Poster frames for video attachments, so chats show a still of every video before it plays. Browsers can paint the
//! first frame themselves, but the phone apps' web views (iPhone and Android) don't until the video is played, which
//! left an empty box. ffmpeg grabs a frame half a second in (the very first is often black), turned the way the video
//! displays (phone videos are stored sideways with a rotation tag), at most 640 px across, as `<id>.thumb`; the
//! attachment's `thumb_type`, `width` and `height` describe it. Made at upload, and once in the background for videos
//! uploaded before this existed.
use sqlx::PgPool;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX: u32 = 640;

pub fn is_video(content_type: &str) -> bool { matches!(content_type, "video/mp4" | "video/webm" | "video/quicktime") }

/// Writes the poster for the video at `src` next to it and returns its size, or None when ffmpeg is missing or the
/// video can't be decoded.
pub async fn make(src: &Path) -> Option<(i32, i32)> {
    let out = src.with_extension("thumb");
    // Half a second in, else (a shorter clip) the first frame.
    for at in ["0.5", "0"] {
        let tmp = src.with_extension(format!("thumb-{}", Uuid::new_v4().simple()));
        let run = tokio::process::Command::new("ffmpeg")
            .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", at, "-i"])
            .arg(src)
            .args(["-an", "-frames:v", "1", "-vf", &format!("scale='min({MAX},iw)':-2:flags=bicubic,format=yuvj420p"), "-c:v", "mjpeg", "-q:v", "4", "-f", "image2"])
            .arg(&tmp)
            .kill_on_drop(true)
            .output();
        let done = tokio::time::timeout(std::time::Duration::from_secs(20), run).await;
        let made = matches!(done, Ok(Ok(ref o)) if o.status.success()) && tokio::fs::metadata(&tmp).await.map(|m| m.len() > 0).unwrap_or(false);
        if !made {
            let _ = tokio::fs::remove_file(&tmp).await;
            if let Ok(Err(e)) = done { tracing::debug!(error = %e, "no ffmpeg: videos have no poster frames"); return None; }
            continue;
        }
        let size = imagesize::size(&tmp).ok()?;
        tokio::fs::rename(&tmp, &out).await.ok()?;
        return Some((size.width as i32, size.height as i32));
    }
    None
}

/// Make the poster for attachment `id` and record it.
async fn make_for(db: &PgPool, dir: &Path, id: Uuid) -> bool {
    let Some((w, h)) = make(&dir.join(id.to_string())).await else { return false };
    sqlx::query("UPDATE attachments SET thumb_type = 'image/jpeg', width = $2, height = $3 WHERE id = $1").bind(id).bind(w).bind(h).execute(db).await.is_ok()
}

/// Once at start-up: posters for videos uploaded before there were any. Videos that can't be decoded are skipped
/// for the rest of this run.
pub async fn backfill(db: PgPool, dir: PathBuf) {
    tokio::time::sleep(std::time::Duration::from_secs(20)).await;
    let ids: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM attachments WHERE thumb_type IS NULL AND content_type IN ('video/mp4', 'video/webm', 'video/quicktime') ORDER BY created_at DESC LIMIT 2000")
        .fetch_all(&db).await.unwrap_or_default();
    let mut made = 0;
    for (id,) in &ids {
        // Another backend may have got to it.
        let pending: Option<bool> = sqlx::query_scalar("SELECT thumb_type IS NULL FROM attachments WHERE id = $1").bind(id).fetch_optional(&db).await.ok().flatten();
        if pending != Some(true) { continue; }
        if make_for(&db, &dir, *id).await { made += 1; }
    }
    if !ids.is_empty() { tracing::info!(made, of = ids.len(), "video poster frames backfilled"); }
}
