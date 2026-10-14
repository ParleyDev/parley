//! Server custom emoji and stickers. Both are backed by an `images` row with the same id, so a
//! message can reference `<:name:id>` / a sticker id and the client resolves `/api/images/<id>`
//! directly. Managed by members with MANAGE_GUILD; usable by any member of any of their servers.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    perms,
    routes::{guilds::require_member, images::{delete_image, image_url, store_image, MAX_EMOJI, MAX_STICKER}},
    state::AppState,
};
use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

pub const MAX_EMOJIS_PER_GUILD: i64 = 100;
pub const MAX_STICKERS_PER_GUILD: i64 = 60;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/emojis", get(list_emojis).post(create_emoji).layer(DefaultBodyLimit::max(MAX_EMOJI + 64 * 1024)))
        .route("/guilds/:id/emojis/:eid", patch(update_emoji).delete(delete_emoji))
        .route("/guilds/:id/stickers", get(list_stickers).post(create_sticker).layer(DefaultBodyLimit::max(MAX_STICKER + 64 * 1024)))
        .route("/guilds/:id/stickers/:sid", patch(update_sticker).delete(delete_sticker))
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Emoji {
    pub id: Uuid,
    pub guild_id: Uuid,
    pub name: String,
    pub animated: bool,
    pub creator_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Sticker {
    pub id: Uuid,
    pub guild_id: Uuid,
    pub name: String,
    pub description: String,
    pub tags: String,
    pub animated: bool,
    pub creator_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    #[sqlx(skip)]
    #[serde(default)]
    pub url: String,
}

const EMOJI_COLS: &str = "id, guild_id, name, animated, creator_id, created_at";
const STICKER_COLS: &str = "id, guild_id, name, description, tags, animated, creator_id, created_at";

pub async fn emojis_for_guilds(db: &PgPool, guild_ids: &[Uuid]) -> AppResult<Vec<Emoji>> {
    let mut rows = sqlx::query_as::<_, Emoji>(&format!("SELECT {EMOJI_COLS} FROM emojis WHERE guild_id = ANY($1) ORDER BY name"))
        .bind(guild_ids)
        .fetch_all(db)
        .await?;
    rows.iter_mut().for_each(|e| e.url = image_url(e.id));
    Ok(rows)
}

pub async fn stickers_for_guilds(db: &PgPool, guild_ids: &[Uuid]) -> AppResult<Vec<Sticker>> {
    let mut rows = sqlx::query_as::<_, Sticker>(&format!("SELECT {STICKER_COLS} FROM stickers WHERE guild_id = ANY($1) ORDER BY name"))
        .bind(guild_ids)
        .fetch_all(db)
        .await?;
    rows.iter_mut().for_each(|s| s.url = image_url(s.id));
    Ok(rows)
}

pub fn valid_emoji_name(n: &str) -> bool {
    (2..=32).contains(&n.len()) && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// `<:name:id>` or `<a:name:id>` — the token a message or reaction uses for a custom emoji.
pub fn parse_custom_emoji(token: &str) -> Option<(bool, &str, Uuid)> {
    let inner = token.strip_prefix('<')?.strip_suffix('>')?;
    let (animated, rest) = match inner.strip_prefix("a:") {
        Some(r) => (true, r),
        None => (false, inner.strip_prefix(':')?),
    };
    let (name, id) = rest.split_once(':')?;
    if !valid_emoji_name(name) {
        return None;
    }
    Some((animated, name, Uuid::parse_str(id).ok()?))
}

async fn require_manage(db: &PgPool, guild_id: Uuid, uid: Uuid) -> AppResult<()> {
    let (_, p) = perms::guild_perms(db, guild_id, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)
}

async fn broadcast_emojis(state: &AppState, guild_id: Uuid) -> AppResult<()> {
    let emojis = emojis_for_guilds(&state.db, &[guild_id]).await?;
    state.hub.emit_guild(guild_id, "GUILD_EMOJIS_UPDATE", json!({ "guild_id": guild_id, "emojis": emojis }));
    Ok(())
}

async fn broadcast_stickers(state: &AppState, guild_id: Uuid) -> AppResult<()> {
    let stickers = stickers_for_guilds(&state.db, &[guild_id]).await?;
    state.hub.emit_guild(guild_id, "GUILD_STICKERS_UPDATE", json!({ "guild_id": guild_id, "stickers": stickers }));
    Ok(())
}

// ---------- emoji ----------

async fn list_emojis(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Emoji>>> {
    require_member(&state.db, id, uid).await?;
    Ok(Json(emojis_for_guilds(&state.db, &[id]).await?))
}

async fn create_emoji(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Emoji>)> {
    require_manage(&state.db, id, uid).await?;
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM emojis WHERE guild_id = $1").bind(id).fetch_one(&state.db).await?;
    if count >= MAX_EMOJIS_PER_GUILD {
        return Err(AppError::BadRequest(format!("A server can have at most {MAX_EMOJIS_PER_GUILD} emoji")));
    }
    let (img, fields) = store_image(&state, uid, "emoji", multipart, MAX_EMOJI).await?;
    let name = fields.get("name").map(|n| n.trim().to_string()).unwrap_or_default();
    if !valid_emoji_name(&name) {
        delete_image(&state, img.id).await;
        return Err(AppError::BadRequest("Emoji names are 2-32 letters, numbers or underscores".into()));
    }
    let res = sqlx::query_as::<_, Emoji>(&format!(
        "INSERT INTO emojis (id, guild_id, name, animated, creator_id) VALUES ($1, $2, $3, $4, $5) RETURNING {EMOJI_COLS}"
    ))
    .bind(img.id)
    .bind(id)
    .bind(&name)
    .bind(img.animated)
    .bind(uid)
    .fetch_one(&state.db)
    .await;
    let mut emoji = match res {
        Ok(e) => e,
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            delete_image(&state, img.id).await;
            return Err(AppError::Conflict("An emoji with that name already exists".into()));
        }
        Err(e) => {
            delete_image(&state, img.id).await;
            return Err(e.into());
        }
    };
    emoji.url = image_url(emoji.id);
    broadcast_emojis(&state, id).await?;
    Ok((StatusCode::CREATED, Json(emoji)))
}

#[derive(Deserialize)]
struct RenameEmoji {
    name: String,
}

async fn update_emoji(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, eid)): Path<(Uuid, Uuid)>,
    Json(req): Json<RenameEmoji>,
) -> AppResult<Json<Emoji>> {
    require_manage(&state.db, id, uid).await?;
    let name = req.name.trim().to_string();
    if !valid_emoji_name(&name) {
        return Err(AppError::BadRequest("Emoji names are 2-32 letters, numbers or underscores".into()));
    }
    let res = sqlx::query_as::<_, Emoji>(&format!("UPDATE emojis SET name = $3 WHERE id = $1 AND guild_id = $2 RETURNING {EMOJI_COLS}"))
        .bind(eid)
        .bind(id)
        .bind(&name)
        .fetch_optional(&state.db)
        .await;
    let mut emoji = match res {
        Ok(Some(e)) => e,
        Ok(None) => return Err(AppError::NotFound("Emoji not found".into())),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => return Err(AppError::Conflict("An emoji with that name already exists".into())),
        Err(e) => return Err(e.into()),
    };
    emoji.url = image_url(emoji.id);
    broadcast_emojis(&state, id).await?;
    Ok(Json(emoji))
}

async fn delete_emoji(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, eid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    require_manage(&state.db, id, uid).await?;
    let res = sqlx::query("DELETE FROM emojis WHERE id = $1 AND guild_id = $2").bind(eid).bind(id).execute(&state.db).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Emoji not found".into()));
    }
    delete_image(&state, eid).await;
    broadcast_emojis(&state, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- stickers ----------

fn clean_sticker(name: &str, description: &str, tags: &str) -> AppResult<(String, String, String)> {
    let name = name.trim().to_string();
    if !(2..=30).contains(&name.chars().count()) {
        return Err(AppError::BadRequest("Sticker names are 2-30 characters".into()));
    }
    let description = description.trim().chars().take(100).collect::<String>();
    let tags = tags.trim().chars().take(200).collect::<String>();
    Ok((name, description, tags))
}

async fn list_stickers(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Sticker>>> {
    require_member(&state.db, id, uid).await?;
    Ok(Json(stickers_for_guilds(&state.db, &[id]).await?))
}

async fn create_sticker(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    multipart: Multipart,
) -> AppResult<(StatusCode, Json<Sticker>)> {
    require_manage(&state.db, id, uid).await?;
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM stickers WHERE guild_id = $1").bind(id).fetch_one(&state.db).await?;
    if count >= MAX_STICKERS_PER_GUILD {
        return Err(AppError::BadRequest(format!("A server can have at most {MAX_STICKERS_PER_GUILD} stickers")));
    }
    let (img, fields) = store_image(&state, uid, "sticker", multipart, MAX_STICKER).await?;
    let get = |k: &str| fields.get(k).map(String::as_str).unwrap_or("");
    let (name, description, tags) = match clean_sticker(get("name"), get("description"), get("tags")) {
        Ok(v) => v,
        Err(e) => {
            delete_image(&state, img.id).await;
            return Err(e);
        }
    };
    let res = sqlx::query_as::<_, Sticker>(&format!(
        "INSERT INTO stickers (id, guild_id, name, description, tags, animated, creator_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING {STICKER_COLS}"
    ))
    .bind(img.id)
    .bind(id)
    .bind(&name)
    .bind(&description)
    .bind(&tags)
    .bind(img.animated)
    .bind(uid)
    .fetch_one(&state.db)
    .await;
    let mut sticker = match res {
        Ok(s) => s,
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            delete_image(&state, img.id).await;
            return Err(AppError::Conflict("A sticker with that name already exists".into()));
        }
        Err(e) => {
            delete_image(&state, img.id).await;
            return Err(e.into());
        }
    };
    sticker.url = image_url(sticker.id);
    broadcast_stickers(&state, id).await?;
    Ok((StatusCode::CREATED, Json(sticker)))
}

#[derive(Deserialize)]
struct UpdateSticker {
    name: Option<String>,
    description: Option<String>,
    tags: Option<String>,
}

async fn update_sticker(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, sid)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateSticker>,
) -> AppResult<Json<Sticker>> {
    require_manage(&state.db, id, uid).await?;
    let cur = sqlx::query_as::<_, Sticker>(&format!("SELECT {STICKER_COLS} FROM stickers WHERE id = $1 AND guild_id = $2"))
        .bind(sid)
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Sticker not found".into()))?;
    let (name, description, tags) = clean_sticker(
        req.name.as_deref().unwrap_or(&cur.name),
        req.description.as_deref().unwrap_or(&cur.description),
        req.tags.as_deref().unwrap_or(&cur.tags),
    )?;
    let res = sqlx::query_as::<_, Sticker>(&format!(
        "UPDATE stickers SET name = $2, description = $3, tags = $4 WHERE id = $1 RETURNING {STICKER_COLS}"
    ))
    .bind(sid)
    .bind(&name)
    .bind(&description)
    .bind(&tags)
    .fetch_one(&state.db)
    .await;
    let mut sticker = match res {
        Ok(s) => s,
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => return Err(AppError::Conflict("A sticker with that name already exists".into())),
        Err(e) => return Err(e.into()),
    };
    sticker.url = image_url(sticker.id);
    broadcast_stickers(&state, id).await?;
    Ok(Json(sticker))
}

async fn delete_sticker(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, sid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    require_manage(&state.db, id, uid).await?;
    let res = sqlx::query("DELETE FROM stickers WHERE id = $1 AND guild_id = $2").bind(sid).bind(id).execute(&state.db).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Sticker not found".into()));
    }
    delete_image(&state, sid).await;
    broadcast_stickers(&state, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// A sticker the user may send: from any server they belong to.
pub async fn sendable_sticker(db: &PgPool, sticker_id: Uuid, uid: Uuid) -> AppResult<bool> {
    let ok: Option<(bool,)> = sqlx::query_as(
        "SELECT true FROM stickers s JOIN guild_members m ON m.guild_id = s.guild_id AND m.user_id = $2 WHERE s.id = $1",
    )
    .bind(sticker_id)
    .bind(uid)
    .fetch_optional(db)
    .await?;
    Ok(ok.is_some())
}

/// A custom emoji the user may react with: from any server they belong to.
pub async fn usable_emoji(db: &PgPool, emoji_id: Uuid, uid: Uuid) -> AppResult<bool> {
    let ok: Option<(bool,)> = sqlx::query_as(
        "SELECT true FROM emojis e JOIN guild_members m ON m.guild_id = e.guild_id AND m.user_id = $2 WHERE e.id = $1",
    )
    .bind(emoji_id)
    .bind(uid)
    .fetch_optional(db)
    .await?;
    Ok(ok.is_some())
}
