//! The operator's policies: where their terms, community guidelines and privacy notice are, and how to reach
//! them about safety and about lawful requests. Parley ships templates (docs/policies) and the places these show
//! (sign-up, the report dialog, My Account); the documents and the addresses are the operator's own.
//!
//! `GET /instance/policies` is public (it is shown before signing in). Stored as `policy_*` instance settings.

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{require_perm, Perm},
    state::AppState,
};
use axum::{extract::State, routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/instance/policies", get(public))
        .route("/admin/policies", get(admin_get).put(admin_put))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Policies {
    /// Web addresses of the operator's documents. Empty = not shown.
    #[serde(default)] pub terms_url: String,
    #[serde(default)] pub guidelines_url: String,
    #[serde(default)] pub privacy_url: String,
    /// Where members write about safety: an email address or a web address. Shown on reports and in My Account.
    #[serde(default)] pub safety_contact: String,
    /// Where the police, courts and rights holders write: an email address or a web address.
    #[serde(default)] pub legal_contact: String,
}

const KEYS: [&str; 5] = ["terms_url", "guidelines_url", "privacy_url", "safety_contact", "legal_contact"];

pub async fn load(db: &PgPool) -> Policies {
    let rows: Vec<(String, Value)> = sqlx::query_as("SELECT key, value FROM instance_settings WHERE key LIKE 'policy\\_%'").fetch_all(db).await.unwrap_or_default();
    let mut p = Policies::default();
    for (k, v) in rows {
        let s = v.as_str().unwrap_or("").to_string();
        match k.as_str() {
            "policy_terms_url" => p.terms_url = s,
            "policy_guidelines_url" => p.guidelines_url = s,
            "policy_privacy_url" => p.privacy_url = s,
            "policy_safety_contact" => p.safety_contact = s,
            "policy_legal_contact" => p.legal_contact = s,
            _ => {}
        }
    }
    p
}

async fn public(State(state): State<AppState>) -> Json<Policies> {
    Json(load(&state.db).await)
}

async fn admin_get(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Policies>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    Ok(Json(load(&state.db).await))
}

fn web(what: &str, v: &str) -> AppResult<String> {
    let v = v.trim();
    if v.is_empty() { return Ok(String::new()) }
    if v.len() > 500 || !(v.starts_with("https://") || v.starts_with("http://")) || v.chars().any(char::is_whitespace) {
        return Err(AppError::BadRequest(format!("{what} must be a web address starting with https://")));
    }
    Ok(v.to_string())
}

/// An email address or a web address.
fn contact(what: &str, v: &str) -> AppResult<String> {
    let v = v.trim();
    if v.is_empty() { return Ok(String::new()) }
    let mail = v.len() <= 254 && v.split_once('@').map(|(a, b)| !a.is_empty() && b.contains('.') && !v.chars().any(|c| c.is_whitespace() || c == '<' || c == '>')).unwrap_or(false) && !v.contains("://");
    if mail { return Ok(v.to_string()) }
    web(what, v).map_err(|_| AppError::BadRequest(format!("{what} must be an email address or a web address starting with https://")))
}

async fn admin_put(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<Policies>) -> AppResult<Json<Policies>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let new = Policies {
        terms_url: web("The terms address", &req.terms_url)?,
        guidelines_url: web("The guidelines address", &req.guidelines_url)?,
        privacy_url: web("The privacy notice address", &req.privacy_url)?,
        safety_contact: contact("The safety contact", &req.safety_contact)?,
        legal_contact: contact("The contact for lawful requests", &req.legal_contact)?,
    };
    let before = load(&state.db).await;
    let values = [&new.terms_url, &new.guidelines_url, &new.privacy_url, &new.safety_contact, &new.legal_contact];
    for (k, v) in KEYS.iter().zip(values) {
        sqlx::query("INSERT INTO instance_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(format!("policy_{k}")).bind(json!(v)).execute(&state.db).await?;
    }
    if before != new { audit::record(&state, uid, "policies.update", "instance", None, "", json!(new)).await; }
    Ok(Json(new))
}
