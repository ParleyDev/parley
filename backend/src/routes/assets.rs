//! Instance-wide assets from a mounted folder (`ASSETS_DIR`, read-only is fine). Each kind lives in its own
//! subfolder: `avatar-decorations/` (PNG / APNG / GIF / WebP overlays drawn around an avatar, Discord-style, square
//! with a transparent middle) and `nameplates/` (short WebM / MP4 loops or images shown behind a name in lists). Dropping files in or removing them needs no restart: the
//! index is rebuilt from the folder at most every `RESCAN` seconds.
//!
//! A decoration's id is its file name without the extension, lower-cased, with anything outside `a-z0-9_-`
//! turned into `_`. Users store `asset:<id>` in `users.avatar_decoration` or `users.nameplate`. Animated files are big, so each one
//! also has a still first frame (`…/:id/static`), made once and cached under `UPLOAD_DIR/asset-cache/`.
use crate::{
    config::Config,
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path as FsPath, PathBuf},
    sync::{Arc, LazyLock, RwLock},
    time::{Duration, Instant, UNIX_EPOCH},
};

pub const DECORATIONS_DIR: &str = "avatar-decorations";
pub const NAMEPLATES_DIR: &str = "nameplates";
/// Stored-value prefix for a decoration from the assets folder (presets are bare names like "gold").
pub const ASSET_PREFIX: &str = "asset:";
const RESCAN: Duration = Duration::from_secs(30);
/// Files above this are skipped: an overlay that size would be a mistake, and every client would download it.
const MAX_FILE: u64 = 8 * 1024 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/assets/avatar-decorations", get(list))
        .route("/assets/avatar-decorations/:id", get(serve))
        .route("/assets/avatar-decorations/:id/static", get(serve_static))
        .route("/assets/nameplates", get(list_nameplates))
        .route("/assets/nameplates/:id", get(serve_nameplate))
}

#[derive(Debug, Clone, Serialize)]
pub struct Decoration {
    pub id: String,
    pub name: String,
    pub animated: bool,
    #[serde(skip)]
    path: PathBuf,
    #[serde(skip)]
    content_type: &'static str,
    #[serde(skip)]
    tag: String,
}

#[derive(Default)]
pub struct Index {
    pub list: Vec<Decoration>,
    by_id: HashMap<String, usize>,
}
impl Index {
    pub fn get(&self, id: &str) -> Option<&Decoration> { self.by_id.get(id).map(|&i| &self.list[i]) }
}

/// Per kind: when the index was built, and the index.
static INDEX: LazyLock<RwLock<HashMap<&'static str, (Instant, Arc<Index>)>>> = LazyLock::new(|| RwLock::new(HashMap::new()));

/// A kind's current index, rescanning its folder when the cached one is older than `RESCAN`.
async fn index_of(config: &Config, kind: &'static str) -> Arc<Index> {
    if let Some((at, idx)) = INDEX.read().unwrap().get(kind) {
        if at.elapsed() < RESCAN { return idx.clone(); }
    }
    let dir = config.assets_dir.join(kind);
    let video = kind == NAMEPLATES_DIR;
    let idx = Arc::new(tokio::task::spawn_blocking(move || scan_kind(&dir, video)).await.unwrap_or_default());
    INDEX.write().unwrap().insert(kind, (Instant::now(), idx.clone()));
    idx
}

pub async fn decorations(config: &Config) -> Arc<Index> { index_of(config, DECORATIONS_DIR).await }
pub async fn nameplates(config: &Config) -> Arc<Index> { index_of(config, NAMEPLATES_DIR).await }

/// Whether a stored `nameplate` value names a nameplate file that exists right now.
pub async fn nameplate_exists(config: &Config, value: &str) -> bool {
    match value.strip_prefix(ASSET_PREFIX) {
        Some(id) => nameplates(config).await.get(id).is_some(),
        None => false,
    }
}

/// Whether a stored `avatar_decoration` value names a decoration that exists right now.
pub async fn decoration_exists(config: &Config, value: &str) -> bool {
    match value.strip_prefix(ASSET_PREFIX) {
        Some(id) => decorations(config).await.get(id).is_some(),
        None => false,
    }
}

pub fn asset_id(file_stem: &str) -> String {
    file_stem.trim().to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).take(64).collect()
}

/// "a_hint_of_clove" → "A Hint Of Clove".
pub fn display_name(file_stem: &str) -> String {
    file_stem.split(['_', '-', ' ']).filter(|w| !w.is_empty()).map(|w| { let mut c = w.chars(); c.next().map(|f| f.to_uppercase().chain(c).collect::<String>()).unwrap_or_default() }).collect::<Vec<_>>().join(" ")
}

fn content_type(ext: &str, video: bool) -> Option<&'static str> {
    match ext {
        "png" | "apng" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "webm" if video => Some("video/webm"),
        "mp4" if video => Some("video/mp4"),
        _ => None,
    }
}

/// Animated PNGs carry an `acTL` chunk before the image data; animated WebP an `ANIM` chunk; GIFs count as animated.
fn is_animated(path: &FsPath, ct: &str) -> bool {
    if ct == "image/gif" || ct.starts_with("video/") { return true; }
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    let mut head = vec![0u8; 4096];
    let n = std::io::Read::read(&mut f, &mut head).unwrap_or(0);
    let head = &head[..n];
    let needle: &[u8] = if ct == "image/webp" { b"ANIM" } else { b"acTL" };
    head.windows(4).any(|w| w == needle)
}

pub fn scan(dir: &FsPath) -> Index { scan_kind(dir, false) }

/// Index a kind's folder; `video` also takes WebM / MP4 loops.
pub fn scan_kind(dir: &FsPath, video: bool) -> Index {
    let Ok(rd) = std::fs::read_dir(dir) else { return Index::default() };
    let mut files: Vec<_> = rd.flatten().filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false)).collect();
    files.sort_by_key(|e| e.file_name());
    let mut idx = Index::default();
    for e in files {
        let path = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        let (Some(stem), Some(ext)) = (path.file_stem().map(|s| s.to_string_lossy().to_string()), path.extension().map(|s| s.to_string_lossy().to_lowercase())) else { continue };
        let Some(ct) = content_type(&ext, video) else { continue };
        let Ok(meta) = e.metadata() else { continue };
        if meta.len() == 0 || meta.len() > MAX_FILE { continue; }
        let id = asset_id(&stem);
        if id.is_empty() || idx.by_id.contains_key(&id) { continue; }
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        let d = Decoration { animated: is_animated(&path, ct), name: display_name(&stem), tag: format!("{mtime:x}-{:x}", meta.len()), id: id.clone(), path, content_type: ct };
        idx.by_id.insert(id, idx.list.len());
        idx.list.push(d);
    }
    idx
}

async fn list(State(state): State<AppState>) -> Json<Vec<Decoration>> {
    Json(decorations(&state.config).await.list.clone())
}

async fn list_nameplates(State(state): State<AppState>) -> Json<Vec<Decoration>> {
    Json(nameplates(&state.config).await.list.clone())
}

async fn serve_nameplate(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap) -> AppResult<Response> {
    let d = nameplates(&state.config).await.get(&id).cloned().ok_or_else(|| AppError::NotFound("Unknown nameplate".into()))?;
    let etag = format!("\"{}\"", d.tag);
    if not_modified(&headers, &etag) { return Ok(StatusCode::NOT_MODIFIED.into_response()); }
    let file = tokio::fs::File::open(&d.path).await.map_err(|_| AppError::NotFound("Nameplate file missing".into()))?;
    Ok(image_response(Body::from_stream(tokio_util::io::ReaderStream::new(file)), d.content_type, &etag))
}

/// Shared headers; the ETag follows the file's mtime and size so a replaced file is picked up after max-age.
fn image_response(body: Body, ct: &str, etag: &str) -> Response {
    let mut resp = Response::new(body);
    let h = resp.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(ct).unwrap_or(HeaderValue::from_static("image/png")));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=86400"));
    if let Ok(v) = HeaderValue::from_str(etag) { h.insert(header::ETAG, v); }
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'"));
    resp
}

fn not_modified(headers: &HeaderMap, etag: &str) -> bool {
    headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()).is_some_and(|v| v.split(',').any(|t| t.trim() == etag))
}

async fn find(state: &AppState, id: &str) -> AppResult<Decoration> {
    decorations(&state.config).await.get(id).cloned().ok_or_else(|| AppError::NotFound("Unknown decoration".into()))
}

async fn serve(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap) -> AppResult<Response> {
    let d = find(&state, &id).await?;
    let etag = format!("\"{}\"", d.tag);
    if not_modified(&headers, &etag) { return Ok(StatusCode::NOT_MODIFIED.into_response()); }
    let file = tokio::fs::File::open(&d.path).await.map_err(|_| AppError::NotFound("Decoration file missing".into()))?;
    Ok(image_response(Body::from_stream(tokio_util::io::ReaderStream::new(file)), d.content_type, &etag))
}

/// A still first frame for lists (animated files are often ~1 MB each); still images are served as they are.
async fn serve_static(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap) -> AppResult<Response> {
    let d = find(&state, &id).await?;
    if !d.animated { return serve(State(state), Path(id), headers).await; }
    let etag = format!("\"s-{}\"", d.tag);
    if not_modified(&headers, &etag) { return Ok(StatusCode::NOT_MODIFIED.into_response()); }
    let cache = state.config.upload_dir.join("asset-cache").join(DECORATIONS_DIR).join(format!("{}-{}.png", d.id, d.tag));
    let bytes = match tokio::fs::read(&cache).await {
        Ok(b) => b,
        Err(_) => {
            let src = d.path.clone();
            let made = tokio::task::spawn_blocking(move || crate::routes::images::first_frame_png(&src)).await.map_err(anyhow::Error::from)?;
            match made {
                Ok(b) => {
                    if let Some(parent) = cache.parent() { let _ = tokio::fs::create_dir_all(parent).await; }
                    let _ = tokio::fs::write(&cache, &b).await;
                    b
                }
                // Undecodable here: hand out the original rather than nothing.
                Err(e) => { tracing::warn!(id = %d.id, "decoration still frame failed: {e}"); return serve(State(state), Path(id), headers).await; }
            }
        }
    };
    Ok(image_response(Body::from(bytes), "image/png", &etag))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_names() {
        assert_eq!(asset_id("A Duck"), "a_duck");
        assert_eq!(asset_id("../evil"), "___evil");
        assert_eq!(display_name("a_hint_of_clove"), "A Hint Of Clove");
        assert_eq!(display_name("28_years-later"), "28 Years Later");
    }

    #[test]
    fn scan_picks_images_and_skips_the_rest() {
        let dir = std::env::temp_dir().join(format!("parley-assets-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0";
        std::fs::write(dir.join("Still One.png"), png).unwrap();
        std::fs::write(dir.join("moving.png"), [&png[..], b"\0\0\0\x08acTL\0\0\0\x02\0\0\0\0"].concat()).unwrap();
        std::fs::write(dir.join("MOVING.gif"), b"GIF89a").unwrap(); // same id as moving.png: first one wins
        std::fs::write(dir.join("notes.txt"), b"hi").unwrap();
        std::fs::write(dir.join(".hidden.png"), png).unwrap();
        std::fs::write(dir.join("empty.png"), b"").unwrap();
        let idx = scan(&dir);
        let ids: Vec<_> = idx.list.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, ["moving", "still_one"]);
        assert!(idx.get("moving").unwrap().animated && idx.get("moving").unwrap().content_type == "image/gif");
        assert!(!idx.get("still_one").unwrap().animated);
        assert_eq!(idx.get("still_one").unwrap().name, "Still One");
        assert!(scan(&dir.join("missing")).list.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn nameplates_take_video_and_decorations_do_not() {
        let dir = std::env::temp_dir().join(format!("parley-assets-video-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Aurora.webm"), b"\x1a\x45\xdf\xa3webm").unwrap();
        std::fs::write(dir.join("clip.mp4"), b"\0\0\0\x18ftypmp42").unwrap();
        let plates = scan_kind(&dir, true);
        assert_eq!(plates.list.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), ["aurora", "clip"]);
        assert!(plates.get("aurora").unwrap().animated && plates.get("aurora").unwrap().content_type == "video/webm");
        assert!(scan(&dir).list.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
