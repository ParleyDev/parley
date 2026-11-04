//! Adding and editing the instance's assets-folder cosmetics from the admin console. The folder and its
//! `metadata.json` files belong to whoever set the instance up (Parley only reads their format, and keeps it as it
//! is): an admin's new item becomes its files plus an entry in its kind's `metadata.json`, and an edit rewrites that
//! entry (name, description, an effect's layer timing, a frame's layout and layers) and adds or replaces files. Every
//! other field in an entry, and the file's other keys, are kept; `item_count` follows the list when the file has one.
//! Turning items off and deleting them are Parley's alone (routes/cosmetics.rs). When the folder isn't writable
//! (mounted read-only), adding and editing fail and say so.

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::StatusCode,
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

/// A kind's `metadata.json` as it is (an empty `{items: []}` when the folder has none yet).
async fn read_meta(dir: &FsPath) -> AppResult<Value> {
    match tokio::fs::read_to_string(dir.join("metadata.json")).await {
        Ok(text) => {
            let v: Value = serde_json::from_str(&text).map_err(|_| AppError::Conflict("metadata.json isn't valid JSON; fix it in the folder first".into()))?;
            if !v.is_object() || !v["items"].is_array() { return Err(AppError::Conflict("metadata.json has no items list; fix it in the folder first".into())) }
            Ok(v)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({ "items": [] })),
        Err(e) => Err(io(e)),
    }
}

/// Write it back, laid out like the files Parley reads (one-space indent), keeping `item_count` true.
async fn write_meta(dir: &FsPath, mut meta: Value) -> AppResult<()> {
    let n = meta["items"].as_array().map(|a| a.len()).unwrap_or(0);
    if meta.get("item_count").is_some() { meta["item_count"] = n.into() }
    let mut out = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut out, serde_json::ser::PrettyFormatter::with_indent(b" "));
    serde::Serialize::serialize(&meta, &mut ser).map_err(|e| AppError::Other(e.into()))?;
    out.push(b'\n');
    put_file(&dir.join("metadata.json"), &out).await
}

/// A file name that is safe to write in the folder, with an extension this kind may use.
fn clean_file_name(kind: &str, name: &str) -> AppResult<String> {
    let name = name.trim();
    let ok = !name.is_empty() && name.len() <= 100 && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let exts: &[&str] = match kind { "nameplate" => &["png", "apng", "gif", "webp", "webm", "mp4"], _ => &["png", "apng", "gif", "webp"] };
    if !ok || !exts.contains(&ext.as_str()) {
        return Err(AppError::BadRequest(format!("{name}: file names are letters, digits, '.', '_' and '-', ending in {}", exts.join(", "))));
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
    let mut meta = read_meta(&dir).await?;
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
    write_meta(&dir, meta).await?;
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
    let mut meta = read_meta(&dir).await?;
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
    write_meta(&dir, meta).await?;
    refresh(&kind);
    let value = format!("{}{id}", assets::ASSET_PREFIX);
    crate::audit::record(&state, uid, "cosmetic.folder_edit", "cosmetic", None, &label, json!({ "kind": kind, "value": value, "fields": up.meta.keys().collect::<Vec<_>>(), "files": up.files.iter().map(|f| &f.0).collect::<Vec<_>>() })).await;
    super::cosmetics::announce(&state).await;
    Ok(Json(json!({ "value": value })))
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
