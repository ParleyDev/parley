//! Profile cosmetics, managed in the admin console: avatar decorations, nameplates, profile effects and profile frames.
//! Each comes from one of three places: the built-in presets (drawn in CSS by the client), the instance's assets folder
//! (`asset:<id>`, see assets.rs and asset_layers.rs) and the ones admins make here (`custom:<uuid>`: an uploaded
//! picture, or colours, or an emoji). Admins can rename any of them and turn any of them off; a cosmetic that is off
//! isn't offered and isn't shown on anyone's profile until it's back on. Custom ones can also be edited and deleted
//! (deleting takes it off everyone who had it). Every client gets the changes live (COSMETICS_UPDATE).

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
    routes::admin_access::{require_perm, Perm},
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
    pub data: Value,
}
const COLS: &str = "kind, value, custom, name, description, enabled, data";

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

// --- what's off and what's renamed, kept in memory for the assets lists and file routes -----------------------------

#[derive(Default)]
struct Overrides {
    off: HashSet<(String, String)>,
    names: HashMap<(String, String), (Option<String>, Option<String>)>,
    custom: HashMap<(String, String), Row>,
}
static OVERRIDES: LazyLock<RwLock<Overrides>> = LazyLock::new(Default::default);

/// Reload the in-memory copy. Each instance also does this every 30 s, so a change made on another one arrives.
pub async fn refresh(state: &AppState) {
    let Ok(rows) = sqlx::query_as::<_, Row>(&format!("SELECT {COLS} FROM cosmetics")).fetch_all(&state.db).await else { return };
    let mut o = Overrides::default();
    for r in rows {
        let key = (r.kind.clone(), r.value.clone());
        if !r.enabled { o.off.insert(key.clone()); }
        if r.custom { o.custom.insert(key, r); } else if r.name.is_some() || r.description.is_some() { o.names.insert(key, (r.name, r.description)); }
    }
    *OVERRIDES.write().unwrap() = o;
}

pub async fn refresh_loop(state: AppState) {
    loop {
        refresh(&state).await;
        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

/// Is this stored value turned off by an admin?
pub fn is_off(kind: &str, value: &str) -> bool { OVERRIDES.read().unwrap().off.contains(&(kind.to_string(), value.to_string())) }

/// An admin's name and description for a built-in or folder item, if they set one.
pub fn renamed(kind: &str, value: &str) -> Option<(Option<String>, Option<String>)> { OVERRIDES.read().unwrap().names.get(&(kind.to_string(), value.to_string())).cloned() }

/// Whether a user may pick this value: it exists and isn't off. Empty clears.
pub async fn allowed(state: &AppState, kind: &str, value: &str) -> bool {
    if value.is_empty() { return true }
    if is_off(kind, value) { return false }
    if value.starts_with(CUSTOM_PREFIX) { return OVERRIDES.read().unwrap().custom.contains_key(&(kind.to_string(), value.to_string())) }
    if value.starts_with(crate::routes::assets::ASSET_PREFIX) {
        return match kind {
            "decoration" => crate::routes::assets::decoration_exists(&state.config, value).await,
            "nameplate" => crate::routes::assets::nameplate_exists(&state.config, value).await,
            "effect" => crate::routes::asset_layers::effect_exists(&state.config, value).await,
            _ => crate::routes::asset_layers::frame_exists(&state.config, value).await,
        };
    }
    builtins(kind).contains(&value)
}

async fn broadcast(state: &AppState) {
    refresh(state).await;
    if let Ok(list) = public_rows(state).await { state.hub.emit_all("COSMETICS_UPDATE", json!({ "cosmetics": list })); }
}

// --- the list every client gets --------------------------------------------------------------------------------------

/// Every admin row: what's off, renamed, and the custom items (with their look). Clients apply it everywhere.
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
    /// The admin's name, the folder's name, or null for a built-in that keeps its own.
    name: Option<String>,
    description: Option<String>,
    enabled: bool,
    data: Value,
    /// How many people have it on their profile.
    users: i64,
}

async fn admin_list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(kind): Path<String>) -> AppResult<Json<Vec<AdminItem>>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    check_kind(&kind)?;
    let rows: HashMap<String, Row> = sqlx::query_as::<_, Row>(&format!("SELECT {COLS} FROM cosmetics WHERE kind = $1 ORDER BY created_at")).bind(&kind).fetch_all(&state.db).await?
        .into_iter().map(|r| (r.value.clone(), r)).collect();
    let counts: HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>(&format!("SELECT {c}, COUNT(*) FROM users WHERE {c} IS NOT NULL AND {c} <> '' GROUP BY 1", c = column(&kind)))
        .fetch_all(&state.db).await?.into_iter().collect();
    let mut out = Vec::new();
    let mut push = |value: String, source: &'static str, name: Option<String>, description: Option<String>| {
        let r = rows.get(&value);
        out.push(AdminItem {
            name: r.and_then(|r| r.name.clone()).or(name),
            description: r.and_then(|r| r.description.clone()).or(description),
            enabled: r.map(|r| r.enabled).unwrap_or(true),
            data: r.map(|r| r.data.clone()).unwrap_or(json!({})),
            users: counts.get(&value).copied().unwrap_or(0),
            value, source,
        });
    };
    for b in builtins(&kind) { push(b.to_string(), "builtin", None, None) }
    let p = crate::routes::assets::ASSET_PREFIX;
    match kind.as_str() {
        "decoration" => for d in &crate::routes::assets::decorations(&state.config).await.list { push(format!("{p}{}", d.id), "folder", Some(d.name.clone()), d.description.clone()) },
        "nameplate" => for d in &crate::routes::assets::nameplates(&state.config).await.list { push(format!("{p}{}", d.id), "folder", Some(d.name.clone()), d.description.clone()) },
        "effect" => for d in &crate::routes::asset_layers::effects(&state.config).await.list { push(format!("{p}{}", d.id), "folder", Some(d.name.clone()), Some(d.description.clone()).filter(|s| !s.is_empty())) },
        _ => for d in &crate::routes::asset_layers::frames(&state.config).await.list { push(format!("{p}{}", d.id), "folder", Some(d.name.clone()), Some(d.description.clone()).filter(|s| !s.is_empty())) },
    }
    for r in rows.values().filter(|r| r.custom) { push(r.value.clone(), "custom", None, None) }
    Ok(Json(out))
}

fn hex(c: &Value) -> Option<String> {
    let c = c.as_str()?.trim().to_ascii_lowercase();
    (c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit())).then_some(c)
}

/// A custom item's look, checked for its kind:
/// decoration `{image}`; nameplate `{image}` or `{colors: [a, b]}`; frame `{colors: [ring, glow]}`;
/// effect `{glyph}` or `{image}`, plus `fall` (drifts down) or not (floats up).
fn clean_data(kind: &str, d: &Value) -> AppResult<Value> {
    let image = match d["image"].as_str().filter(|s| !s.is_empty()) {
        Some(u) if crate::routes::images::image_id(u).is_some() => Some(u.to_string()),
        Some(_) => return Err(AppError::BadRequest("The picture must be uploaded here".into())),
        None => None,
    };
    let colors = || -> AppResult<Vec<String>> {
        let list: Vec<String> = d["colors"].as_array().map(|a| a.iter().filter_map(hex).collect()).unwrap_or_default();
        if list.len() != 2 { return Err(AppError::BadRequest("Pick two colours (#rrggbb)".into())) }
        Ok(list)
    };
    Ok(match kind {
        "decoration" => json!({ "image": image.ok_or_else(|| AppError::BadRequest("A decoration needs a picture".into()))? }),
        "nameplate" => match image { Some(i) => json!({ "image": i }), None => json!({ "colors": colors()? }) },
        "frame" => json!({ "colors": colors()? }),
        _ => {
            let fall = d["fall"].as_bool().unwrap_or(true);
            match image {
                Some(i) => json!({ "image": i, "fall": fall }),
                None => {
                    let g: String = d["glyph"].as_str().unwrap_or_default().trim().to_string();
                    if g.is_empty() || g.chars().count() > 8 { return Err(AppError::BadRequest("An effect needs an emoji or a picture".into())) }
                    json!({ "glyph": g, "fall": fall })
                }
            }
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
    broadcast(&state).await;
    Ok((StatusCode::CREATED, Json(row)))
}

#[derive(Deserialize)]
struct UpdateReq {
    name: Option<String>,
    description: Option<String>,
    enabled: Option<bool>,
    data: Option<Value>,
}

/// Rename, turn on or off, and (custom ones) change the look. For a built-in or folder item, an empty name goes back
/// to its own.
async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((kind, value)): Path<(String, String)>, Json(req): Json<UpdateReq>) -> AppResult<Json<Row>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    check_kind(&kind)?;
    let existing = sqlx::query_as::<_, Row>(&format!("SELECT {COLS} FROM cosmetics WHERE kind = $1 AND value = $2")).bind(&kind).bind(&value).fetch_optional(&state.db).await?;
    let custom = existing.as_ref().map(|r| r.custom).unwrap_or(false);
    let known = custom || if value.starts_with(crate::routes::assets::ASSET_PREFIX) { allowed_ignoring_off(&state, &kind, &value).await } else { builtins(&kind).contains(&value.as_str()) };
    if !known { return Err(AppError::NotFound("Unknown cosmetic".into())) }
    if req.data.is_some() && !custom { return Err(AppError::BadRequest("Only custom ones can change their look".into())) }
    let data = match &req.data { Some(d) => Some(clean_data(&kind, d)?), None => None };
    let name = req.name.as_ref().map(|n| n.trim().chars().take(40).collect::<String>());
    if custom && name.as_deref() == Some("") { return Err(AppError::BadRequest("It needs a name".into())) }
    let description = req.description.as_ref().map(|d| d.trim().chars().take(200).collect::<String>());
    let old_image = existing.as_ref().and_then(|r| r.data["image"].as_str().map(str::to_string));
    let row = sqlx::query_as::<_, Row>(&format!(
        "INSERT INTO cosmetics (kind, value, name, description, enabled) VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), COALESCE($5, true))
         ON CONFLICT (kind, value) DO UPDATE SET
           name = CASE WHEN $3::text IS NULL THEN cosmetics.name ELSE NULLIF($3, '') END,
           description = CASE WHEN $4::text IS NULL THEN cosmetics.description ELSE NULLIF($4, '') END,
           enabled = COALESCE($5, cosmetics.enabled), data = COALESCE($6, cosmetics.data), updated_at = now()
         RETURNING {COLS}"))
        .bind(&kind).bind(&value).bind(&name).bind(&description).bind(req.enabled).bind(&data)
        .fetch_one(&state.db).await?;
    if data.is_some() {
        crate::routes::images::release_replaced(&state, old_image.as_deref(), row.data["image"].as_str()).await;
    }
    let label = row.name.clone().unwrap_or_else(|| value.clone());
    crate::audit::record(&state, uid, "cosmetic.update", "cosmetic", None, &label, json!({ "kind": kind, "value": value, "enabled": req.enabled, "renamed": req.name.is_some(), "look": req.data.is_some() })).await;
    broadcast(&state).await;
    Ok(Json(row))
}

async fn allowed_ignoring_off(state: &AppState, kind: &str, value: &str) -> bool {
    match kind {
        "decoration" => crate::routes::assets::decoration_exists(&state.config, value).await,
        "nameplate" => crate::routes::assets::nameplate_exists(&state.config, value).await,
        "effect" => crate::routes::asset_layers::effect_exists(&state.config, value).await,
        _ => crate::routes::asset_layers::frame_exists(&state.config, value).await,
    }
}

/// Delete a custom one: it comes off everyone who had it. (Built-in and folder ones can only be turned off.)
async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((kind, value)): Path<(String, String)>) -> AppResult<StatusCode> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    check_kind(&kind)?;
    let mut tx = state.db.begin().await?;
    let row = sqlx::query_as::<_, Row>(&format!("DELETE FROM cosmetics WHERE kind = $1 AND value = $2 AND custom RETURNING {COLS}")).bind(&kind).bind(&value).fetch_optional(&mut *tx).await?
        .ok_or_else(|| AppError::BadRequest("Built-in and assets-folder ones can be turned off, not deleted".into()))?;
    let affected: Vec<(Uuid,)> = sqlx::query_as(&format!("UPDATE users SET {c} = '' WHERE {c} = $1 RETURNING id", c = column(&kind))).bind(&value).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    crate::routes::images::release_replaced(&state, row.data["image"].as_str(), None).await;
    crate::audit::record(&state, uid, "cosmetic.delete", "cosmetic", None, row.name.as_deref().unwrap_or(&value), json!({ "kind": kind, "value": value, "users": affected.len() })).await;
    broadcast(&state).await;
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
        let img = "/api/images/0190c0de-0000-7000-8000-000000000001";
        assert!(clean_data("decoration", &json!({})).is_err());
        assert_eq!(clean_data("decoration", &json!({ "image": img })).unwrap(), json!({ "image": img }));
        assert!(clean_data("decoration", &json!({ "image": "https://evil.example/x.png" })).is_err());
        assert_eq!(clean_data("nameplate", &json!({ "colors": ["#FF0000", "#00ff00"] })).unwrap(), json!({ "colors": ["#ff0000", "#00ff00"] }));
        assert!(clean_data("frame", &json!({ "colors": ["red", "#00ff00"] })).is_err());
        assert_eq!(clean_data("effect", &json!({ "glyph": " 🌸 ", "fall": false })).unwrap(), json!({ "glyph": "🌸", "fall": false }));
        assert!(clean_data("effect", &json!({ "glyph": "" })).is_err());
    }
}
