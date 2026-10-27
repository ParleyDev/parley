//! Webhooks: a secret URL that posts into one channel without logging in (CI, monitoring, feeds). Each webhook is
//! authored by a hidden bot user; a message may set the name and avatar shown, and carry rich embeds.
//! Manage Channels creates and edits them. Executions are rate limited per webhook (`RL_WEBHOOKS`).

use crate::{auth::AuthUser, error::{AppError, AppResult}, models::{Channel, Message}, perms, state::AppState};
use axum::{extract::{Path, Query, State}, http::StatusCode, middleware::from_fn, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

use super::channels::{fetch_message, parse_mentions, require_channel_perms, target_for};
use super::guilds::CHANNEL_COLS;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/webhooks", get(list_channel).post(create))
        .route("/guilds/:id/webhooks", get(list_guild))
        .route("/guilds/:id/integrations", get(integrations))
        .route("/webhooks/:id", axum::routing::patch(update).delete(remove))
        .route("/webhooks/:id/reset-token", post(reset_token))
        .route("/webhooks/:id/:token", get(info).post(execute).route_layer(from_fn(crate::ratelimit::rl_webhooks)))
}

#[derive(Serialize, sqlx::FromRow)]
struct Webhook { id: Uuid, guild_id: Uuid, channel_id: Uuid, name: String, avatar_url: Option<String>, creator_id: Option<Uuid>, created_at: chrono::DateTime<chrono::Utc> }
const COLS: &str = "id, guild_id, channel_id, name, avatar_url, creator_id, created_at";

fn clean_name(n: &str) -> AppResult<String> {
    let n: String = n.trim().chars().take(80).collect();
    if n.is_empty() { return Err(AppError::BadRequest("Give the webhook a name".into())) }
    Ok(n)
}

async fn manage(state: &AppState, channel_id: Uuid, uid: Uuid) -> AppResult<Channel> {
    let (c, p) = require_channel_perms(&state.db, channel_id, uid).await?;
    if c.guild_id.is_none() || !matches!(c.kind.as_str(), "text" | "forum") { return Err(AppError::BadRequest("Webhooks post into server text channels".into())) }
    perms::check(p, perms::MANAGE_CHANNELS)?;
    Ok(c)
}

#[derive(Deserialize)]
struct CreateIn { name: String, #[serde(default)] avatar_url: Option<String> }

/// `POST /channels/:id/webhooks`: returns the webhook with its URL token (shown only now and on reset).
async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(cid): Path<Uuid>, Json(req): Json<CreateIn>) -> AppResult<(StatusCode, Json<Value>)> {
    let c = manage(&state, cid, uid).await?;
    let gid = c.guild_id.unwrap_or_default();
    let name = clean_name(&req.name)?;
    let avatar = req.avatar_url.filter(|a| !a.is_empty());
    crate::routes::users::validate_image(&avatar)?;
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM webhooks WHERE channel_id = $1").bind(cid).fetch_one(&state.db).await?;
    if n >= 15 { return Err(AppError::BadRequest("A channel can have up to 15 webhooks".into())) }
    let (id, user_id) = (Uuid::now_v7(), Uuid::now_v7());
    let token = crate::mail::new_token();
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO users (id, username, display_name, email, password_hash, bot, webhook, avatar_url, email_verified_at) VALUES ($1, $2, $3, $4, $5, true, true, $6, now())")
        .bind(user_id).bind(format!("webhook_{}", &id.simple().to_string()[..12])).bind(&name).bind(format!("{id}@webhooks.invalid"))
        .bind(crate::auth::hash_password(&crate::mail::new_token())?).bind(&avatar).execute(&mut *tx).await?;
    let w = sqlx::query_as::<_, Webhook>(&format!("INSERT INTO webhooks (id, guild_id, channel_id, user_id, name, avatar_url, token_hash, creator_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING {COLS}"))
        .bind(id).bind(gid).bind(cid).bind(user_id).bind(&name).bind(&avatar).bind(crate::routes::applications::hash(&token)).bind(uid).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    crate::audit::guild(&state, gid, uid, "webhook.create", "webhook", Some(id), &name, json!({ "channel": c.name })).await;
    Ok((StatusCode::CREATED, Json(json!({ "webhook": w, "token": token }))))
}

async fn list_channel(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(cid): Path<Uuid>) -> AppResult<Json<Vec<Webhook>>> {
    manage(&state, cid, uid).await?;
    Ok(Json(sqlx::query_as::<_, Webhook>(&format!("SELECT {COLS} FROM webhooks WHERE channel_id = $1 ORDER BY created_at")).bind(cid).fetch_all(&state.db).await?))
}

async fn list_guild(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Vec<Webhook>>> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    Ok(Json(sqlx::query_as::<_, Webhook>(&format!("SELECT {COLS} FROM webhooks WHERE guild_id = $1 ORDER BY created_at")).bind(gid).fetch_all(&state.db).await?))
}

async fn owned(state: &AppState, id: Uuid, uid: Uuid) -> AppResult<(Webhook, Uuid)> {
    let row: Option<(Uuid, Uuid)> = sqlx::query_as("SELECT channel_id, user_id FROM webhooks WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let (cid, wuser) = row.ok_or_else(|| AppError::NotFound("Webhook not found".into()))?;
    manage(state, cid, uid).await?;
    Ok((sqlx::query_as::<_, Webhook>(&format!("SELECT {COLS} FROM webhooks WHERE id = $1")).bind(id).fetch_one(&state.db).await?, wuser))
}

#[derive(Deserialize)]
struct UpdateIn { name: Option<String>, #[serde(default, deserialize_with = "nullable")] avatar_url: Option<Option<String>>, channel_id: Option<Uuid> }
fn nullable<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> { Ok(Some(Option::<String>::deserialize(d)?.filter(|s| !s.is_empty()))) }

async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<UpdateIn>) -> AppResult<Json<Webhook>> {
    let (w, wuser) = owned(&state, id, uid).await?;
    let name = match &req.name { Some(n) => clean_name(n)?, None => w.name.clone() };
    let avatar = match req.avatar_url { Some(a) => a, None => w.avatar_url.clone() };
    crate::routes::users::validate_image(&avatar)?;
    let channel = match req.channel_id {
        Some(c) if c != w.channel_id => { let to = manage(&state, c, uid).await?; if to.guild_id != Some(w.guild_id) { return Err(AppError::BadRequest("Pick a channel in the same server".into())) } c }
        _ => w.channel_id,
    };
    sqlx::query("UPDATE users SET display_name = $2, avatar_url = $3 WHERE id = $1").bind(wuser).bind(&name).bind(&avatar).execute(&state.db).await?;
    Ok(Json(sqlx::query_as::<_, Webhook>(&format!("UPDATE webhooks SET name = $2, avatar_url = $3, channel_id = $4 WHERE id = $1 RETURNING {COLS}")).bind(id).bind(&name).bind(&avatar).bind(channel).fetch_one(&state.db).await?))
}

/// Deleting a webhook keeps its messages (their author becomes "Deleted webhook").
async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let (w, wuser) = owned(&state, id, uid).await?;
    sqlx::query("DELETE FROM webhooks WHERE id = $1").bind(id).execute(&state.db).await?;
    sqlx::query("UPDATE users SET display_name = 'Deleted webhook', avatar_url = NULL WHERE id = $1").bind(wuser).execute(&state.db).await?;
    crate::audit::guild(&state, w.guild_id, uid, "webhook.delete", "webhook", Some(id), &w.name, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn reset_token(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    owned(&state, id, uid).await?;
    let token = crate::mail::new_token();
    sqlx::query("UPDATE webhooks SET token_hash = $2 WHERE id = $1").bind(id).bind(crate::routes::applications::hash(&token)).execute(&state.db).await?;
    Ok(Json(json!({ "token": token })))
}

/// The webhook a URL names, if the token matches: (webhook, author user).
async fn by_token(state: &AppState, id: Uuid, token: &str) -> AppResult<(Webhook, Uuid)> {
    let row: Option<(Uuid, String)> = sqlx::query_as("SELECT user_id, token_hash FROM webhooks WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    match row {
        Some((user, hash)) if hash == crate::routes::applications::hash(token) => Ok((sqlx::query_as::<_, Webhook>(&format!("SELECT {COLS} FROM webhooks WHERE id = $1")).bind(id).fetch_one(&state.db).await?, user)),
        _ => Err(AppError::NotFound("Unknown webhook".into())),
    }
}

/// `GET /webhooks/:id/:token`: what the URL posts as (for tools checking their configuration).
async fn info(State(state): State<AppState>, Path((id, token)): Path<(Uuid, String)>) -> AppResult<Json<Webhook>> {
    Ok(Json(by_token(&state, id, &token).await?.0))
}

#[derive(Deserialize, Default)]
struct AllowedMentions { #[serde(default)] parse: Vec<String> }
#[derive(Deserialize)]
struct ExecuteIn {
    #[serde(default)] content: String,
    username: Option<String>,
    avatar_url: Option<String>,
    embeds: Option<Value>,
    /// Which mentions ping: "users", "roles", "everyone". Default: users only.
    allowed_mentions: Option<AllowedMentions>,
}
#[derive(Deserialize, Default)]
struct ExecQ { #[serde(default)] wait: bool }

/// `POST /webhooks/:id/:token[?wait=true]`: post a message (content and/or embeds). 204, or the message with wait.
async fn execute(State(state): State<AppState>, Path((id, token)): Path<(Uuid, String)>, Query(q): Query<ExecQ>, Json(req): Json<ExecuteIn>) -> AppResult<axum::response::Response> {
    use axum::response::IntoResponse;
    let (w, author) = by_token(&state, id, &token).await?;
    let content: String = req.content.trim_end().to_string();
    if content.chars().count() > 2000 { return Err(AppError::BadRequest("content is at most 2000 characters".into())) }
    let embeds = match &req.embeds { Some(e) if e.as_array().map(|a| !a.is_empty()).unwrap_or(false) => Some(clean_embeds(e)?), _ => None };
    if content.trim().is_empty() && embeds.is_none() { return Err(AppError::BadRequest("Send content or at least one embed".into())) }
    let username = req.username.map(|u| u.trim().chars().take(80).collect::<String>()).filter(|u| !u.is_empty());
    let avatar = req.avatar_url.filter(|a| a.starts_with("https://") || a.starts_with("/api/images/"));
    let author_override = (username.is_some() || avatar.is_some()).then(|| json!({ "name": username, "avatar_url": avatar }));
    let c = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(w.channel_id).fetch_one(&state.db).await?;
    let parse = req.allowed_mentions.unwrap_or(AllowedMentions { parse: vec!["users".into()] }).parse;
    let (u, r, e) = parse_mentions(&content);
    let users = if parse.iter().any(|p| p == "users") { u } else { vec![] };
    let roles = if parse.iter().any(|p| p == "roles") { r } else { vec![] };
    let everyone = e && parse.iter().any(|p| p == "everyone");
    crate::routes::safety::check_links(&state, &content).await?;
    let mid = Uuid::now_v7();
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, mentions, mention_roles, mention_everyone, webhook_id, author_override, embeds) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)")
        .bind(mid).bind(c.id).bind(author).bind(&content).bind(&users).bind(&roles).bind(everyone).bind(id).bind(&author_override).bind(&embeds)
        .execute(&state.db).await?;
    crate::metrics::METRICS.messages_created.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let msg: Message = fetch_message(&state.db, mid, author).await?;
    state.hub.emit(target_for(&state.db, &c).await?, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": c.guild_id }));
    crate::push::after_message(state.clone(), msg.clone(), c.clone());
    Ok(if q.wait { Json(msg).into_response() } else { StatusCode::NO_CONTENT.into_response() })
}

fn text(v: &Value, key: &str, max: usize) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(|s| s.trim().chars().take(max).collect::<String>()).filter(|s| !s.is_empty())
}
fn url(v: &Value, key: &str) -> AppResult<Option<String>> {
    match v.get(key).and_then(Value::as_str) {
        None | Some("") => Ok(None),
        Some(u) if (u.starts_with("https://") || u.starts_with("http://")) && u.len() <= 2048 => Ok(Some(u.to_string())),
        Some(_) => Err(AppError::BadRequest(format!("embed {key} must be an http(s) URL"))),
    }
}

/// Rich embeds, rebuilt from only the known fields with Discord's limits: up to 10 embeds and 6000 characters in
/// all; title 256, description 4096, up to 25 fields (name 256, value 1024), footer 2048, author 256.
pub fn clean_embeds(v: &Value) -> AppResult<Value> {
    let list = v.as_array().ok_or_else(|| AppError::BadRequest("embeds must be a list".into()))?;
    if list.len() > 10 { return Err(AppError::BadRequest("Up to 10 embeds".into())) }
    let mut total = 0usize;
    let mut out = Vec::new();
    for e in list {
        let mut m = Map::new();
        let mut put = |k: &str, s: Option<String>, total: &mut usize| { if let Some(s) = s { *total += s.chars().count(); m.insert(k.into(), Value::String(s)); } };
        put("title", text(e, "title", 256), &mut total);
        put("description", text(e, "description", 4096), &mut total);
        if let Some(u) = url(e, "url")? { m.insert("url".into(), json!(u)); }
        if let Some(c) = e.get("color").and_then(Value::as_u64) { m.insert("color".into(), json!(c.min(0xFF_FF_FF))); }
        if let Some(t) = e.get("timestamp").and_then(Value::as_str) {
            let t = chrono::DateTime::parse_from_rfc3339(t).map_err(|_| AppError::BadRequest("embed timestamp must be ISO 8601".into()))?;
            m.insert("timestamp".into(), json!(t.with_timezone(&chrono::Utc)));
        }
        if let Some(a) = e.get("author") {
            let name = text(a, "name", 256).ok_or_else(|| AppError::BadRequest("embed author needs a name".into()))?;
            total += name.chars().count();
            m.insert("author".into(), json!({ "name": name, "url": url(a, "url")?, "icon_url": url(a, "icon_url")? }));
        }
        if let Some(f) = e.get("footer") {
            let t = text(f, "text", 2048).ok_or_else(|| AppError::BadRequest("embed footer needs text".into()))?;
            total += t.chars().count();
            m.insert("footer".into(), json!({ "text": t, "icon_url": url(f, "icon_url")? }));
        }
        for k in ["image", "thumbnail"] {
            if let Some(i) = e.get(k) { if let Some(u) = url(i, "url")? { m.insert(k.into(), json!({ "url": u })); } }
        }
        if let Some(fs) = e.get("fields").and_then(Value::as_array) {
            if fs.len() > 25 { return Err(AppError::BadRequest("Up to 25 fields per embed".into())) }
            let mut fields = Vec::new();
            for f in fs {
                let (Some(n), Some(v)) = (text(f, "name", 256), text(f, "value", 1024)) else { return Err(AppError::BadRequest("embed fields need a name and a value".into())) };
                total += n.chars().count() + v.chars().count();
                fields.push(json!({ "name": n, "value": v, "inline": f.get("inline").and_then(Value::as_bool).unwrap_or(false) }));
            }
            if !fields.is_empty() { m.insert("fields".into(), json!(fields)); }
        }
        if m.is_empty() { return Err(AppError::BadRequest("An embed needs at least one field".into())) }
        out.push(Value::Object(m));
    }
    if total > 6000 { return Err(AppError::BadRequest("Embeds can hold 6000 characters in all".into())) }
    Ok(Value::Array(out))
}

#[cfg(test)]
mod tests {
    use super::clean_embeds;
    use serde_json::json;
    #[test]
    fn embeds_are_cleaned() {
        let v = clean_embeds(&json!([{ "title": "Build passed", "color": 3066993, "fields": [{ "name": "Branch", "value": "main", "inline": true }], "evil": "<script>" }])).unwrap();
        assert_eq!(v[0]["title"], "Build passed");
        assert!(v[0].get("evil").is_none());
        assert!(clean_embeds(&json!([{ "url": "javascript:alert(1)" }])).is_err());
        assert!(clean_embeds(&json!([{}])).is_err());
        assert!(clean_embeds(&json!((0..11).map(|_| json!({ "title": "x" })).collect::<Vec<_>>())).is_err());
    }
}

/// `GET /guilds/:id/integrations` (Manage Server): bots in the server, its webhooks, and announcement channels its
/// channels follow.
async fn integrations(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Value>> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    let bots: Vec<(Uuid, String, Option<String>, chrono::DateTime<chrono::Utc>, Option<String>, Option<Uuid>)> = sqlx::query_as(
        "SELECT u.id, u.display_name, u.avatar_url, m.joined_at, a.name, a.id FROM guild_members m JOIN users u ON u.id = m.user_id
         LEFT JOIN applications a ON a.bot_user_id = u.id WHERE m.guild_id = $1 AND u.bot AND NOT u.webhook ORDER BY m.joined_at")
        .bind(gid).fetch_all(&state.db).await?;
    let hooks: Vec<(Uuid, String, Option<String>, Uuid, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT w.id, w.name, w.avatar_url, c.id, c.name, w.created_at FROM webhooks w JOIN channels c ON c.id = w.channel_id WHERE w.guild_id = $1 ORDER BY c.position, w.created_at")
        .bind(gid).fetch_all(&state.db).await?;
    let follows: Vec<(Uuid, String, Uuid, String, String)> = sqlx::query_as(
        "SELECT t.id, t.name, s.id, s.name, g.name FROM channel_follows f JOIN channels t ON t.id = f.target_id JOIN channels s ON s.id = f.source_id JOIN guilds g ON g.id = s.guild_id
         WHERE t.guild_id = $1 ORDER BY t.position")
        .bind(gid).fetch_all(&state.db).await?;
    Ok(Json(json!({
        "bots": bots.iter().map(|(id, name, avatar, at, app, app_id)| json!({ "id": id, "display_name": name, "avatar_url": avatar, "joined_at": at, "application": app, "application_id": app_id })).collect::<Vec<_>>(),
        "webhooks": hooks.iter().map(|(id, name, avatar, cid, cname, at)| json!({ "id": id, "name": name, "avatar_url": avatar, "channel_id": cid, "channel_name": cname, "created_at": at })).collect::<Vec<_>>(),
        "follows": follows.iter().map(|(tid, tname, sid, sname, gname)| json!({ "channel_id": tid, "channel_name": tname, "source_id": sid, "source_name": sname, "source_guild": gname })).collect::<Vec<_>>(),
    })))
}
