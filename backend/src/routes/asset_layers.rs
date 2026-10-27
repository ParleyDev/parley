//! Layered assets from the instance's assets folder: Discord-style profile effects (`profile-effects/<folder>/`:
//! timed animated PNG layers over the profile card) and profile frames (`profile-frames/<folder>/`: images stapled
//! to the card's top and bottom, rails and borders along its sides). Each folder's `metadata.json` describes them
//! (`{items: [{folder, name, description, layers, layout}]}`); a folder without an entry there is skipped, since the
//! layers can't be placed without it.
//!
//! Users store `asset:<id>` in `profile_effect` / `profile_frame`. Clients get the list with the layer data (plus
//! each layer's pixel size) and fetch files by name; only files actually in the folder are served. Frames also get
//! a small composite preview for pickers, made once and cached under `UPLOAD_DIR/asset-cache/`.
use super::assets::{asset_id, read_metadata, ASSET_PREFIX};
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
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, LazyLock, RwLock},
    time::{Duration, Instant, UNIX_EPOCH},
};

pub const EFFECTS_DIR: &str = "profile-effects";
pub const FRAMES_DIR: &str = "profile-frames";
const RESCAN: Duration = Duration::from_secs(60);
/// Effect layers are full-card animations; the largest are around 12 MB.
const MAX_FILE: u64 = 24 * 1024 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/assets/profile-effects", get(list_effects))
        .route("/assets/profile-effects/:id/:file", get(serve_effect))
        .route("/assets/profile-frames", get(list_frames))
        .route("/assets/profile-frames/:id/preview", get(frame_preview))
        .route("/assets/profile-frames/:id/:file", get(serve_frame))
}

#[derive(Debug, Clone, Serialize)]
pub struct Layered {
    pub id: String,
    pub name: String,
    pub description: String,
    /// Effects: `[{file, start_ms, duration_ms, loop, loop_delay_ms, z_index, random_variants?}]`;
    /// frames: `[{file, order, type, anchor, responsive}]`; each with its `width` and `height` in pixels.
    pub layers: Vec<Value>,
    /// Frames: `{inner_width, overflow_top, overflow_bottom, overflow_horizontal}`.
    #[serde(skip_serializing_if = "Value::is_null")]
    pub layout: Value,
    /// Effects: a still for pickers and one for reduced motion, when the folder has them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub still: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reduced_motion: Option<String>,
    #[serde(skip)]
    dir: PathBuf,
    #[serde(skip)]
    files: HashSet<String>,
    #[serde(skip)]
    tag: String,
}

#[derive(Default)]
pub struct LayerIndex {
    pub list: Vec<Layered>,
    by_id: HashMap<String, usize>,
}
impl LayerIndex {
    pub fn get(&self, id: &str) -> Option<&Layered> { self.by_id.get(id).map(|&i| &self.list[i]) }
}

static INDEX: LazyLock<RwLock<HashMap<&'static str, (Instant, Arc<LayerIndex>)>>> = LazyLock::new(|| RwLock::new(HashMap::new()));

async fn index_of(config: &Config, kind: &'static str) -> Arc<LayerIndex> {
    if let Some((at, idx)) = INDEX.read().unwrap().get(kind) {
        if at.elapsed() < RESCAN { return idx.clone(); }
    }
    let dir = config.assets_dir.join(kind);
    let idx = Arc::new(tokio::task::spawn_blocking(move || scan_layered(&dir)).await.unwrap_or_default());
    INDEX.write().unwrap().insert(kind, (Instant::now(), idx.clone()));
    idx
}

pub async fn effects(config: &Config) -> Arc<LayerIndex> { index_of(config, EFFECTS_DIR).await }
pub async fn frames(config: &Config) -> Arc<LayerIndex> { index_of(config, FRAMES_DIR).await }

/// Whether a stored value names an effect / frame folder that exists right now.
pub async fn effect_exists(config: &Config, value: &str) -> bool {
    match value.strip_prefix(ASSET_PREFIX) { Some(id) => effects(config).await.get(id).is_some(), None => false }
}
pub async fn frame_exists(config: &Config, value: &str) -> bool {
    match value.strip_prefix(ASSET_PREFIX) { Some(id) => frames(config).await.get(id).is_some(), None => false }
}

fn image_type(name: &str) -> Option<&'static str> {
    match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" | "apng" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

/// Index every folder that `metadata.json` describes and whose layer files are all present.
pub fn scan_layered(dir: &std::path::Path) -> LayerIndex {
    let meta = read_metadata(dir);
    let mut folders: Vec<_> = meta.into_iter().collect();
    folders.sort_by(|a, b| a.0.cmp(&b.0));
    let mut idx = LayerIndex::default();
    for (folder, m) in folders {
        if folder.contains(['/', '\\']) || folder.starts_with('.') { continue }
        let path = dir.join(&folder);
        let Ok(rd) = std::fs::read_dir(&path) else { continue };
        let mut files = HashSet::new();
        let mut newest = 0u64;
        let mut total = 0u64;
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(md) = e.metadata() else { continue };
            if !md.is_file() || name.starts_with('.') || image_type(&name).is_none() || md.len() == 0 || md.len() > MAX_FILE { continue }
            newest = newest.max(md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0));
            total += md.len();
            files.insert(name);
        }
        let Some(raw_layers) = m["layers"].as_array() else { continue };
        let mut layers = Vec::new();
        let mut complete = true;
        for l in raw_layers {
            let Some(file) = l["file"].as_str() else { complete = false; break };
            if !files.contains(file) { complete = false; break }
            let mut l = l.clone();
            if let Ok(sz) = imagesize::size(path.join(file)) { l["width"] = sz.width.into(); l["height"] = sz.height.into(); }
            if let Some(vs) = l["random_variants"].as_array() {
                let present: Vec<Value> = vs.iter().filter(|v| v.as_str().is_some_and(|f| files.contains(f))).cloned().collect();
                l["random_variants"] = Value::Array(present);
            }
            layers.push(l);
        }
        if !complete || layers.is_empty() { continue }
        let id = asset_id(&folder);
        if id.is_empty() || idx.by_id.contains_key(&id) { continue }
        let name = m["name"].as_str().map(str::trim).filter(|n| !n.is_empty()).map(str::to_string).unwrap_or_else(|| super::assets::display_name(&folder));
        let pick = |f: &str| files.contains(f).then(|| f.to_string());
        idx.by_id.insert(id.clone(), idx.list.len());
        idx.list.push(Layered {
            id, name, description: m["description"].as_str().unwrap_or_default().trim().to_string(), layers, layout: m["layout"].clone(),
            still: pick("static.png"), reduced_motion: pick("reduced_motion.png"), tag: format!("{newest:x}-{total:x}"), dir: path, files,
        });
    }
    idx
}

async fn list_effects(State(state): State<AppState>) -> Response { list_response(&effects(&state.config).await.list) }
async fn list_frames(State(state): State<AppState>) -> Response { list_response(&frames(&state.config).await.list) }

/// The catalogue changes only when the folder does; let clients keep it for a few minutes.
fn list_response(list: &[Layered]) -> Response {
    let mut resp = Json(list).into_response();
    resp.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=300"));
    resp
}

async fn serve_file(idx: Arc<LayerIndex>, id: &str, file: &str, headers: &HeaderMap) -> AppResult<Response> {
    let item = idx.get(id).ok_or_else(|| AppError::NotFound("Unknown asset".into()))?;
    if !item.files.contains(file) { return Err(AppError::NotFound("No such file".into())) }
    let ct = image_type(file).unwrap_or("image/png");
    let etag = format!("\"{}-{}\"", item.tag, file.len());
    if headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()).is_some_and(|v| v.split(',').any(|t| t.trim() == etag)) {
        return Ok(StatusCode::NOT_MODIFIED.into_response());
    }
    let f = tokio::fs::File::open(item.dir.join(file)).await.map_err(|_| AppError::NotFound("File missing".into()))?;
    Ok(image_response(Body::from_stream(tokio_util::io::ReaderStream::new(f)), ct, &etag))
}

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

async fn serve_effect(State(state): State<AppState>, Path((id, file)): Path<(String, String)>, headers: HeaderMap) -> AppResult<Response> {
    serve_file(effects(&state.config).await, &id, &file, &headers).await
}
async fn serve_frame(State(state): State<AppState>, Path((id, file)): Path<(String, String)>, headers: HeaderMap) -> AppResult<Response> {
    serve_file(frames(&state.config).await, &id, &file, &headers).await
}

/// A picker-sized picture of a frame around a blank card: back layers, the card, front layers.
async fn frame_preview(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap) -> AppResult<Response> {
    let item = frames(&state.config).await.get(&id).cloned().ok_or_else(|| AppError::NotFound("Unknown frame".into()))?;
    let etag = format!("\"p-{}\"", item.tag);
    if headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()).is_some_and(|v| v.split(',').any(|t| t.trim() == etag)) {
        return Ok(StatusCode::NOT_MODIFIED.into_response());
    }
    let cache = state.config.upload_dir.join("asset-cache").join(FRAMES_DIR).join(format!("{}-{}.png", item.id, item.tag));
    let bytes = match tokio::fs::read(&cache).await {
        Ok(b) => b,
        Err(_) => {
            let it = item.clone();
            let b = tokio::task::spawn_blocking(move || compose_preview(&it)).await.map_err(anyhow::Error::from)?.map_err(|e| AppError::Other(anyhow::anyhow!("frame preview: {e}")))?;
            if let Some(p) = cache.parent() { let _ = tokio::fs::create_dir_all(p).await; }
            let _ = tokio::fs::write(&cache, &b).await;
            b
        }
    };
    Ok(image_response(Body::from(bytes), "image/png", &etag))
}

/// Card size the preview is drawn around, in the frame's own units (Discord's 4x card: 1200 wide).
const PREVIEW_CARD_H: u32 = 1500;
const PREVIEW_SCALE: u32 = 8;

fn compose_preview(item: &Layered) -> Result<Vec<u8>, String> {
    use image::{imageops, Rgba, RgbaImage};
    let num = |k: &str| item.layout[k].as_u64().unwrap_or(0) as u32;
    let inner = item.layout["inner_width"].as_u64().unwrap_or(1200) as u32;
    let (ot, ob, oh) = (num("overflow_top"), num("overflow_bottom"), num("overflow_horizontal"));
    let (w, h) = (inner + 2 * oh, ot + PREVIEW_CARD_H + ob);
    let mut canvas = RgbaImage::new(w, h);
    let draw = |canvas: &mut RgbaImage, l: &Value| -> Result<(), String> {
        let file = l["file"].as_str().unwrap_or_default();
        let img = image::open(item.dir.join(file)).map_err(|e| e.to_string())?.to_rgba8();
        let x = (w as i64 - img.width() as i64) / 2;
        let y = match (l["type"].as_str(), l["anchor"].as_str()) {
            (Some("staple"), Some("bottom")) => (ot + PREVIEW_CARD_H + ob) as i64 - img.height() as i64,
            (Some("staple"), _) => 0,
            (_, Some("top")) => ot as i64,
            _ => ot as i64 + (PREVIEW_CARD_H as i64 - img.height() as i64) / 2,
        };
        if l["type"] == "staple" {
            imageops::overlay(canvas, &img, x, y);
        } else {
            // Rails and borders run along the card only.
            let mut band = RgbaImage::new(w, PREVIEW_CARD_H);
            imageops::overlay(&mut band, &img, x, y - ot as i64);
            imageops::overlay(canvas, &band, 0, ot as i64);
        }
        Ok(())
    };
    for l in item.layers.iter().filter(|l| l["order"] == "back") { draw(&mut canvas, l)?; }
    // The card itself (rounded corners, Discord's popout grey).
    let r = 64i64;
    for y in 0..PREVIEW_CARD_H { for x in 0..inner {
        let (cx, cy) = (x as i64, y as i64);
        let (dx, dy) = ((r - cx).max(cx - (inner as i64 - 1 - r)).max(0), (r - cy).max(cy - (PREVIEW_CARD_H as i64 - 1 - r)).max(0));
        if dx * dx + dy * dy <= r * r { canvas.put_pixel(x + oh, y + ot, Rgba([35, 36, 40, 255])) }
    } }
    for l in item.layers.iter().filter(|l| l["order"] != "back") { draw(&mut canvas, l)?; }
    let small = imageops::resize(&canvas, w / PREVIEW_SCALE, h / PREVIEW_SCALE, imageops::FilterType::Triangle);
    let mut out = std::io::Cursor::new(Vec::new());
    small.write_to(&mut out, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(path: &std::path::Path, w: u32, h: u32) {
        image::RgbaImage::new(w, h).save(path).unwrap();
    }

    #[test]
    fn folders_need_metadata_and_every_layer() {
        let dir = std::env::temp_dir().join(format!("parley-layered-{}", uuid::Uuid::now_v7()));
        for f in ["good", "missing_layer", "no_meta"] { std::fs::create_dir_all(dir.join(f)).unwrap(); }
        png(&dir.join("good/layer_01.png"), 45, 88);
        png(&dir.join("good/static.png"), 9, 17);
        std::fs::write(dir.join("good/notes.txt"), "x").unwrap();
        png(&dir.join("no_meta/layer_01.png"), 4, 4);
        std::fs::write(dir.join("metadata.json"), serde_json::json!({ "items": [
            { "folder": "good", "name": "Good One", "description": "d", "layers": [{ "file": "layer_01.png", "start_ms": 0, "duration_ms": 100, "loop": true, "loop_delay_ms": 0, "z_index": 100, "random_variants": ["gone.png"] }] },
            { "folder": "missing_layer", "name": "x", "layers": [{ "file": "layer_01.png" }] },
            { "folder": "../escape", "name": "x", "layers": [{ "file": "layer_01.png" }] },
        ] }).to_string()).unwrap();
        let idx = scan_layered(&dir);
        assert_eq!(idx.list.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(), ["good"]);
        let g = idx.get("good").unwrap();
        assert_eq!((g.name.as_str(), g.still.as_deref()), ("Good One", Some("static.png")));
        assert_eq!((g.layers[0]["width"].as_u64(), g.layers[0]["height"].as_u64()), (Some(45), Some(88)));
        assert_eq!(g.layers[0]["random_variants"], serde_json::json!([]));
        assert!(!g.files.contains("notes.txt"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn frame_previews_compose() {
        let dir = std::env::temp_dir().join(format!("parley-frame-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(dir.join("f")).unwrap();
        png(&dir.join("f/front_staple_top.png"), 1312, 716);
        png(&dir.join("f/back_rail_center.png"), 1312, 2528);
        std::fs::write(dir.join("metadata.json"), serde_json::json!({ "items": [{ "folder": "f", "name": "F",
            "layout": { "inner_width": 1200, "overflow_top": 304, "overflow_bottom": 0, "overflow_horizontal": 56 },
            "layers": [{ "file": "front_staple_top.png", "order": "front", "type": "staple", "anchor": "top" }, { "file": "back_rail_center.png", "order": "back", "type": "rail", "anchor": "center" }] }] }).to_string()).unwrap();
        let idx = scan_layered(&dir);
        let png = compose_preview(idx.get("f").unwrap()).unwrap();
        let img = image::load_from_memory(&png).unwrap();
        assert_eq!((img.width(), img.height()), (1312 / PREVIEW_SCALE, (304 + PREVIEW_CARD_H) / PREVIEW_SCALE));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
