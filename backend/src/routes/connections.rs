//! Settings → Connections: link GitHub, GitLab, Twitch, Reddit and Spotify accounts with OAuth and show them on the
//! profile (and use them for linked roles). Spotify also shows what you're listening to (routes/spotify.rs).
//! Provider credentials live in Instance Settings (`oauth_providers`); `oauth_endpoint_override` points every
//! provider URL at a stub for tests.

use crate::{auth::AuthUser, error::{AppError, AppResult}, state::AppState};
use axum::{extract::{Path, Query, State}, http::StatusCode, response::{IntoResponse, Redirect, Response}, routing::{get, patch}, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/connections", get(list))
        .route("/users/@me/connections/:id", patch(update).delete(remove))
        .route("/connections/:provider/start", get(start))
        .route("/connections/:provider/callback", get(callback))
}

#[derive(Debug, Serialize, sqlx::FromRow, Clone)]
pub struct Connection {
    pub id: Uuid, pub provider: String, pub external_id: String, pub name: String, pub url: String, pub visible: bool, pub creator: bool,
    /// Spotify: share what's playing as the user's status.
    pub show_activity: bool,
    /// Spotify: the link has the access needed for that (links made before it was asked for don't).
    pub live: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}
const COLS: &str = "id, provider, external_id, name, url, visible, creator, show_activity, (access_token IS NOT NULL) AS live, created_at";

/// Everything about a provider: where to send the user, where to swap the code, where to read the profile.
/// `basic`: the token endpoint wants the client id and secret as HTTP Basic auth (Reddit, Spotify).
struct Provider { authorize: &'static str, token: &'static str, profile: &'static str, scope: &'static str, label: &'static str, basic: bool }
const GITHUB: Provider = Provider { authorize: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token", profile: "https://api.github.com/user", scope: "read:user", label: "GitHub", basic: false };
const TWITCH: Provider = Provider { authorize: "https://id.twitch.tv/oauth2/authorize", token: "https://id.twitch.tv/oauth2/token", profile: "https://api.twitch.tv/helix/users", scope: "", label: "Twitch", basic: false };
const GITLAB: Provider = Provider { authorize: "https://gitlab.com/oauth/authorize", token: "https://gitlab.com/oauth/token", profile: "https://gitlab.com/api/v4/user", scope: "read_user", label: "GitLab", basic: false };
const REDDIT: Provider = Provider { authorize: "https://www.reddit.com/api/v1/authorize", token: "https://www.reddit.com/api/v1/access_token", profile: "https://oauth.reddit.com/api/v1/me", scope: "identity", label: "Reddit", basic: true };
const SPOTIFY: Provider = Provider { authorize: "https://accounts.spotify.com/authorize", token: "https://accounts.spotify.com/api/token", profile: "https://api.spotify.com/v1/me", scope: "user-read-private user-read-currently-playing user-modify-playback-state", label: "Spotify", basic: true };
const YOUTUBE: Provider = Provider { authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", profile: "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", scope: "https://www.googleapis.com/auth/youtube.readonly", label: "YouTube", basic: false };
pub const PROVIDERS: [&str; 6] = ["github", "gitlab", "twitch", "youtube", "reddit", "spotify"];

/// Extra scopes for a creator linking their channel to a server (subscriber / channel-member lists).
fn creator_scope(name: &str) -> Option<&'static str> {
    match name {
        "twitch" => Some("channel:read:subscriptions"),
        "youtube" => Some("https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.channel-memberships.creator"),
        _ => None,
    }
}

fn provider(name: &str) -> Option<&'static Provider> { match name { "github" => Some(&GITHUB), "twitch" => Some(&TWITCH), "gitlab" => Some(&GITLAB), "reddit" => Some(&REDDIT), "spotify" => Some(&SPOTIFY), "youtube" => Some(&YOUTUBE), _ => None } }

/// Replace a provider URL's origin with the test override, when set.
pub(crate) fn with_override(url: &str, over: &str) -> String {
    if over.is_empty() { return url.to_string() }
    let path = url.splitn(4, '/').nth(3).unwrap_or("");
    format!("{}/{}", over.trim_end_matches('/'), path)
}

pub(crate) struct Creds { pub client_id: String, pub client_secret: String, pub over: String }
pub(crate) async fn creds(state: &AppState, name: &str) -> AppResult<Creds> {
    let s = crate::routes::admin::load_settings(&state.db).await?;
    let p = s.oauth_providers.get(name).cloned().unwrap_or(Value::Null);
    let id = p.get("client_id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let secret = p.get("client_secret").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if id.is_empty() || secret.is_empty() { return Err(AppError::BadRequest(format!("{name} is not set up on this server. Ask an admin to add its OAuth keys."))) }
    Ok(Creds { client_id: id, client_secret: secret, over: s.oauth_endpoint_override.trim().to_string() })
}

fn redirect_uri(state: &AppState, name: &str) -> String { format!("{}/api/connections/{name}/callback", state.config.app_url.trim_end_matches('/')) }

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Connection>>> {
    Ok(Json(sqlx::query_as::<_, Connection>(&format!("SELECT {COLS} FROM connections WHERE user_id = $1 ORDER BY created_at")).bind(uid).fetch_all(&state.db).await?))
}

/// Visible connections of a user, for their profile.
pub async fn visible_for(db: &sqlx::PgPool, uid: Uuid, include_hidden: bool) -> AppResult<Vec<Connection>> {
    Ok(sqlx::query_as::<_, Connection>(&format!("SELECT {COLS} FROM connections WHERE user_id = $1 AND (visible OR $2) ORDER BY created_at")).bind(uid).bind(include_hidden).fetch_all(db).await?)
}

#[derive(Deserialize)]
struct UpdateReq { visible: Option<bool>, show_activity: Option<bool> }
async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<UpdateReq>) -> AppResult<Json<Connection>> {
    let row = sqlx::query_as::<_, Connection>(&format!("UPDATE connections SET visible = COALESCE($3, visible), show_activity = COALESCE($4, show_activity), polled_at = NULL WHERE id = $1 AND user_id = $2 RETURNING {COLS}"))
        .bind(id).bind(uid).bind(req.visible).bind(req.show_activity).fetch_optional(&state.db).await?;
    row.map(Json).ok_or_else(|| AppError::NotFound("Connection not found".into()))
}
async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let n = sqlx::query("DELETE FROM connections WHERE id = $1 AND user_id = $2").bind(id).bind(uid).execute(&state.db).await?.rows_affected();
    if n == 0 { return Err(AppError::NotFound("Connection not found".into())) }
    // Linked roles that needed this account go with it, and so do subscriber roles.
    crate::routes::linked_roles::recheck_user(&state, uid).await?;
    crate::routes::integrations::after_unlink(&state, uid).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct StartQ { creator: Option<String> }

/// Where to send the browser to link this provider (a signed state ties the callback to the caller).
/// `?creator=1` (Twitch, YouTube): also ask for subscriber access, to link the channel to a server.
async fn start(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(name): Path<String>, Query(q): Query<StartQ>) -> AppResult<Json<Value>> {
    let p = provider(&name).ok_or_else(|| AppError::NotFound("Unknown provider".into()))?;
    let c = creds(&state, &name).await?;
    let creator = matches!(q.creator.as_deref(), Some("1" | "true"));
    let extra = if creator { Some(creator_scope(&name).ok_or_else(|| AppError::BadRequest("Only Twitch and YouTube channels can be linked to a server".into()))?) } else { None };
    let st = crate::auth::issue_typed(&state.config.jwt_secret, uid, &format!("oauth:{name}{}", if creator { ":creator" } else { "" }), 10)?;
    let mut url = url::Url::parse(&with_override(p.authorize, &c.over)).map_err(|e| AppError::Other(e.into()))?;
    let scope = match extra { Some(x) if p.scope.is_empty() => x.to_string(), Some(x) => format!("{} {x}", p.scope), None => p.scope.to_string() };
    url.query_pairs_mut().append_pair("client_id", &c.client_id).append_pair("redirect_uri", &redirect_uri(&state, &name)).append_pair("response_type", "code").append_pair("scope", &scope).append_pair("state", &st);
    // Google only hands out a refresh token (needed for background syncing) with offline access and consent.
    if creator && name == "youtube" { url.query_pairs_mut().append_pair("access_type", "offline").append_pair("prompt", "consent"); }
    Ok(Json(json!({ "url": url.to_string(), "provider": name, "label": p.label })))
}

#[derive(Deserialize)]
struct CallbackQ { code: Option<String>, state: Option<String>, error: Option<String> }

/// The provider sends the browser back here; swap the code for a token, read the profile, store the link, and
/// land the user in the app (query says which provider, or what went wrong).
async fn callback(State(state): State<AppState>, Path(name): Path<String>, Query(q): Query<CallbackQ>) -> Response {
    let home = format!("{}/channels/@me", state.config.app_url.trim_end_matches('/'));
    let fail = |why: &str| { let mut u = url::Url::parse(&home).unwrap_or_else(|_| url::Url::parse("http://localhost/channels/@me").unwrap()); u.query_pairs_mut().append_pair("connect_error", why); Redirect::to(u.as_str()).into_response() };
    let Some(p) = provider(&name) else { return fail("unknown provider") };
    if let Some(e) = q.error { return fail(&e) }
    let (Some(code), Some(st)) = (q.code, q.state) else { return fail("missing code") };
    let (uid, creator) = match crate::auth::verify_typed(&state.config.jwt_secret, &st, &format!("oauth:{name}")) {
        Some(u) => (u, false),
        None => match crate::auth::verify_typed(&state.config.jwt_secret, &st, &format!("oauth:{name}:creator")) { Some(u) => (u, true), None => return fail("link expired, start again") },
    };
    match link(&state, p, &name, uid, &code, creator).await {
        Ok(()) => Redirect::to(&format!("{home}?connected={name}{}", if creator { "&creator=1" } else { "" })).into_response(),
        Err(e) => { tracing::warn!(error = ?e, provider = %name, "connection failed"); fail(&e.to_string()) }
    }
}

async fn link(state: &AppState, p: &Provider, name: &str, uid: Uuid, code: &str, creator: bool) -> AppResult<()> {
    let c = creds(state, name).await?;
    let client = reqwest::Client::builder().user_agent("parley").timeout(std::time::Duration::from_secs(15)).build().map_err(|e| AppError::Other(e.into()))?;
    let mut tokreq = client.post(with_override(p.token, &c.over)).header("Accept", "application/json");
    if p.basic { tokreq = tokreq.basic_auth(&c.client_id, Some(&c.client_secret)); }
    let tok: Value = tokreq
        .form(&[("client_id", c.client_id.as_str()), ("client_secret", c.client_secret.as_str()), ("code", code), ("grant_type", "authorization_code"), ("redirect_uri", &redirect_uri(state, name))])
        .send().await.map_err(|e| AppError::BadRequest(format!("token exchange failed: {e}")))?.json().await.map_err(|e| AppError::BadRequest(format!("token response unreadable: {e}")))?;
    let access = tok.get("access_token").and_then(|v| v.as_str()).ok_or_else(|| AppError::BadRequest("the provider returned no access token".into()))?.to_string();
    let mut req = client.get(with_override(p.profile, &c.over)).bearer_auth(&access);
    if name == "twitch" { req = req.header("Client-Id", &c.client_id); }
    let prof: Value = req.send().await.map_err(|e| AppError::BadRequest(format!("profile fetch failed: {e}")))?.json().await.map_err(|e| AppError::BadRequest(format!("profile unreadable: {e}")))?;
    let (external_id, display, url) = match name {
        "github" => (prof.get("id").map(|v| v.to_string().trim_matches('"').to_string()).unwrap_or_default(), prof.get("login").and_then(|v| v.as_str()).unwrap_or("").to_string(), prof.get("html_url").and_then(|v| v.as_str()).unwrap_or("").to_string()),
        "gitlab" => (prof.get("id").map(|v| v.to_string().trim_matches('"').to_string()).unwrap_or_default(), prof.get("username").and_then(|v| v.as_str()).unwrap_or("").to_string(), prof.get("web_url").and_then(|v| v.as_str()).unwrap_or("").to_string()),
        "reddit" => { let n = prof.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(); (prof.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(), n.clone(), if n.is_empty() { String::new() } else { format!("https://www.reddit.com/user/{n}") }) }
        "youtube" => { let ch = prof.get("items").and_then(|i| i.get(0)).cloned().unwrap_or(Value::Null); let id = ch.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(); (id.clone(), ch["snippet"]["title"].as_str().unwrap_or("").to_string(), if id.is_empty() { String::new() } else { format!("https://www.youtube.com/channel/{id}") }) }
        "spotify" => (prof.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(), prof.get("display_name").and_then(|v| v.as_str()).or(prof.get("id").and_then(|v| v.as_str())).unwrap_or("").to_string(), prof["external_urls"]["spotify"].as_str().unwrap_or("").to_string()),
        _ => { let u = prof.get("data").and_then(|d| d.get(0)).cloned().unwrap_or(Value::Null); let login = u.get("login").and_then(|v| v.as_str()).unwrap_or("").to_string(); (u.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(), u.get("display_name").and_then(|v| v.as_str()).unwrap_or(&login).to_string(), if login.is_empty() { String::new() } else { format!("https://twitch.tv/{login}") }) }
    };
    if external_id.is_empty() || display.is_empty() { return Err(AppError::BadRequest("the provider returned no account".into())) }
    // Only creator links (for syncing subscribers) and Spotify (for the listening status) keep tokens; other links
    // store none.
    let keep = creator || name == "spotify";
    let refresh = tok.get("refresh_token").and_then(|v| v.as_str()).map(str::to_string);
    let expires = tok.get("expires_in").and_then(|v| v.as_i64()).map(|s| chrono::Utc::now() + chrono::Duration::seconds(s));
    sqlx::query(
        "INSERT INTO connections (id, user_id, provider, external_id, name, url, creator, access_token, refresh_token, token_expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, provider, external_id) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url,
           creator = connections.creator OR EXCLUDED.creator,
           access_token = COALESCE(EXCLUDED.access_token, connections.access_token), refresh_token = COALESCE(EXCLUDED.refresh_token, connections.refresh_token),
           token_expires_at = CASE WHEN EXCLUDED.access_token IS NULL THEN connections.token_expires_at ELSE EXCLUDED.token_expires_at END, polled_at = NULL",
    )
    .bind(Uuid::now_v7()).bind(uid).bind(name).bind(&external_id).bind(&display).bind(&url).bind(creator)
    .bind(if keep { Some(access.clone()) } else { None }).bind(if keep { refresh } else { None }).bind(if keep { expires } else { None })
    .execute(&state.db).await?;
    // Their new account may make them a subscriber in servers they're in.
    crate::routes::integrations::after_link(state.clone(), uid, name.to_string());
    Ok(())
}
