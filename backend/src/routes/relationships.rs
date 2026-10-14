//! Friends, friend requests and blocks. Stored per user like Discord: a friendship is two
//! `friend` rows, a pending request is an `outgoing` row for the sender and an `incoming`
//! row for the recipient, and a block is a single `blocked` row owned by the blocker.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Relationship, User},
    routes::users::USER_COLS,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/relationships", get(list).post(send_request))
        .route("/users/@me/relationships/:id", put(accept).delete(remove))
        .route("/users/@me/relationships/:id/block", put(block))
}

const REL_SELECT: &str = "SELECT r.kind, r.created_at, u.id, u.username, u.display_name, u.avatar_url, u.bio, u.status, u.created_at AS user_created_at
    FROM relationships r JOIN users u ON u.id = r.target_id";

pub async fn list_for(db: &PgPool, uid: Uuid) -> AppResult<Vec<Relationship>> {
    let rows: Vec<(String, chrono::DateTime<chrono::Utc>, Uuid, String, String, Option<String>, String, String, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as(&format!("{REL_SELECT} WHERE r.user_id = $1 ORDER BY u.display_name"))
            .bind(uid)
            .fetch_all(db)
            .await?;
    Ok(rows
        .into_iter()
        .map(|(kind, created_at, id, username, display_name, avatar_url, bio, status, user_created_at)| Relationship {
            kind,
            created_at,
            user: User { id, username, display_name, avatar_url, bio, status, created_at: user_created_at },
        })
        .collect())
}

async fn one(db: &PgPool, uid: Uuid, target: Uuid) -> AppResult<Relationship> {
    let mut v = list_for(db, uid).await?;
    v.retain(|r| r.user.id == target);
    v.pop().ok_or_else(|| AppError::NotFound("Relationship not found".into()))
}

pub async fn kind_between(db: &PgPool, uid: Uuid, target: Uuid) -> AppResult<Option<String>> {
    let r: Option<(String,)> = sqlx::query_as("SELECT kind FROM relationships WHERE user_id = $1 AND target_id = $2")
        .bind(uid)
        .bind(target)
        .fetch_optional(db)
        .await?;
    Ok(r.map(|x| x.0))
}

/// True if either side has blocked the other.
pub async fn blocked_either_way(db: &PgPool, a: Uuid, b: Uuid) -> AppResult<bool> {
    let r: Option<(bool,)> = sqlx::query_as(
        "SELECT true FROM relationships WHERE kind = 'blocked' AND ((user_id = $1 AND target_id = $2) OR (user_id = $2 AND target_id = $1)) LIMIT 1",
    )
    .bind(a)
    .bind(b)
    .fetch_optional(db)
    .await?;
    Ok(r.is_some())
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Relationship>>> {
    Ok(Json(list_for(&state.db, uid).await?))
}

#[derive(Deserialize)]
struct SendRequest {
    username: Option<String>,
    user_id: Option<Uuid>,
}

async fn fetch_user(db: &PgPool, id: Uuid) -> AppResult<User> {
    sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))
}

/// Notify both sides about their view of the relationship after a change.
async fn emit_add(state: &AppState, a: Uuid, b: Uuid) -> AppResult<()> {
    if let Ok(r) = one(&state.db, a, b).await {
        state.hub.emit_users(vec![a], "RELATIONSHIP_ADD", json!(r));
    }
    if let Ok(r) = one(&state.db, b, a).await {
        state.hub.emit_users(vec![b], "RELATIONSHIP_ADD", json!(r));
    }
    Ok(())
}

fn emit_remove(state: &AppState, owner: Uuid, target: Uuid) {
    state.hub.emit_users(vec![owner], "RELATIONSHIP_REMOVE", json!({ "user_id": target }));
}

/// Send a friend request by username or id. If the other person already asked, this accepts.
async fn send_request(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(req): Json<SendRequest>,
) -> AppResult<(StatusCode, Json<Relationship>)> {
    let target = match (req.user_id, req.username.as_deref().map(str::trim)) {
        (Some(id), _) => fetch_user(&state.db, id).await?,
        (None, Some(name)) if !name.is_empty() => {
            sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE lower(username) = lower($1)"))
                .bind(name)
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| AppError::BadRequest("Hm, didn't work. Double check that the username is correct.".into()))?
        }
        _ => return Err(AppError::BadRequest("Provide a username".into())),
    };
    if target.id == uid {
        return Err(AppError::BadRequest("You can't add yourself as a friend".into()));
    }
    let mine = kind_between(&state.db, uid, target.id).await?;
    let theirs = kind_between(&state.db, target.id, uid).await?;
    match mine.as_deref() {
        Some("friend") => return Err(AppError::BadRequest("You're already friends with that user".into())),
        Some("outgoing") => return Err(AppError::BadRequest("You already sent a friend request to that user".into())),
        Some("blocked") => return Err(AppError::BadRequest("Unblock this user to send a friend request".into())),
        _ => {}
    }
    if theirs.as_deref() == Some("blocked") {
        // Don't reveal the block; same message as a wrong username.
        return Err(AppError::BadRequest("Hm, didn't work. Double check that the username is correct.".into()));
    }
    let mut tx = state.db.begin().await?;
    let status = if mine.as_deref() == Some("incoming") {
        // They asked first: accept.
        sqlx::query("UPDATE relationships SET kind = 'friend', created_at = now() WHERE (user_id = $1 AND target_id = $2) OR (user_id = $2 AND target_id = $1)")
            .bind(uid)
            .bind(target.id)
            .execute(&mut *tx)
            .await?;
        StatusCode::OK
    } else {
        sqlx::query("INSERT INTO relationships (user_id, target_id, kind) VALUES ($1, $2, 'outgoing'), ($2, $1, 'incoming') ON CONFLICT (user_id, target_id) DO UPDATE SET kind = EXCLUDED.kind, created_at = now()")
            .bind(uid)
            .bind(target.id)
            .execute(&mut *tx)
            .await?;
        StatusCode::CREATED
    };
    tx.commit().await?;
    emit_add(&state, uid, target.id).await?;
    Ok((status, Json(one(&state.db, uid, target.id).await?)))
}

async fn accept(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(target): Path<Uuid>) -> AppResult<Json<Relationship>> {
    if kind_between(&state.db, uid, target).await?.as_deref() != Some("incoming") {
        return Err(AppError::NotFound("No pending request from that user".into()));
    }
    sqlx::query("UPDATE relationships SET kind = 'friend', created_at = now() WHERE (user_id = $1 AND target_id = $2) OR (user_id = $2 AND target_id = $1)")
        .bind(uid)
        .bind(target)
        .execute(&state.db)
        .await?;
    emit_add(&state, uid, target).await?;
    Ok(Json(one(&state.db, uid, target).await?))
}

/// Remove a friend, cancel an outgoing request, decline an incoming one, or unblock.
async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(target): Path<Uuid>) -> AppResult<StatusCode> {
    let kind = kind_between(&state.db, uid, target).await?.ok_or_else(|| AppError::NotFound("Relationship not found".into()))?;
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM relationships WHERE user_id = $1 AND target_id = $2").bind(uid).bind(target).execute(&mut *tx).await?;
    if kind != "blocked" {
        // Friendship / request rows are symmetric; a block is one-sided and leaves theirs alone.
        sqlx::query("DELETE FROM relationships WHERE user_id = $1 AND target_id = $2 AND kind <> 'blocked'").bind(target).bind(uid).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    emit_remove(&state, uid, target);
    if kind != "blocked" {
        emit_remove(&state, target, uid);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Block: drops any friendship or pending request in both directions, then records the block.
async fn block(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(target): Path<Uuid>) -> AppResult<Json<Relationship>> {
    if target == uid {
        return Err(AppError::BadRequest("You can't block yourself".into()));
    }
    fetch_user(&state.db, target).await?;
    let theirs = kind_between(&state.db, target, uid).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM relationships WHERE user_id = $1 AND target_id = $2 AND kind <> 'blocked'").bind(target).bind(uid).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO relationships (user_id, target_id, kind) VALUES ($1, $2, 'blocked') ON CONFLICT (user_id, target_id) DO UPDATE SET kind = 'blocked', created_at = now()")
        .bind(uid)
        .bind(target)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    if matches!(theirs.as_deref(), Some("friend") | Some("outgoing") | Some("incoming")) {
        emit_remove(&state, target, uid);
    }
    let r = one(&state.db, uid, target).await?;
    state.hub.emit_users(vec![uid], "RELATIONSHIP_ADD", json!(r));
    Ok(Json(r))
}
