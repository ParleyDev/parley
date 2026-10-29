//! Colour themes, like Discord's: a full-app gradient (angle and 2-5 colour stops) over a light or dark base, with a
//! midpoint that sets how strongly it tints the surfaces. They are data, managed in the admin console (the seeded ones
//! can be disabled but not deleted); every client gets the enabled list, live (THEMES_UPDATE).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{require_perm, Perm},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/themes", get(list_enabled))
        .route("/admin/themes", get(list_all).post(create))
        .route("/admin/themes/order", put(reorder))
        .route("/admin/themes/:id", patch(update).delete(remove))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Stop {
    pub color: String,
    pub pos: f64,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Theme {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub base: String,
    pub angle: f64,
    pub midpoint: f64,
    pub stops: Value,
    pub sort_order: i32,
    pub enabled: bool,
    pub builtin: bool,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

const COLS: &str = "id, name, slug, base, angle, midpoint, stops, sort_order, enabled, builtin, updated_at";

/// A theme's look, as stored on a theme, a server or a user's own custom theme: checked the same way everywhere.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Look {
    pub base: String,
    pub angle: f64,
    pub midpoint: f64,
    pub stops: Vec<Stop>,
}

pub fn valid_look(l: &Look) -> AppResult<Look> {
    if l.base != "light" && l.base != "dark" { return Err(AppError::BadRequest("A theme's base is light or dark".into())) }
    if !(0.0..=360.0).contains(&l.angle) { return Err(AppError::BadRequest("The angle is 0 to 360 degrees".into())) }
    if !(0.0..=100.0).contains(&l.midpoint) { return Err(AppError::BadRequest("The midpoint is 0 to 100".into())) }
    if !(2..=5).contains(&l.stops.len()) { return Err(AppError::BadRequest("A theme has 2 to 5 colours".into())) }
    let mut stops = Vec::new();
    for s in &l.stops {
        let c = s.color.trim().to_ascii_lowercase();
        if c.len() != 7 || !c.starts_with('#') || !c[1..].chars().all(|x| x.is_ascii_hexdigit()) { return Err(AppError::BadRequest("Colours are #rrggbb".into())) }
        if !(0.0..=100.0).contains(&s.pos) { return Err(AppError::BadRequest("Colour positions are 0 to 100".into())) }
        stops.push(Stop { color: c, pos: (s.pos * 100.0).round() / 100.0 });
    }
    Ok(Look { base: l.base.clone(), angle: (l.angle * 100.0).round() / 100.0, midpoint: (l.midpoint * 10.0).round() / 10.0, stops })
}

fn clean_name(n: &str) -> AppResult<String> {
    let n: String = n.trim().chars().take(40).collect();
    if n.is_empty() { return Err(AppError::BadRequest("A theme needs a name".into())) }
    Ok(n)
}

fn slugify(n: &str) -> String {
    let s: String = n.to_ascii_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.is_empty() { "theme".into() } else { s }
}

async fn enabled(state: &AppState) -> AppResult<Vec<Theme>> {
    Ok(sqlx::query_as::<_, Theme>(&format!("SELECT {COLS} FROM color_themes WHERE enabled ORDER BY sort_order, created_at")).fetch_all(&state.db).await?)
}

/// Everyone gets the new list straight away (a disabled or deleted theme falls back to its base on their side).
async fn broadcast(state: &AppState) {
    if let Ok(list) = enabled(state).await { state.hub.emit_all("THEMES_UPDATE", json!({ "themes": list })); }
}

/// The enabled themes, in order: what Appearance settings and server settings offer.
async fn list_enabled(State(state): State<AppState>) -> AppResult<Json<Vec<Theme>>> {
    Ok(Json(enabled(&state).await?))
}

async fn list_all(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Theme>>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    Ok(Json(sqlx::query_as::<_, Theme>(&format!("SELECT {COLS} FROM color_themes ORDER BY sort_order, created_at")).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
struct CreateTheme {
    name: String,
    #[serde(flatten)]
    look: Look,
    #[serde(default = "yes")]
    enabled: bool,
}
fn yes() -> bool { true }

async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<CreateTheme>) -> AppResult<(StatusCode, Json<Theme>)> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let name = clean_name(&req.name)?;
    let look = valid_look(&req.look)?;
    let base = slugify(&name);
    let mut slug = base.clone();
    for n in 2.. {
        let taken: Option<(bool,)> = sqlx::query_as("SELECT true FROM color_themes WHERE slug = $1").bind(&slug).fetch_optional(&state.db).await?;
        if taken.is_none() { break }
        slug = format!("{base}-{n}");
    }
    let t = sqlx::query_as::<_, Theme>(&format!(
        "INSERT INTO color_themes (name, slug, base, angle, midpoint, stops, sort_order, enabled, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM color_themes), $7, $8, $8) RETURNING {COLS}"))
        .bind(&name).bind(&slug).bind(&look.base).bind(look.angle).bind(look.midpoint).bind(json!(look.stops)).bind(req.enabled).bind(uid)
        .fetch_one(&state.db).await?;
    crate::audit::record(&state, uid, "theme.create", "theme", Some(t.id), &t.name, json!({ "name": t.name, "base": t.base })).await;
    broadcast(&state).await;
    Ok((StatusCode::CREATED, Json(t)))
}

#[derive(Deserialize)]
struct UpdateTheme {
    name: Option<String>,
    base: Option<String>,
    angle: Option<f64>,
    midpoint: Option<f64>,
    stops: Option<Vec<Stop>>,
    enabled: Option<bool>,
}

async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<UpdateTheme>) -> AppResult<Json<Theme>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let cur = sqlx::query_as::<_, Theme>(&format!("SELECT {COLS} FROM color_themes WHERE id = $1")).bind(id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Theme not found".into()))?;
    let name = match &req.name { Some(n) => clean_name(n)?, None => cur.name.clone() };
    let stops: Vec<Stop> = match &req.stops { Some(s) => s.clone(), None => serde_json::from_value(cur.stops.clone()).unwrap_or_default() };
    let look = valid_look(&Look { base: req.base.clone().unwrap_or(cur.base.clone()), angle: req.angle.unwrap_or(cur.angle), midpoint: req.midpoint.unwrap_or(cur.midpoint), stops })?;
    let enabled = req.enabled.unwrap_or(cur.enabled);
    let t = sqlx::query_as::<_, Theme>(&format!(
        "UPDATE color_themes SET name = $2, base = $3, angle = $4, midpoint = $5, stops = $6, enabled = $7, updated_by = $8, updated_at = now() WHERE id = $1 RETURNING {COLS}"))
        .bind(id).bind(&name).bind(&look.base).bind(look.angle).bind(look.midpoint).bind(json!(look.stops)).bind(enabled).bind(uid)
        .fetch_one(&state.db).await?;
    let mut changed = serde_json::Map::new();
    if cur.name != t.name { changed.insert("name".into(), json!({ "from": cur.name, "to": t.name })); }
    if cur.base != t.base { changed.insert("base".into(), json!(t.base)); }
    if cur.angle != t.angle || cur.midpoint != t.midpoint || cur.stops != t.stops { changed.insert("gradient".into(), json!({ "angle": t.angle, "midpoint": t.midpoint, "stops": t.stops })); }
    if cur.enabled != t.enabled { changed.insert("enabled".into(), json!(t.enabled)); }
    if !changed.is_empty() { crate::audit::record(&state, uid, "theme.update", "theme", Some(t.id), &t.name, Value::Object(changed)).await; }
    broadcast(&state).await;
    Ok(Json(t))
}

async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let row: Option<(String, bool)> = sqlx::query_as("SELECT name, builtin FROM color_themes WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let Some((name, builtin)) = row else { return Err(AppError::NotFound("Theme not found".into())) };
    if builtin { return Err(AppError::BadRequest("Built-in themes can be disabled, not deleted".into())) }
    sqlx::query("DELETE FROM color_themes WHERE id = $1").bind(id).execute(&state.db).await?;
    crate::audit::record(&state, uid, "theme.delete", "theme", Some(id), &name, json!({ "name": name })).await;
    broadcast(&state).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Order { ids: Vec<Uuid> }

async fn reorder(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<Order>) -> AppResult<StatusCode> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let mut tx = state.db.begin().await?;
    for (i, id) in req.ids.iter().enumerate() {
        sqlx::query("UPDATE color_themes SET sort_order = $2, updated_by = $3, updated_at = now() WHERE id = $1").bind(id).bind(i as i32 + 1).bind(uid).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    crate::audit::record(&state, uid, "theme.reorder", "theme", None, "", json!({ "count": req.ids.len() })).await;
    broadcast(&state).await;
    Ok(StatusCode::NO_CONTENT)
}

/// A server's theme as sent by its settings: {"id": theme} or {"custom": look}; anything else is refused.
pub async fn valid_guild_theme(state: &AppState, v: &Value) -> AppResult<Value> {
    if let Some(id) = v.get("id").and_then(Value::as_str) {
        let id = Uuid::parse_str(id).map_err(|_| AppError::BadRequest("Unknown theme".into()))?;
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM color_themes WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
        if ok.is_none() { return Err(AppError::BadRequest("Unknown theme".into())) }
        return Ok(json!({ "id": id }));
    }
    if let Some(c) = v.get("custom") {
        let look: Look = serde_json::from_value(c.clone()).map_err(|_| AppError::BadRequest("Invalid custom theme".into()))?;
        return Ok(json!({ "custom": valid_look(&look)? }));
    }
    Err(AppError::BadRequest("A server theme is {id} or {custom}".into()))
}
