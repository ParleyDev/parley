//! Instance-wide assets from a mounted folder (`ASSETS_DIR`, read-only is fine). Each kind lives in its own
//! subfolder; today that is `avatar-decorations/`: PNG / APNG / GIF / WebP overlays drawn around an avatar
//! (Discord-style, square with a transparent middle). Dropping files in or removing them needs no restart: the
//! index is rebuilt from the folder at most every `RESCAN` seconds.
//!
//! A decoration's id is its file name without the extension, lower-cased, with anything outside `a-z0-9_-`
//! turned into `_`. Users store `asset:<id>` in `users.avatar_decoration`. Animated files are big, so each one
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

/// When the index was built, and the index.
type Cached = Option<(Instant, Arc<Index>)>;
static INDEX: LazyLock<RwLock<Cached>> = LazyLock::new(|| RwLock::new(None));

/// The current decoration index, rescanning the folder when the cached one is older than `RESCAN`.
pub async fn decorations(config: &Config) -> Arc<Index> {
    if let Some((at, idx)) = INDEX.read().unwrap().as_ref() {
        if at.elapsed() < RESCAN { return idx.clone(); }
    }
    let dir = config.assets_dir.join(DECORATIONS_DIR);
    let idx = Arc::new(tokio::task::spawn_blocking(move || scan(&dir)).await.unwrap_or_default());
    *INDEX.write().unwrap() = Some((Instant::now(), idx.clone()));
    idx
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

fn content_type(ext: &str) -> Option<&'static str> {
    match ext {
        "png" | "apng" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// Animated PNGs carry an `acTL` chunk before the image data; animated WebP an `ANIM` chunk; GIFs count as animated.
fn is_animated(path: &FsPath, ct: &str) -> bool {
    if ct == "image/gif" { return true; }
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    let mut head = vec![0u8; 4096];
    let n = std::io::Read::read(&mut f, &mut head).unwrap_or(0);
    let head = &head[..n];
    let needle: &[u8] = if ct == "image/webp" { b"ANIM" } else { b"acTL" };
    head.windows(4).any(|w| w == needle)
}

pub fn scan(dir: &FsPath) -> Index {
    let Ok(rd) = std::fs::read_dir(dir) else { return Index::default() };
    let mut files: Vec<_> = rd.flatten().filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false)).collect();
    files.sort_by_key(|e| e.file_name());
    let mut idx = Index::default();
    for e in files {
        let path = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        let (Some(stem), Some(ext)) = (path.file_stem().map(|s| s.to_string_lossy().to_string()), path.extension().map(|s| s.to_string_lossy().to_lowercase())) else { continue };
        let Some(ct) = content_type(&ext) else { continue };
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
            let made = tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
                let img = image::open(&src)?;
                let mut out = std::io::Cursor::new(Vec::new());
                img.write_to(&mut out, image::ImageFormat::Png)?;
                Ok(out.into_inner())
            }).await.map_err(anyhow::Error::from)?;
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
}
