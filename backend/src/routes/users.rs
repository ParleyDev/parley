use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{PrivateUser, User},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

pub const MAX_IMAGE_DATA_URL: usize = 512 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me", get(me).patch(update_me))
        .route("/users/search", get(search))
        .route("/users/:id", get(get_user))
}

pub const USER_COLS: &str = "id, username, display_name, avatar_url, bio, status, created_at";

async fn me(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<PrivateUser>> {
    let u = sqlx::query_as::<_, PrivateUser>(
        "SELECT id, username, display_name, email, avatar_url, bio, status, created_at FROM users WHERE id = $1",
    )
    .bind(uid)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(u))
}

#[derive(Deserialize)]
struct UpdateMe {
    display_name: Option<String>,
    bio: Option<String>,
    avatar_url: Option<String>,
    status: Option<String>,
}

pub fn validate_image(url: &Option<String>) -> AppResult<()> {
    if let Some(u) = url {
        if u.len() > MAX_IMAGE_DATA_URL {
            return Err(AppError::BadRequest("Image too large (max 512KB)".into()));
        }
        if !u.is_empty() && !(u.starts_with("data:image/") || u.starts_with("https://") || u.starts_with("http://")) {
            return Err(AppError::BadRequest("Image must be a data URL or http(s) URL".into()));
        }
    }
    Ok(())
}

async fn update_me(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(req): Json<UpdateMe>,
) -> AppResult<Json<PrivateUser>> {
    if let Some(d) = &req.display_name {
        if d.trim().is_empty() || d.len() > 32 {
            return Err(AppError::BadRequest("Display name must be 1-32 characters".into()));
        }
    }
    if let Some(b) = &req.bio {
        if b.len() > 190 {
            return Err(AppError::BadRequest("Bio must be at most 190 characters".into()));
        }
    }
    if let Some(s) = &req.status {
        if !["online", "idle", "dnd", "invisible"].contains(&s.as_str()) {
            return Err(AppError::BadRequest("Invalid status".into()));
        }
    }
    validate_image(&req.avatar_url)?;

    let u = sqlx::query_as::<_, PrivateUser>(
        "UPDATE users SET
            display_name = COALESCE($2, display_name),
            bio = COALESCE($3, bio),
            avatar_url = CASE WHEN $4::text IS NULL THEN avatar_url WHEN $4 = '' THEN NULL ELSE $4 END,
            status = COALESCE($5, status)
         WHERE id = $1
         RETURNING id, username, display_name, email, avatar_url, bio, status, created_at",
    )
    .bind(uid)
    .bind(req.display_name.map(|d| d.trim().to_string()))
    .bind(req.bio)
    .bind(req.avatar_url)
    .bind(req.status)
    .fetch_one(&state.db)
    .await?;

    let public = User {
        id: u.id,
        username: u.username.clone(),
        display_name: u.display_name.clone(),
        avatar_url: u.avatar_url.clone(),
        bio: u.bio.clone(),
        status: u.status.clone(),
        created_at: u.created_at,
    };
    state.hub.emit_all("USER_UPDATE", json!(public));
    Ok(Json(u))
}

#[derive(Deserialize)]
struct SearchQ {
    q: String,
}

async fn search(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Query(q): Query<SearchQ>,
) -> AppResult<Json<Vec<User>>> {
    let term = q.q.trim().to_lowercase();
    if term.is_empty() {
        return Ok(Json(vec![]));
    }
    let pattern = format!("%{}%", term.replace('%', "\\%").replace('_', "\\_"));
    let users = sqlx::query_as::<_, User>(&format!(
        "SELECT {USER_COLS} FROM users WHERE id <> $1 AND (username ILIKE $2 OR display_name ILIKE $2)
         ORDER BY username LIMIT 20"
    ))
    .bind(uid)
    .bind(pattern)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(users))
}

async fn get_user(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<User>> {
    let u = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;
    Ok(Json(u))
}
