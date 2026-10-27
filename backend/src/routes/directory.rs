//! Directory channels: a channel that lists servers. Someone who manages a server adds it (with a description and a
//! category); members browse, search and join from the list through the entry's lasting invite. The hub's moderators
//! (Manage Channels) or the listed server's managers can remove an entry.

use crate::{auth::AuthUser, error::{AppError, AppResult}, perms, state::AppState};
use axum::{extract::{Path, Query, State}, http::StatusCode, routing::{delete, get}, Json, Router};
use rand::{distributions::Alphanumeric, Rng};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::channels::require_channel_perms;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/directory", get(list).post(add))
        .route("/channels/:id/directory/:gid", delete(remove))
}

pub const CATEGORIES: [&str; 8] = ["gaming", "music", "education", "science", "entertainment", "creative", "community", "other"];

async fn directory(state: &AppState, cid: Uuid, uid: Uuid) -> AppResult<(crate::models::Channel, u64)> {
    let (c, p) = require_channel_perms(&state.db, cid, uid).await?;
    if c.kind != "directory" { return Err(AppError::BadRequest("That isn't a directory channel".into())) }
    Ok((c, p))
}

#[derive(Deserialize)]
struct ListQ { #[serde(default)] q: String, category: Option<String> }

/// `GET /channels/:id/directory?q=&category=`: listed servers, biggest first, with whether you're in them.
async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(cid): Path<Uuid>, Query(q): Query<ListQ>) -> AppResult<Json<Vec<Value>>> {
    directory(&state, cid, uid).await?;
    let like = format!("%{}%", q.q.trim().replace('%', "").replace('_', ""));
    let rows: Vec<(Uuid, String, Option<String>, String, String, String, i64, bool, bool)> = sqlx::query_as(
        "SELECT g.id, g.name, g.icon_url, e.description, e.category, e.invite_code,
                (SELECT COUNT(*) FROM guild_members m WHERE m.guild_id = g.id),
                EXISTS (SELECT 1 FROM guild_members m WHERE m.guild_id = g.id AND m.user_id = $2), g.partnered
         FROM directory_entries e JOIN guilds g ON g.id = e.guild_id
         WHERE e.channel_id = $1 AND (g.name ILIKE $3 OR e.description ILIKE $3) AND ($4::text IS NULL OR e.category = $4)
         ORDER BY 7 DESC, g.name LIMIT 200")
        .bind(cid).bind(uid).bind(&like).bind(q.category.as_deref().filter(|c| !c.is_empty())).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(id, name, icon, desc, cat, code, members, joined, partnered)| json!({
        "guild_id": id, "name": name, "icon_url": icon, "description": desc, "category": cat, "invite_code": code,
        "member_count": members, "joined": joined, "partnered": partnered })).collect()))
}

#[derive(Deserialize)]
struct AddIn { guild_id: Uuid, #[serde(default)] description: String, #[serde(default)] category: String }

/// `POST /channels/:id/directory`: list a server you manage here (you must be able to post in the directory).
async fn add(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(cid): Path<Uuid>, Json(req): Json<AddIn>) -> AppResult<(StatusCode, Json<Value>)> {
    let (c, p) = directory(&state, cid, uid).await?;
    perms::check(p, perms::SEND_MESSAGES)?;
    let (_, mine) = perms::guild_perms(&state.db, req.guild_id, uid).await?;
    perms::check(mine, perms::MANAGE_GUILD)?;
    if Some(req.guild_id) == c.guild_id { return Err(AppError::BadRequest("A server can't list itself".into())) }
    let category = if CATEGORIES.contains(&req.category.as_str()) { req.category.clone() } else { "other".into() };
    let description: String = req.description.trim().chars().take(200).collect();
    // A lasting invite for the entry (reused if the server is listed again).
    let existing: Option<(String,)> = sqlx::query_as("SELECT invite_code FROM directory_entries WHERE channel_id = $1 AND guild_id = $2").bind(cid).bind(req.guild_id).fetch_optional(&state.db).await?;
    let code = match existing {
        Some((c,)) => c,
        None => {
            let code: String = rand::thread_rng().sample_iter(&Alphanumeric).take(10).map(char::from).collect();
            sqlx::query("INSERT INTO invites (code, guild_id, creator_id) VALUES ($1, $2, $3)").bind(&code).bind(req.guild_id).bind(uid).execute(&state.db).await?;
            code
        }
    };
    sqlx::query("INSERT INTO directory_entries (channel_id, guild_id, description, category, invite_code, added_by) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (channel_id, guild_id) DO UPDATE SET description = EXCLUDED.description, category = EXCLUDED.category")
        .bind(cid).bind(req.guild_id).bind(&description).bind(&category).bind(&code).bind(uid).execute(&state.db).await?;
    state.hub.emit(super::channels::target_for(&state.db, &c).await?, "DIRECTORY_UPDATE", json!({ "channel_id": cid }));
    if let Some(gid) = c.guild_id {
        let name = crate::audit::guild_name(&state, req.guild_id).await;
        crate::audit::guild(&state, gid, uid, "directory.add", "guild", Some(req.guild_id), &name, json!({ "channel": c.name })).await;
    }
    Ok((StatusCode::CREATED, Json(json!({ "guild_id": req.guild_id, "invite_code": code }))))
}

/// `DELETE /channels/:id/directory/:gid`: the hub's moderators, or the listed server's managers.
async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((cid, gid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    let (c, p) = directory(&state, cid, uid).await?;
    let manages_listed = perms::guild_perms(&state.db, gid, uid).await.map(|(_, x)| perms::has(x, perms::MANAGE_GUILD)).unwrap_or(false);
    if !perms::has(p, perms::MANAGE_CHANNELS) && !manages_listed { return Err(AppError::Forbidden) }
    let gone: Option<(String,)> = sqlx::query_as("DELETE FROM directory_entries WHERE channel_id = $1 AND guild_id = $2 RETURNING invite_code").bind(cid).bind(gid).fetch_optional(&state.db).await?;
    let Some((code,)) = gone else { return Err(AppError::NotFound("Not listed here".into())) };
    // The invite was only for the listing.
    sqlx::query("DELETE FROM invites WHERE code = $1 AND NOT EXISTS (SELECT 1 FROM directory_entries WHERE invite_code = $1)").bind(&code).execute(&state.db).await?;
    state.hub.emit(super::channels::target_for(&state.db, &c).await?, "DIRECTORY_UPDATE", json!({ "channel_id": cid }));
    Ok(StatusCode::NO_CONTENT)
}
