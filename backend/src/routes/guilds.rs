use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Ban, Channel, Guild, Invite, Member},
    perms,
    routes::roles::{attach_roles, create_everyone},
    routes::users::validate_image,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
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
        .route("/guilds/:id/bans", get(list_bans))
        .route("/guilds/:id/bans/:uid", put(ban_member).delete(unban_member))
        .route("/guilds/:id/owner", post(transfer_ownership))
}

pub const GUILD_COLS: &str = "id, name, icon_url, owner_id, created_at, banner_url";
pub const CHANNEL_COLS: &str = "id, guild_id, name, kind, topic, position, created_at, owner_id, icon_url";

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
    let mut m = sqlx::query_as::<_, Member>(
        "SELECT m.guild_id, m.user_id, m.nickname, m.joined_at, u.username, u.display_name, u.avatar_url, u.status, u.custom_status
         FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = $1 AND m.user_id = $2",
    )
    .bind(guild_id)
    .bind(user_id)
    .fetch_one(db)
    .await?;
    attach_roles(db, std::slice::from_mut(&mut m)).await?;
    Ok(m)
}

async fn list_guilds(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Guild>>> {
    let gs = sqlx::query_as::<_, Guild>(
        "SELECT g.id, g.name, g.icon_url, g.owner_id, g.created_at, g.banner_url FROM guilds g
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
    banner_url: Option<String>,
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
        "INSERT INTO guilds (id, name, icon_url, owner_id, banner_url) VALUES ($1, $2, $3, $4, $5) RETURNING {GUILD_COLS}"
    ))
    .bind(gid)
    .bind(&name)
    .bind(req.icon_url.filter(|s| !s.is_empty()))
    .bind(uid)
    .bind(req.banner_url.filter(|s| !s.is_empty()))
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2)")
        .bind(gid)
        .bind(uid)
        .execute(&mut *tx)
        .await?;
    create_everyone(&mut tx, gid).await?;
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

    let roles = perms::list_roles(&state.db, gid).await?;
    let payload = json!({ "id": guild.id, "name": guild.name, "icon_url": guild.icon_url, "banner_url": guild.banner_url, "owner_id": guild.owner_id,
        "created_at": guild.created_at, "channels": channels, "roles": roles });
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
    /// Empty string clears.
    banner_url: Option<String>,
}

async fn update_guild(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateGuild>,
) -> AppResult<Json<Guild>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    if let Some(n) = &req.name {
        if n.trim().is_empty() || n.len() > 100 {
            return Err(AppError::BadRequest("Server name must be 1-100 characters".into()));
        }
    }
    validate_image(&req.icon_url)?;
    crate::routes::users::validate_image_max(&req.banner_url, 1024 * 1024)?;
    let before: (Option<String>, Option<String>) = sqlx::query_as("SELECT icon_url, banner_url FROM guilds WHERE id = $1").bind(id).fetch_one(&state.db).await?;
    let g = sqlx::query_as::<_, Guild>(&format!(
        "UPDATE guilds SET name = COALESCE($2, name),
           icon_url = CASE WHEN $3::text IS NULL THEN icon_url WHEN $3 = '' THEN NULL ELSE $3 END,
           banner_url = CASE WHEN $4::text IS NULL THEN banner_url WHEN $4 = '' THEN NULL ELSE $4 END
         WHERE id = $1 RETURNING {GUILD_COLS}"
    ))
    .bind(id)
    .bind(req.name.map(|n| n.trim().to_string()))
    .bind(req.icon_url)
    .bind(req.banner_url)
    .fetch_one(&state.db)
    .await?;
    crate::routes::images::release_replaced(&state, before.0.as_deref(), g.icon_url.as_deref()).await;
    crate::routes::images::release_replaced(&state, before.1.as_deref(), g.banner_url.as_deref()).await;
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
    state.hub.voice_evict(|v| v.guild_id == Some(id));
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
    Ok(Json(perms::visible_channels(&state.db, id, uid).await?))
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
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
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
    let target = perms::channel_audience(&state.db, &c).await?;
    state.hub.emit(target, "CHANNEL_CREATE", json!(c));
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
    let mut ms = sqlx::query_as::<_, Member>(
        "SELECT m.guild_id, m.user_id, m.nickname, m.joined_at, u.username, u.display_name, u.avatar_url, u.status, u.custom_status
         FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = $1 ORDER BY u.display_name",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    attach_roles(&state.db, &mut ms).await?;
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
    let (ctx, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::KICK_MEMBERS)?;
    if target == uid {
        return Err(AppError::BadRequest("Cannot kick yourself".into()));
    }
    if !ctx.outranks_member(uid, target) {
        return Err(AppError::Forbidden);
    }
    remove_member(&state, id, target).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_member(state: &AppState, guild_id: Uuid, user_id: Uuid) -> AppResult<()> {
    if !try_remove_member(state, guild_id, user_id).await? {
        return Err(AppError::NotFound("Member not found".into()));
    }
    Ok(())
}

/// Drop a member row (and their per-channel overwrites), evict them from voice and tell everyone.
/// Returns false when they were not a member.
async fn try_remove_member(state: &AppState, guild_id: Uuid, user_id: Uuid) -> AppResult<bool> {
    let res = sqlx::query("DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2")
        .bind(guild_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Ok(false);
    }
    sqlx::query("DELETE FROM channel_overwrites WHERE target_kind = 'member' AND target_id = $1 AND channel_id IN (SELECT id FROM channels WHERE guild_id = $2)")
        .bind(user_id)
        .bind(guild_id)
        .execute(&state.db)
        .await?;
    state.hub.voice_evict(|v| v.guild_id == Some(guild_id) && v.user_id == user_id);
    let payload = json!({ "guild_id": guild_id, "user_id": user_id });
    state.hub.emit_guild(guild_id, "GUILD_MEMBER_REMOVE", payload.clone());
    // The removed user no longer matches the guild target; notify them directly.
    state.hub.emit_users(vec![user_id], "GUILD_MEMBER_REMOVE", payload);
    Ok(true)
}

pub const BAN_COLS: &str = "b.guild_id, b.user_id, b.moderator_id, b.reason, b.created_at, u.username, u.display_name, u.avatar_url, mu.display_name AS moderator_name";

pub async fn is_banned(db: &PgPool, guild_id: Uuid, user_id: Uuid) -> AppResult<bool> {
    let row: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_bans WHERE guild_id = $1 AND user_id = $2")
        .bind(guild_id)
        .bind(user_id)
        .fetch_optional(db)
        .await?;
    Ok(row.is_some())
}

async fn fetch_ban(db: &PgPool, guild_id: Uuid, user_id: Uuid) -> AppResult<Ban> {
    Ok(sqlx::query_as::<_, Ban>(&format!(
        "SELECT {BAN_COLS} FROM guild_bans b JOIN users u ON u.id = b.user_id LEFT JOIN users mu ON mu.id = b.moderator_id WHERE b.guild_id = $1 AND b.user_id = $2"
    ))
    .bind(guild_id)
    .bind(user_id)
    .fetch_one(db)
    .await?)
}

async fn list_bans(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Ban>>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::BAN_MEMBERS)?;
    let bans = sqlx::query_as::<_, Ban>(&format!(
        "SELECT {BAN_COLS} FROM guild_bans b JOIN users u ON u.id = b.user_id LEFT JOIN users mu ON mu.id = b.moderator_id WHERE b.guild_id = $1 ORDER BY b.created_at DESC"
    ))
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(bans))
}

#[derive(Deserialize, Default)]
struct BanReq {
    reason: Option<String>,
}

/// Ban a user: they are removed (if a member) and can no longer accept invites. Like Discord, a
/// user who is not currently a member can be banned pre-emptively. Owners cannot be banned and
/// you must outrank the target.
async fn ban_member(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
    body: Option<Json<BanReq>>,
) -> AppResult<(StatusCode, Json<Ban>)> {
    let (ctx, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::BAN_MEMBERS)?;
    if target == uid {
        return Err(AppError::BadRequest("You cannot ban yourself".into()));
    }
    if ctx.is_owner(target) {
        return Err(AppError::BadRequest("The server owner cannot be banned".into()));
    }
    if ctx.is_member(target) && !ctx.outranks_member(uid, target) {
        return Err(AppError::Forbidden);
    }
    let reason: String = body.and_then(|Json(b)| b.reason).unwrap_or_default().trim().chars().take(512).collect();
    let inserted = sqlx::query(
        "INSERT INTO guild_bans (guild_id, user_id, moderator_id, reason) SELECT $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM users WHERE id = $2)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET moderator_id = EXCLUDED.moderator_id, reason = EXCLUDED.reason, created_at = now()",
    )
    .bind(id)
    .bind(target)
    .bind(uid)
    .bind(&reason)
    .execute(&state.db)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Err(AppError::NotFound("User not found".into()));
    }
    try_remove_member(&state, id, target).await?;
    let ban = fetch_ban(&state.db, id, target).await?;
    state.hub.emit_guild(id, "GUILD_BAN_ADD", json!(ban));
    Ok((StatusCode::CREATED, Json(ban)))
}

async fn unban_member(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::BAN_MEMBERS)?;
    let res = sqlx::query("DELETE FROM guild_bans WHERE guild_id = $1 AND user_id = $2")
        .bind(id)
        .bind(target)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Ban not found".into()));
    }
    state.hub.emit_guild(id, "GUILD_BAN_REMOVE", json!({ "guild_id": id, "user_id": target }));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct TransferReq {
    user_id: Uuid,
}

/// Hand the server to another member. Only the current owner may do this. The old owner keeps
/// their roles but loses the implicit all-permissions, so channel visibility is re-synced.
async fn transfer_ownership(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<TransferReq>,
) -> AppResult<Json<Guild>> {
    require_owner(&state.db, id, uid).await?;
    if req.user_id == uid {
        return Err(AppError::BadRequest("You already own this server".into()));
    }
    let member: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2")
        .bind(id)
        .bind(req.user_id)
        .fetch_optional(&state.db)
        .await?;
    if member.is_none() {
        return Err(AppError::BadRequest("The new owner must be a member of this server".into()));
    }
    let before = perms::visibility(&state.db, id).await?;
    let g = sqlx::query_as::<_, Guild>(&format!("UPDATE guilds SET owner_id = $2 WHERE id = $1 RETURNING {GUILD_COLS}"))
        .bind(id)
        .bind(req.user_id)
        .fetch_one(&state.db)
        .await?;
    state.hub.emit_guild(id, "GUILD_UPDATE", json!(g));
    perms::resync_visibility(&state, id, &before).await?;
    Ok(Json(g))
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
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::CREATE_INVITE)?;
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
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    let invs = sqlx::query_as::<_, Invite>(
        "SELECT code, guild_id, creator_id, uses, max_uses, created_at FROM invites WHERE guild_id = $1 ORDER BY created_at DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(invs))
}
