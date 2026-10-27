//! Twitch and YouTube server integrations (Discord's subscriber roles). A creator links their channel with
//! subscriber access (`/connections/:provider/start?creator=1`) and adds it to a server they manage; the server gets
//! a managed role ("Twitch Subscriber" / "YouTube Member") held by every member whose linked account subscribes to
//! (or is a paying member of) that channel. Synced when added, when members link or unlink accounts, on demand,
//! and every 15 minutes in the background.

use crate::{auth::AuthUser, error::{AppError, AppResult}, perms, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::{delete, get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/integrations/creators", get(list).post(add))
        .route("/guilds/:id/integrations/creators/:iid", delete(remove))
        .route("/guilds/:id/integrations/creators/:iid/sync", post(sync_now))
}

#[derive(Serialize, sqlx::FromRow)]
struct Integration {
    id: Uuid,
    provider: String,
    role_id: Option<Uuid>,
    account_name: String,
    account_url: String,
    added_by: Uuid,
    synced_at: Option<chrono::DateTime<chrono::Utc>>,
    member_count: i32,
    last_error: String,
}

const SELECT: &str = "SELECT i.id, i.provider, i.role_id, c.name AS account_name, c.url AS account_url, i.added_by, i.synced_at, i.member_count, i.last_error
    FROM guild_integrations i JOIN connections c ON c.id = i.connection_id";

fn role_name(provider: &str) -> &'static str { if provider == "twitch" { "Twitch Subscriber" } else { "YouTube Member" } }
fn role_color(provider: &str) -> &'static str { if provider == "twitch" { "#9146ff" } else { "#ff0033" } }

async fn manage(state: &AppState, gid: Uuid, uid: Uuid) -> AppResult<()> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)
}

async fn fetch(state: &AppState, gid: Uuid, iid: Uuid) -> AppResult<Integration> {
    sqlx::query_as::<_, Integration>(&format!("{SELECT} WHERE i.guild_id = $1 AND i.id = $2")).bind(gid).bind(iid).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Integration not found".into()))
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Vec<Integration>>> {
    manage(&state, gid, uid).await?;
    Ok(Json(sqlx::query_as::<_, Integration>(&format!("{SELECT} WHERE i.guild_id = $1 ORDER BY i.created_at")).bind(gid).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
struct AddReq { provider: String }

/// `POST /guilds/:id/integrations/creators {provider}`: link your creator account (made with `?creator=1`) to this server.
async fn add(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<AddReq>) -> AppResult<(StatusCode, Json<Integration>)> {
    manage(&state, gid, uid).await?;
    if !["twitch", "youtube"].contains(&req.provider.as_str()) { return Err(AppError::BadRequest("Twitch or YouTube".into())); }
    let conn: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM connections WHERE user_id = $1 AND provider = $2 AND creator AND access_token IS NOT NULL ORDER BY created_at DESC LIMIT 1")
        .bind(uid).bind(&req.provider).fetch_optional(&state.db).await?;
    let Some((cid,)) = conn else { return Err(AppError::BadRequest("Link your channel first (with subscriber access)".into())) };
    let exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM guild_integrations WHERE guild_id = $1 AND provider = $2").bind(gid).bind(&req.provider).fetch_optional(&state.db).await?;
    if exists.is_some() { return Err(AppError::Conflict("This server already has that integration".into())); }
    let iid = Uuid::now_v7();
    let rid = create_role(&state, gid, &req.provider).await?;
    sqlx::query("INSERT INTO guild_integrations (id, guild_id, provider, connection_id, role_id, added_by) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(iid).bind(gid).bind(&req.provider).bind(cid).bind(rid).bind(uid).execute(&state.db).await?;
    crate::audit::guild(&state, gid, uid, "integration.create", "integration", Some(iid), role_name(&req.provider), json!({ "provider": req.provider })).await;
    let _ = sync(&state, iid).await;
    Ok((StatusCode::CREATED, Json(fetch(&state, gid, iid).await?)))
}

async fn create_role(state: &AppState, gid: Uuid, provider: &str) -> AppResult<Uuid> {
    let rid = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE roles SET position = position + 1 WHERE guild_id = $1 AND position >= 1").bind(gid).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO roles (id, guild_id, name, color, position, permissions, hoist) VALUES ($1, $2, $3, $4, 1, 0, true)")
        .bind(rid).bind(gid).bind(role_name(provider)).bind(role_color(provider)).execute(&mut *tx).await?;
    tx.commit().await?;
    crate::routes::roles::emit_roles(state, gid).await?;
    Ok(rid)
}

/// Removing the integration takes its role (and everyone's copy of it) with it.
async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, iid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    manage(&state, gid, uid).await?;
    let i = fetch(&state, gid, iid).await?;
    let before = perms::visibility(&state.db, gid).await?;
    sqlx::query("DELETE FROM guild_integrations WHERE id = $1").bind(iid).execute(&state.db).await?;
    if let Some(rid) = i.role_id { sqlx::query("DELETE FROM roles WHERE id = $1 AND guild_id = $2").bind(rid).bind(gid).execute(&state.db).await?; }
    perms::resync_visibility(&state, gid, &before).await?;
    crate::routes::roles::emit_roles(&state, gid).await?;
    crate::audit::guild(&state, gid, uid, "integration.delete", "integration", Some(iid), role_name(&i.provider), json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn sync_now(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, iid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Integration>> {
    manage(&state, gid, uid).await?;
    fetch(&state, gid, iid).await?;
    let _ = sync(&state, iid).await;
    Ok(Json(fetch(&state, gid, iid).await?))
}

/// Is this role run by an integration (so it can't be handed out by hand)?
pub async fn is_managed(db: &sqlx::PgPool, rid: Uuid) -> AppResult<bool> {
    Ok(sqlx::query_as::<_, (bool,)>("SELECT EXISTS (SELECT 1 FROM guild_integrations WHERE role_id = $1)").bind(rid).fetch_one(db).await?.0)
}

/// A fresh access token for a creator connection, refreshing (and saving) it when it has expired.
async fn token(state: &AppState, provider: &str, cid: Uuid) -> Result<(String, crate::routes::connections::Creds), String> {
    let c = crate::routes::connections::creds(state, provider).await.map_err(|e| e.to_string())?;
    let (access, refresh, exp): (Option<String>, Option<String>, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as("SELECT access_token, refresh_token, token_expires_at FROM connections WHERE id = $1").bind(cid).fetch_one(&state.db).await.map_err(|e| e.to_string())?;
    let fresh = exp.map(|e| e > chrono::Utc::now() + chrono::Duration::seconds(60)).unwrap_or(true);
    if let (Some(a), true) = (&access, fresh) { return Ok((a.clone(), c)); }
    let Some(r) = refresh else { return Err("The channel's access expired: link it again".into()) };
    let url = crate::routes::connections::with_override(if provider == "twitch" { "https://id.twitch.tv/oauth2/token" } else { "https://oauth2.googleapis.com/token" }, &c.over);
    let tok: Value = reqwest::Client::new().post(url).form(&[("client_id", c.client_id.as_str()), ("client_secret", c.client_secret.as_str()), ("grant_type", "refresh_token"), ("refresh_token", r.as_str())])
        .send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let Some(a) = tok.get("access_token").and_then(|v| v.as_str()) else { return Err("The channel's access was revoked: link it again".into()) };
    let exp = tok.get("expires_in").and_then(|v| v.as_i64()).map(|s| chrono::Utc::now() + chrono::Duration::seconds(s));
    // Twitch rotates refresh tokens; Google keeps the old one.
    sqlx::query("UPDATE connections SET access_token = $2, token_expires_at = $3, refresh_token = COALESCE($4, refresh_token) WHERE id = $1")
        .bind(cid).bind(a).bind(exp).bind(tok.get("refresh_token").and_then(|v| v.as_str())).execute(&state.db).await.map_err(|e| e.to_string())?;
    Ok((a.to_string(), c))
}

/// Everyone subscribed to (Twitch) or a member of (YouTube) the creator's channel, as provider account ids.
async fn subscribers(state: &AppState, provider: &str, cid: Uuid, channel: &str) -> Result<HashSet<String>, String> {
    let (tok, c) = token(state, provider, cid).await?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
    let mut out = HashSet::new();
    let mut cursor: Option<String> = None;
    for _ in 0..100 {
        let req = if provider == "twitch" {
            let mut u = url::Url::parse(&crate::routes::connections::with_override("https://api.twitch.tv/helix/subscriptions", &c.over)).map_err(|e| e.to_string())?;
            u.query_pairs_mut().append_pair("broadcaster_id", channel).append_pair("first", "100");
            if let Some(a) = &cursor { u.query_pairs_mut().append_pair("after", a); }
            client.get(u).header("Client-Id", &c.client_id)
        } else {
            let mut u = url::Url::parse(&crate::routes::connections::with_override("https://www.googleapis.com/youtube/v3/members", &c.over)).map_err(|e| e.to_string())?;
            u.query_pairs_mut().append_pair("part", "snippet").append_pair("mode", "all_current").append_pair("maxResults", "1000");
            if let Some(p) = &cursor { u.query_pairs_mut().append_pair("pageToken", p); }
            client.get(u)
        };
        let resp = req.bearer_auth(&tok).send().await.map_err(|e| e.to_string())?;
        match resp.status().as_u16() {
            200 => {}
            401 => return Err("The channel's access was revoked: link it again".into()),
            403 => return Err(if provider == "twitch" { "Twitch refused: subscriber lists need an Affiliate or Partner channel".into() } else { "YouTube refused: channel memberships must be enabled for this channel".into() }),
            s => return Err(format!("{} answered {s}", if provider == "twitch" { "Twitch" } else { "YouTube" })),
        }
        let body: Value = resp.json().await.map_err(|e| e.to_string())?;
        if provider == "twitch" {
            for s in body["data"].as_array().into_iter().flatten() { if let Some(u) = s["user_id"].as_str() { if u != channel { out.insert(u.to_string()); } } }
            cursor = body["pagination"]["cursor"].as_str().filter(|c| !c.is_empty()).map(str::to_string);
        } else {
            for m in body["items"].as_array().into_iter().flatten() { if let Some(u) = m["snippet"]["memberDetails"]["channelId"].as_str() { out.insert(u.to_string()); } }
            cursor = body["nextPageToken"].as_str().filter(|c| !c.is_empty()).map(str::to_string);
        }
        if cursor.is_none() { break; }
    }
    Ok(out)
}

/// Bring one integration's role in line with the channel's current subscribers.
pub async fn sync(state: &AppState, iid: Uuid) -> AppResult<()> {
    let row: Option<(Uuid, String, Uuid, Option<Uuid>, String)> = sqlx::query_as(
        "SELECT i.guild_id, i.provider, i.connection_id, i.role_id, c.external_id FROM guild_integrations i JOIN connections c ON c.id = i.connection_id WHERE i.id = $1",
    ).bind(iid).fetch_optional(&state.db).await?;
    let Some((gid, provider, cid, role, channel)) = row else { return Ok(()) };
    // Someone deleted the role by hand: make a new one.
    let rid = match role { Some(r) => r, None => { let r = create_role(state, gid, &provider).await?; sqlx::query("UPDATE guild_integrations SET role_id = $2 WHERE id = $1").bind(iid).bind(r).execute(&state.db).await?; r } };
    let subs = match subscribers(state, &provider, cid, &channel).await {
        Ok(s) => s,
        Err(e) => {
            sqlx::query("UPDATE guild_integrations SET last_error = $2, synced_at = now() WHERE id = $1").bind(iid).bind(&e).execute(&state.db).await?;
            return Ok(());
        }
    };
    let ids: Vec<String> = subs.into_iter().collect();
    let want: HashSet<Uuid> = sqlx::query_as::<_, (Uuid,)>(
        "SELECT DISTINCT m.user_id FROM guild_members m JOIN connections c ON c.user_id = m.user_id AND c.provider = $2 AND c.external_id = ANY($3) WHERE m.guild_id = $1",
    ).bind(gid).bind(&provider).bind(&ids).fetch_all(&state.db).await?.into_iter().map(|r| r.0).collect();
    let have: HashSet<Uuid> = sqlx::query_as::<_, (Uuid,)>("SELECT user_id FROM member_roles WHERE guild_id = $1 AND role_id = $2").bind(gid).bind(rid)
        .fetch_all(&state.db).await?.into_iter().map(|r| r.0).collect();
    for u in want.difference(&have) { crate::routes::linked_roles::set_role(state, gid, *u, rid, true).await?; }
    for u in have.difference(&want) { crate::routes::linked_roles::set_role(state, gid, *u, rid, false).await?; }
    sqlx::query("UPDATE guild_integrations SET synced_at = now(), member_count = $2, last_error = '' WHERE id = $1").bind(iid).bind(want.len() as i32).execute(&state.db).await?;
    Ok(())
}

/// A member linked an account: sync that provider's integrations in their servers.
pub fn after_link(state: AppState, uid: Uuid, provider: String) {
    tokio::spawn(async move {
        let ids: Vec<(Uuid,)> = sqlx::query_as("SELECT i.id FROM guild_integrations i JOIN guild_members m ON m.guild_id = i.guild_id AND m.user_id = $1 WHERE i.provider = $2")
            .bind(uid).bind(&provider).fetch_all(&state.db).await.unwrap_or_default();
        for (iid,) in ids { if let Err(e) = sync(&state, iid).await { tracing::warn!(error = ?e, "integration sync failed"); } }
    });
}

/// A member unlinked an account: drop subscriber roles that no longer have an account behind them.
pub async fn after_unlink(state: &AppState, uid: Uuid) -> AppResult<()> {
    let held: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "SELECT i.guild_id, i.role_id FROM guild_integrations i JOIN member_roles mr ON mr.role_id = i.role_id AND mr.user_id = $1
         WHERE NOT EXISTS (SELECT 1 FROM connections c WHERE c.user_id = $1 AND c.provider = i.provider)",
    ).bind(uid).fetch_all(&state.db).await?;
    for (gid, rid) in held { crate::routes::linked_roles::set_role(state, gid, uid, rid, false).await?; }
    Ok(())
}

/// Background: every integration at most every 15 minutes. Claiming by `synced_at` keeps instances from doubling up.
pub async fn sync_loop(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        let due: Vec<(Uuid,)> = sqlx::query_as(
            "UPDATE guild_integrations SET synced_at = now() WHERE id IN (SELECT id FROM guild_integrations WHERE synced_at IS NULL OR synced_at < now() - interval '15 minutes' ORDER BY synced_at NULLS FIRST LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING id",
        ).fetch_all(&state.db).await.unwrap_or_default();
        for (iid,) in due { if let Err(e) = sync(&state, iid).await { tracing::warn!(error = ?e, "integration sync failed"); } }
    }
}
