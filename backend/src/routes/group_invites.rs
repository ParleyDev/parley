//! Invite links for group DMs: any member makes one (valid a day, or up to a week); anyone with the link joins while
//! the group has room, unless they've blocked, or been blocked by, someone in it.

use crate::{auth::AuthUser, error::{AppError, AppResult}, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::get, Json, Router};
use rand::{distributions::Alphanumeric, Rng};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::dms::{broadcast_group, dm_view, require_group_member, system_message, MAX_GROUP_MEMBERS};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/group-invites", get(list).post(create))
        .route("/group-invites/:code", get(preview).post(join).delete(revoke))
}

#[derive(Deserialize)]
struct CreateReq { #[serde(default)] max_age_hours: Option<i64> }

async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<CreateReq>) -> AppResult<(StatusCode, Json<Value>)> {
    require_group_member(&state.db, id, uid).await?;
    let hours = req.max_age_hours.unwrap_or(24).clamp(1, 168);
    let code: String = rand::thread_rng().sample_iter(&Alphanumeric).take(10).map(char::from).collect();
    let (expires,): (chrono::DateTime<chrono::Utc>,) = sqlx::query_as("INSERT INTO group_invites (code, channel_id, creator_id, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4::int)) RETURNING expires_at")
        .bind(&code).bind(id).bind(uid).bind(hours as i32).fetch_one(&state.db).await?;
    Ok((StatusCode::CREATED, Json(json!({ "code": code, "channel_id": id, "expires_at": expires }))))
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    require_group_member(&state.db, id, uid).await?;
    let rows: Vec<(String, chrono::DateTime<chrono::Utc>, Option<Uuid>)> = sqlx::query_as("SELECT code, expires_at, creator_id FROM group_invites WHERE channel_id = $1 AND expires_at > now() ORDER BY created_at DESC")
        .bind(id).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(code, exp, by)| json!({ "code": code, "expires_at": exp, "creator_id": by })).collect()))
}

async fn find(state: &AppState, code: &str) -> AppResult<Uuid> {
    let row: Option<(Uuid,)> = sqlx::query_as("SELECT channel_id FROM group_invites WHERE code = $1 AND expires_at > now()").bind(code).fetch_optional(&state.db).await?;
    row.map(|r| r.0).ok_or_else(|| AppError::NotFound("This invite is invalid or has expired".into()))
}

/// `GET /group-invites/:code`: the group's name, icon and members, and whether you're already in it.
async fn preview(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(code): Path<String>) -> AppResult<Json<Value>> {
    let cid = find(&state, &code).await?;
    let (name, icon): (String, Option<String>) = sqlx::query_as("SELECT name, icon_url FROM channels WHERE id = $1").bind(cid).fetch_one(&state.db).await?;
    let members: Vec<(Uuid, String, Option<String>)> = sqlx::query_as("SELECT u.id, u.display_name, u.avatar_url FROM channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = $1 ORDER BY m.joined_at")
        .bind(cid).fetch_all(&state.db).await?;
    let already = members.iter().any(|m| m.0 == uid);
    Ok(Json(json!({ "code": code, "channel_id": cid, "name": name, "icon_url": icon, "already_member": already, "full": members.len() as i64 >= MAX_GROUP_MEMBERS,
        "members": members.iter().map(|(id, n, a)| json!({ "id": id, "display_name": n, "avatar_url": a })).collect::<Vec<_>>() })))
}

async fn join(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(code): Path<String>) -> AppResult<Json<Value>> {
    let cid = find(&state, &code).await?;
    let members: Vec<(Uuid,)> = sqlx::query_as("SELECT user_id FROM channel_members WHERE channel_id = $1").bind(cid).fetch_all(&state.db).await?;
    if !members.iter().any(|m| m.0 == uid) {
        if members.len() as i64 >= MAX_GROUP_MEMBERS { return Err(AppError::BadRequest(format!("Groups can have at most {MAX_GROUP_MEMBERS} members"))) }
        for (m,) in &members {
            if crate::routes::relationships::blocked_either_way(&state.db, uid, *m).await? { return Err(AppError::Forbidden) }
        }
        sqlx::query("INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(cid).bind(uid).execute(&state.db).await?;
        state.hub.emit_users(vec![uid], "CHANNEL_CREATE", json!(dm_view(&state.db, cid, uid).await?));
        broadcast_group(&state, cid).await?;
        system_message(&state, cid, uid, "recipient_add", "joined the group with an invite link.", vec![]).await?;
    }
    Ok(Json(json!(dm_view(&state.db, cid, uid).await?)))
}

/// `DELETE /group-invites/:code`: its creator or the group owner.
async fn revoke(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(code): Path<String>) -> AppResult<StatusCode> {
    let row: Option<(Uuid, Option<Uuid>)> = sqlx::query_as("SELECT channel_id, creator_id FROM group_invites WHERE code = $1").bind(&code).fetch_optional(&state.db).await?;
    let (cid, creator) = row.ok_or_else(|| AppError::NotFound("Invite not found".into()))?;
    let c = require_group_member(&state.db, cid, uid).await?;
    if creator != Some(uid) && c.owner_id != Some(uid) { return Err(AppError::Forbidden) }
    sqlx::query("DELETE FROM group_invites WHERE code = $1").bind(&code).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
