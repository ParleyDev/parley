//! Parley as a remote MCP server (Model Context Protocol, Streamable HTTP transport) at `POST /mcp`. AI assistants
//! connect with OAuth (see `oauth.rs`) and act as the user who approved them, within the scopes they were granted.
//!
//! Every tool is a thin wrapper over Parley's own REST API, called in-process with the client's token: permission
//! checks, events and side effects are exactly what the app does, and the token's scopes are enforced on the REST
//! side too (`rest_allows`), so an MCP token is never more powerful than its tools. The server is stateless: no
//! `Mcp-Session-Id`, one JSON response per POST, and no server-initiated stream (`GET /mcp` is 405).
pub mod oauth;
mod tools;

use crate::{auth::AuthUser, error::AppResult, state::AppState};
use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::OnceLock;
use uuid::Uuid;

/// Protocol revisions this server speaks, newest first.
const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/// The API router (no `/api` prefix), for tools to call in-process. Set once at startup.
static INTERNAL: OnceLock<Router> = OnceLock::new();
pub fn set_internal(api: Router) { let _ = INTERNAL.set(api); }

/// Public, cross-origin endpoints at the root of the site: MCP itself and the OAuth discovery/registration/token
/// endpoints MCP clients call (some from a browser). The web client's nginx forwards these paths to the backend.
pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/mcp", post(endpoint).get(no_stream).delete(no_stream))
        .route("/.well-known/oauth-protected-resource", get(oauth::protected_resource))
        .route("/.well-known/oauth-protected-resource/mcp", get(oauth::protected_resource))
        .route("/.well-known/oauth-authorization-server", get(oauth::authorization_server))
        .route("/oauth/register", post(oauth::register))
        .route("/oauth/authorize", get(oauth::authorize_redirect))
        .route("/oauth/token", post(oauth::token))
}

/// Signed-in (web client) endpoints under `/api`: the consent page, the user's connections, and unread summaries.
pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/mcp/consent", get(oauth::consent_info).post(oauth::consent))
        .route("/users/@me/mcp-grants", get(oauth::list_grants))
        .route("/users/@me/mcp-grants/:id", delete(oauth::revoke_grant))
        .route("/users/@me/unreads", get(unreads))
}

// ---- REST scope enforcement for MCP tokens ---------------------------------------------------------------

/// (method, path pattern, scope): the only REST calls an MCP token may make. `*` matches one path segment.
const REST_ALLOW: &[(&str, &str, &str)] = &[
    ("GET", "/users/@me", "mcp.read"),
    ("GET", "/users/@me/channels", "mcp.read"),
    ("GET", "/users/search", "mcp.read"),
    ("GET", "/users/*", "mcp.read"),
    ("GET", "/guilds", "mcp.read"),
    ("GET", "/guilds/*", "mcp.read"),
    ("GET", "/guilds/*/channels", "mcp.read"),
    ("GET", "/guilds/*/members", "mcp.read"),
    ("GET", "/channels/*", "mcp.read"),
    ("GET", "/channels/*/messages", "mcp.read"),
    ("GET", "/channels/*/pins", "mcp.read"),
    ("GET", "/channels/*/threads", "mcp.read"),
    ("GET", "/channels/*/threads/*", "mcp.read"),
    ("GET", "/channels/*/search", "mcp.read"),
    ("GET", "/search", "mcp.read"),
    ("GET", "/users/@me/unreads", "mcp.notifications"),
    ("GET", "/users/@me/mentions", "mcp.notifications"),
    ("PUT", "/channels/*/read", "mcp.notifications"),
    ("POST", "/channels/*/messages", "mcp.send"),
    ("PATCH", "/channels/*/messages/*", "mcp.send"),
    ("PUT", "/channels/*/messages/*/reactions/*", "mcp.send"),
    ("DELETE", "/channels/*/messages/*/reactions/*", "mcp.send"),
    ("POST", "/users/@me/channels", "mcp.send"),
    ("POST", "/channels/*/threads", "mcp.send"),
    ("POST", "/guilds/*/channels", "mcp.manage"),
    ("PATCH", "/channels/*", "mcp.manage"),
    ("PUT", "/channels/*/pins/*", "mcp.manage"),
    ("DELETE", "/channels/*/pins/*", "mcp.manage"),
    ("DELETE", "/channels/*/messages/*", "mcp.manage"),
    ("PUT", "/guilds/*/members/*/timeout", "mcp.manage"),
    ("DELETE", "/guilds/*/members/*/timeout", "mcp.manage"),
    ("DELETE", "/guilds/*/members/*", "mcp.manage"),
    ("GET", "/guilds/*/bans", "mcp.manage"),
    ("PUT", "/guilds/*/bans/*", "mcp.manage"),
    ("DELETE", "/guilds/*/bans/*", "mcp.manage"),
    ("POST", "/guilds/*/invites", "mcp.manage"),
];

/// Whether an MCP token with `scopes` may make this REST call. Paths with or without the `/api` prefix.
pub fn rest_allows(scopes: &[String], method: &Method, path: &str) -> bool {
    let path = path.strip_prefix("/api").unwrap_or(path);
    let segs: Vec<&str> = path.trim_end_matches('/').split('/').skip(1).collect();
    REST_ALLOW.iter().any(|(m, pat, scope)| {
        if *m != method.as_str() || !scopes.iter().any(|s| s == scope) { return false; }
        let p: Vec<&str> = pat.split('/').skip(1).collect();
        // `*` is an id-like segment: never a literal word another pattern means ("@me", "search").
        p.len() == segs.len() && p.iter().zip(&segs).all(|(a, b)| if *a == "*" { !b.is_empty() && *b != "@me" && *b != "search" } else { a == b })
    })
}

// ---- unread summary (GET /users/@me/unreads) -----------------------------------------------------------------

/// Channels and DMs with messages the user has not read yet: how many (capped at 100) and how many mention them.
/// What "what did I miss?" needs, without the WebSocket READY payload the app uses.
async fn unreads(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    let guilds: Vec<(Uuid, String)> = sqlx::query_as("SELECT g.id, g.name FROM guilds g JOIN guild_members m ON m.guild_id = g.id WHERE m.user_id = $1 ORDER BY m.joined_at").bind(uid).fetch_all(&state.db).await?;
    let mut place: std::collections::HashMap<Uuid, Value> = std::collections::HashMap::new();
    for (gid, gname) in &guilds {
        for c in crate::perms::visible_channels(&state.db, *gid, uid).await.unwrap_or_default() {
            if matches!(c.kind.as_str(), "category" | "voice" | "stage") { continue; }
            place.insert(c.id, json!({ "channel_id": c.id, "channel_name": c.name, "server_id": gid, "server_name": gname }));
        }
    }
    let dms = crate::routes::dms::list_dm_channels(&state.db, uid).await.unwrap_or_default();
    let dm_ids: Vec<Uuid> = dms.iter().filter(|d| d.request_state == "accepted").map(|d| d.channel.id).collect();
    for d in dms.iter().filter(|d| d.request_state == "accepted") {
        let with: Vec<String> = d.recipients.iter().map(|u| format!("{} (@{})", u.display_name, u.username)).collect();
        place.insert(d.channel.id, json!({ "channel_id": d.channel.id, "dm_with": with }));
    }
    let ids: Vec<Uuid> = place.keys().copied().collect();
    // Never-read channels count only the last week, so joining a busy server doesn't read as thousands unread.
    let counts: Vec<(Uuid, i64, Uuid)> = sqlx::query_as(
        "SELECT m.channel_id, LEAST(COUNT(*), 100), max(m.id::text)::uuid FROM messages m
         LEFT JOIN read_states rs ON rs.channel_id = m.channel_id AND rs.user_id = $1
         WHERE m.channel_id = ANY($2) AND m.author_id <> $1 AND m.kind = 'default'
           AND (CASE WHEN rs.last_read_msg IS NULL THEN m.created_at > now() - interval '7 days' ELSE m.id > rs.last_read_msg END)
         GROUP BY m.channel_id")
        .bind(uid).bind(&ids).fetch_all(&state.db).await?;
    let mentions: std::collections::HashMap<Uuid, i64> = crate::ws::handler::mention_counts(&state.db, uid, &ids, &dm_ids).await.into_iter().collect();
    let mut out: Vec<Value> = counts.into_iter().filter_map(|(cid, n, last)| {
        let mut v = place.get(&cid)?.clone();
        v["unread"] = json!(n);
        v["mentions"] = json!(if dm_ids.contains(&cid) { n } else { mentions.get(&cid).copied().unwrap_or(0) });
        v["last_message_id"] = json!(last);
        Some(v)
    }).collect();
    out.sort_by_key(|v| (std::cmp::Reverse(v["mentions"].as_i64().unwrap_or(0)), std::cmp::Reverse(v["unread"].as_i64().unwrap_or(0))));
    Ok(Json(json!({ "channels": out })))
}

// ---- the MCP endpoint ------------------------------------------------------------------------------------

async fn no_stream() -> Response {
    let mut r = StatusCode::METHOD_NOT_ALLOWED.into_response();
    r.headers_mut().insert(header::ALLOW, HeaderValue::from_static("POST"));
    r
}

/// 401 that tells the client where to find the authorization server (MCP authorization spec, RFC 9728 §5.1).
fn unauthorized(state: &AppState, presented: bool) -> Response {
    let mut v = format!("Bearer resource_metadata=\"{}\", scope=\"{}\"", oauth::resource_metadata_url(state), oauth::DEFAULT_SCOPES.join(" "));
    if presented { v.push_str(", error=\"invalid_token\", error_description=\"The access token is invalid or expired\""); }
    let mut r = (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response();
    if let Ok(h) = HeaderValue::from_str(&v) { r.headers_mut().insert(header::WWW_AUTHENTICATE, h); }
    r
}

fn rpc_result(id: &Value, result: Value) -> Value { json!({ "jsonrpc": "2.0", "id": id, "result": result }) }
fn rpc_error(id: &Value, code: i64, message: &str) -> Value { json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }) }

/// The caller, as tools need it: the token to forward and the client's address (for per-client rate limits).
pub struct Caller { pub auth: String, pub forwarded_for: String, pub scopes: Vec<String>, pub base: String }

async fn endpoint(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    let auth = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let Some(raw) = auth.strip_prefix("Bearer ").filter(|t| t.starts_with("mcp_")) else { return unauthorized(&state, !auth.is_empty()) };
    let scopes = match oauth::resolve(&state, raw).await {
        Ok(Some((_, _, scopes))) => scopes,
        Ok(None) => return unauthorized(&state, true),
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let caller = Caller { auth: auth.clone(), forwarded_for: headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).unwrap_or("").to_string(), scopes, base: oauth::issuer(&state) };

    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return Json(rpc_error(&Value::Null, -32700, "Parse error")).into_response(),
    };
    let (batch, msgs) = match parsed { Value::Array(a) => (true, a), v => (false, vec![v]) };
    let mut out = Vec::new();
    for m in msgs {
        if let Some(r) = handle(&caller, m).await { out.push(r); }
    }
    if out.is_empty() { return StatusCode::ACCEPTED.into_response(); } // notifications and responses only
    let body = if batch { Value::Array(out) } else { out.into_iter().next().unwrap_or(Value::Null) };
    let mut r = Json(body).into_response();
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

/// One JSON-RPC message; None for notifications (and stray responses), which get no reply.
async fn handle(caller: &Caller, m: Value) -> Option<Value> {
    let method = m.get("method").and_then(Value::as_str)?.to_string();
    let id = m.get("id").cloned()?;
    if m.get("jsonrpc").and_then(Value::as_str) != Some("2.0") { return Some(rpc_error(&id, -32600, "Invalid Request")); }
    let params = m.get("params").cloned().unwrap_or(Value::Null);
    Some(match method.as_str() {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
            let version = if PROTOCOL_VERSIONS.contains(&asked) { asked } else { PROTOCOL_VERSIONS[0] };
            rpc_result(&id, json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "parley", "title": "Parley", "version": crate::VERSION, "websiteUrl": caller.base },
                "instructions": tools::INSTRUCTIONS,
            }))
        }
        "ping" => rpc_result(&id, json!({})),
        "tools/list" => rpc_result(&id, json!({ "tools": tools::list(&caller.scopes) })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            match tools::call(caller, name, &args).await {
                tools::Outcome::Unknown => rpc_error(&id, -32602, &format!("Unknown tool: {name}")),
                tools::Outcome::Done(text) => rpc_result(&id, json!({ "content": [{ "type": "text", "text": text }], "isError": false })),
                tools::Outcome::Failed(text) => rpc_result(&id, json!({ "content": [{ "type": "text", "text": text }], "isError": true })),
            }
        }
        _ => rpc_error(&id, -32601, &format!("Method not found: {method}")),
    })
}

/// Call Parley's REST API in-process as the MCP client's user. `path` has no `/api` prefix and may carry a query.
pub async fn api(caller: &Caller, method: Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    use tower::ServiceExt;
    let router = INTERNAL.get().ok_or("server not ready")?.clone();
    let mut b = axum::http::Request::builder().method(method).uri(path).header(header::AUTHORIZATION, &caller.auth);
    if !caller.forwarded_for.is_empty() { b = b.header("x-forwarded-for", &caller.forwarded_for); }
    let req = match body {
        Some(v) => b.header(header::CONTENT_TYPE, "application/json").body(Body::from(v.to_string())),
        None => b.body(Body::empty()),
    }.map_err(|e| e.to_string())?;
    let resp = router.oneshot(req).await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 8 * 1024 * 1024).await.map_err(|e| e.to_string())?;
    let v: Value = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
    if status.is_success() { return Ok(v); }
    let msg = v.get("error").and_then(Value::as_str).unwrap_or(status.canonical_reason().unwrap_or("Request failed"));
    Err(match status {
        StatusCode::FORBIDDEN => format!("Not allowed: {msg}. You can only do what this account may do in Parley, within the permissions granted to this connection."),
        StatusCode::NOT_FOUND => format!("Not found: {msg}"),
        StatusCode::TOO_MANY_REQUESTS => format!("Rate limited: {msg}"),
        _ => format!("{msg} ({})", status.as_u16()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn s(v: &[&str]) -> Vec<String> { v.iter().map(|x| x.to_string()).collect() }

    #[test]
    fn rest_allowlist() {
        let id = "0190f0aa-0000-7000-8000-000000000001";
        let read = s(&["mcp.read"]);
        assert!(rest_allows(&read, &Method::GET, &format!("/api/channels/{id}/messages")));
        assert!(rest_allows(&read, &Method::GET, "/users/@me"));
        assert!(!rest_allows(&read, &Method::POST, &format!("/channels/{id}/messages")));
        assert!(!rest_allows(&read, &Method::GET, "/users/@me/unreads"));
        let all = s(&["mcp.read", "mcp.notifications", "mcp.send", "mcp.manage"]);
        assert!(rest_allows(&all, &Method::PUT, &format!("/channels/{id}/messages/{id}/reactions/%F0%9F%91%8D")));
        assert!(rest_allows(&all, &Method::DELETE, &format!("/guilds/{id}/members/{id}")));
        // Never, whatever the scopes: account, sessions, admin, OAuth, MCP consent and grants.
        for (m, p) in [(Method::PATCH, "/users/@me"), (Method::DELETE, "/users/@me"), (Method::POST, "/users/@me/password"), (Method::GET, "/users/@me/sessions"),
                       (Method::GET, "/admin/users"), (Method::POST, "/applications"), (Method::POST, "/mcp/consent"), (Method::GET, "/users/@me/mcp-grants"),
                       (Method::DELETE, &format!("/users/@me/mcp-grants/{id}")), (Method::DELETE, "/guilds/@me/members/@me"), (Method::DELETE, &format!("/guilds/{id}"))] {
            assert!(!rest_allows(&all, &m, p), "{m} {p}");
        }
    }
}
