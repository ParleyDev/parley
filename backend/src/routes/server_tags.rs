//! Server tags: a server picks a short official tag (2-4 letters) and a badge emoji; members wear it next to their
//! name instead of a free-text tag. Changing the server's tag changes everyone wearing it; removing it, or leaving
//! the server, takes it off.

use crate::{auth::AuthUser, error::{AppError, AppResult}, models::User, perms, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::{get, post, put}, Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/tag", put(set_tag))
        .route("/users/@me/server-tag", put(wear))
        .route("/guilds/:id/tag-card", get(card))
        .route("/guilds/:id/tag-join", post(join))
}

/// Tell everyone these users' tags changed.
pub async fn announce(state: &AppState, users: &[Uuid]) {
    for u in users {
        if let Ok(user) = sqlx::query_as::<_, User>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::USER_COLS)).bind(u).fetch_one(&state.db).await {
            state.hub.emit_all("USER_UPDATE", json!(user));
        }
    }
}

#[derive(Deserialize)]
struct TagIn { tag: Option<String>, #[serde(default)] badge: Option<String>, #[serde(default)] color: Option<String> }

fn valid_color(c: &str) -> bool { c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit()) }

/// `PUT /guilds/:id/tag` (Manage Server): the server's tag and badge; null tag removes it (from everyone wearing it).
async fn set_tag(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<TagIn>) -> AppResult<Json<crate::models::Guild>> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    let tag = req.tag.map(|t| t.trim().to_uppercase()).filter(|t| !t.is_empty());
    if let Some(t) = &tag { if t.chars().count() < 2 || t.chars().count() > 4 || !t.chars().all(|c| c.is_ascii_alphanumeric()) { return Err(AppError::BadRequest("A tag is 2-4 letters or digits".into())) } }
    let badge = req.badge.map(|b| b.trim().chars().take(8).collect::<String>()).filter(|b| !b.is_empty() && tag.is_some());
    let color = req.color.map(|c| c.trim().to_lowercase()).filter(|c| !c.is_empty() && tag.is_some());
    if let Some(c) = &color { if !valid_color(c) { return Err(AppError::BadRequest("A tag colour is #rrggbb".into())) } }
    sqlx::query("UPDATE guilds SET tag = $2, tag_badge = $3, tag_color = $4 WHERE id = $1").bind(gid).bind(&tag).bind(&badge).bind(&color).execute(&state.db).await?;
    let changed: Vec<(Uuid,)> = match &tag {
        Some(t) => sqlx::query_as("UPDATE users SET clan_tag = $2 WHERE clan_tag_guild = $1 RETURNING id").bind(gid).bind(t).fetch_all(&state.db).await?,
        None => sqlx::query_as("UPDATE users SET clan_tag = '', clan_tag_guild = NULL WHERE clan_tag_guild = $1 RETURNING id").bind(gid).fetch_all(&state.db).await?,
    };
    announce(&state, &changed.into_iter().map(|r| r.0).collect::<Vec<_>>()).await;
    let g = sqlx::query_as::<_, crate::models::Guild>(&format!("SELECT {} FROM guilds WHERE id = $1", crate::routes::guilds::GUILD_COLS)).bind(gid).fetch_one(&state.db).await?;
    state.hub.emit_guild(gid, "GUILD_UPDATE", json!(g));
    let name = crate::audit::guild_name(&state, gid).await;
    crate::audit::guild(&state, gid, uid, "guild.tag", "guild", Some(gid), &name, json!({ "tag": tag })).await;
    Ok(Json(g))
}

#[derive(Deserialize)]
struct WearIn { guild_id: Option<Uuid> }

/// `PUT /users/@me/server-tag`: wear a server's tag (you must be in it), or none.
async fn wear(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<WearIn>) -> AppResult<StatusCode> {
    match req.guild_id {
        Some(gid) => {
            perms::guild_perms(&state.db, gid, uid).await?;
            let (tag,): (Option<String>,) = sqlx::query_as("SELECT tag FROM guilds WHERE id = $1").bind(gid).fetch_one(&state.db).await?;
            let tag = tag.ok_or_else(|| AppError::BadRequest("That server has no tag".into()))?;
            sqlx::query("UPDATE users SET clan_tag = $2, clan_tag_guild = $3 WHERE id = $1").bind(uid).bind(&tag).bind(gid).execute(&state.db).await?;
        }
        None => { sqlx::query("UPDATE users SET clan_tag = '', clan_tag_guild = NULL WHERE id = $1").bind(uid).execute(&state.db).await?; }
    }
    announce(&state, &[uid]).await;
    Ok(StatusCode::NO_CONTENT)
}

/// What anyone who sees a server tag can learn about its server (Discord's server profile behind a tag).
#[derive(Serialize, sqlx::FromRow)]
struct TagCard {
    id: Uuid,
    name: String,
    icon_url: Option<String>,
    banner_url: Option<String>,
    description: String,
    tag: Option<String>,
    tag_badge: Option<String>,
    tag_color: Option<String>,
    created_at: DateTime<Utc>,
    member_count: i64,
    #[sqlx(skip)]
    online_count: i64,
    member: bool,
    /// 'apply' (applications are on), 'join' (listed in Discover) or none.
    #[sqlx(skip)]
    join: Option<&'static str>,
}

async fn joinable(db: &sqlx::PgPool, gid: Uuid) -> AppResult<Option<&'static str>> {
    let (apps, listed): (bool, bool) = sqlx::query_as("SELECT COALESCE((g.applications->>'enabled')::boolean, false), EXISTS (SELECT 1 FROM guild_discovery d WHERE d.guild_id = g.id AND d.status = 'approved') FROM guilds g WHERE g.id = $1")
        .bind(gid).fetch_optional(db).await?.ok_or_else(|| AppError::NotFound("Server not found".into()))?;
    Ok(if apps { Some("apply") } else if listed { Some("join") } else { None })
}

/// `GET /guilds/:id/tag-card`: the server behind a tag. Only servers with a tag are visible this way (or your own).
async fn card(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<TagCard>> {
    let mut c = sqlx::query_as::<_, TagCard>("SELECT g.id, g.name, g.icon_url, g.banner_url, COALESCE(g.description, '') AS description, g.tag, g.tag_badge, g.tag_color, g.created_at,
        (SELECT COUNT(*) FROM guild_members m WHERE m.guild_id = g.id) AS member_count,
        EXISTS (SELECT 1 FROM guild_members m WHERE m.guild_id = g.id AND m.user_id = $2) AS member
        FROM guilds g WHERE g.id = $1")
        .bind(gid).bind(uid).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Server not found".into()))?;
    if c.tag.is_none() && !c.member { return Err(AppError::NotFound("Server not found".into())) }
    let online = crate::ws::bus::visible_online_users(&state.db).await;
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM guild_members WHERE guild_id = $1 AND user_id = ANY($2)").bind(gid).bind(&online).fetch_one(&state.db).await?;
    c.online_count = n;
    if !c.member && !crate::routes::guilds::is_banned(&state.db, gid, uid).await? { c.join = joinable(&state.db, gid).await?; }
    Ok(Json(c))
}

/// `POST /guilds/:id/tag-join`: join from a server tag, when its server takes applications (you join as an
/// applicant and fill in the form) or is listed in Discover.
async fn join(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Value>> {
    let (tag,): (Option<String>,) = sqlx::query_as("SELECT tag FROM guilds WHERE id = $1").bind(gid).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Server not found".into()))?;
    if tag.is_none() || joinable(&state.db, gid).await?.is_none() { return Err(AppError::Forbidden) }
    crate::routes::discovery::join_guild(&state, gid, uid, "tag").await
}
