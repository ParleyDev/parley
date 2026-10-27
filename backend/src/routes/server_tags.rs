//! Server tags: a server picks a short official tag (2-4 letters) and a badge emoji; members wear it next to their
//! name instead of a free-text tag. Changing the server's tag changes everyone wearing it; removing it, or leaving
//! the server, takes it off.

use crate::{auth::AuthUser, error::{AppError, AppResult}, models::User, perms, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::put, Json, Router};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/tag", put(set_tag))
        .route("/users/@me/server-tag", put(wear))
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
struct TagIn { tag: Option<String>, #[serde(default)] badge: Option<String> }

/// `PUT /guilds/:id/tag` (Manage Server): the server's tag and badge; null tag removes it (from everyone wearing it).
async fn set_tag(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<TagIn>) -> AppResult<Json<crate::models::Guild>> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    let tag = req.tag.map(|t| t.trim().to_uppercase()).filter(|t| !t.is_empty());
    if let Some(t) = &tag { if t.chars().count() < 2 || t.chars().count() > 4 || !t.chars().all(|c| c.is_ascii_alphanumeric()) { return Err(AppError::BadRequest("A tag is 2-4 letters or digits".into())) } }
    let badge = req.badge.map(|b| b.trim().chars().take(8).collect::<String>()).filter(|b| !b.is_empty() && tag.is_some());
    sqlx::query("UPDATE guilds SET tag = $2, tag_badge = $3 WHERE id = $1").bind(gid).bind(&tag).bind(&badge).execute(&state.db).await?;
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
