//! Tags and cover art for music posted as audio files: the title, artist, album, year, track number and genre (ID3
//! in MP3s, Vorbis comments in FLAC and Ogg, iTunes atoms in M4A), and the embedded front cover. The players show
//! them in place of the file name. The image's ffmpeg has no ffprobe, so the tags come from `ffmpeg -i`'s description
//! of the file; the cover is decoded and saved as a JPEG of at most 512 px, which becomes the attachment's thumbnail
//! (`<id>.thumb`, `thumb_type`). Read at upload, and once in the background for audio posted before this existed.
//! `attachments.audio_tags` is NULL until the file has been read and `{}` when it has no tags.
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::state::AppState;

/// Covers are scaled to fit this square.
const COVER: u32 = 512;
/// A tag value longer than this is cut.
const MAX_LEN: usize = 200;

pub struct Read {
    /// `{title, artist, album, year, track, genre}`, each only when the file has it.
    pub tags: Value,
    /// The front cover as a JPEG, when the file has one.
    pub cover: Option<Vec<u8>>,
}

/// The tags and cover of the audio file at `src`. None when ffmpeg isn't there; a file it can't read has no tags.
pub async fn read(src: &Path) -> Option<Read> {
    let run = tokio::process::Command::new("ffmpeg").args(["-nostdin", "-hide_banner", "-i"]).arg(src).kill_on_drop(true).output();
    let out = match tokio::time::timeout(std::time::Duration::from_secs(15), run).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => { tracing::debug!(error = %e, "no ffmpeg: audio files have no tags"); return None; }
        Err(_) => return Some(Read { tags: Value::Object(Map::new()), cover: None }),
    };
    let dump = String::from_utf8_lossy(&out.stderr);
    let (raw, cover_stream) = parse_dump(&dump);
    let cover = match cover_stream { Some(s) => extract_cover(src, &s).await, None => None };
    Some(Read { tags: tidy(&raw), cover })
}

/// Decodes the attached picture in stream `stream` ("0:1") to a JPEG.
async fn extract_cover(src: &Path, stream: &str) -> Option<Vec<u8>> {
    let tmp = src.with_extension(format!("cover-{}", Uuid::new_v4().simple()));
    let scale = format!("scale='min({COVER},iw)':'min({COVER},ih)':force_original_aspect_ratio=decrease:flags=bicubic+accurate_rnd+full_chroma_int,format=yuvj420p");
    let run = tokio::process::Command::new("ffmpeg")
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(src)
        .args(["-map", stream, "-an", "-frames:v", "1", "-vf", &scale, "-c:v", "mjpeg", "-q:v", "3", "-f", "image2"])
        .arg(&tmp)
        .kill_on_drop(true)
        .output();
    let ok = matches!(tokio::time::timeout(std::time::Duration::from_secs(15), run).await, Ok(Ok(ref o)) if o.status.success());
    let bytes = if ok { tokio::fs::read(&tmp).await.ok().filter(|b| !b.is_empty()) } else { None };
    let _ = tokio::fs::remove_file(&tmp).await;
    bytes
}

/// The file's tags (lower-case keys; the file's own over its audio stream's) and the stream holding its cover, from
/// `ffmpeg -i`'s description. Metadata entries sit two spaces deeper than their `Metadata:` heading as `key : value`,
/// a value's further lines as `: more` under the value. Chapters' and the cover's own metadata are skipped.
fn parse_dump(dump: &str) -> (Map<String, Value>, Option<String>) {
    let (mut file, mut stream) = (Map::new(), Map::new());
    let mut cover = None;
    // Which metadata block is open (true: the file's own) and the indent of its entries; the stream block that
    // follows a `Stream` line, if it's audio.
    let mut open: Option<(bool, usize)> = None;
    let mut audio_stream = false;
    let mut last: Option<(bool, String)> = None;
    for line in dump.lines() {
        let indent = line.len() - line.trim_start().len();
        let text = line.trim();
        if let Some((global, at)) = open {
            // A value's further lines are indented to the value's column.
            if indent > at && text.starts_with(':') {
                let v = text[1..].strip_prefix(' ').unwrap_or(&text[1..]);
                let into = if global { &mut file } else { &mut stream };
                if let Some((g, key)) = &last { if *g == global { if let Some(Value::String(s)) = into.get_mut(key) { s.push('\n'); s.push_str(v); } } }
                continue;
            }
            if indent == at {
                if let Some(i) = text.find(':') {
                    let (k, v) = (text[..i].trim().to_ascii_lowercase(), text[i + 1..].strip_prefix(' ').unwrap_or(&text[i + 1..]));
                    let into = if global { &mut file } else { &mut stream };
                    if k.is_empty() {
                        if let Some((g, key)) = &last { if *g == global { if let Some(Value::String(s)) = into.get_mut(key) { s.push('\n'); s.push_str(v); } } }
                    } else if !into.contains_key(&k) {
                        into.insert(k.clone(), Value::String(v.to_string()));
                        last = Some((global, k));
                    }
                    continue;
                }
            }
            open = None;
        }
        if text == "Metadata:" {
            if indent == 2 { open = Some((true, 4)) } else if indent > 2 && audio_stream { open = Some((false, indent + 2)) }
            continue;
        }
        if let Some(rest) = text.strip_prefix("Stream #") {
            audio_stream = text.contains(": Audio:");
            if cover.is_none() && text.contains(": Video:") && text.contains("(attached pic)") {
                let id: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == ':').collect();
                let id = id.trim_end_matches(':').to_string();
                if !id.is_empty() { cover = Some(id) }
            }
        } else if text.starts_with("Chapter #") || text.starts_with("Output #") {
            audio_stream = false;
        }
    }
    for (k, v) in stream { file.entry(k).or_insert(v); }
    (file, cover)
}

/// The tags the players show, cleaned: no control characters, trimmed, cut to `MAX_LEN`.
fn tidy(raw: &Map<String, Value>) -> Value {
    let get = |keys: &[&str]| keys.iter().find_map(|k| raw.get(*k).and_then(|v| v.as_str()).map(clean).filter(|s| !s.is_empty()));
    let mut out = Map::new();
    if let Some(v) = get(&["title"]) { out.insert("title".into(), v.into()); }
    if let Some(v) = get(&["artist", "album_artist", "album artist", "performer"]) { out.insert("artist".into(), v.into()); }
    if let Some(v) = get(&["album"]) { out.insert("album".into(), v.into()); }
    if let Some(y) = get(&["date", "year", "tdrc", "tyer", "originaldate"]).and_then(|d| year(&d)) { out.insert("year".into(), y.into()); }
    if let Some(n) = get(&["track", "tracknumber"]).and_then(|t| t.split('/').next().and_then(|n| n.trim().parse::<u16>().ok())).filter(|n| *n > 0) { out.insert("track".into(), n.into()); }
    if let Some(v) = get(&["genre"]) { out.insert("genre".into(), v.into()); }
    Value::Object(out)
}

fn clean(s: &str) -> String {
    let one: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let squeezed = one.split_whitespace().collect::<Vec<_>>().join(" ");
    squeezed.chars().take(MAX_LEN).collect()
}

/// The first plausible four-digit year in a date tag ("2024", "2024-03-01", "03/2024").
fn year(d: &str) -> Option<u16> {
    let digits: Vec<char> = d.chars().collect();
    digits.windows(4).enumerate().find_map(|(i, w)| {
        let before = i == 0 || !digits[i - 1].is_ascii_digit();
        let after = digits.get(i + 4).map(|c| !c.is_ascii_digit()).unwrap_or(true);
        (before && after && w.iter().all(|c| c.is_ascii_digit())).then(|| w.iter().collect::<String>().parse::<u16>().ok()).flatten()
    }).filter(|y| (1000..3000).contains(y))
}

/// The cover through the checks a posted picture gets (known abuse material, the server's explicit image filter),
/// then saved as `<id>.thumb`. False when it was refused or couldn't be saved; a refusal's error is returned.
pub async fn keep_cover(state: &AppState, id: Uuid, cover: &[u8], uid: Uuid, channel_id: Uuid, filename: &str, explicit: bool) -> crate::error::AppResult<bool> {
    crate::routes::matching::check(state, cover, crate::routes::matching::Ctx { user_id: uid, surface: "attachment", channel_id: Some(channel_id), filename, content_type: "image/jpeg" }).await?;
    if explicit { crate::routes::explicit::check_attachment(state, cover, "image/jpeg", channel_id, uid).await?; }
    let out = thumb_path(&state.config.upload_dir, id);
    let tmp = out.with_extension(format!("thumb-{}", Uuid::new_v4().simple()));
    if tokio::fs::write(&tmp, cover).await.is_err() { return Ok(false) }
    Ok(tokio::fs::rename(&tmp, &out).await.is_ok())
}

fn thumb_path(dir: &Path, id: Uuid) -> PathBuf { dir.join(format!("{id}.thumb")) }

/// Once at start-up: tags and covers for audio files posted before they were read, newest first. A cover that fails
/// the abuse check is left out (the check records the match).
pub async fn backfill(state: AppState) {
    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
    let mut tried = std::collections::HashSet::new();
    let (mut tagged, mut covers) = (0, 0);
    loop {
        let rows: Vec<(Uuid, Uuid, Uuid, String)> = sqlx::query_as(
            "SELECT id, uploader_id, channel_id, filename FROM attachments WHERE audio_tags IS NULL AND duration_ms IS NULL AND content_type ILIKE 'audio/%' AND message_id IS NOT NULL ORDER BY created_at DESC LIMIT 200",
        ).fetch_all(&state.db).await.unwrap_or_default();
        let fresh: Vec<_> = rows.into_iter().filter(|r| tried.insert(r.0)).collect();
        if fresh.is_empty() { break; }
        for (id, uid, channel_id, filename) in fresh {
            let Some(r) = read(&state.config.upload_dir.join(id.to_string())).await else { return };
            let kept = match &r.cover { Some(c) => keep_cover(&state, id, c, uid, channel_id, &filename, false).await.unwrap_or(false), None => false };
            let _ = sqlx::query("UPDATE attachments SET audio_tags = $2, thumb_type = CASE WHEN $3 THEN 'image/jpeg' ELSE thumb_type END WHERE id = $1 AND audio_tags IS NULL")
                .bind(id).bind(&r.tags).bind(kept).execute(&state.db).await;
            if r.tags.as_object().map(|o| !o.is_empty()).unwrap_or(false) { tagged += 1; }
            if kept { covers += 1; }
        }
    }
    if tagged + covers > 0 { tracing::info!(tagged, covers, "audio tags backfilled"); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const MP3: &str = "Input #0, mp3, from 'x':
  Metadata:
    title           : Tidewater
    artist          : Low Lantern
    album           : Harbour Lights
    date            : 2024-03-01
    track           : 4/11
    genre           : Ambient
    comment         : line one
                    : line two
  Duration: 00:03:47.00, start: 0.025057, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 320 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 600x600 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)
      Metadata:
        title           : Album cover
        comment         : Cover (front)
At least one output file must be specified";

    const OGG: &str = "Input #0, ogg, from 'x':
  Duration: 00:00:02.00, start: 0.000000, bitrate: 40 kb/s
  Stream #0:0: Audio: vorbis, 44100 Hz, mono, fltp, 80 kb/s
      Metadata:
        TITLE           : Night\u{7}Bus
        ARTIST          : Somebody
        DATE            : 1999
        TRACKNUMBER     : 2
At least one output file must be specified";

    #[test]
    fn reads_file_tags_and_finds_the_cover() {
        let (raw, cover) = parse_dump(MP3);
        assert_eq!(cover.as_deref(), Some("0:1"));
        assert_eq!(raw["comment"], "line one\nline two");
        assert_eq!(tidy(&raw), json!({ "title": "Tidewater", "artist": "Low Lantern", "album": "Harbour Lights", "year": 2024, "track": 4, "genre": "Ambient" }));
    }

    #[test]
    fn reads_stream_tags_and_cleans_them() {
        let (raw, cover) = parse_dump(OGG);
        assert_eq!(cover, None);
        assert_eq!(tidy(&raw), json!({ "title": "Night Bus", "artist": "Somebody", "year": 1999, "track": 2 }));
    }

    #[test]
    fn no_tags_is_empty() {
        let (raw, cover) = parse_dump("Input #0, wav, from 'x':\n  Duration: 00:00:01.00, bitrate: 1411 kb/s\n  Stream #0:0: Audio: pcm_s16le, 44100 Hz, 2 channels, s16, 1411 kb/s\n");
        assert_eq!((tidy(&raw), cover), (json!({}), None));
    }

    #[test]
    fn years() {
        assert_eq!(year("2024-03-01"), Some(2024));
        assert_eq!(year("03/1987"), Some(1987));
        assert_eq!(year("12345"), None);
        assert_eq!(year("0000"), None);
        assert_eq!(clean("  a \t b\n"), "a b");
    }
}
