//! Explicit-image checks made by the server.
//!
//! The explicit image filter used to run only in each member's browser, so a bot, an API client or a changed
//! client was never checked, and pictures everyone sees (profile pictures, banners, server icons, emoji, stickers)
//! were not checked at all. With a classifier service set up, the server asks it:
//!
//! - **Pictures everyone sees** are always refused when explicit. While the service cannot be reached they are
//!   refused too, unless the operator turns that off: these pictures are shown to everyone, including people who
//!   are not confirmed as adults.
//! - **Attachments** are checked where the server's own explicit image filter applies (off, members without roles,
//!   everyone) and never in a channel with a minimum age. While the service is down they go through.
//!
//! Parley ships no model. The operator runs a small service that speaks the contract below (see
//! docs/self-hosting/explicit-images.md): Parley sends the file, the service answers `{ "explicit": true|false }`.
//! For an animation the service is expected to look at several frames and answer explicit only when at least two
//! agree. Off until an address is set.

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{require_perm, Perm},
    state::AppState,
};
use axum::{extract::State, routing::{get, post}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/safety/explicit", get(get_config).put(put_config))
        .route("/admin/safety/explicit/test", post(test_service))
}

#[derive(Debug, Clone, Default)]
pub struct Config {
    pub service_url: String,
    pub service_token: String,
    /// Pictures everyone sees are let through while the service cannot be reached (default: refused).
    pub allow_when_down: bool,
}

pub async fn load_config(db: &PgPool) -> Config {
    let rows: Vec<(String, Value)> = sqlx::query_as("SELECT key, value FROM instance_settings WHERE key LIKE 'explicit\\_%'").fetch_all(db).await.unwrap_or_default();
    let mut c = Config::default();
    for (k, v) in rows {
        match k.as_str() {
            "explicit_service_url" => c.service_url = v.as_str().unwrap_or("").to_string(),
            "explicit_service_token" => c.service_token = v.as_str().unwrap_or("").to_string(),
            "explicit_allow_when_down" => c.allow_when_down = v.as_bool().unwrap_or(false),
            _ => {}
        }
    }
    c
}

/// The largest file sent to the classifier; bigger ones (long videos) are not checked.
const MAX_CHECK: usize = 30 * 1024 * 1024;

#[derive(Deserialize)]
struct Reply { explicit: bool }

/// Ask the service. Err = it could not be asked, or answered something else.
async fn ask(cfg: &Config, bytes: &[u8], surface: &str, content_type: &str) -> Result<bool, String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
    let mut req = client.post(cfg.service_url.trim())
        .header("Content-Type", if content_type.is_empty() { "application/octet-stream" } else { content_type })
        .header("X-Parley-Surface", surface)
        .body(bytes.to_vec());
    if !cfg.service_token.is_empty() { req = req.bearer_auth(&cfg.service_token); }
    let res = req.send().await.map_err(|e| format!("request failed: {e}"))?;
    if !res.status().is_success() { return Err(format!("status {}", res.status())); }
    Ok(res.json::<Reply>().await.map_err(|e| format!("unreadable answer: {e}"))?.explicit)
}

fn checkable(content_type: &str, len: usize) -> bool {
    (content_type.starts_with("image/") || content_type.starts_with("video/")) && len <= MAX_CHECK
}

/// A picture everyone sees (profile picture, banner, server icon, emoji, sticker, Discover banner).
pub async fn check_public(state: &AppState, bytes: &[u8], content_type: &str) -> AppResult<()> {
    let cfg = load_config(&state.db).await;
    if cfg.service_url.trim().is_empty() || !checkable(content_type, bytes.len()) { return Ok(()) }
    match ask(&cfg, bytes, "image", content_type).await {
        Ok(false) => Ok(()),
        Ok(true) => Err(AppError::BadRequest("This picture can't be used here: it looks explicit.".into())),
        Err(e) => {
            tracing::warn!(error = %e, "explicit image service could not be used");
            if cfg.allow_when_down { Ok(()) } else { Err(AppError::BadRequest("Pictures can't be checked right now, so this one can't be saved. Try again in a little while.".into())) }
        }
    }
}

/// An attachment headed for a channel. Checked where the server's explicit image filter applies to this member.
pub async fn check_attachment(state: &AppState, bytes: &[u8], content_type: &str, channel_id: Uuid, uid: Uuid) -> AppResult<()> {
    if !checkable(content_type, bytes.len()) { return Ok(()) }
    let cfg = load_config(&state.db).await;
    if cfg.service_url.trim().is_empty() { return Ok(()) }
    // The server's setting, whether this member has any role, and whether the channel is for adults anyway.
    let row: Option<(String, bool, bool)> = sqlx::query_as(
        "SELECT g.explicit_filter, EXISTS (SELECT 1 FROM member_roles mr WHERE mr.guild_id = g.id AND mr.user_id = $2), channel_min_age(c.id) IS NOT NULL
           FROM channels c JOIN guilds g ON g.id = c.guild_id WHERE c.id = $1",
    ).bind(channel_id).bind(uid).fetch_optional(&state.db).await?;
    let Some((filter, has_role, restricted)) = row else { return Ok(()) }; // a DM: each side's own setting decides
    let applies = !restricted && match filter.as_str() { "all" => true, "no_roles" => !has_role, _ => false };
    if !applies { return Ok(()) }
    match ask(&cfg, bytes, "attachment", content_type).await {
        Ok(true) => Err(AppError::BadRequest("This server doesn't allow explicit pictures or videos here.".into())),
        Ok(false) => Ok(()),
        Err(e) => { tracing::warn!(error = %e, "explicit image service could not be used"); Ok(()) }
    }
}

async fn config_json(state: &AppState) -> Value {
    let c = load_config(&state.db).await;
    json!({ "service_url": c.service_url, "service_token_set": !c.service_token.is_empty(), "allow_when_down": c.allow_when_down, "active": !c.service_url.trim().is_empty() })
}

async fn get_config(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    Ok(Json(config_json(&state).await))
}

#[derive(Deserialize)]
struct PutConfig { service_url: String, service_token: Option<String>, allow_when_down: bool }

async fn put_config(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<PutConfig>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let url = req.service_url.trim().to_string();
    if !url.is_empty() && !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::BadRequest("The service address must start with https:// (or http:// for one on your own network)".into()));
    }
    let before = load_config(&state.db).await;
    let mut set: Vec<(&str, Value)> = vec![("explicit_service_url", json!(url)), ("explicit_allow_when_down", json!(req.allow_when_down))];
    if let Some(t) = &req.service_token { set.push(("explicit_service_token", json!(t.trim()))); }
    for (k, v) in set {
        sqlx::query("INSERT INTO instance_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(k).bind(v).execute(&state.db).await?;
    }
    let mut changed = serde_json::Map::new();
    if before.service_url != url { changed.insert("service_url".into(), json!(url)); }
    if before.allow_when_down != req.allow_when_down { changed.insert("allow_when_down".into(), json!(req.allow_when_down)); }
    if let Some(t) = &req.service_token { if before.service_token != t.trim() { changed.insert("service_token".into(), json!(if t.trim().is_empty() { "cleared" } else { "set" })); } }
    if !changed.is_empty() { audit::record(&state, uid, "safety.explicit.update", "instance", None, "", Value::Object(changed)).await; }
    Ok(Json(config_json(&state).await))
}

/// `POST /admin/safety/explicit/test`: send a blank pixel and say what came back.
async fn test_service(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let cfg = load_config(&state.db).await;
    if cfg.service_url.trim().is_empty() { return Err(AppError::BadRequest("No service address is set".into())); }
    Ok(Json(match ask(&cfg, crate::routes::matching::PROBE_PNG, "test", "image/png").await {
        Ok(false) => json!({ "ok": true, "message": "The service answered: the test picture is not explicit." }),
        Ok(true) => json!({ "ok": false, "message": "The service answered that the test picture (a single blank pixel) is explicit. Check that it follows the contract." }),
        Err(e) => json!({ "ok": false, "message": format!("The service could not be used: {e}") }),
    }))
}
