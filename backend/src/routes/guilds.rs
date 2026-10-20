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
        .route("/guilds/:id/rules/accept", axum::routing::post(accept_rules))
        .route("/guilds/:id", get(get_guild).patch(update_guild).delete(delete_guild))
        .route("/guilds/:id/channels", get(list_channels).post(create_channel))
        .route("/guilds/:id/members", get(list_members))
        .route("/guilds/:id/members/@me", delete(leave_guild))
        .route("/guilds/:id/members/:uid", delete(kick_member))
        .route("/guilds/:id/members/:uid/timeout", put(timeout_member).delete(clear_timeout))
        .route("/guilds/:id/audit", get(list_audit))
        .route("/guilds/:id/channels/positions", axum::routing::patch(reorder_channels))
        .route("/guilds/:id/invites", get(list_invites).post(create_invite))
        .route("/guilds/:id/bans", get(list_bans))
        .route("/guilds/:id/bans/:uid", put(ban_member).delete(unban_member))
        .route("/guilds/:id/owner", post(transfer_ownership))
}

pub const GUILD_COLS: &str = "id, name, icon_url, owner_id, created_at, banner_url, rules, rules_required";
pub const CHANNEL_COLS: &str = "id, guild_id, name, kind, topic, position, created_at, owner_id, icon_url, parent_id";

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

/// `POST /guilds/:id/rules/accept`: the caller accepts the server rules (membership screening).
pub async fn accept_rules(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Member>> {
    let res = sqlx::query("UPDATE guild_members SET rules_accepted_at = COALESCE(rules_accepted_at, now()) WHERE guild_id = $1 AND user_id = $2").bind(id).bind(uid).execute(&state.db).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Not a member".into()));
    }
    let m = fetch_member(&state.db, id, uid).await?;
    state.hub.emit_guild(id, "GUILD_MEMBER_UPDATE", json!(m));
    Ok(Json(m))
}

/// Membership screening gate: Err(RulesRequired) when the guild requires rules the member has not accepted.
pub async fn check_rules(db: &PgPool, guild_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let blocked: Option<(bool,)> = sqlx::query_as("SELECT g.rules_required AND m.rules_accepted_at IS NULL FROM guilds g JOIN guild_members m ON m.guild_id = g.id AND m.user_id = $2 WHERE g.id = $1")
        .bind(guild_id).bind(user_id).fetch_optional(db).await?;
    if blocked.map(|b| b.0).unwrap_or(false) { Err(AppError::RulesRequired) } else { Ok(()) }
}

pub async fn fetch_member(db: &PgPool, guild_id: Uuid, user_id: Uuid) -> AppResult<Member> {
    let mut m = sqlx::query_as::<_, Member>(
        "SELECT m.guild_id, m.user_id, m.nickname, m.joined_at, u.username, u.display_name, u.avatar_url, u.status, u.custom_status, m.timeout_until, m.rules_accepted_at, u.avatar_decoration, u.clan_tag, m.rules_accepted_at
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
    crate::routes::users::require_verified(&state, uid).await?;
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
    let payload = json!({ "id": guild.id, "name": guild.name, "icon_url": guild.icon_url, "banner_url": guild.banner_url, "owner_id": guild.owner_id, "rules": guild.rules, "rules_required": guild.rules_required,
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
    /// Membership screening: rules markdown (up to 4000 chars) and whether accepting them is required to chat.
    rules: Option<String>,
    rules_required: Option<bool>,
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
    let (before_name, before): (String, (Option<String>, Option<String>)) = sqlx::query_as::<_, (String, Option<String>, Option<String>)>("SELECT name, icon_url, banner_url FROM guilds WHERE id = $1").bind(id).fetch_one(&state.db).await.map(|r| (r.0, (r.1, r.2)))?;
    let rules = req.rules.map(|r| r.trim_end().chars().take(4000).collect::<String>());
    let g = sqlx::query_as::<_, Guild>(&format!(
        "UPDATE guilds SET name = COALESCE($2, name),
           icon_url = CASE WHEN $3::text IS NULL THEN icon_url WHEN $3 = '' THEN NULL ELSE $3 END,
           banner_url = CASE WHEN $4::text IS NULL THEN banner_url WHEN $4 = '' THEN NULL ELSE $4 END,
           rules = COALESCE($5, rules), rules_required = COALESCE($6, rules_required)
         WHERE id = $1 RETURNING {GUILD_COLS}"
    ))
    .bind(id)
    .bind(req.name.map(|n| n.trim().to_string()))
    .bind(req.icon_url)
    .bind(req.banner_url)
    .bind(&rules)
    .bind(req.rules_required)
    .fetch_one(&state.db)
    .await?;
    crate::routes::images::release_replaced(&state, before.0.as_deref(), g.icon_url.as_deref()).await;
    crate::routes::images::release_replaced(&state, before.1.as_deref(), g.banner_url.as_deref()).await;
    state.hub.emit_guild(id, "GUILD_UPDATE", json!(g));
    let mut changed = serde_json::Map::new();
    if g.name != before_name { changed.insert("name".into(), json!(g.name)); }
    if g.icon_url != before.0 { changed.insert("icon".into(), json!(g.icon_url.is_some())); }
    if g.banner_url != before.1 { changed.insert("banner".into(), json!(g.banner_url.is_some())); }
    if rules.is_some() { changed.insert("rules".into(), json!(!g.rules.is_empty())); }
    if let Some(r) = req.rules_required { changed.insert("rules_required".into(), json!(r)); }
    crate::audit::guild(&state, id, uid, "guild.update", "guild", Some(id), &g.name, serde_json::Value::Object(changed)).await;
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
    /// Category to create the channel under (text/voice only).
    parent_id: Option<Uuid>,
}

/// A valid category in this guild for `parent_id`, or an error.
pub async fn check_parent(db: &PgPool, guild_id: Uuid, kind: &str, parent: Option<Uuid>) -> AppResult<Option<Uuid>> {
    let Some(pid) = parent else { return Ok(None) };
    if kind == "category" {
        return Err(AppError::BadRequest("Categories cannot be nested".into()));
    }
    let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM channels WHERE id = $1 AND guild_id = $2 AND kind = 'category'").bind(pid).bind(guild_id).fetch_optional(db).await?;
    if ok.is_none() {
        return Err(AppError::BadRequest("parent_id must be a category in this server".into()));
    }
    Ok(Some(pid))
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
    if !["text", "voice", "category", "forum"].contains(&kind.as_str()) {
        return Err(AppError::BadRequest("kind must be text, voice, forum or category".into()));
    }
    let name = normalize_channel_name(&req.name, &kind)?;
    let parent = check_parent(&state.db, id, &kind, req.parent_id).await?;
    let (pos,): (i32,) = sqlx::query_as("SELECT COALESCE(MAX(position), -1) + 1 FROM channels WHERE guild_id = $1")
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    let mut c = sqlx::query_as::<_, Channel>(&format!(
        "INSERT INTO channels (id, guild_id, name, kind, topic, position, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING {CHANNEL_COLS}"
    ))
    .bind(Uuid::now_v7())
    .bind(id)
    .bind(&name)
    .bind(&kind)
    .bind(req.topic.unwrap_or_default().chars().take(1024).collect::<String>())
    .bind(pos)
    .bind(parent)
    .fetch_one(&state.db)
    .await?;
    // Inherit the category's overwrites (so a private category yields a private channel).
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut c)).await?;
    let target = perms::channel_audience(&state.db, &c).await?;
    state.hub.emit(target, "CHANNEL_CREATE", json!(c));
    crate::audit::guild(&state, id, uid, "channel.create", "channel", Some(c.id), &c.name, json!({ "kind": c.kind })).await;
    Ok((StatusCode::CREATED, Json(c)))
}

pub fn normalize_channel_name(raw: &str, kind: &str) -> AppResult<String> {
    let name = if kind == "category" {
        raw.trim().chars().take(100).collect::<String>()
    } else if kind == "text" || kind == "forum" {
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
        "SELECT m.guild_id, m.user_id, m.nickname, m.joined_at, u.username, u.display_name, u.avatar_url, u.status, u.custom_status, m.timeout_until, m.rules_accepted_at, u.avatar_decoration, u.clan_tag
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
    let name = crate::audit::username(&state, target).await;
    remove_member(&state, id, target).await?;
    crate::audit::guild(&state, id, uid, "member.kick", "user", Some(target), &name, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct TimeoutReq {
    /// 1 minute to 28 days.
    minutes: i64,
}

/// Time a member out: they can read but not send, react, attach, or use voice until it lapses. Needs MODERATE_MEMBERS
/// and rank above the target; owners and administrators cannot be timed out.
async fn timeout_member(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
    Json(req): Json<TimeoutReq>,
) -> AppResult<Json<Member>> {
    let (ctx, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MODERATE_MEMBERS)?;
    if !ctx.is_member(target) {
        return Err(AppError::NotFound("Member not found".into()));
    }
    if target == uid {
        return Err(AppError::BadRequest("You cannot time yourself out".into()));
    }
    if !ctx.outranks_member(uid, target) {
        return Err(AppError::Forbidden);
    }
    if ctx.base(target).map(|b| perms::has(b, perms::ADMINISTRATOR)).unwrap_or(false) {
        return Err(AppError::BadRequest("Administrators cannot be timed out".into()));
    }
    if !(1..=28 * 24 * 60).contains(&req.minutes) {
        return Err(AppError::BadRequest("Timeout must be between 1 minute and 28 days".into()));
    }
    sqlx::query("UPDATE guild_members SET timeout_until = now() + make_interval(mins => $3) WHERE guild_id = $1 AND user_id = $2")
        .bind(id)
        .bind(target)
        .bind(req.minutes as i32)
        .execute(&state.db)
        .await?;
    state.hub.voice_evict(|v| v.user_id == target && v.guild_id == Some(id));
    let m = fetch_member(&state.db, id, target).await?;
    state.hub.emit_guild(id, "GUILD_MEMBER_UPDATE", json!(m));
    crate::audit::guild(&state, id, uid, "member.timeout", "user", Some(target), &m.username, json!({ "minutes": req.minutes })).await;
    Ok(Json(m))
}

async fn clear_timeout(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<Member>> {
    let (ctx, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MODERATE_MEMBERS)?;
    if !ctx.is_member(target) {
        return Err(AppError::NotFound("Member not found".into()));
    }
    if !ctx.outranks_member(uid, target) {
        return Err(AppError::Forbidden);
    }
    sqlx::query("UPDATE guild_members SET timeout_until = NULL WHERE guild_id = $1 AND user_id = $2").bind(id).bind(target).execute(&state.db).await?;
    let m = fetch_member(&state.db, id, target).await?;
    state.hub.emit_guild(id, "GUILD_MEMBER_UPDATE", json!(m));
    crate::audit::guild(&state, id, uid, "member.timeout_clear", "user", Some(target), &m.username, json!({})).await;
    Ok(Json(m))
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
    crate::audit::guild(&state, id, uid, "member.ban", "user", Some(target), &ban.username, json!({ "reason": reason })).await;
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
    crate::audit::guild(&state, id, uid, "member.unban", "user", Some(target), &crate::audit::username(&state, target).await, json!({})).await;
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
    crate::audit::guild(&state, id, uid, "guild.transfer", "user", Some(req.user_id), &crate::audit::username(&state, req.user_id).await, json!({})).await;
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

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct GuildAuditRow {
    pub id: Uuid,
    pub actor_id: Option<Uuid>,
    pub actor_name: String,
    pub action: String,
    pub target_kind: String,
    pub target_id: Option<Uuid>,
    pub target_name: String,
    pub details: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
struct AuditQuery {
    before: Option<Uuid>,
    #[serde(default)]
    q: String,
}

/// Server audit log, newest first, 100 per page; needs Manage Server.
async fn list_audit(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    axum::extract::Query(q): axum::extract::Query<AuditQuery>,
) -> AppResult<Json<Vec<GuildAuditRow>>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    let t = q.q.trim().replace('%', "\\%").replace('_', "\\_");
    let pat = if t.is_empty() { None } else { Some(format!("%{t}%")) };
    let rows = sqlx::query_as::<_, GuildAuditRow>(
        "SELECT id, actor_id, actor_name, action, target_kind, target_id, target_name, details, created_at FROM guild_audit
         WHERE guild_id = $1 AND ($2::uuid IS NULL OR id < $2) AND ($3::text IS NULL OR actor_name ILIKE $3 OR action ILIKE $3 OR target_name ILIKE $3)
         ORDER BY id DESC LIMIT 100",
    )
    .bind(id)
    .bind(q.before)
    .bind(pat)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct PositionItem {
    id: Uuid,
    position: i32,
    /// Omit to keep the current category; null to move to the top level.
    #[serde(default, deserialize_with = "crate::routes::roles::deserialize_nullable_uuid")]
    parent_id: Option<Option<Uuid>>,
}

#[derive(Deserialize)]
struct Positions {
    items: Vec<PositionItem>,
}

/// Bulk reorder / re-parent (drag and drop). Needs Manage Channels; categories keep parent NULL.
async fn reorder_channels(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<Positions>,
) -> AppResult<Json<Vec<Channel>>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    if req.items.len() > 500 {
        return Err(AppError::BadRequest("Too many items".into()));
    }
    let before = perms::visibility(&state.db, id).await?;
    let mut tx = state.db.begin().await?;
    for it in &req.items {
        let kind: Option<(String,)> = sqlx::query_as("SELECT kind FROM channels WHERE id = $1 AND guild_id = $2").bind(it.id).bind(id).fetch_optional(&mut *tx).await?;
        let Some((kind,)) = kind else { return Err(AppError::NotFound("Channel not found".into())) };
        match it.parent_id {
            Some(parent) => {
                let parent = check_parent(&state.db, id, &kind, parent).await?;
                sqlx::query("UPDATE channels SET position = $3, parent_id = $4 WHERE id = $1 AND guild_id = $2").bind(it.id).bind(id).bind(it.position).bind(parent).execute(&mut *tx).await?;
            }
            None => {
                sqlx::query("UPDATE channels SET position = $3 WHERE id = $1 AND guild_id = $2").bind(it.id).bind(id).bind(it.position).execute(&mut *tx).await?;
            }
        }
    }
    tx.commit().await?;
    // Parent changes can change inherited overwrites; this also pushes CHANNEL_UPDATE (new positions) to everyone.
    perms::resync_visibility(&state, id, &before).await?;
    crate::audit::guild(&state, id, uid, "channel.reorder", "guild", Some(id), "", json!({ "count": req.items.len() })).await;
    Ok(Json(perms::guild_channels(&state.db, id).await?))
}
