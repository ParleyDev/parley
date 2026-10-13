use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Channel, Guild, Invite, Member},
    routes::users::validate_image,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get},
    Json, Router,
};
use rand::{distributions::Alphanumeric, Rng};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds", get(list_guilds).post(create_guild))
        .route("/guilds/:id", get(get_guild).patch(update_guild).delete(delete_guild))
        .route("/guilds/:id/channels", get(list_channels).post(create_channel))
        .route("/guilds/:id/members", get(list_members))
        .route("/guilds/:id/members/@me", delete(leave_guild))
        .route("/guilds/:id/members/:uid", delete(kick_member))
        .route("/guilds/:id/invites", get(list_invites).post(create_invite))
}

pub const GUILD_COLS: &str = "id, name, icon_url, owner_id, created_at";
pub const CHANNEL_COLS: &str = "id, guild_id, name, kind, topic, position, created_at";

pub async fn require_member(db: &PgPool, guild_id: Uuid, user_id: Uuid) -> AppResult<Guild> {
    let g = sqlx::query_as::<_, Guild>(&format!(
        "SELECT g.{} FROM guilds g JOIN guild_members m ON m.guild_id = g.id
         WHERE g.id = $1 AND m.user_id = $2",
        GUILD_COLS.replace(", ", ", g.")
    ))
    .bind(guild_id)
    .bind(user_id)
    .fetch_optional(db)
    .await?;
    g.ok_or_else(|| AppError::NotFound("Server not found".into()))
}

pub async fn require_owner(db: &PgPool, guild_id: Uuid, user_id: Uuid) -> AppResult<Guild> {
    let g = require_member(db, guild_id, user_id).await?;
    if g.owner_id != user_id {
        return Err(AppError::Forbidden);
    }
    Ok(g)
}

pub async fn fetch_member(db: &PgPool, guild_id: Uuid, user_id: Uuid) -> AppResult<Member> {
    Ok(sqlx::query_as::<_, Member>(
        "SELECT m.guild_id, m.user_id, m.nickname, m.joined_at, u.username, u.display_name, u.avatar_url, u.status
         FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = $1 AND m.user_id = $2",
    )
    .bind(guild_id)
    .bind(user_id)
    .fetch_one(db)
    .await?)
}

async fn list_guilds(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Guild>>> {
    let gs = sqlx::query_as::<_, Guild>(
        "SELECT g.id, g.name, g.icon_url, g.owner_id, g.created_at FROM guilds g
         JOIN guild_members m ON m.guild_id = g.id WHERE m.user_id = $1 ORDER BY m.joined_at",
    )
    .bind(uid)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(gs))
}

#[derive(Deserialize)]
struct CreateGuild {
    name: String,
    icon_url: Option<String>,
}

async fn create_guild(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(req): Json<CreateGuild>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::BadRequest("Server name must be 1-100 characters".into()));
    }
    validate_image(&req.icon_url)?;

    let mut tx = state.db.begin().await?;
    let gid = Uuid::now_v7();
    let guild = sqlx::query_as::<_, Guild>(&format!(
        "INSERT INTO guilds (id, name, icon_url, owner_id) VALUES ($1, $2, $3, $4) RETURNING {GUILD_COLS}"
    ))
    .bind(gid)
    .bind(&name)
    .bind(req.icon_url.filter(|s| !s.is_empty()))
    .bind(uid)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2)")
        .bind(gid)
        .bind(uid)
        .execute(&mut *tx)
        .await?;
    let channels = vec![
        sqlx::query_as::<_, Channel>(&format!(
            "INSERT INTO channels (id, guild_id, name, kind, position) VALUES ($1, $2, 'general', 'text', 0) RETURNING {CHANNEL_COLS}"
        ))
        .bind(Uuid::now_v7())
        .bind(gid)
        .fetch_one(&mut *tx)
        .await?,
        sqlx::query_as::<_, Channel>(&format!(
            "INSERT INTO channels (id, guild_id, name, kind, position) VALUES ($1, $2, 'General', 'voice', 1) RETURNING {CHANNEL_COLS}"
        ))
        .bind(Uuid::now_v7())
        .bind(gid)
        .fetch_one(&mut *tx)
        .await?,
    ];
    tx.commit().await?;

    let payload = json!({ "id": guild.id, "name": guild.name, "icon_url": guild.icon_url, "owner_id": guild.owner_id,
        "created_at": guild.created_at, "channels": channels });
    state.hub.emit_users(vec![uid], "GUILD_CREATE", payload.clone());
    Ok((StatusCode::CREATED, Json(payload)))
}

async fn get_guild(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Guild>> {
    Ok(Json(require_member(&state.db, id, uid).await?))
}

#[derive(Deserialize)]
struct UpdateGuild {
    name: Option<String>,
    icon_url: Option<String>,
}

async fn update_guild(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateGuild>,
) -> AppResult<Json<Guild>> {
    require_owner(&state.db, id, uid).await?;
    if let Some(n) = &req.name {
        if n.trim().is_empty() || n.len() > 100 {
            return Err(AppError::BadRequest("Server name must be 1-100 characters".into()));
        }
    }
    validate_image(&req.icon_url)?;
    let g = sqlx::query_as::<_, Guild>(&format!(
        "UPDATE guilds SET name = COALESCE($2, name),
           icon_url = CASE WHEN $3::text IS NULL THEN icon_url WHEN $3 = '' THEN NULL ELSE $3 END
         WHERE id = $1 RETURNING {GUILD_COLS}"
    ))
    .bind(id)
    .bind(req.name.map(|n| n.trim().to_string()))
    .bind(req.icon_url)
    .fetch_one(&state.db)
    .await?;
    state.hub.emit_guild(id, "GUILD_UPDATE", json!(g));
    Ok(Json(g))
}

async fn delete_guild(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    require_owner(&state.db, id, uid).await?;
    // Emit before deleting so member set is still intact for fan-out.
    state.hub.emit_guild(id, "GUILD_DELETE", json!({ "id": id }));
    sqlx::query("DELETE FROM guilds WHERE id = $1").bind(id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_channels(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Channel>>> {
    require_member(&state.db, id, uid).await?;
    let cs = sqlx::query_as::<_, Channel>(&format!(
        "SELECT {CHANNEL_COLS} FROM channels WHERE guild_id = $1 ORDER BY position, created_at"
    ))
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(cs))
}

#[derive(Deserialize)]
struct CreateChannel {
    name: String,
    kind: Option<String>,
    topic: Option<String>,
}

async fn create_channel(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateChannel>,
) -> AppResult<(StatusCode, Json<Channel>)> {
    require_member(&state.db, id, uid).await?;
    let kind = req.kind.unwrap_or_else(|| "text".into());
    if !["text", "voice"].contains(&kind.as_str()) {
        return Err(AppError::BadRequest("kind must be text or voice".into()));
    }
    let name = normalize_channel_name(&req.name, &kind)?;
    let (pos,): (i32,) = sqlx::query_as("SELECT COALESCE(MAX(position), -1) + 1 FROM channels WHERE guild_id = $1")
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    let c = sqlx::query_as::<_, Channel>(&format!(
        "INSERT INTO channels (id, guild_id, name, kind, topic, position) VALUES ($1, $2, $3, $4, $5, $6) RETURNING {CHANNEL_COLS}"
    ))
    .bind(Uuid::now_v7())
    .bind(id)
    .bind(&name)
    .bind(&kind)
    .bind(req.topic.unwrap_or_default().chars().take(1024).collect::<String>())
    .bind(pos)
    .fetch_one(&state.db)
    .await?;
    state.hub.emit_guild(id, "CHANNEL_CREATE", json!(c));
    Ok((StatusCode::CREATED, Json(c)))
}

pub fn normalize_channel_name(raw: &str, kind: &str) -> AppResult<String> {
    let name = if kind == "text" {
        raw.trim().to_lowercase().chars().map(|c| if c.is_whitespace() { '-' } else { c }).collect::<String>()
    } else {
        raw.trim().to_string()
    };
    if name.is_empty() || name.len() > 100 {
        return Err(AppError::BadRequest("Channel name must be 1-100 characters".into()));
    }
    Ok(name)
}

async fn list_members(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Member>>> {
    require_member(&state.db, id, uid).await?;
    let ms = sqlx::query_as::<_, Member>(
        "SELECT m.guild_id, m.user_id, m.nickname, m.joined_at, u.username, u.display_name, u.avatar_url, u.status
         FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = $1 ORDER BY u.display_name",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(ms))
}

async fn leave_guild(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let g = require_member(&state.db, id, uid).await?;
    if g.owner_id == uid {
        return Err(AppError::BadRequest("Owner cannot leave; delete the server or transfer ownership".into()));
    }
    remove_member(&state, id, uid).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn kick_member(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    require_owner(&state.db, id, uid).await?;
    if target == uid {
        return Err(AppError::BadRequest("Cannot kick yourself".into()));
    }
    remove_member(&state, id, target).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_member(state: &AppState, guild_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2")
        .bind(guild_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Member not found".into()));
    }
    let payload = json!({ "guild_id": guild_id, "user_id": user_id });
    state.hub.emit_guild(guild_id, "GUILD_MEMBER_REMOVE", payload.clone());
    // The removed user no longer matches the guild target; notify them directly.
    state.hub.emit_users(vec![user_id], "GUILD_MEMBER_REMOVE", payload);
    Ok(())
}

#[derive(Deserialize)]
struct CreateInvite {
    max_uses: Option<i32>,
}

async fn create_invite(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateInvite>,
) -> AppResult<(StatusCode, Json<Invite>)> {
    require_member(&state.db, id, uid).await?;
    let code: String = rand::thread_rng().sample_iter(&Alphanumeric).take(8).map(char::from).collect();
    let inv = sqlx::query_as::<_, Invite>(
        "INSERT INTO invites (code, guild_id, creator_id, max_uses) VALUES ($1, $2, $3, $4)
         RETURNING code, guild_id, creator_id, uses, max_uses, created_at",
    )
    .bind(&code)
    .bind(id)
    .bind(uid)
    .bind(req.max_uses.filter(|n| *n > 0))
    .fetch_one(&state.db)
    .await?;
    Ok((StatusCode::CREATED, Json(inv)))
}

async fn list_invites(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Invite>>> {
    require_member(&state.db, id, uid).await?;
    let invs = sqlx::query_as::<_, Invite>(
        "SELECT code, guild_id, creator_id, uses, max_uses, created_at FROM invites WHERE guild_id = $1 ORDER BY created_at DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(invs))
}
