//! Developer applications: OAuth2 apps (authorization code flow with scopes) and bot accounts.
//! Users see what they authorised under Settings → Authorized Apps and can revoke it.

use crate::{auth::AuthUser, error::{AppError, AppResult}, models::{PrivateUser, User}, state::AppState};
use axum::{extract::{Path, Query, State}, http::StatusCode, routing::{get, post}, Form, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/applications", get(list_apps).post(create_app))
        .route("/applications/:id", get(get_app).patch(update_app).delete(delete_app))
        .route("/applications/:id/reset-secret", post(reset_secret))
        .route("/applications/:id/bot", post(create_bot))
        .route("/applications/:id/bot/reset-token", post(reset_bot_token))
        .route("/oauth2/authorize", get(authorize_info).post(authorize))
        .route("/oauth2/token", post(token))
        .route("/oauth2/@me", get(oauth_me))
        .route("/users/@me/authorized-apps", get(authorized_apps))
        .route("/users/@me/authorized-apps/:app", axum::routing::delete(deauthorize))
}

/// Scopes an app may ask for, with what each lets it do.
pub const SCOPES: [(&str, &str); 6] = [
    ("identify", "Read your username, display name and avatar"),
    ("email", "Read your email address"),
    ("guilds", "See which servers you are in"),
    ("messages.read", "Read messages in channels you can see"),
    ("messages.write", "Send messages as you"),
    ("bot", "Add the app's bot to a server you manage"),
];

pub fn hash(token: &str) -> String { format!("{:x}", Sha256::digest(token.as_bytes())) }
fn secret(prefix: &str) -> String { format!("{prefix}_{}", crate::mail::new_token()) }

#[derive(Serialize, sqlx::FromRow, Clone)]
pub struct App { pub id: Uuid, pub owner_id: Uuid, pub name: String, pub description: String, pub client_id: String, pub redirect_uris: Vec<String>, pub bot_user_id: Option<Uuid>, pub created_at: chrono::DateTime<chrono::Utc>, #[sqlx(default)] pub privileged_intents: i32 }
const APP_COLS: &str = "id, owner_id, name, description, client_id, redirect_uris, bot_user_id, created_at, privileged_intents";

async fn own(state: &AppState, uid: Uuid, id: Uuid) -> AppResult<App> {
    sqlx::query_as::<_, App>(&format!("SELECT {APP_COLS} FROM applications WHERE id = $1 AND owner_id = $2")).bind(id).bind(uid).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Application not found".into()))
}
async fn by_client(state: &AppState, client_id: &str) -> AppResult<App> {
    sqlx::query_as::<_, App>(&format!("SELECT {APP_COLS} FROM applications WHERE client_id = $1")).bind(client_id).fetch_optional(&state.db).await?.ok_or_else(|| AppError::BadRequest("Unknown client_id".into()))
}

async fn list_apps(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<App>>> {
    Ok(Json(sqlx::query_as::<_, App>(&format!("SELECT {APP_COLS} FROM applications WHERE owner_id = $1 ORDER BY created_at")).bind(uid).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
struct AppReq {
    name: Option<String>,
    description: Option<String>,
    redirect_uris: Option<Vec<String>>,
    /// Privileged gateway intents the bot may ask for: server members (1<<1), presences (1<<8), message content (1<<15).
    #[serde(default)]
    privileged_intents: Option<u32>,
}

fn clean_uris(list: &[String]) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    for u in list {
        let u = u.trim();
        if u.is_empty() { continue }
        if !(u.starts_with("http://") || u.starts_with("https://")) || u.contains('#') { return Err(AppError::BadRequest(format!("Redirect URI must be an http(s) URL without a fragment: {u}"))) }
        if !out.contains(&u.to_string()) { out.push(u.to_string()) }
    }
    if out.len() > 10 { return Err(AppError::BadRequest("At most 10 redirect URIs".into())) }
    Ok(out)
}

/// Create an app; the client secret is returned once, here.
async fn create_app(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<AppReq>) -> AppResult<(StatusCode, Json<Value>)> {
    let name = req.name.unwrap_or_default().trim().to_string();
    if name.is_empty() || name.chars().count() > 50 { return Err(AppError::BadRequest("Name must be 1–50 characters".into())) }
    let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM applications WHERE owner_id = $1").bind(uid).fetch_one(&state.db).await?;
    if count >= 25 { return Err(AppError::BadRequest("You already have 25 applications".into())) }
    let id = Uuid::now_v7();
    let client_id = format!("app_{}", &Uuid::now_v7().simple().to_string()[..20]);
    let sec = secret("sec");
    let uris = clean_uris(&req.redirect_uris.unwrap_or_default())?;
    let app = sqlx::query_as::<_, App>(&format!("INSERT INTO applications (id, owner_id, name, description, client_id, client_secret_hash, redirect_uris) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING {APP_COLS}"))
        .bind(id).bind(uid).bind(&name).bind(req.description.unwrap_or_default().trim().chars().take(400).collect::<String>()).bind(&client_id).bind(hash(&sec)).bind(&uris).fetch_one(&state.db).await?;
    let mut v = json!(app); v["client_secret"] = json!(sec);
    Ok((StatusCode::CREATED, Json(v)))
}

async fn get_app(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let app = own(&state, uid, id).await?;
    let mut v = json!(app);
    if let Some(b) = app.bot_user_id { v["bot"] = json!(sqlx::query_as::<_, User>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::USER_COLS)).bind(b).fetch_optional(&state.db).await?); }
    let (users,): (i64,) = sqlx::query_as("SELECT count(DISTINCT user_id) FROM oauth_tokens WHERE app_id = $1 AND kind = 'user' AND revoked_at IS NULL").bind(id).fetch_one(&state.db).await?;
    v["authorized_users"] = json!(users);
    Ok(Json(v))
}

async fn update_app(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<AppReq>) -> AppResult<Json<App>> {
    own(&state, uid, id).await?;
    if let Some(n) = &req.name { if n.trim().is_empty() || n.chars().count() > 50 { return Err(AppError::BadRequest("Name must be 1–50 characters".into())) } }
    let uris = match &req.redirect_uris { Some(l) => Some(clean_uris(l)?), None => None };
    let app = sqlx::query_as::<_, App>(&format!("UPDATE applications SET name = COALESCE($2, name), description = COALESCE($3, description), redirect_uris = COALESCE($4, redirect_uris), privileged_intents = COALESCE($5, privileged_intents) WHERE id = $1 RETURNING {APP_COLS}"))
        .bind(id).bind(req.name.map(|n| n.trim().to_string())).bind(req.description.map(|d| d.trim().chars().take(400).collect::<String>())).bind(uris)
        .bind(req.privileged_intents.map(|i| (i & crate::ws::intents::PRIVILEGED) as i32)).fetch_one(&state.db).await?;
    if let Some(b) = app.bot_user_id { sqlx::query("UPDATE users SET display_name = $2 WHERE id = $1 AND bot").bind(b).bind(&app.name).execute(&state.db).await?; }
    Ok(Json(app))
}

/// Deleting an app revokes every token and removes its bot account.
async fn delete_app(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let app = own(&state, uid, id).await?;
    sqlx::query("DELETE FROM applications WHERE id = $1").bind(id).execute(&state.db).await?;
    if let Some(b) = app.bot_user_id { crate::routes::admin::delete_account(&state, b).await?; }
    Ok(StatusCode::NO_CONTENT)
}

async fn reset_secret(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    own(&state, uid, id).await?;
    let sec = secret("sec");
    sqlx::query("UPDATE applications SET client_secret_hash = $2 WHERE id = $1").bind(id).bind(hash(&sec)).execute(&state.db).await?;
    Ok(Json(json!({ "client_secret": sec })))
}

/// Create the app's bot account (a user that can only act through its token) and return the token once.
async fn create_bot(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let app = own(&state, uid, id).await?;
    if app.bot_user_id.is_some() { return Err(AppError::Conflict("This app already has a bot".into())) }
    let base: String = app.name.to_lowercase().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(24).collect();
    let username = format!("{}_bot_{}", if base.is_empty() { "app".to_string() } else { base }, &app.client_id[4..10]);
    let bot_id = Uuid::now_v7();
    sqlx::query("INSERT INTO users (id, username, display_name, email, password_hash, bot, email_verified_at) VALUES ($1, $2, $3, $4, $5, true, now())")
        .bind(bot_id).bind(&username).bind(&app.name).bind(format!("{}@bots.invalid", app.client_id)).bind(crate::auth::hash_password(&crate::mail::new_token())?).execute(&state.db).await?;
    sqlx::query("UPDATE applications SET bot_user_id = $2 WHERE id = $1").bind(id).bind(bot_id).execute(&state.db).await?;
    let tok = issue_token(&state, id, bot_id, "bot", &["bot".into()]).await?;
    let bot = sqlx::query_as::<_, User>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::USER_COLS)).bind(bot_id).fetch_one(&state.db).await?;
    Ok(Json(json!({ "bot": bot, "token": tok })))
}

async fn reset_bot_token(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let app = own(&state, uid, id).await?;
    let bot = app.bot_user_id.ok_or_else(|| AppError::NotFound("This app has no bot".into()))?;
    sqlx::query("UPDATE oauth_tokens SET revoked_at = now() WHERE app_id = $1 AND kind = 'bot' AND revoked_at IS NULL").bind(id).execute(&state.db).await?;
    state.hub.session_forget_user(bot);
    Ok(Json(json!({ "token": issue_token(&state, id, bot, "bot", &["bot".into()]).await? })))
}

/// Mint an opaque token (stored hashed) and return it.
async fn issue_token(state: &AppState, app_id: Uuid, user_id: Uuid, kind: &str, scopes: &[String]) -> AppResult<String> {
    let tok = secret(if kind == "bot" { "bot" } else { "oa" });
    sqlx::query("INSERT INTO oauth_tokens (id, token_hash, app_id, user_id, kind, scopes) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(Uuid::now_v7()).bind(hash(&tok)).bind(app_id).bind(user_id).bind(kind).bind(scopes).execute(&state.db).await?;
    Ok(tok)
}

// ---- OAuth2 ------------------------------------------------------------------------------------------

#[derive(Deserialize)]
struct AuthorizeQ { client_id: String, redirect_uri: Option<String>, scope: Option<String>, state: Option<String>, guild_id: Option<Uuid> }

fn parse_scopes(s: &str) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    for sc in s.split(|c: char| c == ' ' || c == ',').map(str::trim).filter(|x| !x.is_empty()) {
        if !SCOPES.iter().any(|(k, _)| *k == sc) { return Err(AppError::BadRequest(format!("Unknown scope {sc}"))) }
        if !out.contains(&sc.to_string()) { out.push(sc.to_string()) }
    }
    if out.is_empty() { out.push("identify".into()) }
    Ok(out)
}

/// What the consent page shows: the app, the scopes with their meaning, and (for the bot scope) the servers the
/// user can add it to.
async fn authorize_info(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<AuthorizeQ>) -> AppResult<Json<Value>> {
    let app = by_client(&state, &q.client_id).await?;
    let scopes = parse_scopes(q.scope.as_deref().unwrap_or("identify"))?;
    let redirect = pick_redirect(&app, q.redirect_uri.as_deref())?;
    let owner = sqlx::query_as::<_, User>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::USER_COLS)).bind(app.owner_id).fetch_optional(&state.db).await?;
    let guilds: Vec<(Uuid, String, Option<String>)> = if scopes.iter().any(|s| s == "bot") {
        sqlx::query_as("SELECT g.id, g.name, g.icon_url FROM guilds g JOIN guild_members m ON m.guild_id = g.id AND m.user_id = $1 ORDER BY g.name").bind(uid).fetch_all(&state.db).await?
    } else { Vec::new() };
    let mut manageable = Vec::new();
    for (gid, name, icon) in guilds {
        let p = crate::perms::guild_perms(&state.db, gid, uid).await.map(|x| x.1).unwrap_or(0);
        if crate::perms::has(p, crate::perms::MANAGE_GUILD) { manageable.push(json!({ "id": gid, "name": name, "icon_url": icon })); }
    }
    Ok(Json(json!({
        "app": { "id": app.id, "name": app.name, "description": app.description, "client_id": app.client_id, "has_bot": app.bot_user_id.is_some(), "owner": owner },
        "scopes": scopes.iter().map(|s| json!({ "id": s, "description": SCOPES.iter().find(|(k, _)| k == s).map(|x| x.1).unwrap_or("") })).collect::<Vec<_>>(),
        "redirect_uri": redirect, "state": q.state, "guilds": manageable,
    })))
}

fn pick_redirect(app: &App, want: Option<&str>) -> AppResult<String> {
    match want {
        Some(u) if app.redirect_uris.iter().any(|r| r == u) => Ok(u.to_string()),
        Some(_) => Err(AppError::BadRequest("redirect_uri is not registered for this application".into())),
        None => app.redirect_uris.first().cloned().ok_or_else(|| AppError::BadRequest("This application has no redirect URI".into())),
    }
}

#[derive(Deserialize)]
struct AuthorizeReq { client_id: String, redirect_uri: Option<String>, scope: Option<String>, state: Option<String>, guild_id: Option<Uuid> }

/// The user approved: mint a one-minute code and (with the bot scope) add the bot to the chosen server.
async fn authorize(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<AuthorizeReq>) -> AppResult<Json<Value>> {
    let app = by_client(&state, &req.client_id).await?;
    let scopes = parse_scopes(req.scope.as_deref().unwrap_or("identify"))?;
    let redirect = pick_redirect(&app, req.redirect_uri.as_deref())?;
    if scopes.iter().any(|s| s == "bot") {
        let gid = req.guild_id.ok_or_else(|| AppError::BadRequest("Pick a server to add the bot to".into()))?;
        let bot = app.bot_user_id.ok_or_else(|| AppError::BadRequest("This application has no bot".into()))?;
        let p = crate::perms::guild_perms(&state.db, gid, uid).await?.1;
        if !crate::perms::has(p, crate::perms::MANAGE_GUILD) { return Err(AppError::Forbidden) }
        let inserted = sqlx::query("INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(gid).bind(bot).execute(&state.db).await?.rows_affected();
        if inserted > 0 {
            if let Ok(member) = crate::routes::guilds::fetch_member(&state.db, gid, bot).await { state.hub.emit_guild(gid, "GUILD_MEMBER_ADD", json!(member)); }
            let _ = crate::routes::channels::guild_system_message(&state, gid, bot, "member_join", "joined the server.").await;
        }
    }
    let code = crate::mail::new_token();
    sqlx::query("INSERT INTO oauth_codes (code, app_id, user_id, scopes, redirect_uri, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval '1 minute')")
        .bind(&code).bind(app.id).bind(uid).bind(&scopes).bind(&redirect).execute(&state.db).await?;
    let mut u = url::Url::parse(&redirect).map_err(|_| AppError::BadRequest("Bad redirect URI".into()))?;
    u.query_pairs_mut().append_pair("code", &code);
    if let Some(st) = &req.state { u.query_pairs_mut().append_pair("state", st); }
    Ok(Json(json!({ "redirect": u.to_string() })))
}

#[derive(Deserialize)]
struct TokenReq { grant_type: String, code: Option<String>, client_id: String, client_secret: String, redirect_uri: Option<String> }

/// Swap a code for a user token (the app's secret proves the app). JSON like the big providers.
async fn token(State(state): State<AppState>, Form(req): Form<TokenReq>) -> AppResult<Json<Value>> {
    if req.grant_type != "authorization_code" { return Err(AppError::BadRequest("unsupported_grant_type".into())) }
    let app = by_client(&state, &req.client_id).await?;
    let (hash_db,): (String,) = sqlx::query_as("SELECT client_secret_hash FROM applications WHERE id = $1").bind(app.id).fetch_one(&state.db).await?;
    if hash(&req.client_secret) != hash_db { return Err(AppError::Unauthorized) }
    let code = req.code.ok_or_else(|| AppError::BadRequest("code required".into()))?;
    let row: Option<(Uuid, Vec<String>, String)> = sqlx::query_as("UPDATE oauth_codes SET used_at = now() WHERE code = $1 AND app_id = $2 AND used_at IS NULL AND expires_at > now() RETURNING user_id, scopes, redirect_uri")
        .bind(&code).bind(app.id).fetch_optional(&state.db).await?;
    let (uid, scopes, redirect) = row.ok_or_else(|| AppError::BadRequest("invalid_grant".into()))?;
    if let Some(r) = &req.redirect_uri { if *r != redirect { return Err(AppError::BadRequest("invalid_grant: redirect_uri mismatch".into())) } }
    let tok = issue_token(&state, app.id, uid, "user", &scopes).await?;
    Ok(Json(json!({ "access_token": tok, "token_type": "Bearer", "scope": scopes.join(" "), "expires_in": Value::Null })))
}

/// For an app token: which app, which user, which scopes.
async fn oauth_me(State(state): State<AppState>, parts: axum::http::request::Parts) -> AppResult<Json<Value>> {
    let header = parts.headers.get(axum::http::header::AUTHORIZATION).and_then(|v| v.to_str().ok()).unwrap_or("");
    let raw = header.strip_prefix("Bearer ").or_else(|| header.strip_prefix("Bot ")).ok_or(AppError::Unauthorized)?;
    let row: Option<(Uuid, Uuid, Vec<String>, String)> = sqlx::query_as("SELECT app_id, user_id, scopes, kind FROM oauth_tokens WHERE token_hash = $1 AND revoked_at IS NULL").bind(hash(raw)).fetch_optional(&state.db).await?;
    let (app_id, uid, scopes, kind) = row.ok_or(AppError::Unauthorized)?;
    let app = sqlx::query_as::<_, App>(&format!("SELECT {APP_COLS} FROM applications WHERE id = $1")).bind(app_id).fetch_one(&state.db).await?;
    let user = sqlx::query_as::<_, User>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::USER_COLS)).bind(uid).fetch_one(&state.db).await?;
    Ok(Json(json!({ "application": { "id": app.id, "name": app.name, "client_id": app.client_id }, "user": user, "scopes": scopes, "kind": kind })))
}

/// Settings → Authorized Apps: apps holding a live token for you, with their scopes.
async fn authorized_apps(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Value>>> {
    let rows: Vec<(Uuid, String, String, Option<String>, Vec<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT a.id, a.name, a.description, o.display_name, array_agg(DISTINCT s) AS scopes, min(t.created_at)
         FROM oauth_tokens t JOIN applications a ON a.id = t.app_id LEFT JOIN users o ON o.id = a.owner_id, unnest(t.scopes) s
         WHERE t.user_id = $1 AND t.kind = 'user' AND t.revoked_at IS NULL GROUP BY a.id, a.name, a.description, o.display_name ORDER BY min(t.created_at)").bind(uid).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(id, name, desc, owner, scopes, since)| json!({ "id": id, "name": name, "description": desc, "owner": owner, "scopes": scopes, "since": since })).collect()))
}

async fn deauthorize(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(app): Path<Uuid>) -> AppResult<StatusCode> {
    let n = sqlx::query("UPDATE oauth_tokens SET revoked_at = now() WHERE user_id = $1 AND app_id = $2 AND kind = 'user' AND revoked_at IS NULL").bind(uid).bind(app).execute(&state.db).await?.rows_affected();
    if n == 0 { return Err(AppError::NotFound("Not authorised".into())) }
    state.hub.session_forget_user(uid);
    Ok(StatusCode::NO_CONTENT)
}

/// Resolve an opaque app/bot token into the acting user, checking its scope against the request. Returns
/// None when the header is not an app token at all (so the JWT path runs).
pub async fn resolve_token(state: &AppState, header: &str, method: &axum::http::Method, path: &str) -> AppResult<Option<Uuid>> {
    // MCP access tokens (AI assistants): only the REST calls their scopes' tools make (mcp::rest_allows).
    if let Some(raw) = header.strip_prefix("Bearer ").filter(|t| t.starts_with("mcp_")) {
        let Some((uid, _, scopes)) = crate::mcp::oauth::resolve(state, raw).await? else { return Err(AppError::Unauthorized) };
        if !crate::mcp::rest_allows(&scopes, method, path) { return Err(AppError::Forbidden); }
        return Ok(Some(uid));
    }
    let raw = match header.strip_prefix("Bot ") { Some(t) => t, None => match header.strip_prefix("Bearer ") { Some(t) if t.starts_with("oa_") || t.starts_with("bot_") => t, _ => return Ok(None) } };
    let row: Option<(Uuid, Vec<String>, String, Uuid)> = sqlx::query_as("SELECT user_id, scopes, kind, id FROM oauth_tokens WHERE token_hash = $1 AND revoked_at IS NULL").bind(hash(raw)).fetch_optional(&state.db).await?;
    let Some((uid, scopes, kind, tid)) = row else { return Err(AppError::Unauthorized) };
    if kind == "user" && !scope_allows(&scopes, method, path) {
        return Err(AppError::Forbidden);
    }
    let _ = sqlx::query("UPDATE oauth_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')").bind(tid).execute(&state.db).await;
    Ok(Some(uid))
}

/// Coarse scope map for user tokens (bots act as their own user and skip this).
fn scope_allows(scopes: &[String], method: &axum::http::Method, path: &str) -> bool {
    let has = |s: &str| scopes.iter().any(|x| x == s);
    let get = method == axum::http::Method::GET;
    // Inside the router the /api prefix is already stripped; accept both spellings.
    let stripped = path.strip_prefix("/api").unwrap_or(path);
    let path = &format!("/api{stripped}");
    if path == "/api/oauth2/@me" { return true }
    if path == "/api/users/@me" && get { return has("identify") || has("email") }
    if path.starts_with("/api/users/@me/guilds") || (path == "/api/guilds" && get) { return has("guilds") }
    if path.starts_with("/api/channels/") && path.contains("/messages") { return if get { has("messages.read") } else { has("messages.write") } }
    if path.starts_with("/api/users/") && get { return has("identify") }
    false
}

/// Public user view of a bot (bot flag on).
pub async fn is_bot(db: &sqlx::PgPool, uid: Uuid) -> bool {
    sqlx::query_as::<_, (bool,)>("SELECT bot FROM users WHERE id = $1").bind(uid).fetch_optional(db).await.ok().flatten().map(|x| x.0).unwrap_or(false)
}

#[allow(dead_code)]
fn _unused(_: PrivateUser) {}
