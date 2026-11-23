//! Adding and editing the instance's assets-folder cosmetics from the admin console. The folder and its
//! `metadata.json` files belong to whoever set the instance up (Parley only reads their format, and keeps it as it
//! is): an admin's new item becomes its files plus an entry in its kind's `metadata.json`, and an edit rewrites that
//! entry (name, description, tags, an effect's layer timing, a frame's layout and layers) and adds or replaces files. Every
//! other field in an entry, and the file's other keys, are kept; `item_count` follows the list when the file has one.
//! Turning items off and deleting them are Parley's alone (routes/cosmetics.rs). When the folder isn't writable
//! (mounted read-only), adding and editing fail and say so.
//!
//! Importing copies items from another folder of the same layout (the admin picks it in the browser): only items
//! whose file or folder this one doesn't have yet, each with its entry exactly as it was (shop fields and all).

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use serde_json::{json, Map, Value};
use std::path::{Path as FsPath, PathBuf};

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::{
        admin_access::{require_perm, Perm},
        asset_layers, assets,
    },
    state::AppState,
};

/// Each file is at most what the folder scan accepts.
const MAX_FILE: usize = 8 * 1024 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/cosmetics-folder", get(status))
        .route("/admin/cosmetics/:kind/folder", post(add))
        .route("/admin/cosmetics/:kind/folder/:id", patch(edit))
        .route("/admin/cosmetics/:kind/import/check", post(import_check))
        .route("/admin/cosmetics/:kind/import", post(import))
        .route("/admin/cosmetics/bundles", get(bundles_get))
        .route("/admin/cosmetics/bundles/:file", axum::routing::put(bundles_put).delete(bundles_delete))
        .route("/admin/cosmetics/:kind/metadata", get(metadata_get).patch(metadata_patch))
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
}

fn dir_name(kind: &str) -> AppResult<&'static str> {
    Ok(match kind {
        "decoration" => assets::DECORATIONS_DIR,
        "nameplate" => assets::NAMEPLATES_DIR,
        "effect" => asset_layers::EFFECTS_DIR,
        "frame" => asset_layers::FRAMES_DIR,
        _ => return Err(AppError::NotFound("Unknown kind of cosmetic".into())),
    })
}
/// Effects and frames are folders of layers; decorations and nameplates are single files.
fn layered(kind: &str) -> bool { kind == "effect" || kind == "frame" }

fn read_only() -> AppError {
    AppError::Conflict("The assets folder isn't writable. Mount it read-write to add or edit items here.".into())
}
fn io(e: std::io::Error) -> AppError {
    use std::io::ErrorKind::*;
    match e.kind() {
        PermissionDenied | ReadOnlyFilesystem => read_only(),
        _ => AppError::Other(e.into()),
    }
}

/// Can Parley write to the folder? (A test file, made and removed.)
async fn writable(root: &FsPath) -> bool {
    let probe = root.join(".parley-write-test");
    let ok = tokio::fs::create_dir_all(root).await.is_ok() && tokio::fs::write(&probe, b"").await.is_ok();
    let _ = tokio::fs::remove_file(&probe).await;
    ok
}

async fn status(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    Ok(Json(json!({ "writable": writable(&state.config.assets_dir).await })))
}

/// Write a file in place atomically (a hidden temp file beside it, then a rename).
async fn put_file(path: &FsPath, bytes: &[u8]) -> AppResult<()> {
    let tmp = path.with_file_name(format!(".{}.parley-tmp", path.file_name().and_then(|n| n.to_str()).unwrap_or("file")));
    tokio::fs::write(&tmp, bytes).await.map_err(io)?;
    tokio::fs::rename(&tmp, path).await.map_err(|e| { let _ = std::fs::remove_file(&tmp); io(e) })
}

/// How a `metadata.json` was laid out, so a rewrite keeps it: its indent (`None`: all on one line) and whether it
/// ended with a newline. A new file gets one space and a newline.
#[derive(Debug, Clone, PartialEq)]
struct Layout { indent: Option<Vec<u8>>, newline: bool }
impl Default for Layout { fn default() -> Self { Layout { indent: Some(b" ".to_vec()), newline: true } } }

fn layout_of(text: &str) -> Layout {
    let body = text.trim_end();
    let indent = body.lines().nth(1).map(|l| l.bytes().take_while(|b| *b == b' ' || *b == b'\t').collect::<Vec<u8>>());
    Layout { indent: match indent { Some(i) if !i.is_empty() => Some(i), Some(_) => Some(b" ".to_vec()), None => None }, newline: text.ends_with('\n') }
}

/// A kind's `metadata.json` as it is (an empty `{items: []}` when the folder has none yet), and its layout.
async fn read_meta(dir: &FsPath) -> AppResult<(Value, Layout)> {
    match tokio::fs::read_to_string(dir.join("metadata.json")).await {
        Ok(text) => {
            let v: Value = serde_json::from_str(&text).map_err(|_| AppError::Conflict("metadata.json isn't valid JSON; fix it in the folder first".into()))?;
            if !v.is_object() || !v["items"].is_array() { return Err(AppError::Conflict("metadata.json has no items list; fix it in the folder first".into())) }
            Ok((v, layout_of(&text)))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((json!({ "items": [] }), Layout::default())),
        Err(e) => Err(io(e)),
    }
}

fn render_meta(meta: &Value, layout: &Layout) -> AppResult<Vec<u8>> {
    let mut out = Vec::new();
    match &layout.indent {
        Some(i) => { let mut ser = serde_json::Serializer::with_formatter(&mut out, serde_json::ser::PrettyFormatter::with_indent(i)); serde::Serialize::serialize(meta, &mut ser) }
        None => serde_json::to_writer(&mut out, meta),
    }.map_err(|e| AppError::Other(e.into()))?;
    if layout.newline { out.push(b'\n'); }
    Ok(out)
}

/// Write it back laid out as it was, keeping `item_count` true.
async fn write_meta(dir: &FsPath, mut meta: Value, layout: &Layout) -> AppResult<()> {
    let n = meta["items"].as_array().map(|a| a.len()).unwrap_or(0);
    if meta.get("item_count").is_some() { meta["item_count"] = n.into() }
    recount_collections(&mut meta);
    put_file(&dir.join("metadata.json"), &render_meta(&meta, layout)?).await
}

/// When the file has a top-level `collections`, make it follow the entries' `collection_id`s (the rule Profile Studio
/// keeps too): `{id: {items: [file or folder, in entry order]}}`, each collection's other keys kept.
fn recount_collections(meta: &mut Value) {
    let Some(old) = meta.get("collections").and_then(Value::as_object).cloned() else { return };
    let mut out = Map::new();
    for it in meta["items"].as_array().map(Vec::as_slice).unwrap_or_default() {
        let Some(cid) = it.get("collection_id").and_then(|c| match c { Value::String(s) if !s.trim().is_empty() => Some(s.clone()), Value::Number(n) => Some(n.to_string()), _ => None }) else { continue };
        let Some(key) = it["file"].as_str().or_else(|| it["folder"].as_str()) else { continue };
        let c = out.entry(cid.clone()).or_insert_with(|| { let mut m = old.get(&cid).and_then(Value::as_object).cloned().unwrap_or_default(); m.insert("items".into(), json!([])); Value::Object(m) });
        if let Some(list) = c["items"].as_array_mut() { list.push(key.into()) }
    }
    meta["collections"] = Value::Object(out);
}

/// A file's version for If-Match: the SHA-256 of its bytes, in hex.
fn etag_of(bytes: &[u8]) -> String { use sha2::Digest; sha2::Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect() }

/// Is the caller's If-Match / If-None-Match satisfied by the file as it is (`None`: missing)? Neither header: yes.
fn precondition(headers: &HeaderMap, current: Option<&str>) -> bool {
    let h = |n: &str| headers.get(n).and_then(|v| v.to_str().ok()).map(|v| v.trim().to_string());
    if let Some(m) = h("if-none-match") { if m == "*" && current.is_some() { return false } }
    match h("if-match") {
        None => true,
        Some(m) if m == "*" => current.is_some(),
        Some(m) => m.split(',').map(|t| t.trim().trim_start_matches("W/").trim_matches('"')).any(|t| Some(t) == current),
    }
}

/// A file name that is safe to write in the folder, with an extension this kind may use.
/// Characters a name may have besides ASCII letters and digits. The punctuation is what Discord profile sync tools
/// write (e.g. "all_bark,_all_bite.webm"); `/ \ : * ? " < > |` and control characters stay out, so a name is
/// never a path. Folder names take the same set without '.'.
const NAME_PUNCT: &str = "._- !&'(),";

/// A name made of `allowed` characters, 1 to 100 long, with no leading or trailing space.
fn tidy_name(name: &str, allowed: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name.trim() == name && name.chars().all(|c| c.is_ascii_alphanumeric() || allowed.contains(c))
}

fn clean_file_name(kind: &str, name: &str) -> AppResult<String> {
    let ok = tidy_name(name, NAME_PUNCT) && !name.starts_with('.');
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let exts: &[&str] = match kind { "nameplate" => &["png", "apng", "gif", "webp", "webm", "mp4"], _ => &["png", "apng", "gif", "webp"] };
    if !ok || !exts.contains(&ext.as_str()) {
        return Err(AppError::BadRequest(format!("{name}: file names are letters, digits, spaces and . _ - ! & ' ( ) , (not starting with '.' or a space), ending in {}", exts.join(", "))));
    }
    Ok(name.to_string())
}

struct Upload {
    meta: Map<String, Value>,
    files: Vec<(String, Vec<u8>)>,
}

/// The form: `meta` (the entry's fields as JSON) and any number of files, each sent under its file name.
async fn read_form(kind: &str, mut form: Multipart) -> AppResult<Upload> {
    let mut meta = Map::new();
    let mut files = Vec::new();
    while let Some(field) = form.next_field().await.map_err(|e| AppError::BadRequest(e.to_string()))? {
        if field.name() == Some("meta") {
            let text = field.text().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
            meta = match serde_json::from_str(&text) { Ok(Value::Object(m)) => m, _ => return Err(AppError::BadRequest("meta must be a JSON object".into())) };
            continue;
        }
        let name = clean_file_name(kind, field.file_name().unwrap_or_default())?;
        let bytes = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
        if bytes.is_empty() || bytes.len() > MAX_FILE { return Err(AppError::BadRequest(format!("{name}: files are up to 8 MB"))) }
        files.push((name, bytes.to_vec()));
    }
    Ok(Upload { meta, files })
}

fn text(v: Option<&Value>, max: usize, what: &str) -> AppResult<Option<String>> {
    match v {
        None => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.trim().chars().take(max).collect())),
        Some(_) => Err(AppError::BadRequest(format!("{what} must be text"))),
    }
}
fn ms(l: &Map<String, Value>, k: &str) -> AppResult<u64> {
    l.get(k).and_then(Value::as_u64).filter(|n| *n <= 600_000).ok_or_else(|| AppError::BadRequest(format!("Each layer's {k} is 0 to 600000")))
}
fn one_of<'a>(l: &'a Map<String, Value>, k: &str, options: &[&str]) -> AppResult<&'a str> {
    l.get(k).and_then(Value::as_str).filter(|v| options.contains(v)).ok_or_else(|| AppError::BadRequest(format!("Each layer's {k} is {}", options.join(", "))))
}

/// The entry's layers as sent, checked field by field. Fields Parley doesn't edit that a layer of the same file had
/// before (`width`/`height` added by the scan aside) are carried over.
fn clean_layers(kind: &str, sent: &Value, before: Option<&Value>) -> AppResult<Vec<Value>> {
    let list = sent.as_array().ok_or_else(|| AppError::BadRequest("layers must be a list".into()))?;
    if list.is_empty() || list.len() > 32 { return Err(AppError::BadRequest("An item has 1 to 32 layers".into())) }
    let old: Vec<&Map<String, Value>> = before.and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_object).collect()).unwrap_or_default();
    let mut out = Vec::new();
    for l in list {
        let l = l.as_object().ok_or_else(|| AppError::BadRequest("Each layer is an object".into()))?;
        let file = clean_file_name(kind, l.get("file").and_then(Value::as_str).unwrap_or_default())?;
        let mut m: Map<String, Value> = old.iter().find(|o| o.get("file").and_then(Value::as_str) == Some(file.as_str())).map(|o| (*o).clone()).unwrap_or_default();
        m.remove("width"); m.remove("height");
        if kind == "effect" {
            m.insert("start_ms".into(), ms(l, "start_ms")?.into());
            m.insert("duration_ms".into(), ms(l, "duration_ms")?.into());
            m.insert("loop".into(), l.get("loop").and_then(Value::as_bool).unwrap_or(false).into());
            m.insert("loop_delay_ms".into(), ms(l, "loop_delay_ms")?.into());
            m.insert("z_index".into(), l.get("z_index").and_then(Value::as_i64).filter(|z| (0..=10_000).contains(z)).ok_or_else(|| AppError::BadRequest("Each layer's z_index is 0 to 10000".into()))?.into());
            m.insert("file".into(), file.into());
            match l.get("random_variants").and_then(Value::as_array) {
                Some(vs) if !vs.is_empty() => {
                    let vs: Vec<Value> = vs.iter().map(|v| clean_file_name(kind, v.as_str().unwrap_or_default()).map(Value::from)).collect::<AppResult<_>>()?;
                    m.insert("random_variants".into(), vs.into());
                }
                _ => { m.remove("random_variants"); }
            }
        } else {
            m.insert("file".into(), file.into());
            m.insert("order".into(), one_of(l, "order", &["front", "back"])?.into());
            m.insert("type".into(), one_of(l, "type", &["staple", "rail", "border"])?.into());
            m.insert("anchor".into(), one_of(l, "anchor", &["top", "bottom", "center"])?.into());
            m.insert("responsive".into(), l.get("responsive").and_then(Value::as_bool).unwrap_or(false).into());
        }
        out.push(Value::Object(m));
    }
    Ok(out)
}

fn clean_layout(sent: &Value, before: Option<&Value>) -> AppResult<Value> {
    let mut m = before.and_then(Value::as_object).cloned().unwrap_or_default();
    for k in ["inner_width", "overflow_top", "overflow_bottom", "overflow_horizontal"] {
        let n = sent.get(k).and_then(Value::as_u64).filter(|n| *n <= 4096).ok_or_else(|| AppError::BadRequest(format!("The layout's {k} is 0 to 4096")))?;
        m.insert(k.into(), n.into());
    }
    Ok(Value::Object(m))
}

/// Apply what the form sends to an entry: name, description, and (effects and frames) layers and layout.
fn apply(kind: &str, entry: &mut Map<String, Value>, sent: &Map<String, Value>) -> AppResult<()> {
    if let Some(n) = text(sent.get("name"), 60, "name")? {
        if n.is_empty() { return Err(AppError::BadRequest("It needs a name".into())) }
        entry.insert("name".into(), n.into());
    }
    if let Some(d) = text(sent.get("description"), 300, "description")? { entry.insert("description".into(), d.into()); }
    match sent.get("tags") {
        None => {}
        Some(Value::Array(list)) => {
            if list.iter().any(|t| !t.is_string()) { return Err(AppError::BadRequest("tags must be a list of text".into())) }
            let tags = assets::clean_tags(list);
            // No tags: the key goes, so an untagged entry stays as it was written.
            if tags.is_empty() { entry.remove("tags"); } else { entry.insert("tags".into(), tags.into()); }
        }
        Some(_) => return Err(AppError::BadRequest("tags must be a list of text".into())),
    }
    // Fields Parley doesn't manage (a shop sync's colours, themes, collection, bundles...), as Profile Studio sends them.
    if let Some(f) = sent.get("fields") { set_fields(entry, f, &["file", "folder", "layers", "layout", "items", "name", "description", "tags"])?; }
    if layered(kind) {
        if let Some(l) = sent.get("layers") { let v = clean_layers(kind, l, entry.get("layers"))?; entry.insert("layers".into(), v.into()); }
        if kind == "frame" {
            if let Some(l) = sent.get("layout") { let v = clean_layout(l, entry.get("layout"))?; entry.insert("layout".into(), v); }
        }
    }
    Ok(())
}

/// Every file an effect or frame entry names must be in its folder (after this upload).
async fn check_layer_files(folder: &FsPath, entry: &Map<String, Value>) -> AppResult<()> {
    let layers = entry.get("layers").and_then(Value::as_array).ok_or_else(|| AppError::BadRequest("It needs its layers".into()))?;
    let mut names: Vec<String> = Vec::new();
    for l in layers {
        names.extend(l["file"].as_str().map(str::to_string));
        for v in l["random_variants"].as_array().map(Vec::as_slice).unwrap_or_default() { names.extend(v.as_str().map(str::to_string)) }
    }
    for f in names {
        if !tokio::fs::try_exists(folder.join(&f)).await.unwrap_or(false) { return Err(AppError::BadRequest(format!("{f} is named in a layer but wasn't uploaded"))) }
    }
    Ok(())
}

/// A new item's file or folder name, from its name and unused in the folder.
async fn fresh_stem(dir: &FsPath, name: &str, taken: impl Fn(&str) -> bool) -> String {
    let base = assets::asset_id(name).trim_matches('_').to_string();
    let base = if base.is_empty() { "item".to_string() } else { base };
    let mut stem = base.clone();
    for n in 2.. {
        let used = taken(&stem) || tokio::fs::try_exists(dir.join(&stem)).await.unwrap_or(false);
        if !used { break }
        stem = format!("{base}_{n}");
    }
    stem
}

fn refresh(kind: &str) {
    super::explore::forget();
    if layered(kind) { asset_layers::forget(dir_name(kind).unwrap_or_default()) } else { assets::forget(dir_name(kind).unwrap_or_default()) }
}

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Add an item to the folder: its file (decorations, nameplates) or its folder of layers (effects, frames), and its
/// entry in `metadata.json`.
async fn add(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(kind): Path<String>, form: Multipart) -> AppResult<(StatusCode, Json<Value>)> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let dir: PathBuf = state.config.assets_dir.join(dir_name(&kind)?);
    let up = read_form(&kind, form).await?;
    let name = text(up.meta.get("name"), 60, "name")?.filter(|n| !n.is_empty()).ok_or_else(|| AppError::BadRequest("It needs a name".into()))?;
    let _guard = LOCK.lock().await;
    if !writable(&state.config.assets_dir).await { return Err(read_only()) }
    tokio::fs::create_dir_all(&dir).await.map_err(io)?;
    let (mut meta, layout) = read_meta(&dir).await?;
    let id;
    if layered(&kind) {
        let names: Vec<String> = meta["items"].as_array().unwrap().iter().filter_map(|i| i["folder"].as_str().map(assets::asset_id)).collect();
        let folder = fresh_stem(&dir, &name, |s| names.iter().any(|n| n == s)).await;
        let mut entry = Map::new();
        entry.insert("folder".into(), folder.clone().into());
        entry.insert("name".into(), name.clone().into());
        entry.insert("description".into(), "".into());
        apply(&kind, &mut entry, &up.meta)?;
        if kind == "frame" && !entry.contains_key("layout") { return Err(AppError::BadRequest("A frame needs its layout".into())) }
        let path = dir.join(&folder);
        tokio::fs::create_dir_all(&path).await.map_err(io)?;
        for (f, bytes) in &up.files { put_file(&path.join(f), bytes).await?; }
        if let Err(e) = check_layer_files(&path, &entry).await { let _ = tokio::fs::remove_dir_all(&path).await; return Err(e) }
        meta["items"].as_array_mut().unwrap().push(Value::Object(entry));
        id = assets::asset_id(&folder);
    } else {
        let [(file, bytes)] = up.files.as_slice() else { return Err(AppError::BadRequest("Send its one file".into())) };
        let ext = file.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
        let index = if kind == "nameplate" { assets::nameplates(&state.config).await } else { assets::decorations(&state.config).await };
        let stem = fresh_stem(&dir, &name, |s| index.get(s).is_some()).await;
        let file = format!("{stem}.{ext}");
        put_file(&dir.join(&file), bytes).await?;
        let mut entry = Map::new();
        entry.insert("file".into(), file.into());
        entry.insert("name".into(), name.clone().into());
        entry.insert("description".into(), "".into());
        apply(&kind, &mut entry, &up.meta)?;
        meta["items"].as_array_mut().unwrap().push(Value::Object(entry));
        id = assets::asset_id(&stem);
    }
    write_meta(&dir, meta, &layout).await?;
    refresh(&kind);
    let value = format!("{}{id}", assets::ASSET_PREFIX);
    crate::audit::record(&state, uid, "cosmetic.folder_add", "cosmetic", None, &name, json!({ "kind": kind, "value": value, "files": up.files.iter().map(|f| &f.0).collect::<Vec<_>>() })).await;
    super::cosmetics::announce(&state).await;
    Ok((StatusCode::CREATED, Json(json!({ "value": value }))))
}

/// Edit a folder item: its entry's fields, and new or replacement files.
async fn edit(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((kind, id)): Path<(String, String)>, form: Multipart) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let dir: PathBuf = state.config.assets_dir.join(dir_name(&kind)?);
    let up = read_form(&kind, form).await?;
    let _guard = LOCK.lock().await;
    if !writable(&state.config.assets_dir).await { return Err(read_only()) }
    let (mut meta, layout) = read_meta(&dir).await?;
    let label;
    if layered(&kind) {
        let items = meta["items"].as_array_mut().unwrap();
        let entry = items.iter_mut().filter_map(Value::as_object_mut).find(|i| i.get("folder").and_then(Value::as_str).map(assets::asset_id).as_deref() == Some(id.as_str()))
            .ok_or_else(|| AppError::NotFound("No such item in the folder".into()))?;
        let folder = dir.join(entry["folder"].as_str().unwrap_or_default());
        let mut next = entry.clone();
        apply(&kind, &mut next, &up.meta)?;
        for (f, bytes) in &up.files { put_file(&folder.join(f), bytes).await?; }
        check_layer_files(&folder, &next).await?;
        label = next.get("name").and_then(Value::as_str).unwrap_or(&id).to_string();
        *entry = next;
    } else {
        let index = if kind == "nameplate" { assets::nameplates(&state.config).await } else { assets::decorations(&state.config).await };
        let current = index.get(&id).ok_or_else(|| AppError::NotFound("No such item in the folder".into()))?;
        let old_file = current.file_name();
        let stem = old_file.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| old_file.clone());
        // A replacement keeps the item's name in the folder (so its id, and everyone wearing it, stay); only the
        // extension follows the new file.
        let mut file = old_file.clone();
        match up.files.as_slice() {
            [] => {}
            [(new, bytes)] => {
                let ext = new.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
                file = format!("{stem}.{ext}");
                put_file(&dir.join(&file), bytes).await?;
                if file != old_file { let _ = tokio::fs::remove_file(dir.join(&old_file)).await; }
            }
            _ => return Err(AppError::BadRequest("Send at most one file".into())),
        }
        let items = meta["items"].as_array_mut().unwrap();
        let pos = items.iter().position(|i| i["file"].as_str() == Some(old_file.as_str()));
        let mut entry = match pos { Some(p) => items[p].as_object().cloned().unwrap_or_default(), None => Map::new() };
        if pos.is_none() { entry.insert("name".into(), current.name.clone().into()); }
        entry.insert("file".into(), file.into());
        apply(&kind, &mut entry, &up.meta)?;
        label = entry.get("name").and_then(Value::as_str).unwrap_or(&id).to_string();
        match pos { Some(p) => items[p] = Value::Object(entry), None => items.push(Value::Object(entry)) }
    }
    write_meta(&dir, meta, &layout).await?;
    refresh(&kind);
    let value = format!("{}{id}", assets::ASSET_PREFIX);
    crate::audit::record(&state, uid, "cosmetic.folder_edit", "cosmetic", None, &label, json!({ "kind": kind, "value": value, "fields": up.meta.keys().collect::<Vec<_>>(), "files": up.files.iter().map(|f| &f.0).collect::<Vec<_>>() })).await;
    super::cosmetics::announce(&state).await;
    Ok(Json(json!({ "value": value })))
}

/// A layered item's folder name as it may be written: letters, digits, '_' and '-'.
fn clean_folder_name(name: &str) -> AppResult<String> {
    if !tidy_name(name, &NAME_PUNCT.replace('.', "")) { return Err(AppError::BadRequest(format!("{name}: folder names are letters, digits, spaces and _ - ! & ' ( ) , (not starting or ending with a space)"))) }
    Ok(name.to_string())
}

/// Where an item from elsewhere stands against this folder, by its file (decorations, nameplates) or folder
/// (effects, frames): `present` when that name is already here (an item an admin deleted keeps its files, so it
/// counts), `clash` when another name here makes the same id (`Foo Bar.png` and `foo_bar.webp`), else `missing`.
async fn standing(state: &AppState, kind: &str, dir: &FsPath, meta: &Value, key: &str) -> &'static str {
    let field = if layered(kind) { "folder" } else { "file" };
    let items = meta["items"].as_array().map(Vec::as_slice).unwrap_or_default();
    if items.iter().any(|i| i[field].as_str() == Some(key)) || tokio::fs::try_exists(dir.join(key)).await.unwrap_or(false) { return "present" }
    let stem = if layered(kind) { key } else { key.rsplit_once('.').map(|(s, _)| s).unwrap_or(key) };
    let id = assets::asset_id(stem);
    let taken = if layered(kind) {
        items.iter().filter_map(|i| i["folder"].as_str()).any(|f| assets::asset_id(f) == id)
            || tokio::fs::try_exists(dir.join(&id)).await.unwrap_or(false)
    } else {
        let index = if kind == "nameplate" { assets::nameplates(&state.config).await } else { assets::decorations(&state.config).await };
        index.get(&id).is_some() || items.iter().filter_map(|i| i["file"].as_str()).any(|f| assets::asset_id(f.rsplit_once('.').map(|(s, _)| s).unwrap_or(f)) == id)
    };
    if taken { "clash" } else { "missing" }
}

/// `POST /admin/cosmetics/:kind/import/check {keys}`: each key's standing (see `standing`), for the import's dry run.
async fn import_check(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(kind): Path<String>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let dir: PathBuf = state.config.assets_dir.join(dir_name(&kind)?);
    let keys = body["keys"].as_array().ok_or_else(|| AppError::BadRequest("keys must be a list".into()))?;
    if keys.len() > 5000 { return Err(AppError::BadRequest("At most 5000 items at a time".into())) }
    let (meta, _) = read_meta(&dir).await?;
    let mut out = Map::new();
    for k in keys.iter().filter_map(Value::as_str) {
        out.insert(k.to_string(), standing(&state, &kind, &dir, &meta, k).await.into());
    }
    Ok(Json(json!({ "keys": out })))
}

/// `POST /admin/cosmetics/:kind/import`: one item from another folder, as `entry` (its metadata.json entry, kept as
/// it is) and its files under their own names. Refused (409) unless it is missing here.
async fn import(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(kind): Path<String>, mut form: Multipart) -> AppResult<(StatusCode, Json<Value>)> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let dir: PathBuf = state.config.assets_dir.join(dir_name(&kind)?);
    let mut entry: Option<Map<String, Value>> = None;
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    while let Some(field) = form.next_field().await.map_err(|e| AppError::BadRequest(e.to_string()))? {
        if field.name() == Some("entry") {
            let text = field.text().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
            if text.len() > 64 * 1024 { return Err(AppError::BadRequest("The entry is too big".into())) }
            entry = match serde_json::from_str(&text) { Ok(Value::Object(m)) => Some(m), _ => return Err(AppError::BadRequest("entry must be a JSON object".into())) };
            continue;
        }
        let name = clean_file_name(&kind, field.file_name().unwrap_or_default())?;
        let bytes = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
        if bytes.is_empty() || bytes.len() > MAX_FILE { return Err(AppError::BadRequest(format!("{name}: files are up to 8 MB"))) }
        files.push((name, bytes.to_vec()));
    }
    let entry = entry.ok_or_else(|| AppError::BadRequest("Send its entry".into()))?;
    let key = if layered(&kind) {
        clean_folder_name(entry.get("folder").and_then(Value::as_str).unwrap_or_default())?
    } else {
        clean_file_name(&kind, entry.get("file").and_then(Value::as_str).unwrap_or_default())?
    };
    let label = entry.get("name").and_then(Value::as_str).unwrap_or(&key).to_string();
    let _guard = LOCK.lock().await;
    if !writable(&state.config.assets_dir).await { return Err(read_only()) }
    tokio::fs::create_dir_all(&dir).await.map_err(io)?;
    let (mut meta, layout) = read_meta(&dir).await?;
    match standing(&state, &kind, &dir, &meta, &key).await {
        "missing" => {}
        "present" => return Err(AppError::Conflict(format!("{key} is already in the assets folder"))),
        _ => return Err(AppError::Conflict(format!("{key} has the same id as an item already in the assets folder"))),
    }
    let stem = if layered(&kind) {
        let path = dir.join(&key);
        tokio::fs::create_dir_all(&path).await.map_err(io)?;
        let mut wrote = Ok(());
        for (f, bytes) in &files { if let Err(e) = put_file(&path.join(f), bytes).await { wrote = Err(e); break } }
        if let Err(e) = wrote.and(check_layer_files(&path, &entry).await) { let _ = tokio::fs::remove_dir_all(&path).await; return Err(e) }
        key.clone()
    } else {
        let [(file, bytes)] = files.as_slice() else { return Err(AppError::BadRequest("Send its one file".into())) };
        if *file != key { return Err(AppError::BadRequest(format!("The file sent is {file}, but its entry names {key}"))) }
        put_file(&dir.join(&key), bytes).await?;
        key.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| key.clone())
    };
    meta["items"].as_array_mut().unwrap().push(Value::Object(entry));
    write_meta(&dir, meta, &layout).await?;
    refresh(&kind);
    let value = format!("{}{}", assets::ASSET_PREFIX, assets::asset_id(&stem));
    crate::audit::record(&state, uid, "cosmetic.folder_import", "cosmetic", None, &label, json!({ "kind": kind, "value": value, "files": files.iter().map(|f| &f.0).collect::<Vec<_>>() })).await;
    Ok((StatusCode::CREATED, Json(json!({ "value": value }))))
}

// --- Profile Studio's sync: the bundle files, whole entries, and each kind's top-level fields -------------------------

const BUNDLE_FILES: [&str; 2] = ["bundles.json", "bundles.local.json"];

/// A bundles file's slot for GET: null when missing, `{json, etag}`, or `{error, etag}` when it isn't valid JSON.
async fn bundle_slot(path: &FsPath) -> AppResult<Value> {
    match tokio::fs::read(path).await {
        Ok(bytes) => Ok(match serde_json::from_slice::<Value>(&bytes) {
            Ok(v) => json!({ "json": v, "etag": etag_of(&bytes) }),
            Err(e) => json!({ "error": format!("Not valid JSON: {e}"), "etag": etag_of(&bytes) }),
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(e) => Err(io(e)),
    }
}

/// `GET /admin/cosmetics/bundles`: both bundle files at the assets root, as they are.
async fn bundles_get(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let mut files = Map::new();
    for f in BUNDLE_FILES { files.insert(f.into(), bundle_slot(&state.config.assets_dir.join(f)).await?); }
    Ok(Json(json!({ "files": files })))
}

fn bundle_file(file: &str) -> AppResult<&'static str> {
    BUNDLE_FILES.iter().copied().find(|f| *f == file).ok_or_else(|| AppError::NotFound("Only bundles.json and bundles.local.json".into()))
}

fn conflict(current: Value) -> Response { (StatusCode::PRECONDITION_FAILED, Json(current)).into_response() }

/// `PUT /admin/cosmetics/bundles/:file`: replace (If-Match) or create (If-None-Match: *) a bundles file. Every field
/// is kept as sent; only the shape is checked. The file keeps its layout; a new one gets two spaces and a newline.
async fn bundles_put(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(file): Path<String>, headers: HeaderMap, Json(doc): Json<Value>) -> AppResult<Response> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let file = bundle_file(&file)?;
    let ok = doc.is_object() && doc["bundles"].as_array().is_some_and(|l| l.iter().all(|b| b.is_object() && b["id"].is_string()));
    if !ok { return Err(AppError::BadRequest("A bundles file is an object whose bundles is a list of objects, each with a text id".into())) }
    let path = state.config.assets_dir.join(file);
    let _guard = LOCK.lock().await;
    if !writable(&state.config.assets_dir).await { return Err(read_only()) }
    let before = match tokio::fs::read(&path).await { Ok(b) => Some(b), Err(e) if e.kind() == std::io::ErrorKind::NotFound => None, Err(e) => return Err(io(e)) };
    if !precondition(&headers, before.as_deref().map(etag_of).as_deref()) { return Ok(conflict(bundle_slot(&path).await?)) }
    let layout = before.as_deref().map(|b| layout_of(&String::from_utf8_lossy(b))).unwrap_or(Layout { indent: Some(b"  ".to_vec()), newline: true });
    let out = render_meta(&doc, &layout)?;
    put_file(&path, &out).await?;
    super::explore::forget();
    crate::audit::record(&state, uid, "cosmetic.bundles_write", "cosmetic", None, file, json!({ "bundles": doc["bundles"].as_array().map(Vec::len) })).await;
    super::cosmetics::announce(&state).await;
    Ok(Json(json!({ "etag": etag_of(&out) })).into_response())
}

/// `DELETE /admin/cosmetics/bundles/:file` (If-Match): Studio drops an empty bundles.local.json.
async fn bundles_delete(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(file): Path<String>, headers: HeaderMap) -> AppResult<Response> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let file = bundle_file(&file)?;
    let path = state.config.assets_dir.join(file);
    let _guard = LOCK.lock().await;
    let before = match tokio::fs::read(&path).await { Ok(b) => b, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(AppError::NotFound(format!("There is no {file}"))), Err(e) => return Err(io(e)) };
    if !precondition(&headers, Some(&etag_of(&before))) { return Ok(conflict(bundle_slot(&path).await?)) }
    tokio::fs::remove_file(&path).await.map_err(io)?;
    super::explore::forget();
    crate::audit::record(&state, uid, "cosmetic.bundles_delete", "cosmetic", None, file, json!({})).await;
    super::cosmetics::announce(&state).await;
    Ok(StatusCode::NO_CONTENT.into_response())
}

/// A kind's metadata.json bytes (None when it has none yet).
async fn meta_bytes(dir: &FsPath) -> AppResult<Option<Vec<u8>>> {
    match tokio::fs::read(dir.join("metadata.json")).await { Ok(b) => Ok(Some(b)), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None), Err(e) => Err(io(e)) }
}
fn top_fields(meta: &Value) -> Value {
    Value::Object(meta.as_object().map(|m| m.iter().filter(|(k, _)| *k != "items").map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default())
}

/// `GET /admin/cosmetics/:kind/metadata`: the file's top-level fields (everything but items) and its etag.
async fn metadata_get(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(kind): Path<String>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let dir = state.config.assets_dir.join(dir_name(&kind)?);
    let (meta, _) = read_meta(&dir).await?;
    Ok(Json(json!({ "fields": top_fields(&meta), "etag": meta_bytes(&dir).await?.as_deref().map(etag_of) })))
}

/// Shallow set (null removes) of a map's keys, refusing the ones that have their own handling.
fn set_fields(target: &mut Map<String, Value>, fields: &Value, refused: &[&str]) -> AppResult<()> {
    let fields = fields.as_object().ok_or_else(|| AppError::BadRequest("fields must be an object".into()))?;
    if let Some(k) = fields.keys().find(|k| refused.contains(&k.as_str())) { return Err(AppError::BadRequest(format!("{k} can't be set through fields"))) }
    for (k, v) in fields { if v.is_null() { target.remove(k); } else { target.insert(k.clone(), v.clone()); } }
    Ok(())
}

/// `PATCH /admin/cosmetics/:kind/metadata {fields}` (If-Match): set or remove top-level fields (`items` refused;
/// `item_count` stays true).
async fn metadata_patch(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(kind): Path<String>, headers: HeaderMap, Json(body): Json<Value>) -> AppResult<Response> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let dir = state.config.assets_dir.join(dir_name(&kind)?);
    let _guard = LOCK.lock().await;
    if !writable(&state.config.assets_dir).await { return Err(read_only()) }
    tokio::fs::create_dir_all(&dir).await.map_err(io)?;
    let (mut meta, layout) = read_meta(&dir).await?;
    let current = meta_bytes(&dir).await?.as_deref().map(etag_of);
    if !precondition(&headers, current.as_deref()) { return Ok(conflict(json!({ "fields": top_fields(&meta), "etag": current }))) }
    let mut fields = body.get("fields").cloned().ok_or_else(|| AppError::BadRequest("Send fields".into()))?;
    if let Some(f) = fields.as_object_mut() { f.remove("item_count"); }
    set_fields(meta.as_object_mut().expect("checked by read_meta"), &fields, &["items"])?;
    write_meta(&dir, meta, &layout).await?;
    refresh(&kind);
    let etag = meta_bytes(&dir).await?.as_deref().map(etag_of);
    crate::audit::record(&state, uid, "cosmetic.metadata_edit", "cosmetic", None, &kind, json!({ "kind": kind, "fields": body["fields"].as_object().map(|f| f.keys().cloned().collect::<Vec<_>>()) })).await;
    super::cosmetics::announce(&state).await;
    Ok(Json(json!({ "etag": etag })).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_safe_and_typed() {
        assert!(clean_file_name("effect", "layer_01.png").is_ok());
        assert!(clean_file_name("effect", "../x.png").is_err());
        assert!(clean_file_name("effect", ".hidden.png").is_err());
        assert!(clean_file_name("effect", "clip.webm").is_err());
        assert!(clean_file_name("nameplate", "clip.webm").is_ok());
        assert!(clean_file_name("nameplate", "all_bark,_all_bite.webm").is_ok());
        assert!(clean_file_name("effect", "Rock & Roll (Don't Stop)!.png").is_ok());
        for bad in [" lead.png", "trail.png ", "a/b.png", "a\\b.png", "a:b.png", "a*.png", "a?.png", "a\".png", "a<b>.png", "a|b.png", "a\tb.png", "é.png"] {
            assert!(clean_file_name("effect", bad).is_err(), "{bad}");
        }
        assert!(clean_file_name("effect", &format!("{}.png", "a".repeat(97))).is_err());
        assert!(clean_folder_name("all_bark,_all_bite (alt)").is_ok());
        assert!(clean_folder_name("a.b").is_err());
        assert!(clean_folder_name("..").is_err());
        assert!(clean_folder_name(" x").is_err());
        assert!(clean_folder_name("alt_raccoon").is_ok());
        assert!(clean_folder_name("../up").is_err());
        assert!(clean_folder_name("a b").is_ok());
    }

    #[test]
    fn edits_keep_fields_parley_does_not_manage() {
        let mut entry = json!({ "folder": "x", "name": "Old", "description": "d", "in_shop": true, "price": { "amount": 1 },
            "layers": [{ "file": "a.png", "start_ms": 0, "duration_ms": 10, "loop": false, "loop_delay_ms": 0, "z_index": 1, "width": 9, "custom": 7 }] });
        let sent = json!({ "name": "New", "layers": [{ "file": "a.png", "start_ms": 5, "duration_ms": 20, "loop": true, "loop_delay_ms": 3, "z_index": 2 }] });
        apply("effect", entry.as_object_mut().unwrap(), sent.as_object().unwrap()).unwrap();
        assert_eq!(entry["name"], "New");
        assert_eq!(entry["in_shop"], true);
        assert_eq!(entry["price"]["amount"], 1);
        assert_eq!(entry["layers"][0]["start_ms"], 5);
        assert_eq!(entry["layers"][0]["custom"], 7);
        assert!(entry["layers"][0].get("width").is_none());
        let keys: Vec<&String> = entry.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["folder", "name", "description", "in_shop", "price", "layers"]);
    }

    /// A rewrite keeps the file's layout: a sync script's two spaces and no final newline, or Parley's own one space.
    #[test]
    fn rewrites_keep_the_layout() {
        let v = json!({ "source": "x", "tag_labels": ["Cute & Cozy"], "items": [{ "file": "a.png", "name": "Été", "description": null, "price": { "amount": 5.99 }, "colors": [] }], "item_count": 1 });
        for (indent, newline) in [("  ", false), (" ", true), ("\t", true)] {
            let mut bytes = Vec::new();
            let mut ser = serde_json::Serializer::with_formatter(&mut bytes, serde_json::ser::PrettyFormatter::with_indent(indent.as_bytes()));
            serde::Serialize::serialize(&v, &mut ser).unwrap();
            let mut text = String::from_utf8(bytes).unwrap();
            if newline { text.push('\n') }
            let layout = layout_of(&text);
            assert_eq!(String::from_utf8(render_meta(&v, &layout).unwrap()).unwrap(), text, "{indent:?} {newline}");
        }
        let compact = v.to_string();
        assert_eq!(String::from_utf8(render_meta(&v, &layout_of(&compact)).unwrap()).unwrap(), compact);
    }

    #[test]
    fn fields_pass_through_and_collections_follow() {
        let mut entry = json!({ "file": "moon.png", "name": "Moon", "price": 1 }).as_object().unwrap().clone();
        apply("decoration", &mut entry, json!({ "fields": { "colors": ["blue"], "collection_id": "c1", "price": null } }).as_object().unwrap()).unwrap();
        assert_eq!(entry["colors"], json!(["blue"]));
        assert!(!entry.contains_key("price"));
        for k in ["file", "layers", "name", "tags"] {
            assert!(apply("decoration", &mut entry, json!({ "fields": { k: 1 } }).as_object().unwrap()).is_err(), "{k}");
        }
        let mut meta = json!({ "collections": { "c1": { "items": ["old.png"], "note": "kept" }, "gone": { "items": [] } },
            "items": [{ "file": "a.png", "collection_id": "c2" }, { "file": "b.png", "collection_id": "c1" }, { "folder": "c", "collection_id": "c1" }, { "file": "d.png" }] });
        recount_collections(&mut meta);
        assert_eq!(meta["collections"], json!({ "c2": { "items": ["a.png"] }, "c1": { "items": ["b.png", "c"], "note": "kept" } }));
        let mut none = json!({ "items": [{ "file": "a.png", "collection_id": "c2" }] });
        recount_collections(&mut none);
        assert!(none.get("collections").is_none(), "only when the file has the key");
    }

    #[test]
    fn preconditions() {
        let mut h = HeaderMap::new();
        assert!(precondition(&h, None) && precondition(&h, Some("abc")));
        h.insert("if-match", "\"abc\"".parse().unwrap());
        assert!(precondition(&h, Some("abc")) && !precondition(&h, Some("def")) && !precondition(&h, None));
        let mut h = HeaderMap::new();
        h.insert("if-none-match", "*".parse().unwrap());
        assert!(precondition(&h, None) && !precondition(&h, Some("abc")));
    }

    #[test]
    fn tags_are_cleaned_and_cleared() {
        let mut entry = json!({ "file": "holly_wreath.png", "name": "Holly Wreath" }).as_object().unwrap().clone();
        apply("decoration", &mut entry, json!({ "tags": ["Christmas", " winter ", "christmas"] }).as_object().unwrap()).unwrap();
        assert_eq!(entry["tags"], json!(["christmas", "winter"]));
        apply("decoration", &mut entry, json!({ "name": "Wreath" }).as_object().unwrap()).unwrap();
        assert_eq!(entry["tags"], json!(["christmas", "winter"]), "kept when not sent");
        assert!(apply("decoration", &mut entry, json!({ "tags": "christmas" }).as_object().unwrap()).is_err());
        assert!(apply("decoration", &mut entry, json!({ "tags": [1] }).as_object().unwrap()).is_err());
        apply("decoration", &mut entry, json!({ "tags": [] }).as_object().unwrap()).unwrap();
        assert!(!entry.contains_key("tags"));
    }

    #[test]
    fn frame_layers_and_layout_are_checked() {
        let mut entry = Map::new();
        assert!(apply("frame", &mut entry, json!({ "layers": [{ "file": "a.png", "order": "sideways", "type": "rail", "anchor": "top" }] }).as_object().unwrap()).is_err());
        assert!(apply("frame", &mut entry, json!({ "layout": { "inner_width": 1200, "overflow_top": 1, "overflow_bottom": 2 } }).as_object().unwrap()).is_err());
        apply("frame", &mut entry, json!({ "layout": { "inner_width": 1200, "overflow_top": 1, "overflow_bottom": 2, "overflow_horizontal": 3 },
            "layers": [{ "file": "a.png", "order": "front", "type": "rail", "anchor": "top", "responsive": true }] }).as_object().unwrap()).unwrap();
        assert_eq!(entry["layout"]["overflow_horizontal"], 3);
        assert_eq!(entry["layers"][0]["anchor"], "top");
    }
}
