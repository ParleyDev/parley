//! Relayed voice for people behind strict networks, through Cloudflare's TURN service. An admin pastes a TURN key ID
//! and API token into Instance Settings; the server then trades them for short-lived TURN credentials and hands those
//! to clients with the instance's own ICE_SERVERS. Clients fetch them again on every call join (`GET /voice/ice-servers`),
//! so nobody is left with an expired login. Without a key, or when Cloudflare can't be reached, calls use ICE_SERVERS alone.

use crate::{auth::AuthUser, error::AppResult, state::AppState};
use axum::{extract::State, routing::get, Json, Router};
use serde_json::Value;
use std::{
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

/// How long Cloudflare's credentials last, and how long we hand out the same set before asking again.
const TTL_SECS: u64 = 24 * 3600;
const REUSE: Duration = Duration::from_secs(6 * 3600);
const CF_API: &str = "https://rtc.live.cloudflare.com";

pub fn router() -> Router<AppState> {
    Router::new().route("/voice/ice-servers", get(list))
}

async fn list(State(state): State<AppState>, AuthUser(_): AuthUser) -> AppResult<Json<Value>> {
    Ok(Json(ice_servers(&state).await))
}

struct Cached { key: String, at: Instant, servers: Vec<Value> }
fn cache() -> &'static Mutex<Option<Cached>> { static C: OnceLock<Mutex<Option<Cached>>> = OnceLock::new(); C.get_or_init(|| Mutex::new(None)) }
fn http() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().timeout(Duration::from_secs(5)).redirect(reqwest::redirect::Policy::none()).build().unwrap_or_default())
}

/// ICE_SERVERS plus, when a Cloudflare TURN key is set, its relays.
pub async fn ice_servers(state: &AppState) -> Value {
    let mut out: Vec<Value> = state.config.ice_servers.as_array().cloned().unwrap_or_default();
    let s = match crate::routes::admin::load_settings(&state.db).await { Ok(s) => s, Err(_) => return Value::Array(out) };
    if !s.turn_configured() { return Value::Array(out) }
    match relays(&s.cf_turn_key_id, &s.cf_turn_api_token, &s.cf_turn_endpoint, false).await {
        Ok(r) => out.extend(r),
        Err(e) => tracing::warn!(error = %e, "Cloudflare TURN credentials unavailable; calls use ICE_SERVERS only"),
    }
    Value::Array(out)
}

/// Cloudflare's relays for this key: cached for a few hours, fetched fresh when `fresh` (checking a new key).
pub async fn relays(key_id: &str, token: &str, endpoint: &str, fresh: bool) -> Result<Vec<Value>, String> {
    let ck = format!("{key_id}\n{token}\n{endpoint}");
    if !fresh {
        if let Some(c) = cache().lock().unwrap().as_ref() {
            if c.key == ck && c.at.elapsed() < REUSE { return Ok(c.servers.clone()) }
        }
    }
    let base = if endpoint.trim().is_empty() { CF_API } else { endpoint.trim().trim_end_matches('/') };
    let res = http()
        .post(format!("{base}/v1/turn/keys/{}/credentials/generate-ice-servers", key_id.trim()))
        .bearer_auth(token.trim())
        .json(&serde_json::json!({ "ttl": TTL_SECS }))
        .send().await.map_err(|e| format!("couldn't reach Cloudflare: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        return Err(if status.as_u16() == 401 || status.as_u16() == 403 || status.as_u16() == 404 { "Cloudflare didn't accept that TURN key ID and API token".into() } else { format!("Cloudflare answered {status}") });
    }
    let body: Value = res.json().await.map_err(|e| format!("unexpected answer from Cloudflare: {e}"))?;
    let servers = clean(&body["iceServers"]);
    if servers.is_empty() { return Err("Cloudflare returned no TURN servers".into()) }
    *cache().lock().unwrap() = Some(Cached { key: ck, at: Instant::now(), servers: servers.clone() });
    Ok(servers)
}

/// Cloudflare's answer is an RTCIceServer or a list of them. Browsers block port 53, and trying those URLs only
/// slows down connecting, so they are dropped (as Cloudflare advises).
fn clean(v: &Value) -> Vec<Value> {
    let list = match v { Value::Array(a) => a.clone(), Value::Object(_) => vec![v.clone()], _ => vec![] };
    list.into_iter().filter_map(|mut s| {
        let urls: Vec<Value> = match &s["urls"] { Value::String(u) => vec![Value::String(u.clone())], Value::Array(a) => a.clone(), _ => vec![] };
        let kept: Vec<Value> = urls.into_iter().filter(|u| u.as_str().is_some_and(|u| !u.split('?').next().unwrap_or(u).ends_with(":53"))).collect();
        if kept.is_empty() { return None }
        s["urls"] = Value::Array(kept);
        Some(s)
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn port_53_is_dropped_and_shapes_are_normalised() {
        let one = clean(&json!({ "urls": ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], "username": "u", "credential": "c" }));
        assert_eq!(one.len(), 1);
        assert_eq!(one[0]["urls"], json!(["stun:stun.cloudflare.com:3478", "turns:turn.cloudflare.com:443?transport=tcp"]));
        assert_eq!(one[0]["username"], "u");
        assert_eq!(clean(&json!([{ "urls": "turn:x:53" }, { "urls": "turn:x:3478" }])), vec![json!({ "urls": ["turn:x:3478"] })]);
        assert!(clean(&json!(null)).is_empty());
    }
}
