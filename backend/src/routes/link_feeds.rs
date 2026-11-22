//! Threat feeds for the blocked-links list (Admin Console → Blocked Links).
//!
//! The list used to be filled by hand. A feed is the address of a plain-text list of malicious domains kept up by
//! someone else: Parley fetches each enabled feed every six hours and blocks links to the domains it names, in
//! messages and in link previews, alongside the hand-added ones. A feed never overrides or removes a domain an
//! administrator added, and a short list of sites everybody shares is never blocked whatever a feed says.
//!
//! Accepted lines: a bare domain, a hosts-file line (`0.0.0.0 bad.example`), or an address with no path
//! (`http://bad.example/`). An address with a path names one page of a site, not the site, so it is skipped:
//! blocking a whole host because one page on it was bad would block shared hosts wholesale.

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{require_perm, Perm},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/link-feeds", get(list).post(add))
        .route("/admin/link-feeds/:id", patch(update).delete(remove))
        .route("/admin/link-feeds/:id/refresh", post(refresh_now))
}

/// The most a feed may be (a hosts list of a few hundred thousand names is a few megabytes).
const MAX_FEED_BYTES: usize = 25 * 1024 * 1024;
const MAX_ENTRIES: usize = 400_000;
const REFRESH_HOURS: i64 = 6;

/// Sites so widely shared that one bad page on them must never block all of them, whatever a feed lists.
const NEVER: &[&str] = &[
    "google.com", "youtube.com", "youtu.be", "github.com", "githubusercontent.com", "gitlab.com", "microsoft.com", "live.com", "office.com", "apple.com", "icloud.com",
    "amazon.com", "amazonaws.com", "cloudflare.com", "dropbox.com", "wikipedia.org", "x.com", "twitter.com", "facebook.com", "instagram.com", "reddit.com", "discord.com",
    "twitch.tv", "spotify.com", "mozilla.org", "archive.org", "bit.ly", "t.co",
];

/// The domain a line of a feed names, if it names one.
pub fn domain_of(line: &str) -> Option<String> {
    let line = line.split('#').next().unwrap_or("").trim();
    if line.is_empty() || line.starts_with('!') || line.starts_with('[') { return None }
    // hosts-file form: an address, then the name.
    let mut parts = line.split_whitespace();
    let first = parts.next()?;
    let token = match parts.next() { Some(name) if first.parse::<std::net::IpAddr>().is_ok() => name, Some(_) => return None, None => first };
    let host = if token.contains("://") {
        let u = url::Url::parse(token).ok()?;
        if !(u.path().is_empty() || u.path() == "/") || u.query().is_some() { return None }
        u.host_str()?.to_string()
    } else if token.contains('/') { return None } else { token.to_string() };
    let host = host.trim_start_matches("www.").trim_end_matches('.').to_lowercase();
    if host.len() > 253 || !host.contains('.') || host.parse::<std::net::IpAddr>().is_ok() { return None }
    if !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.') { return None }
    if host == "localhost.localdomain" || NEVER.iter().any(|n| host == *n || host.ends_with(&format!(".{n}"))) { return None }
    Some(host)
}

/// Fetch one feed and replace what it contributed. Returns how many domains it now blocks.
async fn refresh(state: &AppState, id: Uuid, url: &str) -> Result<usize, String> {
    let client = reqwest::Client::builder().user_agent("parley").timeout(std::time::Duration::from_secs(60)).build().map_err(|e| e.to_string())?;
    let res = client.get(url).send().await.map_err(|e| format!("could not fetch: {e}"))?;
    if !res.status().is_success() { return Err(format!("the feed answered {}", res.status())) }
    let body = res.bytes().await.map_err(|e| format!("could not read: {e}"))?;
    if body.len() > MAX_FEED_BYTES { return Err("the feed is larger than 25 MB".into()) }
    let text = String::from_utf8_lossy(&body);
    let own = url::Url::parse(&state.config.app_url).ok().and_then(|u| u.host_str().map(str::to_lowercase)).unwrap_or_default();
    let mut domains: Vec<String> = text.lines().filter_map(domain_of).filter(|d| *d != own).collect();
    domains.sort(); domains.dedup();
    if domains.len() > MAX_ENTRIES { return Err(format!("the feed names more than {MAX_ENTRIES} domains")) }
    if domains.is_empty() { return Err("nothing in the feed looked like a domain".into()) }
    let source = format!("feed:{id}");
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM blocked_domains WHERE source = $1").bind(&source).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    // A domain already on the list (by hand, or from another feed) stays as it is.
    sqlx::query("INSERT INTO blocked_domains (domain, reason, source) SELECT d, 'Threat feed', $2 FROM unnest($1::text[]) AS d ON CONFLICT (domain) DO NOTHING")
        .bind(&domains).bind(&source).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(domains.len())
}

async fn run(state: &AppState, id: Uuid, url: &str) -> (bool, String, usize) {
    let (ok, status, n) = match refresh(state, id, url).await {
        Ok(n) => (true, "ok".to_string(), n),
        Err(e) => (false, e, 0),
    };
    // A failed fetch keeps what the feed contributed last time: a feed that is down should not unblock anything.
    if ok { let _ = sqlx::query("UPDATE link_feeds SET last_run = now(), last_status = $2, entries = $3 WHERE id = $1").bind(id).bind(&status).bind(n as i32).execute(&state.db).await; }
    else { let _ = sqlx::query("UPDATE link_feeds SET last_run = now(), last_status = $2 WHERE id = $1").bind(id).bind(&status).execute(&state.db).await; }
    (ok, status, n)
}

/// Every half hour: refresh the enabled feeds that are due.
pub async fn refresh_loop(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(1800)).await;
        let due: Vec<(Uuid, String)> = sqlx::query_as("SELECT id, url FROM link_feeds WHERE enabled AND (last_run IS NULL OR last_run < now() - make_interval(hours => $1))")
            .bind(REFRESH_HOURS as i32).fetch_all(&state.db).await.unwrap_or_default();
        for (id, url) in due { let (ok, status, _) = run(&state, id, &url).await; if !ok { tracing::warn!(feed = %url, error = %status, "link feed refresh failed"); } }
    }
}

async fn list_json(state: &AppState) -> AppResult<Value> {
    let rows: Vec<(Uuid, String, String, bool, i32, Option<chrono::DateTime<chrono::Utc>>, String)> = sqlx::query_as("SELECT id, name, url, enabled, entries, last_run, last_status FROM link_feeds ORDER BY created_at").fetch_all(&state.db).await?;
    let (manual, total): (i64, i64) = sqlx::query_as("SELECT count(*) FILTER (WHERE source = ''), count(*) FROM blocked_domains").fetch_one(&state.db).await?;
    Ok(json!({
        "feeds": rows.into_iter().map(|r| json!({ "id": r.0, "name": r.1, "url": r.2, "enabled": r.3, "entries": r.4, "last_run": r.5, "last_status": r.6 })).collect::<Vec<_>>(),
        "manual": manual, "total": total, "refresh_hours": REFRESH_HOURS,
    }))
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    Ok(Json(list_json(&state).await?))
}

#[derive(Deserialize)]
struct Add { name: String, url: String }

/// `POST /admin/link-feeds {name, url}`: add a feed and fetch it straight away.
async fn add(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<Add>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let name: String = req.name.trim().chars().take(80).collect();
    let url = req.url.trim().to_string();
    if name.is_empty() { return Err(AppError::BadRequest("Give the feed a name".into())) }
    if !(url.starts_with("https://") || url.starts_with("http://")) || url.len() > 500 { return Err(AppError::BadRequest("The feed address must start with https:// or http://".into())) }
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM link_feeds").fetch_one(&state.db).await?;
    if n >= 20 { return Err(AppError::BadRequest("At most 20 feeds".into())) }
    let id = Uuid::now_v7();
    let made = sqlx::query("INSERT INTO link_feeds (id, name, url) VALUES ($1, $2, $3) ON CONFLICT (url) DO NOTHING").bind(id).bind(&name).bind(&url).execute(&state.db).await?.rows_affected();
    if made == 0 { return Err(AppError::Conflict("That feed is already added".into())) }
    let (ok, status, entries) = run(&state, id, &url).await;
    audit::record(&state, uid, "safety.link_feed.add", "instance", Some(id), &name, json!({ "url": url, "fetched": ok, "entries": entries, "status": status })).await;
    Ok(Json(list_json(&state).await?))
}

#[derive(Deserialize)]
struct Update { enabled: bool }

/// `PATCH /admin/link-feeds/:id {enabled}`: a disabled feed stops blocking (what it contributed is removed).
async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<Update>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let Some((name, url)): Option<(String, String)> = sqlx::query_as("UPDATE link_feeds SET enabled = $2 WHERE id = $1 RETURNING name, url").bind(id).bind(req.enabled).fetch_optional(&state.db).await? else { return Err(AppError::NotFound("Feed not found".into())) };
    if req.enabled { run(&state, id, &url).await; } else {
        sqlx::query("DELETE FROM blocked_domains WHERE source = $1").bind(format!("feed:{id}")).execute(&state.db).await?;
        sqlx::query("UPDATE link_feeds SET entries = 0 WHERE id = $1").bind(id).execute(&state.db).await?;
    }
    audit::record(&state, uid, "safety.link_feed.update", "instance", Some(id), &name, json!({ "enabled": req.enabled })).await;
    Ok(Json(list_json(&state).await?))
}

async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let Some((name,)): Option<(String,)> = sqlx::query_as("DELETE FROM link_feeds WHERE id = $1 RETURNING name").bind(id).fetch_optional(&state.db).await? else { return Err(AppError::NotFound("Feed not found".into())) };
    sqlx::query("DELETE FROM blocked_domains WHERE source = $1").bind(format!("feed:{id}")).execute(&state.db).await?;
    audit::record(&state, uid, "safety.link_feed.remove", "instance", Some(id), &name, json!({})).await;
    Ok(Json(list_json(&state).await?))
}

async fn refresh_now(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let Some((url,)): Option<(String,)> = sqlx::query_as("SELECT url FROM link_feeds WHERE id = $1").bind(id).fetch_optional(&state.db).await? else { return Err(AppError::NotFound("Feed not found".into())) };
    run(&state, id, &url).await;
    Ok(Json(list_json(&state).await?))
}

#[cfg(test)]
mod tests {
    use super::domain_of;

    #[test]
    fn what_a_feed_line_names() {
        assert_eq!(domain_of("bad.example"), Some("bad.example".into()));
        assert_eq!(domain_of("0.0.0.0 Bad.Example  # seen 2026"), Some("bad.example".into()));
        assert_eq!(domain_of("127.0.0.1\twww.bad.example"), Some("bad.example".into()));
        assert_eq!(domain_of("http://bad.example/"), Some("bad.example".into()));
        assert_eq!(domain_of("https://bad.example"), Some("bad.example".into()));
    }

    #[test]
    fn what_it_does_not() {
        for line in ["", "# a comment", "! adblock comment", "[Adblock Plus]", "http://shared.example/one/bad/page.php", "http://bad.example/?x=1", "bad.example/path", "10.1.2.3", "http://10.1.2.3/", "nodot", "two words here", "127.0.0.1 localhost.localdomain", "bad_host!.example"] {
            assert_eq!(domain_of(line), None, "{line}");
        }
    }

    #[test]
    fn sites_everybody_shares_are_never_blocked() {
        for line in ["github.com", "0.0.0.0 raw.githubusercontent.com", "https://drive.google.com/", "docs.google.com", "t.co"] {
            assert_eq!(domain_of(line), None, "{line}");
        }
        assert_eq!(domain_of("notgithub.com"), Some("notgithub.com".into()));
    }
}
