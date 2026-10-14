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

pub const USER_COLS: &str = "id, username, display_name, avatar_url, bio, status, created_at, banner_url, theme_primary, theme_accent, pronouns, name_primary, name_accent";
pub const PRIVATE_USER_COLS: &str = "id, username, display_name, email, avatar_url, bio, status, created_at, banner_url, theme_primary, theme_accent, pronouns, name_primary, name_accent";

async fn me(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<PrivateUser>> {
    let u = sqlx::query_as::<_, PrivateUser>(
        &format!("SELECT {PRIVATE_USER_COLS} FROM users WHERE id = $1"),
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
    /// Empty string clears, like avatar_url.
    banner_url: Option<String>,
    theme_primary: Option<String>,
    theme_accent: Option<String>,
    pronouns: Option<String>,
    name_primary: Option<String>,
    name_accent: Option<String>,
}

pub fn validate_image(url: &Option<String>) -> AppResult<()> {
    validate_image_max(url, MAX_IMAGE_DATA_URL)
}

pub fn validate_image_max(url: &Option<String>, max: usize) -> AppResult<()> {
    if let Some(u) = url {
        if u.len() > max {
            return Err(AppError::BadRequest(format!("Image too large (max {}KB)", max / 1024)));
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
        if b.chars().count() > 400 {
            return Err(AppError::BadRequest("Bio must be at most 400 characters".into()));
        }
    }
    if let Some(p) = &req.pronouns {
        if p.chars().count() > 40 {
            return Err(AppError::BadRequest("Pronouns must be at most 40 characters".into()));
        }
    }
    for c in [&req.theme_primary, &req.theme_accent, &req.name_primary, &req.name_accent].into_iter().flatten() {
        let ok = c.is_empty() || (c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit()));
        if !ok {
            return Err(AppError::BadRequest("Theme colours must be #rrggbb".into()));
        }
    }
    validate_image_max(&req.banner_url, 1024 * 1024)?;
    if let Some(s) = &req.status {
        if !["online", "idle", "dnd", "invisible"].contains(&s.as_str()) {
            return Err(AppError::BadRequest("Invalid status".into()));
        }
    }
    validate_image(&req.avatar_url)?;

    let u = sqlx::query_as::<_, PrivateUser>(
        &format!("UPDATE users SET
            display_name = COALESCE($2, display_name),
            bio = COALESCE($3, bio),
            avatar_url = CASE WHEN $4::text IS NULL THEN avatar_url WHEN $4 = '' THEN NULL ELSE $4 END,
            status = COALESCE($5, status),
            banner_url = CASE WHEN $6::text IS NULL THEN banner_url WHEN $6 = '' THEN NULL ELSE $6 END,
            theme_primary = CASE WHEN $7::text IS NULL THEN theme_primary WHEN $7 = '' THEN NULL ELSE $7 END,
            theme_accent = CASE WHEN $8::text IS NULL THEN theme_accent WHEN $8 = '' THEN NULL ELSE $8 END,
            pronouns = COALESCE($9, pronouns),
            name_primary = CASE WHEN $10::text IS NULL THEN name_primary WHEN $10 = '' THEN NULL ELSE $10 END,
            name_accent = CASE WHEN $11::text IS NULL THEN name_accent WHEN $11 = '' THEN NULL ELSE $11 END
         WHERE id = $1
         RETURNING {PRIVATE_USER_COLS}"),
    )
    .bind(uid)
    .bind(req.display_name.map(|d| d.trim().to_string()))
    .bind(req.bio.map(|b| b.trim_end().to_string()))
    .bind(req.avatar_url)
    .bind(req.status)
    .bind(req.banner_url)
    .bind(req.theme_primary)
    .bind(req.theme_accent)
    .bind(req.pronouns.map(|p| p.trim().to_string()))
    .bind(req.name_primary)
    .bind(req.name_accent)
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
        banner_url: u.banner_url.clone(),
        theme_primary: u.theme_primary.clone(),
        theme_accent: u.theme_accent.clone(),
        pronouns: u.pronouns.clone(),
        name_primary: u.name_primary.clone(),
        name_accent: u.name_accent.clone(),
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
