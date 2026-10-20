//! Settings → Connections: link GitHub / Twitch accounts with OAuth and show them on the profile.
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
pub struct Connection { pub id: Uuid, pub provider: String, pub external_id: String, pub name: String, pub url: String, pub visible: bool, pub created_at: chrono::DateTime<chrono::Utc> }

/// Everything about a provider: where to send the user, where to swap the code, where to read the profile.
struct Provider { authorize: &'static str, token: &'static str, profile: &'static str, scope: &'static str, label: &'static str }
const GITHUB: Provider = Provider { authorize: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token", profile: "https://api.github.com/user", scope: "read:user", label: "GitHub" };
const TWITCH: Provider = Provider { authorize: "https://id.twitch.tv/oauth2/authorize", token: "https://id.twitch.tv/oauth2/token", profile: "https://api.twitch.tv/helix/users", scope: "", label: "Twitch" };
pub const PROVIDERS: [&str; 2] = ["github", "twitch"];

fn provider(name: &str) -> Option<&'static Provider> { match name { "github" => Some(&GITHUB), "twitch" => Some(&TWITCH), _ => None } }

/// Replace a provider URL's origin with the test override, when set.
fn with_override(url: &str, over: &str) -> String {
    if over.is_empty() { return url.to_string() }
    let path = url.splitn(4, '/').nth(3).unwrap_or("");
    format!("{}/{}", over.trim_end_matches('/'), path)
}

struct Creds { client_id: String, client_secret: String, over: String }
async fn creds(state: &AppState, name: &str) -> AppResult<Creds> {
    let s = crate::routes::admin::load_settings(&state.db).await?;
    let p = s.oauth_providers.get(name).cloned().unwrap_or(Value::Null);
    let id = p.get("client_id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let secret = p.get("client_secret").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if id.is_empty() || secret.is_empty() { return Err(AppError::BadRequest(format!("{name} is not set up on this server. Ask an admin to add its OAuth keys."))) }
    Ok(Creds { client_id: id, client_secret: secret, over: s.oauth_endpoint_override.trim().to_string() })
}

fn redirect_uri(state: &AppState, name: &str) -> String { format!("{}/api/connections/{name}/callback", state.config.app_url.trim_end_matches('/')) }

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Connection>>> {
    Ok(Json(sqlx::query_as::<_, Connection>("SELECT id, provider, external_id, name, url, visible, created_at FROM connections WHERE user_id = $1 ORDER BY created_at").bind(uid).fetch_all(&state.db).await?))
}

/// Visible connections of a user, for their profile.
pub async fn visible_for(db: &sqlx::PgPool, uid: Uuid, include_hidden: bool) -> AppResult<Vec<Connection>> {
    Ok(sqlx::query_as::<_, Connection>("SELECT id, provider, external_id, name, url, visible, created_at FROM connections WHERE user_id = $1 AND (visible OR $2) ORDER BY created_at").bind(uid).bind(include_hidden).fetch_all(db).await?)
}

#[derive(Deserialize)]
struct UpdateReq { visible: bool }
async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<UpdateReq>) -> AppResult<Json<Connection>> {
    let row = sqlx::query_as::<_, Connection>("UPDATE connections SET visible = $3 WHERE id = $1 AND user_id = $2 RETURNING id, provider, external_id, name, url, visible, created_at")
        .bind(id).bind(uid).bind(req.visible).fetch_optional(&state.db).await?;
    row.map(Json).ok_or_else(|| AppError::NotFound("Connection not found".into()))
}
async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let n = sqlx::query("DELETE FROM connections WHERE id = $1 AND user_id = $2").bind(id).bind(uid).execute(&state.db).await?.rows_affected();
    if n == 0 { return Err(AppError::NotFound("Connection not found".into())) }
    Ok(StatusCode::NO_CONTENT)
}

/// Where to send the browser to link this provider (a signed state ties the callback to the caller).
async fn start(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(name): Path<String>) -> AppResult<Json<Value>> {
    let p = provider(&name).ok_or_else(|| AppError::NotFound("Unknown provider".into()))?;
    let c = creds(&state, &name).await?;
    let st = crate::auth::issue_typed(&state.config.jwt_secret, uid, &format!("oauth:{name}"), 10)?;
    let mut url = url::Url::parse(&with_override(p.authorize, &c.over)).map_err(|e| AppError::Other(e.into()))?;
    url.query_pairs_mut().append_pair("client_id", &c.client_id).append_pair("redirect_uri", &redirect_uri(&state, &name)).append_pair("response_type", "code").append_pair("scope", p.scope).append_pair("state", &st);
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
    let Some(uid) = crate::auth::verify_typed(&state.config.jwt_secret, &st, &format!("oauth:{name}")) else { return fail("link expired, start again") };
    match link(&state, p, &name, uid, &code).await {
        Ok(()) => Redirect::to(&format!("{home}?connected={name}")).into_response(),
        Err(e) => { tracing::warn!(error = ?e, provider = %name, "connection failed"); fail(&e.to_string()) }
    }
}

async fn link(state: &AppState, p: &Provider, name: &str, uid: Uuid, code: &str) -> AppResult<()> {
    let c = creds(state, name).await?;
    let client = reqwest::Client::builder().user_agent("parley").timeout(std::time::Duration::from_secs(15)).build().map_err(|e| AppError::Other(e.into()))?;
    let tok: Value = client.post(with_override(p.token, &c.over)).header("Accept", "application/json")
        .form(&[("client_id", c.client_id.as_str()), ("client_secret", c.client_secret.as_str()), ("code", code), ("grant_type", "authorization_code"), ("redirect_uri", &redirect_uri(state, name))])
        .send().await.map_err(|e| AppError::BadRequest(format!("token exchange failed: {e}")))?.json().await.map_err(|e| AppError::BadRequest(format!("token response unreadable: {e}")))?;
    let access = tok.get("access_token").and_then(|v| v.as_str()).ok_or_else(|| AppError::BadRequest("the provider returned no access token".into()))?.to_string();
    let mut req = client.get(with_override(p.profile, &c.over)).bearer_auth(&access);
    if name == "twitch" { req = req.header("Client-Id", &c.client_id); }
    let prof: Value = req.send().await.map_err(|e| AppError::BadRequest(format!("profile fetch failed: {e}")))?.json().await.map_err(|e| AppError::BadRequest(format!("profile unreadable: {e}")))?;
    let (external_id, display, url) = match name {
        "github" => (prof.get("id").map(|v| v.to_string().trim_matches('"').to_string()).unwrap_or_default(), prof.get("login").and_then(|v| v.as_str()).unwrap_or("").to_string(), prof.get("html_url").and_then(|v| v.as_str()).unwrap_or("").to_string()),
        _ => { let u = prof.get("data").and_then(|d| d.get(0)).cloned().unwrap_or(Value::Null); let login = u.get("login").and_then(|v| v.as_str()).unwrap_or("").to_string(); (u.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(), u.get("display_name").and_then(|v| v.as_str()).unwrap_or(&login).to_string(), if login.is_empty() { String::new() } else { format!("https://twitch.tv/{login}") }) }
    };
    if external_id.is_empty() || display.is_empty() { return Err(AppError::BadRequest("the provider returned no account".into())) }
    sqlx::query("INSERT INTO connections (id, user_id, provider, external_id, name, url) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, provider, external_id) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url")
        .bind(Uuid::now_v7()).bind(uid).bind(name).bind(&external_id).bind(&display).bind(&url).execute(&state.db).await?;
    Ok(())
}
