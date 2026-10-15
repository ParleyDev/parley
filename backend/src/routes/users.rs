use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{PrivateUser, Review, User},
    routes::relationships::blocked_either_way,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

pub const MAX_IMAGE_DATA_URL: usize = 512 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me", get(me).patch(update_me))
        .route("/users/search", get(search))
        .route("/users/:id", get(get_user))
        .route("/users/:id/reviews", get(list_reviews).put(put_review))
        .route("/users/:id/reviews/:rid", delete(delete_review))
        .route("/users/@me/guild-layout", get(get_layout).put(put_layout))
}

/// The server bar layout: an ordered list of `{"kind":"guild","id":…}` and
/// `{"kind":"folder","id":…,"name":…,"color":…,"guilds":[…]}` entries. Stored as given (after
/// light validation); the client reconciles it with the servers the user is actually in.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LayoutItem {
    Guild { id: Uuid },
    Folder { id: String, #[serde(default)] name: String, #[serde(default)] color: Option<String>, #[serde(default)] guilds: Vec<Uuid> },
}

async fn get_layout(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<serde_json::Value>> {
    let (v,): (serde_json::Value,) = sqlx::query_as("SELECT guild_layout FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    Ok(Json(v))
}

async fn put_layout(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(items): Json<Vec<LayoutItem>>) -> AppResult<Json<Vec<LayoutItem>>> {
    if items.len() > 500 {
        return Err(AppError::BadRequest("Layout too large".into()));
    }
    let mine: Vec<(Uuid,)> = sqlx::query_as("SELECT guild_id FROM guild_members WHERE user_id = $1").bind(uid).fetch_all(&state.db).await?;
    let mine: std::collections::HashSet<Uuid> = mine.into_iter().map(|r| r.0).collect();
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for it in items {
        match it {
            LayoutItem::Guild { id } => {
                if mine.contains(&id) && seen.insert(id) { out.push(LayoutItem::Guild { id }) }
            }
            LayoutItem::Folder { id, name, color, guilds } => {
                if id.len() > 64 { return Err(AppError::BadRequest("Bad folder id".into())); }
                if let Some(c) = &color {
                    if !(c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit())) { return Err(AppError::BadRequest("Folder colours must be #rrggbb".into())); }
                }
                let guilds: Vec<Uuid> = guilds.into_iter().filter(|g| mine.contains(g) && seen.insert(*g)).collect();
                out.push(LayoutItem::Folder { id, name: name.chars().take(100).collect(), color, guilds });
            }
        }
    }
    sqlx::query("UPDATE users SET guild_layout = $2 WHERE id = $1").bind(uid).bind(serde_json::to_value(&out).map_err(|e| AppError::Other(e.into()))?).execute(&state.db).await?;
    Ok(Json(out))
}

pub const USER_COLS: &str = "id, username, display_name, avatar_url, bio, status, created_at, banner_url, theme_primary, theme_accent, pronouns, name_primary, name_accent, custom_status";
pub const PRIVATE_USER_COLS: &str = "id, username, display_name, email, avatar_url, bio, status, created_at, banner_url, theme_primary, theme_accent, pronouns, name_primary, name_accent, custom_status, is_admin";

/// Is this user a Parley admin? The `is_admin` flag, or an email listed in `ADMIN_EMAILS`
/// (which is then persisted as the flag so the UI sees it too).
pub async fn ensure_admin(state: &AppState, uid: Uuid) -> AppResult<bool> {
    let row: Option<(bool, String)> = sqlx::query_as("SELECT is_admin, email FROM users WHERE id = $1").bind(uid).fetch_optional(&state.db).await?;
    let Some((flag, email)) = row else { return Ok(false) };
    if flag {
        return Ok(true);
    }
    if state.config.admin_emails.iter().any(|e| e.eq_ignore_ascii_case(&email)) {
        sqlx::query("UPDATE users SET is_admin = true WHERE id = $1").bind(uid).execute(&state.db).await?;
        return Ok(true);
    }
    Ok(false)
}

pub async fn require_admin(state: &AppState, uid: Uuid) -> AppResult<()> {
    if ensure_admin(state, uid).await? { Ok(()) } else { Err(AppError::Forbidden) }
}

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
    custom_status: Option<String>,
}

pub fn validate_image(url: &Option<String>) -> AppResult<()> {
    validate_image_max(url, MAX_IMAGE_DATA_URL)
}

pub fn validate_image_max(url: &Option<String>, max: usize) -> AppResult<()> {
    if let Some(u) = url {
        if u.len() > max {
            return Err(AppError::BadRequest(format!("Image too large (max {}KB)", max / 1024)));
        }
        if !u.is_empty() && !(u.starts_with("data:image/") || u.starts_with("https://") || u.starts_with("http://") || crate::routes::images::image_id(u).is_some()) {
            return Err(AppError::BadRequest("Image must be an uploaded image, a data URL or an http(s) URL".into()));
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
    if let Some(c) = &req.custom_status {
        if c.chars().count() > 128 {
            return Err(AppError::BadRequest("Custom status must be at most 128 characters".into()));
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
    let before: (Option<String>, Option<String>) = sqlx::query_as("SELECT avatar_url, banner_url FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;

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
            custom_status = COALESCE($12, custom_status),
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
    .bind(req.custom_status.as_ref().map(|c| c.trim().chars().take(128).collect::<String>()))
    .fetch_one(&state.db)
    .await?;
    crate::routes::images::release_replaced(&state, before.0.as_deref(), u.avatar_url.as_deref()).await;
    crate::routes::images::release_replaced(&state, before.1.as_deref(), u.banner_url.as_deref()).await;

    let public = User {
        id: u.id,
        username: u.username.clone(),
        display_name: u.display_name.clone(),
        avatar_url: u.avatar_url.clone(),
        bio: u.bio.clone(),
        status: u.status.clone(),
        custom_status: u.custom_status.clone(),
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

/// A public profile plus the servers the requester shares with that user (for the popout).
async fn get_user(
    State(state): State<AppState>,
    AuthUser(me): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let u = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;
    let mutual: Vec<(Uuid, String, Option<String>)> = if me == id {
        Vec::new()
    } else {
        sqlx::query_as(
            "SELECT g.id, g.name, g.icon_url FROM guilds g
             JOIN guild_members a ON a.guild_id = g.id AND a.user_id = $1
             JOIN guild_members b ON b.guild_id = g.id AND b.user_id = $2
             ORDER BY a.joined_at",
        )
        .bind(me)
        .bind(id)
        .fetch_all(&state.db)
        .await?
    };
    // Friends of both of us (relationship rows are symmetric for 'friend').
    let friends: Vec<(Uuid, String, Option<String>)> = if me == id {
        Vec::new()
    } else {
        sqlx::query_as(
            "SELECT u.id, u.display_name, u.avatar_url FROM relationships a
             JOIN relationships b ON b.target_id = a.target_id AND b.user_id = $2 AND b.kind = 'friend'
             JOIN users u ON u.id = a.target_id
             WHERE a.user_id = $1 AND a.kind = 'friend' AND a.target_id <> $2 ORDER BY u.display_name",
        )
        .bind(me)
        .bind(id)
        .fetch_all(&state.db)
        .await?
    };
    let (review_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM user_reviews WHERE target_id = $1").bind(id).fetch_one(&state.db).await?;
    let mut v = json!(u);
    v["mutual_guilds"] = json!(mutual.into_iter().map(|(gid, name, icon)| json!({ "id": gid, "name": name, "icon_url": icon })).collect::<Vec<_>>());
    v["mutual_friends"] = json!(friends.into_iter().map(|(fid, name, avatar)| json!({ "id": fid, "display_name": name, "avatar_url": avatar })).collect::<Vec<_>>());
    v["review_count"] = json!(review_count);
    Ok(Json(v))
}

const REVIEW_COLS: &str = "r.id, r.target_id, r.author_id, r.content, r.created_at, r.updated_at, u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url";

async fn list_reviews(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Review>>> {
    let rs = sqlx::query_as::<_, Review>(&format!(
        "SELECT {REVIEW_COLS} FROM user_reviews r JOIN users u ON u.id = r.author_id WHERE r.target_id = $1 ORDER BY r.created_at DESC"
    ))
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rs))
}

#[derive(Deserialize)]
struct PutReview {
    content: String,
}

/// Leave (or replace) your review on someone's profile. One per author per profile.
async fn put_review(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<PutReview>,
) -> AppResult<(StatusCode, Json<Review>)> {
    if id == uid {
        return Err(AppError::BadRequest("You cannot review yourself".into()));
    }
    let content = req.content.trim().to_string();
    if content.is_empty() || content.chars().count() > 500 {
        return Err(AppError::BadRequest("Reviews must be 1-500 characters".into()));
    }
    let exists: Option<(bool,)> = sqlx::query_as("SELECT true FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    if exists.is_none() {
        return Err(AppError::NotFound("User not found".into()));
    }
    if blocked_either_way(&state.db, uid, id).await? {
        return Err(AppError::Forbidden);
    }
    let (rid,): (Uuid,) = sqlx::query_as(
        "INSERT INTO user_reviews (id, target_id, author_id, content) VALUES ($1, $2, $3, $4)
         ON CONFLICT (target_id, author_id) DO UPDATE SET content = EXCLUDED.content, updated_at = now() RETURNING id",
    )
    .bind(Uuid::now_v7())
    .bind(id)
    .bind(uid)
    .bind(&content)
    .fetch_one(&state.db)
    .await?;
    let r = sqlx::query_as::<_, Review>(&format!("SELECT {REVIEW_COLS} FROM user_reviews r JOIN users u ON u.id = r.author_id WHERE r.id = $1"))
        .bind(rid)
        .fetch_one(&state.db)
        .await?;
    Ok((StatusCode::OK, Json(r)))
}

/// The author or the profile's owner may remove a review.
async fn delete_review(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, rid)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    // Only the author may remove a review; the profile owner cannot curate what others wrote.
    let res = sqlx::query("DELETE FROM user_reviews WHERE id = $1 AND target_id = $2 AND author_id = $3")
        .bind(rid)
        .bind(id)
        .bind(uid)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Review not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}
