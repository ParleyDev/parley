//! Profile cosmetics, managed in the admin console: avatar decorations, nameplates, profile effects and profile frames.
//! Each comes from one of three places: the built-in presets (drawn in CSS by the client), the instance's assets folder
//! (`asset:<id>`, see assets.rs and asset_layers.rs; adding and editing those writes the folder, see asset_admin.rs)
//! and Parley's own colour and emoji ones (`custom:<uuid>`, kept here). What is Parley's alone lives in this table:
//! turning any of them off (it isn't offered and isn't shown on anyone's profile until it's back on), deleting any of
//! them (a custom one goes; a built-in or folder one is hidden for good, its files untouched, and can be restored; either
//! way it comes off everyone who had it), a built-in one's name, and the custom ones themselves. Every client gets the
//! changes live (COSMETICS_UPDATE).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::FromRow;
use std::{
    collections::{HashMap, HashSet},
    sync::{LazyLock, RwLock},
    time::Duration,
};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::{
        admin_access::{require_perm, Perm},
        asset_layers, assets,
    },
    state::AppState,
};

pub const CUSTOM_PREFIX: &str = "custom:";
pub const KINDS: [&str; 4] = ["decoration", "nameplate", "effect", "frame"];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/cosmetics", get(public_list))
        .route("/admin/cosmetics/:kind", get(admin_list).post(create))
        .route("/admin/cosmetics/:kind/:value", patch(update).delete(remove))
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Row {
    pub kind: String,
    pub value: String,
    pub custom: bool,
    pub name: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
    pub deleted: bool,
    pub data: Value,
}
const COLS: &str = "kind, value, custom, name, description, enabled, deleted, data";

/// The users column each kind is stored in.
fn column(kind: &str) -> &'static str {
    match kind { "decoration" => "avatar_decoration", "nameplate" => "nameplate", "effect" => "profile_effect", _ => "profile_frame" }
}

fn builtins(kind: &str) -> Vec<&'static str> {
    use crate::routes::users::{DECORATIONS, NAMEPLATES, PROFILE_EFFECTS, PROFILE_FRAMES};
    match kind {
        "decoration" => DECORATIONS.iter().copied().filter(|d| !d.is_empty()).collect(),
        "nameplate" => NAMEPLATES.to_vec(),
        "effect" => PROFILE_EFFECTS.to_vec(),
        _ => PROFILE_FRAMES.to_vec(),
    }
}

fn check_kind(kind: &str) -> AppResult<()> {
    if KINDS.contains(&kind) { Ok(()) } else { Err(AppError::NotFound("Unknown kind of cosmetic".into())) }
}

/// Whether the assets folder has this item right now.
async fn in_folder(state: &AppState, kind: &str, value: &str) -> bool {
    match kind {
        "decoration" => assets::decoration_exists(&state.config, value).await,
        "nameplate" => assets::nameplate_exists(&state.config, value).await,
        "effect" => asset_layers::effect_exists(&state.config, value).await,
        _ => asset_layers::frame_exists(&state.config, value).await,
    }
}

// --- what's off or deleted, kept in memory for the assets lists and profile checks -----------------------------------

#[derive(Default)]
struct Overrides {
    off: HashSet<(String, String)>,
    custom: HashSet<(String, String)>,
}
static OVERRIDES: LazyLock<RwLock<Overrides>> = LazyLock::new(Default::default);

/// Reload the in-memory copy. Each instance also does this every 30 s, so a change made on another one arrives.
pub async fn refresh(state: &AppState) {
    let Ok(rows) = sqlx::query_as::<_, Row>(&format!("SELECT {COLS} FROM cosmetics")).fetch_all(&state.db).await else { return };
    let mut o = Overrides::default();
    for r in rows {
        let key = (r.kind.clone(), r.value.clone());
        if !r.enabled || r.deleted { o.off.insert(key.clone()); }
        if r.custom { o.custom.insert(key); }
    }
    *OVERRIDES.write().unwrap() = o;
}

pub async fn refresh_loop(state: AppState) {
    loop {
        refresh(&state).await;
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

/// Is this stored value turned off (or deleted) by an admin?
pub fn is_off(kind: &str, value: &str) -> bool { OVERRIDES.read().unwrap().off.contains(&(kind.to_string(), value.to_string())) }

/// Whether a user may pick this value: it exists and isn't off. Empty clears.
pub async fn allowed(state: &AppState, kind: &str, value: &str) -> bool {
    if value.is_empty() { return true }
    if is_off(kind, value) { return false }
    if value.starts_with(CUSTOM_PREFIX) { return OVERRIDES.read().unwrap().custom.contains(&(kind.to_string(), value.to_string())) }
    if value.starts_with(assets::ASSET_PREFIX) { return in_folder(state, kind, value).await }
    builtins(kind).contains(&value)
}

/// Tell every client: the rows changed, or the folder did (they refetch its lists).
pub async fn announce(state: &AppState) {
    refresh(state).await;
    if let Ok(list) = public_rows(state).await { state.hub.emit_all("COSMETICS_UPDATE", json!({ "cosmetics": list })); }
}

// --- the list every client gets --------------------------------------------------------------------------------------

/// Every admin row: what's off, built-ins' names, and the custom items (with their look). Clients apply it everywhere.
async fn public_rows(state: &AppState) -> AppResult<Vec<Row>> {
    Ok(sqlx::query_as::<_, Row>(&format!("SELECT {COLS} FROM cosmetics ORDER BY created_at")).fetch_all(&state.db).await?)
}

async fn public_list(State(state): State<AppState>) -> AppResult<Json<Vec<Row>>> {
    Ok(Json(public_rows(&state).await?))
}

// --- admin -------------------------------------------------------------------------------------------------------------

#[derive(Serialize)]
struct AdminItem {
    value: String,
    /// builtin, folder or custom.
    source: &'static str,
    /// Built-ins: the admin's name, or null for their own; folder items: from metadata.json.
    name: Option<String>,
    description: Option<String>,
    enabled: bool,
    deleted: bool,
    /// Custom ones' look; folder effects and frames: their layers, layout and stills, as metadata.json has them.
    data: Value,
    /// How many people have it on their profile.
    users: i64,
}

async fn admin_list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(kind): Path<String>) -> AppResult<Json<Vec<AdminItem>>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    check_kind(&kind)?;
    let rows: HashMap<String, Row> = sqlx::query_as::<_, Row>(&format!("SELECT {COLS} FROM cosmetics WHERE kind = $1 ORDER BY created_at")).bind(&kind).fetch_all(&state.db).await?
        .into_iter().map(|r| (r.value.clone(), r)).collect();
    let counts: HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>(&format!("SELECT {c}, COUNT(*) FROM users WHERE {c} <> '' GROUP BY 1", c = column(&kind)))
        .fetch_all(&state.db).await?.into_iter().collect();
    let mut out = Vec::new();
    let mut push = |value: String, source: &'static str, name: Option<String>, description: Option<String>, data: Value| {
        let r = rows.get(&value);
        let own = source != "folder";
        out.push(AdminItem {
            name: if own { r.and_then(|r| r.name.clone()) } else { name },
            description: if own { r.and_then(|r| r.description.clone()) } else { description },
            enabled: r.map(|r| r.enabled).unwrap_or(true),
            deleted: r.map(|r| r.deleted).unwrap_or(false),
            data: if source == "custom" { r.map(|r| r.data.clone()).unwrap_or(json!({})) } else { data },
            users: counts.get(&value).copied().unwrap_or(0),
            value, source,
        });
    };
    for b in builtins(&kind) { push(b.to_string(), "builtin", None, None, json!({})) }
    let p = assets::ASSET_PREFIX;
    let some = |s: &str| Some(s.to_string()).filter(|s| !s.is_empty());
    match kind.as_str() {
        "decoration" => for d in &assets::decorations(&state.config).await.list { push(format!("{p}{}", d.id), "folder", Some(d.name.clone()), d.description.clone(), json!({ "file": d.file_name() })) },
        "nameplate" => for d in &assets::nameplates(&state.config).await.list { push(format!("{p}{}", d.id), "folder", Some(d.name.clone()), d.description.clone(), json!({ "file": d.file_name() })) },
        "effect" => for d in &asset_layers::effects(&state.config).await.list { push(format!("{p}{}", d.id), "folder", Some(d.name.clone()), some(&d.description), json!({ "layers": d.layers, "still": d.still, "thumbnail": d.thumbnail, "reduced_motion": d.reduced_motion })) },
        _ => for d in &asset_layers::frames(&state.config).await.list { push(format!("{p}{}", d.id), "folder", Some(d.name.clone()), some(&d.description), json!({ "layers": d.layers, "layout": d.layout })) },
    }
    for r in rows.values().filter(|r| r.custom) { push(r.value.clone(), "custom", None, None, json!({})) }
    Ok(Json(out))
}

fn hex(c: &Value) -> Option<String> {
    let c = c.as_str()?.trim().to_ascii_lowercase();
    (c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit())).then_some(c)
}

/// A custom item's look, checked for its kind: nameplate `{colors: [a, b]}`; frame `{colors: [ring, glow]}`; effect
/// `{glyph, fall}` (drifts down, or floats up). Pictures go in the assets folder instead.
fn clean_data(kind: &str, d: &Value) -> AppResult<Value> {
    let colors = || -> AppResult<Vec<String>> {
        let list: Vec<String> = d["colors"].as_array().map(|a| a.iter().filter_map(hex).collect()).unwrap_or_default();
        if list.len() != 2 { return Err(AppError::BadRequest("Pick two colours (#rrggbb)".into())) }
        Ok(list)
    };
    Ok(match kind {
        "decoration" => return Err(AppError::BadRequest("Decorations are pictures: add them to the assets folder".into())),
        "nameplate" | "frame" => json!({ "colors": colors()? }),
        _ => {
            let g: String = d["glyph"].as_str().unwrap_or_default().trim().to_string();
            if g.is_empty() || g.chars().count() > 8 { return Err(AppError::BadRequest("An effect needs an emoji".into())) }
            json!({ "glyph": g, "fall": d["fall"].as_bool().unwrap_or(true) })
        }
    })
}

fn clean_text(s: &Option<String>, max: usize) -> Option<String> {
    s.as_ref().map(|s| s.trim().chars().take(max).collect::<String>()).filter(|s| !s.is_empty())
}

#[derive(Deserialize)]
struct CreateReq {
    name: String,
    #[serde(default)]
    description: Option<String>,
    data: Value,
    #[serde(default = "yes")]
    enabled: bool,
}
fn yes() -> bool { true }

/// A custom colour or emoji one (Parley's own; pictures go in the assets folder).
async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(kind): Path<String>, Json(req): Json<CreateReq>) -> AppResult<(StatusCode, Json<Row>)> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    check_kind(&kind)?;
    let name = clean_text(&Some(req.name), 40).ok_or_else(|| AppError::BadRequest("It needs a name".into()))?;
    let data = clean_data(&kind, &req.data)?;
    let value = format!("{CUSTOM_PREFIX}{}", Uuid::now_v7());
    let row = sqlx::query_as::<_, Row>(&format!("INSERT INTO cosmetics (kind, value, custom, name, description, enabled, data) VALUES ($1, $2, true, $3, $4, $5, $6) RETURNING {COLS}"))
        .bind(&kind).bind(&value).bind(&name).bind(clean_text(&req.description, 200)).bind(req.enabled).bind(&data)
        .fetch_one(&state.db).await?;
    crate::audit::record(&state, uid, "cosmetic.create", "cosmetic", None, &name, json!({ "kind": kind, "value": value })).await;
    announce(&state).await;
    Ok((StatusCode::CREATED, Json(row)))
}

#[derive(Deserialize)]
struct UpdateReq {
    name: Option<String>,
    description: Option<String>,
    enabled: Option<bool>,
    /// false restores a deleted built-in or folder one.
    deleted: Option<bool>,
    data: Option<Value>,
}

/// Turn on or off, restore, and for built-in and custom ones rename (an empty name gives a built-in its own back);
/// custom ones can change their look. A folder item's name and look are in metadata.json (asset_admin.rs).
async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((kind, value)): Path<(String, String)>, Json(req): Json<UpdateReq>) -> AppResult<Json<Row>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    check_kind(&kind)?;
    let existing = sqlx::query_as::<_, Row>(&format!("SELECT {COLS} FROM cosmetics WHERE kind = $1 AND value = $2")).bind(&kind).bind(&value).fetch_optional(&state.db).await?;
    let custom = existing.as_ref().map(|r| r.custom).unwrap_or(false);
    let folder = value.starts_with(assets::ASSET_PREFIX);
    let known = custom || if folder { in_folder(&state, &kind, &value).await } else { builtins(&kind).contains(&value.as_str()) };
    if !known { return Err(AppError::NotFound("Unknown cosmetic".into())) }
    if folder && (req.name.is_some() || req.description.is_some()) { return Err(AppError::BadRequest("A folder item's name and description are in its metadata.json: edit the item".into())) }
    if req.data.is_some() && !custom { return Err(AppError::BadRequest("Only custom ones can change their look here".into())) }
    if req.deleted == Some(true) { return Err(AppError::BadRequest("Delete it instead".into())) }
    let data = match &req.data { Some(d) => Some(clean_data(&kind, d)?), None => None };
    let name = req.name.as_ref().map(|n| n.trim().chars().take(40).collect::<String>());
    if custom && name.as_deref() == Some("") { return Err(AppError::BadRequest("It needs a name".into())) }
    let description = req.description.as_ref().map(|d| d.trim().chars().take(200).collect::<String>());
    // Restoring a deleted one brings it back on.
    let enabled = if req.deleted == Some(false) { Some(true) } else { req.enabled };
    let row = sqlx::query_as::<_, Row>(&format!(
        "INSERT INTO cosmetics (kind, value, name, description, enabled) VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), COALESCE($5, true))
         ON CONFLICT (kind, value) DO UPDATE SET
           name = CASE WHEN $3::text IS NULL THEN cosmetics.name ELSE NULLIF($3, '') END,
           description = CASE WHEN $4::text IS NULL THEN cosmetics.description ELSE NULLIF($4, '') END,
           enabled = COALESCE($5, cosmetics.enabled), deleted = COALESCE($7, cosmetics.deleted), data = COALESCE($6, cosmetics.data), updated_at = now()
         RETURNING {COLS}"))
        .bind(&kind).bind(&value).bind(&name).bind(&description).bind(enabled).bind(&data).bind(req.deleted)
        .fetch_one(&state.db).await?;
    let label = row.name.clone().unwrap_or_else(|| value.clone());
    crate::audit::record(&state, uid, "cosmetic.update", "cosmetic", None, &label, json!({ "kind": kind, "value": value, "enabled": req.enabled, "restored": req.deleted == Some(false), "renamed": req.name.is_some(), "look": req.data.is_some() })).await;
    announce(&state).await;
    Ok(Json(row))
}

/// Delete one: a custom one goes; a built-in or folder one is hidden for good (its files stay; it can be restored).
/// Either way it comes off everyone who had it.
async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((kind, value)): Path<(String, String)>) -> AppResult<StatusCode> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    check_kind(&kind)?;
    let folder = value.starts_with(assets::ASSET_PREFIX);
    let known_elsewhere = if folder { in_folder(&state, &kind, &value).await } else { builtins(&kind).contains(&value.as_str()) };
    let mut tx = state.db.begin().await?;
    let gone = sqlx::query_as::<_, Row>(&format!("DELETE FROM cosmetics WHERE kind = $1 AND value = $2 AND custom RETURNING {COLS}")).bind(&kind).bind(&value).fetch_optional(&mut *tx).await?;
    let label = match gone {
        Some(r) => r.name.unwrap_or_else(|| value.clone()),
        None if known_elsewhere => {
            sqlx::query("INSERT INTO cosmetics (kind, value, enabled, deleted) VALUES ($1, $2, false, true) ON CONFLICT (kind, value) DO UPDATE SET enabled = false, deleted = true, updated_at = now()")
                .bind(&kind).bind(&value).execute(&mut *tx).await?;
            value.clone()
        }
        None => return Err(AppError::NotFound("Unknown cosmetic".into())),
    };
    let affected: Vec<(Uuid,)> = sqlx::query_as(&format!("UPDATE users SET {c} = '' WHERE {c} = $1 RETURNING id", c = column(&kind))).bind(&value).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    crate::audit::record(&state, uid, "cosmetic.delete", "cosmetic", None, &label, json!({ "kind": kind, "value": value, "users": affected.len() })).await;
    announce(&state).await;
    let ids: Vec<Uuid> = affected.into_iter().map(|r| r.0).collect();
    if !ids.is_empty() {
        let users = sqlx::query_as::<_, crate::models::User>(&format!("SELECT {} FROM users WHERE id = ANY($1)", crate::routes::users::USER_COLS)).bind(&ids).fetch_all(&state.db).await.unwrap_or_default();
        for u in users { state.hub.emit_all("USER_UPDATE", json!(u)); }
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_are_checked_per_kind() {
        assert!(clean_data("decoration", &json!({ "image": "/api/images/x" })).is_err());
        assert_eq!(clean_data("nameplate", &json!({ "colors": ["#FF0000", "#00ff00"] })).unwrap(), json!({ "colors": ["#ff0000", "#00ff00"] }));
        assert!(clean_data("frame", &json!({ "colors": ["red", "#00ff00"] })).is_err());
        assert_eq!(clean_data("effect", &json!({ "glyph": " 🌸 ", "fall": false })).unwrap(), json!({ "glyph": "🌸", "fall": false }));
        assert!(clean_data("effect", &json!({ "glyph": "" })).is_err());
    }
}
