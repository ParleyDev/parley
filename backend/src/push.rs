//! Push notifications for the native apps through Firebase Cloud Messaging (HTTP v1). Configured in Instance
//! Settings (`fcm_service_account`: a Firebase service-account JSON; `fcm_endpoint` overrides the Google hosts for
//! tests). Without it, tokens are stored but nothing is sent. Pushes go to users who are mentioned or DM'd while
//! they have no open socket anywhere, honouring their mute settings; dead tokens are dropped on UNREGISTERED.

use crate::state::AppState;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use uuid::Uuid;

#[derive(Deserialize)]
struct ServiceAccount { project_id: String, client_email: String, private_key: String }

struct Fcm { project: String, email: String, key: jsonwebtoken::EncodingKey, endpoint: String }

/// OAuth access tokens by service-account email (they last an hour).
static TOKENS: OnceLock<Mutex<HashMap<String, (String, Instant)>>> = OnceLock::new();

/// Parse the service account out of Instance Settings; Err(message) when it is set but unusable.
pub fn parse(json: &str) -> Result<(String, String), String> {
    let sa: ServiceAccount = serde_json::from_str(json).map_err(|e| format!("not a service-account JSON: {e}"))?;
    jsonwebtoken::EncodingKey::from_rsa_pem(sa.private_key.as_bytes()).map_err(|e| format!("private_key: {e}"))?;
    Ok((sa.project_id, sa.client_email))
}

async fn fcm(state: &AppState) -> Option<Fcm> {
    let s = crate::routes::admin::load_settings(&state.db).await.ok()?;
    if s.fcm_service_account.trim().is_empty() { return None; }
    let sa: ServiceAccount = serde_json::from_str(&s.fcm_service_account).ok()?;
    let key = jsonwebtoken::EncodingKey::from_rsa_pem(sa.private_key.as_bytes()).ok()?;
    Some(Fcm { project: sa.project_id, email: sa.client_email, key, endpoint: s.fcm_endpoint.trim().trim_end_matches('/').to_string() })
}

pub async fn enabled(state: &AppState) -> bool { fcm(state).await.is_some() }

#[derive(serde::Serialize)]
struct Claims<'a> { iss: &'a str, scope: &'a str, aud: &'a str, iat: i64, exp: i64 }

fn token_url(f: &Fcm) -> String { if f.endpoint.is_empty() { "https://oauth2.googleapis.com/token".into() } else { format!("{}/token", f.endpoint) } }
fn send_url(f: &Fcm) -> String { if f.endpoint.is_empty() { format!("https://fcm.googleapis.com/v1/projects/{}/messages:send", f.project) } else { format!("{}/v1/projects/{}/messages:send", f.endpoint, f.project) } }

async fn access_token(f: &Fcm) -> Option<String> {
    let cache = TOKENS.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((t, at)) = cache.lock().ok()?.get(&f.email).cloned() { if at.elapsed() < Duration::from_secs(50 * 60) { return Some(t); } }
    let now = chrono::Utc::now().timestamp();
    let aud = token_url(f);
    let jwt = jsonwebtoken::encode(&jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256), &Claims { iss: &f.email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: &aud, iat: now, exp: now + 3600 }, &f.key).ok()?;
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client.post(&aud).form(&[("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"), ("assertion", &jwt)]).send().await.ok()?.json().await.ok()?;
    let token = resp.get("access_token")?.as_str()?.to_string();
    if let Ok(mut g) = cache.lock() { g.insert(f.email.clone(), (token.clone(), Instant::now())); }
    Some(token)
}

/// Send one notification to one device token. Err(true) means the token is dead and should be removed.
async fn send_one(f: &Fcm, token: &str, title: &str, body: &str, data: &serde_json::Value) -> Result<(), bool> {
    let at = access_token(f).await.ok_or(false)?;
    let msg = json!({ "message": { "token": token, "notification": { "title": title, "body": body }, "data": data,
        "android": { "priority": "high", "notification": { "channel_id": "messages" } },
        "apns": { "payload": { "aps": { "sound": "default" } } } } });
    let resp = reqwest::Client::new().post(send_url(f)).bearer_auth(at).json(&msg).send().await.map_err(|_| false)?;
    if resp.status().is_success() { return Ok(()); }
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    let dead = status.as_u16() == 404 || text.contains("UNREGISTERED") || text.contains("INVALID_ARGUMENT");
    tracing::warn!(%status, dead, "FCM send failed: {}", text.chars().take(200).collect::<String>());
    Err(dead)
}

/// Notify `users` (already filtered to offline, unmuted recipients) about a message.
pub async fn notify(state: &AppState, users: &[Uuid], title: &str, body: &str, data: serde_json::Value) {
    let Some(f) = fcm(state).await else { return };
    let f = &f;
    if users.is_empty() { return; }
    let rows: Vec<(String, Uuid)> = match sqlx::query_as("SELECT token, user_id FROM push_tokens WHERE user_id = ANY($1)").bind(users).fetch_all(&state.db).await { Ok(r) => r, Err(_) => return };
    for (token, _) in rows {
        if let Err(dead) = send_one(f, &token, title, body, &data).await {
            if dead { let _ = sqlx::query("DELETE FROM push_tokens WHERE token = $1").bind(&token).execute(&state.db).await; }
        } else {
            crate::metrics::METRICS.push_sent.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
    }
}

/// After a message is created: push to DM recipients and mentioned members who have no socket open and have not
/// muted the channel or server. Runs in the background; never blocks the request.
pub fn after_message(state: AppState, msg: crate::models::Message, channel: crate::models::Channel) {
    tokio::spawn(async move {
        let push_on = enabled(&state).await;
        let mail_on = crate::mail::enabled(&state.config);
        if !push_on && !mail_on { return; }
        let online = crate::ws::bus::online_users(&state.db).await;
        let candidates: Vec<Uuid> = if channel.guild_id.is_none() {
            sqlx::query_as::<_, (Uuid,)>("SELECT user_id FROM channel_members WHERE channel_id = $1 AND user_id <> $2").bind(channel.id).bind(msg.author.id).fetch_all(&state.db).await.unwrap_or_default().into_iter().map(|r| r.0).collect()
        } else {
            msg.mentions.iter().copied().filter(|u| *u != msg.author.id).collect()
        };
        let mut targets: Vec<Uuid> = Vec::new();   // push: offline, or online but idle past their timeout
        let mut mail_to: Vec<Uuid> = Vec::new();   // email: offline, opted in, not mailed in the last hour
        for u in candidates {
            let muted: Option<(bool,)> = sqlx::query_as(
                "SELECT true FROM notification_settings WHERE user_id = $1 AND target_id = ANY($2) AND (level = 'nothing' OR (muted_until IS NOT NULL AND muted_until > now())) LIMIT 1",
            ).bind(u).bind(&[Some(channel.id), channel.guild_id].into_iter().flatten().collect::<Vec<Uuid>>()).fetch_optional(&state.db).await.unwrap_or(None);
            if muted.is_some() { continue; }
            if online.contains(&u) {
                // Online somewhere: push only once they have been idle longer than their inactive timeout.
                let idle: Option<(bool,)> = sqlx::query_as(
                    "SELECT COALESCE(active_at, now()) < now() - make_interval(mins => COALESCE((notif_prefs->>'push_timeout_min')::int, 10)) FROM users WHERE id = $1",
                ).bind(u).fetch_optional(&state.db).await.unwrap_or(None);
                if idle.map(|x| x.0).unwrap_or(false) { targets.push(u); }
                continue;
            }
            targets.push(u);
            if mail_on {
                let wants: Option<(bool,)> = sqlx::query_as(
                    "SELECT COALESCE((notif_prefs->>'email_dms')::bool, true) AND (notify_mailed_at IS NULL OR notify_mailed_at < now() - interval '1 hour') FROM users WHERE id = $1",
                ).bind(u).fetch_optional(&state.db).await.unwrap_or(None);
                if wants.map(|x| x.0).unwrap_or(false) { mail_to.push(u); }
            }
        }
        if !mail_to.is_empty() {
            let where_ = if let Some(gid) = channel.guild_id {
                let g: Option<(String,)> = sqlx::query_as("SELECT name FROM guilds WHERE id = $1").bind(gid).fetch_optional(&state.db).await.unwrap_or(None);
                format!("#{} in {}", channel.name, g.map(|x| x.0).unwrap_or_default())
            } else { "a direct message".to_string() };
            let snippet: String = if msg.content.is_empty() { "(an attachment)".into() } else { msg.content.chars().take(200).collect() };
            for u in &mail_to {
                if let Ok((email,)) = sqlx::query_as::<_, (String,)>("UPDATE users SET notify_mailed_at = now() WHERE id = $1 RETURNING email").bind(u).fetch_one(&state.db).await {
                    let body = format!("{} sent you a message in {}:\n\n{}\n\nOpen Parley: {}\n\nYou get at most one of these an hour while you are away. Turn them off in Settings → Notifications.", msg.author.display_name, where_, snippet, state.config.app_url);
                    let _ = crate::mail::send(&state.config, &email, &format!("New message from {}", msg.author.display_name), &body).await;
                }
            }
        }
        if !push_on || targets.is_empty() { return; }
        let where_ = if let Some(gid) = channel.guild_id {
            let g: Option<(String,)> = sqlx::query_as("SELECT name FROM guilds WHERE id = $1").bind(gid).fetch_optional(&state.db).await.unwrap_or(None);
            format!("#{} · {}", channel.name, g.map(|x| x.0).unwrap_or_default())
        } else { "Direct message".to_string() };
        let title = format!("{} ({})", msg.author.display_name, where_);
        let body = if msg.content.is_empty() { if msg.attachments.is_empty() { "Sent a message".to_string() } else { "Sent an attachment".to_string() } } else { msg.content.chars().take(160).collect() };
        notify(&state, &targets, &title, &body, json!({ "channel_id": channel.id, "guild_id": channel.guild_id, "message_id": msg.id })).await;
    });
}
