//! OAuth 2.1 for MCP clients, per the MCP authorization spec: Protected Resource Metadata (RFC 9728) and
//! Authorization Server Metadata (RFC 8414) under `/.well-known/`, Dynamic Client Registration (RFC 7591), the
//! authorization code flow with PKCE (S256 only), resource indicators (RFC 8707) and rotating refresh tokens.
//! Clients are public (no secret). The consent page is the web client's `/oauth2/mcp/authorize`.
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::applications::hash,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Redirect, Response},
    Form, Json,
};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// What an MCP client may be allowed to do, with the wording the consent page shows.
pub const SCOPES: [(&str, &str); 4] = [
    ("mcp.read", "Read your servers, channels, DMs and messages, and search them"),
    ("mcp.notifications", "See your unread messages and mentions, and mark channels as read"),
    ("mcp.send", "Send, edit and react to messages and DMs as you"),
    ("mcp.manage", "Manage servers as you: create and edit channels, pin and delete messages, time out, kick and ban (only where you already have permission)"),
];
/// Granted when a client asks for no particular scope. Managing is opt-in.
pub const DEFAULT_SCOPES: [&str; 3] = ["mcp.read", "mcp.notifications", "mcp.send"];
const ACCESS_TTL_SECS: i64 = 3600;
const REFRESH_TTL_DAYS: i64 = 30;

pub fn issuer(state: &AppState) -> String { state.config.app_url.trim_end_matches('/').to_string() }
pub fn resource(state: &AppState) -> String { format!("{}/mcp", issuer(state)) }
pub fn resource_metadata_url(state: &AppState) -> String { format!("{}/.well-known/oauth-protected-resource/mcp", issuer(state)) }

/// RFC 6749 §5.2 error body.
fn oauth_error(status: StatusCode, error: &str, description: &str) -> Response {
    let mut r = (status, Json(json!({ "error": error, "error_description": description }))).into_response();
    r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

// ---- discovery ----------------------------------------------------------------------------------------

pub async fn protected_resource(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "resource": resource(&state),
        "authorization_servers": [issuer(&state)],
        "scopes_supported": SCOPES.iter().map(|s| s.0).collect::<Vec<_>>(),
        "bearer_methods_supported": ["header"],
        "resource_name": "Parley",
        "resource_documentation": "https://github.com/ParleyDev/parley#mcp-ai-assistants",
    }))
}

pub async fn authorization_server(State(state): State<AppState>) -> Json<Value> {
    let iss = issuer(&state);
    Json(json!({
        "issuer": iss,
        "authorization_endpoint": format!("{iss}/oauth/authorize"),
        "token_endpoint": format!("{iss}/oauth/token"),
        "registration_endpoint": format!("{iss}/oauth/register"),
        "scopes_supported": SCOPES.iter().map(|s| s.0).collect::<Vec<_>>(),
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["none"],
        "code_challenge_methods_supported": ["S256"],
        "authorization_response_iss_parameter_supported": true,
        "service_documentation": "https://github.com/ParleyDev/parley#mcp-ai-assistants",
    }))
}

// ---- dynamic client registration ----------------------------------------------------------------------

#[derive(Deserialize)]
pub struct RegisterReq {
    #[serde(default)]
    redirect_uris: Vec<String>,
    client_name: Option<String>,
    client_uri: Option<String>,
}

/// https anywhere; plain http only to this machine (desktop clients listen on a loopback port); app schemes such
/// as `cursor://` are fine. Never script-ish schemes or fragments.
pub fn redirect_ok(uri: &str) -> bool {
    let Ok(u) = url::Url::parse(uri) else { return false };
    if u.fragment().is_some() || uri.len() > 500 { return false; }
    match u.scheme() {
        "https" => u.host_str().is_some(),
        "http" => matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
        "javascript" | "data" | "file" | "blob" | "about" | "vbscript" | "ftp" | "ws" | "wss" => false,
        s => s.contains('.') || s.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-'),
    }
}

pub async fn register(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<RegisterReq>) -> Response {
    let ip = crate::ratelimit::client_ip(&headers);
    if let Err(retry) = crate::ratelimit::LIMITER.take("oauth", &ip, crate::ratelimit::LIMITER.limit("oauth")) {
        return crate::ratelimit::too_many(retry);
    }
    if req.redirect_uris.is_empty() || req.redirect_uris.len() > 10 {
        return oauth_error(StatusCode::BAD_REQUEST, "invalid_redirect_uri", "Give 1 to 10 redirect_uris");
    }
    if let Some(bad) = req.redirect_uris.iter().find(|u| !redirect_ok(u)) {
        return oauth_error(StatusCode::BAD_REQUEST, "invalid_redirect_uri", &format!("Not an allowed redirect URI: {bad}"));
    }
    let name: String = req.client_name.as_deref().map(str::trim).filter(|n| !n.is_empty()).unwrap_or("MCP client").chars().filter(|c| !c.is_control()).take(100).collect();
    let client_uri = req.client_uri.filter(|u| u.starts_with("https://") && u.len() <= 300);
    let client_id = format!("mcpc_{}", crate::mail::new_token());
    let res = sqlx::query("INSERT INTO mcp_clients (id, client_id, client_name, client_uri, redirect_uris) VALUES ($1, $2, $3, $4, $5)")
        .bind(Uuid::now_v7()).bind(&client_id).bind(&name).bind(&client_uri).bind(&req.redirect_uris).execute(&state.db).await;
    if res.is_err() { return oauth_error(StatusCode::INTERNAL_SERVER_ERROR, "server_error", "Could not register the client"); }
    // Registrations nobody ever approved are dropped after a week.
    let _ = sqlx::query("DELETE FROM mcp_clients c WHERE c.created_at < now() - interval '7 days' AND NOT EXISTS (SELECT 1 FROM mcp_grants g WHERE g.client_id = c.id)").execute(&state.db).await;
    let mut body = json!({
        "client_id": client_id,
        "client_id_issued_at": chrono::Utc::now().timestamp(),
        "client_name": name,
        "redirect_uris": req.redirect_uris,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });
    // RFC 7591 §3.2.1: metadata the client did not give is left out, not null (strict clients reject null).
    if let Some(u) = client_uri { body["client_uri"] = json!(u); }
    (StatusCode::CREATED, Json(body)).into_response()
}

// ---- authorization ------------------------------------------------------------------------------------

/// The authorization endpoint lives on the backend (so metadata can point at it) and hands the request, unchanged,
/// to the web client's consent page.
pub async fn authorize_redirect(State(state): State<AppState>, uri: axum::http::Uri) -> Redirect {
    let q = uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    Redirect::to(&format!("{}/oauth2/mcp/authorize{q}", issuer(&state)))
}

#[derive(Deserialize)]
pub struct AuthorizeQ {
    response_type: Option<String>,
    client_id: String,
    redirect_uri: Option<String>,
    scope: Option<String>,
    state: Option<String>,
    code_challenge: Option<String>,
    code_challenge_method: Option<String>,
    resource: Option<String>,
}

struct Client { id: Uuid, name: String, client_uri: Option<String>, redirect_uris: Vec<String> }

async fn client(state: &AppState, client_id: &str) -> AppResult<Client> {
    let row: Option<(Uuid, String, Option<String>, Vec<String>)> = sqlx::query_as("SELECT id, client_name, client_uri, redirect_uris FROM mcp_clients WHERE client_id = $1").bind(client_id).fetch_optional(&state.db).await?;
    let (id, name, client_uri, redirect_uris) = row.ok_or_else(|| AppError::BadRequest("Unknown client. Reconnect the app so it registers again.".into()))?;
    Ok(Client { id, name, client_uri, redirect_uris })
}

pub fn parse_scopes(s: Option<&str>) -> AppResult<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for sc in s.unwrap_or("").split([' ', ',']).map(str::trim).filter(|x| !x.is_empty()) {
        if !SCOPES.iter().any(|(k, _)| *k == sc) { continue; } // unknown scopes (e.g. "openid") are ignored, as RFC 6749 allows
        if !out.iter().any(|x| x == sc) { out.push(sc.to_string()); }
    }
    if out.is_empty() { out = DEFAULT_SCOPES.iter().map(|s| s.to_string()).collect(); }
    Ok(out)
}

/// Everything about an authorization request that must hold before anyone is asked to approve it.
fn check_request(state: &AppState, c: &Client, q: &AuthorizeQ) -> AppResult<String> {
    if q.response_type.as_deref().unwrap_or("code") != "code" { return Err(AppError::BadRequest("Only response_type=code is supported".into())); }
    let redirect = match q.redirect_uri.as_deref() {
        Some(u) if c.redirect_uris.iter().any(|r| r == u) => u.to_string(),
        Some(_) => return Err(AppError::BadRequest("redirect_uri is not registered for this client".into())),
        None if c.redirect_uris.len() == 1 => c.redirect_uris[0].clone(),
        None => return Err(AppError::BadRequest("redirect_uri required".into())),
    };
    let challenge = q.code_challenge.as_deref().unwrap_or("");
    if challenge.len() < 43 || challenge.len() > 128 { return Err(AppError::BadRequest("PKCE code_challenge required".into())); }
    if q.code_challenge_method.as_deref() != Some("S256") { return Err(AppError::BadRequest("code_challenge_method must be S256".into())); }
    if let Some(r) = &q.resource { if r.trim_end_matches('/') != resource(state) { return Err(AppError::BadRequest(format!("resource must be {}", resource(state)))); } }
    Ok(redirect)
}

/// What the consent page shows.
pub async fn consent_info(State(state): State<AppState>, AuthUser(_uid): AuthUser, Query(q): Query<AuthorizeQ>) -> AppResult<Json<Value>> {
    let c = client(&state, &q.client_id).await?;
    let redirect = check_request(&state, &c, &q)?;
    let wanted = parse_scopes(q.scope.as_deref())?;
    let host = url::Url::parse(&redirect).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| redirect.split(':').next().unwrap_or("").to_string());
    Ok(Json(json!({
        "client": { "name": c.name, "client_uri": c.client_uri },
        "redirect_uri": redirect, "redirect_host": host,
        "scopes": SCOPES.iter().map(|(id, d)| json!({ "id": id, "description": d, "requested": wanted.iter().any(|w| w == id) })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
pub struct ConsentReq {
    #[serde(flatten)]
    q: AuthorizeQ,
    approve: bool,
    /// The scopes the user left ticked (a subset of the four; at least one).
    #[serde(default)]
    scopes: Vec<String>,
}

/// The user's answer: a redirect back to the client with a code (or `error=access_denied`).
pub async fn consent(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<ConsentReq>) -> AppResult<Json<Value>> {
    let c = client(&state, &req.q.client_id).await?;
    let redirect = check_request(&state, &c, &req.q)?;
    let mut u = url::Url::parse(&redirect).map_err(|_| AppError::BadRequest("Bad redirect URI".into()))?;
    if !req.approve {
        u.query_pairs_mut().append_pair("error", "access_denied");
    } else {
        let scopes: Vec<String> = SCOPES.iter().map(|s| s.0.to_string()).filter(|s| req.scopes.contains(s)).collect();
        if scopes.is_empty() { return Err(AppError::BadRequest("Pick at least one permission".into())); }
        let code = crate::mail::new_token();
        sqlx::query("INSERT INTO mcp_codes (code_hash, client_id, user_id, scopes, redirect_uri, code_challenge, resource, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '5 minutes')")
            .bind(hash(&code)).bind(c.id).bind(uid).bind(&scopes).bind(&redirect).bind(req.q.code_challenge.as_deref().unwrap_or("")).bind(&req.q.resource)
            .execute(&state.db).await?;
        u.query_pairs_mut().append_pair("code", &code);
    }
    if let Some(st) = &req.q.state { u.query_pairs_mut().append_pair("state", st); }
    u.query_pairs_mut().append_pair("iss", &issuer(&state));
    Ok(Json(json!({ "redirect": u.to_string() })))
}

// ---- tokens -------------------------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct TokenReq {
    grant_type: String,
    code: Option<String>,
    redirect_uri: Option<String>,
    client_id: Option<String>,
    code_verifier: Option<String>,
    refresh_token: Option<String>,
    resource: Option<String>,
}

pub fn s256(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

async fn mint(state: &AppState, grant: Uuid, scopes: &[String]) -> AppResult<Value> {
    let access = format!("mcp_{}", crate::mail::new_token());
    let refresh = format!("mcpr_{}", crate::mail::new_token());
    sqlx::query("INSERT INTO mcp_tokens (token_hash, grant_id, kind, expires_at) VALUES ($1, $3, 'access', now() + make_interval(secs => $4)), ($2, $3, 'refresh', now() + make_interval(days => $5))")
        .bind(hash(&access)).bind(hash(&refresh)).bind(grant).bind(ACCESS_TTL_SECS as f64).bind(REFRESH_TTL_DAYS as i32).execute(&state.db).await?;
    Ok(json!({ "access_token": access, "token_type": "Bearer", "expires_in": ACCESS_TTL_SECS, "refresh_token": refresh, "scope": scopes.join(" ") }))
}

pub async fn token(State(state): State<AppState>, headers: HeaderMap, Form(req): Form<TokenReq>) -> Response {
    let ip = crate::ratelimit::client_ip(&headers);
    if let Err(retry) = crate::ratelimit::LIMITER.take("oauth", &ip, crate::ratelimit::LIMITER.limit("oauth")) {
        return crate::ratelimit::too_many(retry);
    }
    let res = match req.grant_type.as_str() {
        "authorization_code" => code_grant(&state, &req).await,
        "refresh_token" => refresh_grant(&state, &req).await,
        _ => Err(("unsupported_grant_type", "Use authorization_code or refresh_token")),
    };
    match res {
        Ok(Ok(body)) => { let mut r = Json(body).into_response(); r.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store")); r }
        Ok(Err(e)) => { tracing::error!(error = ?e, "mcp token"); oauth_error(StatusCode::INTERNAL_SERVER_ERROR, "server_error", "Try again") }
        Err((err, desc)) => oauth_error(StatusCode::BAD_REQUEST, err, desc),
    }
}

type Grant = Result<AppResult<Value>, (&'static str, &'static str)>;

async fn code_grant(state: &AppState, req: &TokenReq) -> Grant {
    let code = req.code.as_deref().ok_or(("invalid_request", "code required"))?;
    let client_id = req.client_id.as_deref().ok_or(("invalid_request", "client_id required"))?;
    let verifier = req.code_verifier.as_deref().ok_or(("invalid_request", "code_verifier required"))?;
    if req.resource.as_deref().is_some_and(|r| r.trim_end_matches('/') != resource(state)) { return Err(("invalid_target", "Unknown resource")); }
    let row: Option<(Uuid, Uuid, Vec<String>, String, String)> = sqlx::query_as(
        "UPDATE mcp_codes k SET used_at = now() FROM mcp_clients c WHERE k.code_hash = $1 AND c.id = k.client_id AND c.client_id = $2 AND k.used_at IS NULL AND k.expires_at > now()
         RETURNING k.client_id, k.user_id, k.scopes, k.redirect_uri, k.code_challenge")
        .bind(hash(code)).bind(client_id).fetch_optional(&state.db).await.map_err(|_| ("server_error", "Try again"))?;
    let (cid, uid, scopes, redirect, challenge) = row.ok_or(("invalid_grant", "The code is invalid, expired or already used"))?;
    if req.redirect_uri.as_deref().is_some_and(|r| r != redirect) { return Err(("invalid_grant", "redirect_uri does not match")); }
    if s256(verifier) != challenge { return Err(("invalid_grant", "PKCE verification failed")); }
    let gid = Uuid::now_v7();
    if sqlx::query("INSERT INTO mcp_grants (id, client_id, user_id, scopes) VALUES ($1, $2, $3, $4)").bind(gid).bind(cid).bind(uid).bind(&scopes).execute(&state.db).await.is_err() {
        return Err(("server_error", "Try again"));
    }
    let _ = sqlx::query("UPDATE mcp_clients SET last_used_at = now() WHERE id = $1").bind(cid).execute(&state.db).await;
    Ok(mint(state, gid, &scopes).await)
}

async fn refresh_grant(state: &AppState, req: &TokenReq) -> Grant {
    let raw = req.refresh_token.as_deref().ok_or(("invalid_request", "refresh_token required"))?;
    let client_id = req.client_id.as_deref().ok_or(("invalid_request", "client_id required"))?;
    type Row = (Uuid, Vec<String>, Option<chrono::DateTime<chrono::Utc>>, bool); // grant, scopes, revoked_at, live
    let row: Option<Row> = sqlx::query_as(
        "SELECT g.id, g.scopes, t.revoked_at, (t.expires_at > now() AND g.revoked_at IS NULL) FROM mcp_tokens t JOIN mcp_grants g ON g.id = t.grant_id JOIN mcp_clients c ON c.id = g.client_id
         WHERE t.token_hash = $1 AND t.kind = 'refresh' AND c.client_id = $2")
        .bind(hash(raw)).bind(client_id).fetch_optional(&state.db).await.map_err(|_| ("server_error", "Try again"))?;
    let (gid, scopes, revoked, live) = row.ok_or(("invalid_grant", "Unknown refresh token"))?;
    if revoked.is_some() {
        // A rotated-out refresh token came back: it may have leaked, so end the whole grant (OAuth 2.1 §4.3.1).
        let _ = sqlx::query("UPDATE mcp_grants SET revoked_at = now() WHERE id = $1").bind(gid).execute(&state.db).await;
        return Err(("invalid_grant", "Refresh token already used; sign in again"));
    }
    if !live { return Err(("invalid_grant", "Refresh token expired or access was revoked")); }
    let _ = sqlx::query("UPDATE mcp_tokens SET revoked_at = now() WHERE token_hash = $1").bind(hash(raw)).execute(&state.db).await;
    Ok(mint(state, gid, &scopes).await)
}

/// A live access token: (user, grant, scopes). None for unknown, expired or revoked tokens.
pub async fn resolve(state: &AppState, raw: &str) -> AppResult<Option<(Uuid, Uuid, Vec<String>)>> {
    let row: Option<(Uuid, Uuid, Vec<String>)> = sqlx::query_as(
        "SELECT g.user_id, g.id, g.scopes FROM mcp_tokens t JOIN mcp_grants g ON g.id = t.grant_id JOIN users u ON u.id = g.user_id
         WHERE t.token_hash = $1 AND t.kind = 'access' AND t.revoked_at IS NULL AND t.expires_at > now() AND g.revoked_at IS NULL
           AND u.suspended_at IS NULL AND u.disabled_at IS NULL")
        .bind(hash(raw)).fetch_optional(&state.db).await?;
    if let Some((_, gid, _)) = &row {
        let _ = sqlx::query("UPDATE mcp_grants SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')").bind(gid).execute(&state.db).await;
    }
    Ok(row)
}

// ---- the user's grants (Settings → Authorized Apps) -----------------------------------------------------

pub async fn list_grants(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Value>>> {
    type Row = (Uuid, String, Option<String>, Vec<String>, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>);
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT g.id, c.client_name, c.client_uri, g.scopes, g.created_at, g.last_used_at FROM mcp_grants g JOIN mcp_clients c ON c.id = g.client_id
         WHERE g.user_id = $1 AND g.revoked_at IS NULL ORDER BY g.created_at DESC").bind(uid).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(id, name, client_uri, scopes, since, used)| json!({ "id": id, "name": name, "client_uri": client_uri, "scopes": scopes, "since": since, "last_used_at": used })).collect()))
}

pub async fn revoke_grant(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let n = sqlx::query("UPDATE mcp_grants SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL").bind(id).bind(uid).execute(&state.db).await?.rows_affected();
    if n == 0 { return Err(AppError::NotFound("Not connected".into())); }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_s256_matches_rfc7636_example() {
        assert_eq!(s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn redirect_uris() {
        for ok in ["https://claude.ai/api/mcp/auth_callback", "http://localhost:6274/oauth/callback", "http://127.0.0.1:33418/cb", "cursor://anysphere.cursor-retrieval/oauth/callback", "vscode://x/y"] { assert!(redirect_ok(ok), "{ok}"); }
        for bad in ["http://evil.example/cb", "javascript:alert(1)", "data:text/html,x", "https://ok.example/cb#frag", "file:///etc/passwd", "not a url"] { assert!(!redirect_ok(bad), "{bad}"); }
    }

    #[test]
    fn scopes_default_and_filter() {
        assert_eq!(parse_scopes(None).unwrap(), DEFAULT_SCOPES);
        assert_eq!(parse_scopes(Some("openid mcp.manage mcp.read mcp.read")).unwrap(), ["mcp.manage", "mcp.read"]);
    }
}
