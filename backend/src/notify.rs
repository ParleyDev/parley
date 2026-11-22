//! Instance event notifications: what happens on the instance (accounts, servers, safety, the admin console) posted
//! where its admins will see it. Each category goes to a text channel on the instance (as the Parley account) and/or
//! a webhook (Discord, Slack, or anything that takes JSON), with links to the matching admin console pages.
//!
//! Routes live in `instance_settings` under `event_routes`: `{ "<category>": { "channel_id", "webhook_url" } }`.
//! Delivery never holds up or fails the request that caused the event: it runs in the background, each category is
//! capped per minute (what went over is counted in the next post), and the last failure per category is kept for the
//! settings page.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::Channel,
    routes::admin_access::{require_perm, Perm},
    state::AppState,
};
use axum::{extract::{Path, Query, State}, routing::{get, post}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{collections::HashMap, sync::Mutex, time::{Duration, Instant}};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/event-routes", get(get_routes).put(put_routes))
        .route("/admin/event-routes/channels", get(channels))
        .route("/admin/event-routes/:category/test", post(test))
}

/// The categories, in the order the settings page lists them.
pub const CATEGORIES: [&str; 4] = ["users", "servers", "safety", "console"];
/// How many posts a category may make a minute; the rest are counted and mentioned in the next one.
const PER_MINUTE: u32 = 30;
const SETTING: &str = "event_routes";

fn title(cat: &str) -> &'static str {
    match cat { "users" => "Users", "servers" => "Servers", "safety" => "Safety", _ => "Console" }
}

// ---- events ------------------------------------------------------------------------------------------------------

/// One thing that happened. `text` is Markdown (names go through `name`); links are admin console paths.
#[derive(Debug, Clone)]
pub struct Event {
    pub kind: String,
    pub cats: Vec<&'static str>,
    pub text: String,
    pub links: Vec<(String, String)>,
}

impl Event {
    pub fn new(cat: &'static str, kind: &str, text: impl Into<String>) -> Self {
        Event { kind: kind.to_string(), cats: vec![cat], text: text.into(), links: Vec::new() }
    }
    /// Post it to another category too (each destination still gets it once).
    pub fn also(mut self, cat: &'static str) -> Self { if !self.cats.contains(&cat) { self.cats.push(cat) } self }
    /// A link to an admin console page (`/admin/...`).
    pub fn link(mut self, label: &str, path: impl Into<String>) -> Self { self.links.push((label.to_string(), path.into())); self }
    pub fn user(self, id: Uuid) -> Self { self.link("User", format!("/admin/users/{id}")) }
    pub fn server(self, id: Uuid) -> Self { self.link("Server", format!("/admin/servers/{id}")) }
}

/// A name as it may sit in Markdown: formatting characters escaped, and no @everyone / @here pings.
pub fn name(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars().take(100) {
        match ch {
            '\\' | '`' | '*' | '_' | '~' | '|' | '#' | '>' | '-' | '[' | ']' | '(' | ')' | '<' => { out.push('\\'); out.push(ch) }
            '@' => { out.push('@'); out.push('\u{200b}') }
            '\n' | '\r' => out.push(' '),
            c => out.push(c),
        }
    }
    if out.trim().is_empty() { "(no name)".into() } else { out }
}

/// A server was made (from scratch or a template).
pub async fn server_created(state: &AppState, owner: Uuid, gid: Uuid, server: &str) {
    let who = name(&crate::audit::username(state, owner).await);
    send(state, Event::new("servers", "guild.create", format!("**{who}** created the server **{}**", name(server))).server(gid).user(owner));
}

/// Send an event in the background.
pub fn send(state: &AppState, ev: Event) {
    let state = state.clone();
    tokio::spawn(async move { deliver(&state, ev).await });
}

// ---- routes (settings) -------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq)]
struct Route { channel_id: Option<Uuid>, webhook_url: String }

async fn load(db: &sqlx::PgPool) -> HashMap<String, Route> {
    let v: Option<(Value,)> = sqlx::query_as("SELECT value FROM instance_settings WHERE key = $1").bind(SETTING).fetch_optional(db).await.ok().flatten();
    parse(&v.map(|r| r.0).unwrap_or(Value::Null))
}

fn parse(v: &Value) -> HashMap<String, Route> {
    CATEGORIES.iter().filter_map(|c| {
        let r = v.get(*c)?;
        Some((c.to_string(), Route {
            channel_id: r.get("channel_id").and_then(Value::as_str).and_then(|s| Uuid::parse_str(s).ok()),
            webhook_url: r.get("webhook_url").and_then(Value::as_str).unwrap_or_default().to_string(),
        }))
    }).collect()
}

fn to_json(routes: &HashMap<String, Route>) -> Value {
    Value::Object(CATEGORIES.iter().filter_map(|c| routes.get(*c).map(|r| (c.to_string(), json!({ "channel_id": r.channel_id, "webhook_url": r.webhook_url })))).collect())
}

/// A webhook address: http(s) only. Its host, for showing without the secret part.
fn webhook_host(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    if !matches!(u.scheme(), "http" | "https") { return None }
    u.host_str().map(str::to_string)
}

fn last_errors() -> &'static Mutex<HashMap<String, (String, chrono::DateTime<chrono::Utc>)>> {
    static E: std::sync::OnceLock<Mutex<HashMap<String, (String, chrono::DateTime<chrono::Utc>)>>> = std::sync::OnceLock::new();
    E.get_or_init(Default::default)
}

/// A channel for the settings page: where it is.
async fn channel_info(db: &sqlx::PgPool, id: Uuid) -> Option<Value> {
    let r: Option<(Uuid, String, Uuid, String)> = sqlx::query_as(
        "SELECT c.id, c.name, g.id, g.name FROM channels c JOIN guilds g ON g.id = c.guild_id WHERE c.id = $1 AND c.kind = 'text'",
    ).bind(id).fetch_optional(db).await.ok().flatten();
    r.map(|(id, name, gid, gname)| json!({ "id": id, "name": name, "guild_id": gid, "guild_name": gname }))
}

async fn routes_json(state: &AppState) -> Value {
    let routes = load(&state.db).await;
    let errors = last_errors().lock().map(|e| e.clone()).unwrap_or_default();
    let mut out = Map::new();
    for c in CATEGORIES {
        let r = routes.get(c).cloned().unwrap_or_default();
        let channel = match r.channel_id { Some(id) => channel_info(&state.db, id).await.unwrap_or(json!({ "id": id, "missing": true })), None => Value::Null };
        out.insert(c.into(), json!({
            "channel": channel,
            "webhook": if r.webhook_url.is_empty() { Value::Null } else { json!({ "host": webhook_host(&r.webhook_url).unwrap_or_default() }) },
            "last_error": errors.get(c).map(|(m, at)| json!({ "message": m, "at": at })),
        }));
    }
    json!({ "categories": CATEGORIES, "routes": out })
}

/// `GET /admin/event-routes`: where each category goes (webhooks by host only: the address holds its secret).
async fn get_routes(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    Ok(Json(routes_json(&state).await))
}

#[derive(Deserialize)]
struct RouteIn {
    /// Omitted: unchanged; null: none.
    #[serde(default, deserialize_with = "crate::routes::roles::deserialize_nullable_uuid")]
    channel_id: Option<Option<Uuid>>,
    /// Omitted: unchanged; "" removes it.
    webhook_url: Option<String>,
}

/// `PUT /admin/event-routes {<category>: {channel_id?, webhook_url?}}`: change some categories' destinations.
async fn put_routes(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<HashMap<String, RouteIn>>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let before = load(&state.db).await;
    let mut after = before.clone();
    for (cat, r) in req {
        if !CATEGORIES.contains(&cat.as_str()) { return Err(AppError::BadRequest(format!("Unknown category: {cat}"))) }
        let e = after.entry(cat.clone()).or_default();
        if let Some(ch) = r.channel_id {
            if let Some(id) = ch {
                if channel_info(&state.db, id).await.is_none() { return Err(AppError::BadRequest("Pick a text channel in a server".into())) }
            }
            e.channel_id = ch;
        }
        if let Some(url) = r.webhook_url {
            let url = url.trim().to_string();
            if !url.is_empty() && webhook_host(&url).is_none() { return Err(AppError::BadRequest("The webhook address must start with https:// (or http:// on your own network)".into())) }
            if url.len() > 2000 { return Err(AppError::BadRequest("The webhook address is too long".into())) }
            e.webhook_url = url;
        }
    }
    after.retain(|_, r| r.channel_id.is_some() || !r.webhook_url.is_empty());
    sqlx::query("INSERT INTO instance_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value")
        .bind(SETTING).bind(to_json(&after)).execute(&state.db).await?;
    // The audit entry says what changed, never a webhook's address.
    let mut changed = Map::new();
    for c in CATEGORIES {
        let (b, a) = (before.get(c).cloned().unwrap_or_default(), after.get(c).cloned().unwrap_or_default());
        if b == a { continue }
        if b.channel_id != a.channel_id { changed.insert(format!("{c}.channel"), json!(a.channel_id)); }
        if b.webhook_url != a.webhook_url { changed.insert(format!("{c}.webhook"), json!(if a.webhook_url.is_empty() { "removed".to_string() } else { webhook_host(&a.webhook_url).unwrap_or_default() })); }
        if let Ok(mut e) = last_errors().lock() { e.remove(c); }
    }
    if !changed.is_empty() { crate::audit::record(&state, uid, "notifications.update", "instance", None, "", Value::Object(changed)).await; }
    Ok(Json(routes_json(&state).await))
}

#[derive(Deserialize)]
struct ChannelQuery { #[serde(default)] q: String }

/// `GET /admin/event-routes/channels?q=`: text channels on the instance whose name or server's name matches.
async fn channels(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<ChannelQuery>) -> AppResult<Json<Vec<Value>>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let pat = format!("%{}%", q.q.trim().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    let rows: Vec<(Uuid, String, Uuid, String)> = sqlx::query_as(
        "SELECT c.id, c.name, g.id, g.name FROM channels c JOIN guilds g ON g.id = c.guild_id
          WHERE c.kind = 'text' AND g.state = 'active' AND (c.name ILIKE $1 OR g.name ILIKE $1)
          ORDER BY lower(g.name), c.position, c.name LIMIT 25",
    ).bind(pat).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(id, name, gid, gname)| json!({ "id": id, "name": name, "guild_id": gid, "guild_name": gname })).collect()))
}

/// `POST /admin/event-routes/:category/test`: post a test now and say how each destination took it.
async fn test(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(cat): Path<String>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let cat: &'static str = CATEGORIES.iter().find(|c| **c == cat).copied().ok_or_else(|| AppError::NotFound("No such category".into()))?;
    let r = load(&state.db).await.remove(cat).unwrap_or_default();
    if r.channel_id.is_none() && r.webhook_url.is_empty() { return Err(AppError::BadRequest("Pick a channel or a webhook first".into())) }
    let who = crate::audit::username(&state, uid).await;
    let ev = Event::new(cat, "test", format!("A test from **{}**: {} events will show up here.", name(&who), title(cat))).link("Notification settings", "/admin/notifications");
    let text = render(&state, cat, &ev, 0);
    let channel = match r.channel_id { Some(id) => Some(post_channel(&state, id, &text.channel).await), None => None };
    let webhook = if r.webhook_url.is_empty() { None } else { Some(post_webhook(&state, &r.webhook_url, cat, &ev, &text).await) };
    note(cat, channel.as_ref().and_then(|r| r.as_ref().err()).or(webhook.as_ref().and_then(|r| r.as_ref().err())));
    let show = |r: Option<Result<(), String>>| match r { None => Value::Null, Some(Ok(())) => json!({ "ok": true }), Some(Err(e)) => json!({ "ok": false, "error": e }) };
    Ok(Json(json!({ "channel": show(channel), "webhook": show(webhook) })))
}

// ---- delivery ----------------------------------------------------------------------------------------------------

/// Per category: when its minute started, how many went out in it, how many didn't.
fn budget() -> &'static Mutex<HashMap<&'static str, (Instant, u32, u32)>> {
    static B: std::sync::OnceLock<Mutex<HashMap<&'static str, (Instant, u32, u32)>>> = std::sync::OnceLock::new();
    B.get_or_init(Default::default)
}

/// May this category post now? Some(n): yes, and n posts were held back before it.
fn take(cat: &'static str) -> Option<u32> {
    let mut b = budget().lock().ok()?;
    let e = b.entry(cat).or_insert((Instant::now(), 0, 0));
    if e.0.elapsed() >= Duration::from_secs(60) { e.0 = Instant::now(); e.1 = 0; }
    if e.1 >= PER_MINUTE { e.2 += 1; return None }
    e.1 += 1;
    Some(std::mem::take(&mut e.2))
}

fn note(cat: &str, err: Option<&String>) {
    if let Ok(mut e) = last_errors().lock() {
        match err { Some(m) => { e.insert(cat.to_string(), (m.clone(), chrono::Utc::now())); } None => { e.remove(cat); } }
    }
}

struct Rendered { channel: String, discord: String, slack: String, plain: String }

fn render(state: &AppState, cat: &str, ev: &Event, skipped: u32) -> Rendered {
    let base = state.config.app_url.trim_end_matches('/');
    let url = |p: &str| format!("{base}{p}");
    let more = if skipped > 0 { format!("\n*({skipped} more {} event{} in the last minute weren't posted.)*", title(cat).to_lowercase(), if skipped == 1 { "" } else { "s" }) } else { String::new() };
    let md_links = ev.links.iter().map(|(l, p)| format!("[{l}]({})", url(p))).collect::<Vec<_>>().join(" · ");
    let md = format!("**{}** · {}{}{more}", title(cat), ev.text, if md_links.is_empty() { String::new() } else { format!("\n{md_links}") });
    let plain_text = unescape(&ev.text).replace("**", "");
    let slack_text = slack_escape(&unescape(&ev.text)).replace("**", "*");
    let slack_links = ev.links.iter().map(|(l, p)| format!("<{}|{}>", url(p), slack_escape(l))).collect::<Vec<_>>().join(" · ");
    let slack_more = if skipped > 0 { format!("\n_({skipped} more weren't posted.)_") } else { String::new() };
    Rendered {
        channel: md.clone(),
        discord: md,
        slack: format!("*{}* · {slack_text}{}{slack_more}", title(cat), if slack_links.is_empty() { String::new() } else { format!("\n{slack_links}") }),
        plain: plain_text,
    }
}

/// Markdown escapes off (for Slack and the plain text), the zero-width space after '@' kept.
fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\\' { if let Some(n) = it.next() { out.push(n); continue } }
        out.push(c);
    }
    out
}

fn slack_escape(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;") }

async fn deliver(state: &AppState, ev: Event) {
    let routes = load(&state.db).await;
    // Each channel and webhook gets the event once, under the first of its categories that goes there.
    let mut seen_channels: Vec<Uuid> = Vec::new();
    let mut seen_hooks: Vec<String> = Vec::new();
    for cat in ev.cats.clone() {
        let Some(r) = routes.get(cat) else { continue };
        let ch = r.channel_id.filter(|c| !seen_channels.contains(c));
        let hook = Some(r.webhook_url.clone()).filter(|u| !u.is_empty() && !seen_hooks.contains(u));
        if ch.is_none() && hook.is_none() { continue }
        let Some(skipped) = take(cat) else { continue };
        let text = render(state, cat, &ev, skipped);
        let mut err = None;
        if let Some(id) = ch {
            seen_channels.push(id);
            if let Err(e) = post_channel(state, id, &text.channel).await { tracing::warn!(category = cat, "event notification not posted to its channel: {e}"); err = Some(e) }
        }
        if let Some(url) = hook {
            if let Err(e) = post_webhook(state, &url, cat, &ev, &text).await { tracing::warn!(category = cat, "event notification webhook failed: {e}"); err = err.or(Some(e)) }
            seen_hooks.push(url);
        }
        note(cat, err.as_ref());
    }
}

/// Post as the Parley account in a server's text channel.
async fn post_channel(state: &AppState, id: Uuid, content: &str) -> Result<(), String> {
    let c = sqlx::query_as::<_, Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS))
        .bind(id).fetch_optional(&state.db).await.map_err(|e| e.to_string())?.ok_or("The channel was deleted")?;
    if c.guild_id.is_none() || c.kind != "text" { return Err("The channel isn't a server text channel".into()) }
    let sys = crate::routes::notices::system_user(state).await.map_err(|e| e.to_string())?;
    let content: String = content.chars().take(2000).collect();
    let mid = Uuid::now_v7();
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content) VALUES ($1, $2, $3, $4)")
        .bind(mid).bind(c.id).bind(sys).bind(&content).execute(&state.db).await.map_err(|e| e.to_string())?;
    crate::metrics::METRICS.messages_created.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let msg = crate::routes::channels::fetch_message(&state.db, mid, sys).await.map_err(|e| e.to_string())?;
    let target = crate::routes::channels::target_for(&state.db, &c).await.map_err(|e| e.to_string())?;
    state.hub.emit(target, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": c.guild_id }));
    crate::push::after_message(state.clone(), msg, c);
    Ok(())
}

fn client() -> &'static reqwest::Client {
    static C: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().user_agent("parley").timeout(Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none()).build().unwrap_or_default())
}

/// The body a webhook gets: Discord's and Slack's own shapes for them, otherwise JSON with both and the event.
fn webhook_body(url: &str, cat: &str, ev: &Event, text: &Rendered, base: &str) -> Value {
    let host = webhook_host(url).unwrap_or_default();
    let discord = json!({ "username": "Parley", "content": text.discord.chars().take(2000).collect::<String>(), "allowed_mentions": { "parse": [] } });
    if host.ends_with("discord.com") || host.ends_with("discordapp.com") { return discord }
    if host.ends_with("slack.com") { return json!({ "text": text.slack }) }
    json!({
        "content": discord["content"], "text": text.slack,
        "event": {
            "category": cat, "kind": ev.kind, "summary": text.plain, "at": chrono::Utc::now(),
            "links": ev.links.iter().map(|(l, p)| json!({ "label": l, "url": format!("{base}{p}") })).collect::<Vec<_>>(),
        },
    })
}

async fn post_webhook(state: &AppState, url: &str, cat: &str, ev: &Event, text: &Rendered) -> Result<(), String> {
    let body = webhook_body(url, cat, ev, text, state.config.app_url.trim_end_matches('/'));
    let res = client().post(url).json(&body).send().await.map_err(|e| format!("Could not reach the webhook: {}", e.without_url()))?;
    if res.status().is_success() { Ok(()) } else { Err(format!("The webhook answered {}", res.status())) }
}

// ---- console activity --------------------------------------------------------------------------------------------

/// What a console action reads as ("suspended"), and the other categories it belongs to.
fn console_action(action: &str) -> (&'static str, &'static [&'static str]) {
    match action {
        "user.suspend" => ("suspended", &["users"]),
        "user.unsuspend" => ("lifted the suspension of", &["users"]),
        "user.delete" => ("deleted the account of", &["users"]),
        "user.purge" => ("purged", &["users"]),
        "user.purge_messages" => ("deleted the messages of", &["users"]),
        "user.purge_uploads" => ("deleted the uploads of", &["users"]),
        "user.promote" => ("made an admin:", &["users"]),
        "user.demote" => ("removed the admin roles of", &["users"]),
        "roles.set" => ("changed the admin roles of", &["users"]),
        "user.clear_mfa" => ("turned off two-factor sign-in for", &["users"]),
        "user.logout_all" => ("signed out every session of", &[]),
        "user.quota" | "user.upload_limit" => ("changed the upload limit of", &[]),
        "guild.delete" => ("deleted the server", &["servers"]),
        "guild.takedown" => ("took down the server", &["servers"]),
        "guild.invites_pause" => ("paused invites to", &["servers"]),
        "guild.invites_resume" => ("resumed invites to", &["servers"]),
        "sanction.create" => ("restricted", &["safety"]),
        "sanction.lift" => ("lifted a restriction on", &["safety"]),
        "abuse.review" => ("reviewed a spam flag on", &["safety"]),
        "safety.dm_spam" => ("acted on DM spam by", &["safety"]),
        "message.delete" => ("deleted a message by", &["safety"]),
        "report.authority" => ("reported to the authorities:", &["safety"]),
        "case.open" => ("opened a case", &["safety"]),
        "case.close" => ("closed a case", &["safety"]),
        "case.grant_request" => ("asked for more access on a case", &["safety"]),
        "case.export" => ("exported a case", &["safety"]),
        "settings.update" => ("changed the instance settings", &[]),
        "notifications.update" => ("changed where notifications go", &[]),
        "announce.post" => ("posted an announcement in", &[]),
        "badge.award" => ("gave a badge to", &["users"]),
        "badge.revoke" => ("took a badge back from", &["users"]),
        "badge.create" => ("made the badge", &[]),
        "badge.update" => ("changed the badge", &[]),
        "badge.delete" => ("deleted the badge", &[]),
        a if a.starts_with("discovery.") => ("changed the discovery listing of", &["servers"]),
        a if a.starts_with("report.") => ("updated the report on", &["safety"]),
        a if a.starts_with("safety.match.") => ("acted on a matched upload by", &["safety"]),
        a if a.starts_with("pii.") => ("looked up private details", &[]),
        _ => ("", &[]),
    }
}

/// The console page an action's target lives on.
fn console_page(action: &str, kind: &str, id: Option<Uuid>) -> Option<(&'static str, String)> {
    match (kind, id) {
        ("user", Some(id)) => return Some(("User", format!("/admin/users/{id}"))),
        ("guild", Some(id)) => return Some(("Server", format!("/admin/servers/{id}"))),
        ("report", Some(id)) => return Some(("Report", format!("/admin/reports?report={id}"))),
        ("case", Some(id)) => return Some(("Case", format!("/admin/cases/{id}"))),
        _ => {}
    }
    let section = action.split('.').next().unwrap_or_default();
    Some(match (section, kind) {
        (_, "theme") => ("Themes", "/admin/themes".into()),
        (_, "badge") => ("Badges", "/admin/badges".into()),
        (_, "cosmetic") => ("Cosmetics", "/admin/cosmetics".into()),
        (_, "mail") => ("Mail", "/admin/mail".into()),
        (_, "domain") => ("Blocked links", "/admin/blocked-links".into()),
        ("age", _) => ("Age checks", "/admin/age".into()),
        ("policies", _) => ("Policies", "/admin/policies".into()),
        ("abuse", _) | ("sanction", _) => ("Bans & limits", "/admin/sanctions".into()),
        ("notifications", _) => ("Notifications", "/admin/notifications".into()),
        ("settings", _) => ("Settings", "/admin/settings".into()),
        ("safety", _) if action.starts_with("safety.match") => ("Matching", "/admin/matching".into()),
        ("safety", _) if action.starts_with("safety.explicit") => ("Explicit images", "/admin/explicit".into()),
        ("safety", _) if action.starts_with("safety.link_feed") => ("Blocked links", "/admin/blocked-links".into()),
        _ => return None,
    })
}

/// A console action (from `audit::record`), as an event for the console category and any other it belongs to.
pub async fn console(state: &AppState, actor: Uuid, action: &str, target_kind: &str, target_id: Option<Uuid>, target_name: &str) {
    // Nothing to do (and no lookups) when no category this action reaches has a destination.
    let (verb, also) = console_action(action);
    let routes = load(&state.db).await;
    if !routes.contains_key("console") && !also.iter().any(|c| routes.contains_key(*c)) { return }
    let who = crate::audit::username(state, actor).await;
    let target = match (target_name.trim(), target_kind, target_id) {
        ("", "user", Some(id)) => crate::audit::username(state, id).await,
        ("", "guild", Some(id)) => crate::audit::guild_name(state, id).await,
        (n, _, _) => n.to_string(),
    };
    let target = if target.is_empty() { String::new() } else { format!(" **{}**", name(&target)) };
    let text = if verb.is_empty() { format!("**{}** did `{action}`{target}", name(&who)) } else { format!("**{}** {verb}{target}", name(&who)) };
    let mut ev = Event::new("console", action, text);
    for c in also { ev = ev.also(c) }
    if let Some((label, path)) = console_page(action, target_kind, target_id) { ev = ev.link(label, path) }
    ev = ev.link("Admin", format!("/admin/users/{actor}")).link("Audit log", "/admin/audit");
    send(state, ev);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_cannot_format_link_or_ping() {
        assert_eq!(name("**x** [a](https://e.x)"), "\\*\\*x\\*\\* \\[a\\]\\(https://e.x\\)");
        assert_eq!(name("@everyone"), "@\u{200b}everyone");
        assert_eq!(name("a\nb"), "a b");
        assert_eq!(name("  "), "(no name)");
        assert_eq!(unescape(&name("*hi* @here")), "*hi* @\u{200b}here");
    }

    #[test]
    fn routes_round_trip_and_ignore_unknown_categories() {
        let id = Uuid::now_v7();
        let v = json!({ "users": { "channel_id": id, "webhook_url": "" }, "safety": { "channel_id": null, "webhook_url": "https://hooks.slack.com/x" }, "bogus": {} });
        let r = parse(&v);
        assert_eq!(r.len(), 2);
        assert_eq!(r["users"].channel_id, Some(id));
        assert_eq!(parse(&to_json(&r)), r);
    }

    #[test]
    fn webhooks_get_their_own_shape() {
        let ev = Event::new("users", "user.signup", format!("New account **{}**", name("a_b"))).user(Uuid::nil());
        let text = Rendered { channel: String::new(), discord: "**Users** · New account **a\\_b**".into(), slack: "*Users* · New account *a_b*".into(), plain: "New account a_b".into() };
        let d = webhook_body("https://discord.com/api/webhooks/1/t", "users", &ev, &text, "https://p.example");
        assert_eq!(d["allowed_mentions"]["parse"], json!([]));
        assert!(d.get("event").is_none());
        assert_eq!(webhook_body("https://hooks.slack.com/services/x", "users", &ev, &text, ""), json!({ "text": text.slack }));
        let g = webhook_body("https://example.org/hook", "users", &ev, &text, "https://p.example");
        assert_eq!(g["event"]["links"][0]["url"], format!("https://p.example/admin/users/{}", Uuid::nil()));
        assert_eq!(g["event"]["summary"], "New account a_b");
        assert!(webhook_host("ftp://x").is_none() && webhook_host("javascript:alert(1)").is_none());
    }

    #[test]
    fn console_actions_link_to_their_page() {
        let id = Uuid::nil();
        assert_eq!(console_page("user.suspend", "user", Some(id)).unwrap().1, format!("/admin/users/{id}"));
        assert_eq!(console_page("report.evidence", "report", Some(id)).unwrap().1, format!("/admin/reports?report={id}"));
        assert_eq!(console_page("age.settings.update", "instance", None).unwrap().1, "/admin/age");
        assert_eq!(console_page("safety.matching.update", "instance", None).unwrap().1, "/admin/matching");
        assert!(console_page("something.new", "instance", None).is_none());
        assert_eq!(console_action("user.suspend").1, ["users"]);
    }

    #[test]
    fn the_budget_holds_back_and_counts() {
        for _ in 0..PER_MINUTE { assert_eq!(take("servers"), Some(0)); }
        assert_eq!(take("servers"), None);
        assert_eq!(take("servers"), None);
        // A new minute: the next one through says how many were held back.
        budget().lock().unwrap().get_mut("servers").unwrap().0 = Instant::now() - Duration::from_secs(61);
        assert_eq!(take("servers"), Some(2));
    }
}
