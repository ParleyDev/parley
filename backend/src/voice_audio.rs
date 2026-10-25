//! Voice messages in a format every client can play. Chrome, Firefox and Android record WebM/Opus (or Ogg), which
//! iPhones (Safari, and Chrome on iOS, both WebKit) will not play in an `<audio>` element; recorder WebM also has
//! no duration or seek index. So voice messages are converted with ffmpeg to AAC in MP4 (`.m4a`, faststart), which
//! plays everywhere. New recordings are converted on upload; older ones by a one-off background pass at startup.
//! Without an `ffmpeg` binary on PATH nothing is converted and the originals are served as before.
use crate::state::AppState;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use uuid::Uuid;

static WARNED: AtomicBool = AtomicBool::new(false);

/// Types that need converting (anything else, e.g. iPhone recordings in audio/mp4, already plays everywhere).
pub fn needs_conversion(content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    ct.starts_with("audio/webm") || ct.starts_with("audio/ogg") || ct.starts_with("video/webm")
}

/// `voice-message.webm` → `voice-message.m4a`.
pub fn m4a_name(filename: &str) -> String {
    let stem = filename.rsplit_once('.').map(|(s, _)| s).filter(|s| !s.is_empty()).unwrap_or(filename);
    format!("{stem}.m4a")
}

/// Convert the file at `path` in place; returns the new size. `Err` leaves the original untouched.
pub async fn convert_in_place(path: &Path) -> anyhow::Result<u64> {
    let tmp = path.with_extension(format!("m4a-{}", Uuid::new_v4().simple()));
    let out = tokio::process::Command::new("ffmpeg")
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(path)
        .args(["-vn", "-ac", "1", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-f", "mp4"])
        .arg(&tmp)
        .kill_on_drop(true)
        .output()
        .await;
    let out = match out {
        Ok(o) => o,
        Err(e) => {
            if !WARNED.swap(true, Ordering::Relaxed) {
                tracing::warn!("ffmpeg not available ({e}); voice messages stay in their recorded format and may not play on iPhones");
            }
            anyhow::bail!("ffmpeg not available: {e}");
        }
    };
    let size = tokio::fs::metadata(&tmp).await.map(|m| m.len()).unwrap_or(0);
    if !out.status.success() || size == 0 {
        let _ = tokio::fs::remove_file(&tmp).await;
        anyhow::bail!("ffmpeg failed: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    tokio::fs::rename(&tmp, path).await?;
    Ok(size)
}

/// One-off pass over voice messages stored before conversion existed. Only one backend instance runs it
/// (advisory lock); each file is converted, then its row updated.
pub async fn convert_backlog(state: AppState) {
    const LOCK: i64 = 0x7061_726c_6579_7631; // "parleyv1"
    let mut conn = match state.db.acquire().await { Ok(c) => c, Err(_) => return };
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)").bind(LOCK).fetch_one(&mut *conn).await.unwrap_or(false);
    if !locked { return; }
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT id, filename, content_type FROM attachments WHERE duration_ms IS NOT NULL AND (content_type ILIKE 'audio/webm%' OR content_type ILIKE 'audio/ogg%' OR content_type ILIKE 'video/webm%') ORDER BY created_at DESC",
    ).fetch_all(&state.db).await.unwrap_or_default();
    let (mut done, mut failed) = (0, 0);
    for (id, filename, _) in rows {
        let path = state.config.upload_dir.join(id.to_string());
        if tokio::fs::metadata(&path).await.is_err() { continue; }
        match convert_in_place(&path).await {
            Ok(size) => {
                let _ = sqlx::query("UPDATE attachments SET content_type = 'audio/mp4', filename = $2, size = $3 WHERE id = $1")
                    .bind(id).bind(m4a_name(&filename)).bind(size as i64).execute(&state.db).await;
                done += 1;
            }
            Err(e) => {
                failed += 1;
                if WARNED.load(Ordering::Relaxed) && e.to_string().starts_with("ffmpeg not available") { break; }
                tracing::warn!(attachment = %id, error = %e, "voice message conversion failed");
            }
        }
    }
    if done + failed > 0 { tracing::info!(converted = done, failed, "converted stored voice messages to m4a"); }
    let _ = sqlx::query("SELECT pg_advisory_unlock($1)").bind(LOCK).execute(&mut *conn).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_types() {
        assert_eq!(m4a_name("voice-message.webm"), "voice-message.m4a");
        assert_eq!(m4a_name("clip"), "clip.m4a");
        assert!(needs_conversion("audio/webm;codecs=opus") && needs_conversion("audio/webm; codecs=opus") && needs_conversion("audio/ogg"));
        assert!(!needs_conversion("audio/mp4") && !needs_conversion("audio/mpeg"));
    }
}
