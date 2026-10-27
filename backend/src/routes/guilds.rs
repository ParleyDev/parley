use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Ban, Channel, Guild, Invite, InviteListing, Member},
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
use serde::{Deserialize, Serialize};
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
        .route("/guilds/:id/member-joins", get(member_joins))
        .route("/guilds/:id/invites/:code", delete(delete_invite))
        .route("/guilds/:id/bans", get(list_bans))
        .route("/guilds/:id/bans/:uid", put(ban_member).delete(unban_member))
        .route("/guilds/:id/owner", post(transfer_ownership))
}

/// A server as GUILD_CREATE sends it: every guild field, plus the extras (channels, roles, emojis, ...).
pub fn guild_payload(g: &Guild, extra: serde_json::Value) -> serde_json::Value {
    let mut v = json!(g);
    if let (Some(obj), Some(more)) = (v.as_object_mut(), extra.as_object()) {
        for (k, x) in more { obj.insert(k.clone(), x.clone()); }
    }
    v
}

pub const GUILD_COLS: &str = "id, name, icon_url, owner_id, created_at, banner_url, rules, rules_required, description, system_channel_id, join_notices, join_wave, default_notifications, verification_level, mfa_level, invites_paused, dms_paused_until, afk_channel_id, afk_timeout, rules_channel_id, welcome_screen, widget_enabled, widget_invite, invite_splash_url, raid_protection, raid_threshold, safety_alerts_channel_id, onboarding, applications, tag, tag_badge, partnered";
pub const CHANNEL_COLS: &str = "id, guild_id, name, kind, topic, position, created_at, owner_id, icon_url, parent_id, nsfw, audio_mode, audio_bitrate, audio_low_latency, e2ee, rate_limit_per_user, user_limit, voice_status, spoiler, video_quality, forum_layout, forum_sort, forum_require_tag, forum_default_reaction, news, media";

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
    let (apps,): (bool,) = sqlx::query_as("SELECT COALESCE((applications->>'enabled')::boolean, false) FROM guilds WHERE id = $1").bind(id).fetch_optional(&state.db).await?.unwrap_or((false,));
    if apps { return Err(AppError::BadRequest("This server reviews applications: apply to join instead".into())) }
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
    let blocked: Option<(bool,)> = sqlx::query_as("SELECT (g.rules_required OR COALESCE((g.applications->>'enabled')::boolean, false)) AND m.rules_accepted_at IS NULL FROM guilds g JOIN guild_members m ON m.guild_id = g.id AND m.user_id = $2 WHERE g.id = $1")
        .bind(guild_id).bind(user_id).fetch_optional(db).await?;
    if blocked.map(|b| b.0).unwrap_or(false) { Err(AppError::RulesRequired) } else { Ok(()) }
}

pub async fn fetch_member(db: &PgPool, guild_id: Uuid, user_id: Uuid) -> AppResult<Member> {
    let mut m = sqlx::query_as::<_, Member>(
        "SELECT m.guild_id, m.user_id, m.nickname, m.joined_at, u.username, u.display_name, u.avatar_url, u.status, u.custom_status, m.timeout_until, m.rules_accepted_at, m.mute, m.deaf, u.avatar_decoration, u.clan_tag, u.name_primary, u.name_accent, u.name_style, u.nameplate, m.quarantined, m.flags, m.rules_accepted_at, m.guild_avatar, m.guild_banner, m.guild_bio, m.guild_pronouns
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
    let gs = sqlx::query_as::<_, Guild>(&format!(
        "SELECT g.{} FROM guilds g
         JOIN guild_members m ON m.guild_id = g.id WHERE m.user_id = $1 ORDER BY m.joined_at",
        GUILD_COLS.replace(", ", ", g.")
    ))
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
    let payload = crate::routes::guilds::guild_payload(&guild, json!({ "channels": channels, "roles": roles }));
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
    /// Up to 300 characters.
    description: Option<String>,
    /// A text channel in this server, or null for the first one.
    #[serde(default, deserialize_with = "crate::routes::roles::deserialize_nullable_uuid")]
    system_channel_id: Option<Option<Uuid>>,
    join_notices: Option<bool>,
    join_wave: Option<bool>,
    /// 'all' | 'mentions'
    default_notifications: Option<String>,
    /// 0-3
    verification_level: Option<i16>,
    /// 0 or 1; only the owner, who needs 2FA themselves to turn it on.
    mfa_level: Option<i16>,
    invites_paused: Option<bool>,
    /// Pause DMs between members for this many hours (1-24); 0 resumes them.
    pause_dms_hours: Option<i32>,
    /// A voice channel in this server, or null for none.
    #[serde(default, deserialize_with = "crate::routes::roles::deserialize_nullable_uuid")]
    afk_channel_id: Option<Option<Uuid>>,
    /// Seconds: 60, 300, 900, 1800 or 3600.
    afk_timeout: Option<i32>,
    /// A text channel in this server, or null for none.
    #[serde(default, deserialize_with = "crate::routes::roles::deserialize_nullable_uuid")]
    rules_channel_id: Option<Option<Uuid>>,
    welcome_screen: Option<WelcomeScreen>,
    widget_enabled: Option<bool>,
    /// An invite code of this server for the widget's Join button ('' for none).
    widget_invite: Option<String>,
    /// Empty string clears.
    invite_splash_url: Option<String>,
    raid_protection: Option<bool>,
    /// Joins per minute that count as a raid (3-100).
    raid_threshold: Option<i32>,
    #[serde(default, deserialize_with = "crate::routes::roles::deserialize_nullable_uuid")]
    safety_alerts_channel_id: Option<Option<Uuid>>,
}

#[derive(Deserialize, Serialize)]
struct WelcomeChannel {
    channel_id: Uuid,
    #[serde(default)]
    description: String,
    #[serde(default)]
    emoji: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct WelcomeScreen {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    description: String,
    #[serde(default)]
    channels: Vec<WelcomeChannel>,
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
    if req.description.as_ref().map(|d| d.chars().count() > 300).unwrap_or(false) {
        return Err(AppError::BadRequest("Description must be at most 300 characters".into()));
    }
    if req.default_notifications.as_deref().map(|d| d != "all" && d != "mentions").unwrap_or(false) {
        return Err(AppError::BadRequest("default_notifications must be 'all' or 'mentions'".into()));
    }
    if req.verification_level.map(|v| !(0..=3).contains(&v)).unwrap_or(false) {
        return Err(AppError::BadRequest("verification_level must be 0 to 3".into()));
    }
    if req.pause_dms_hours.map(|h| !(0..=24).contains(&h)).unwrap_or(false) {
        return Err(AppError::BadRequest("DMs can be paused for 1 to 24 hours".into()));
    }
    if let Some(level) = req.mfa_level {
        if !(0..=1).contains(&level) { return Err(AppError::BadRequest("mfa_level must be 0 or 1".into())) }
        // Like Discord: only the owner, and only with 2FA on their own account.
        let (owner, mfa): (bool, bool) = sqlx::query_as("SELECT g.owner_id = $2, u.totp_secret IS NOT NULL FROM guilds g, users u WHERE g.id = $1 AND u.id = $2").bind(id).bind(uid).fetch_one(&state.db).await?;
        if !owner { return Err(AppError::Forbidden) }
        if level == 1 && !mfa { return Err(AppError::BadRequest("Turn on two-factor authentication for your own account first".into())) }
    }
    if let Some(Some(cid)) = req.system_channel_id {
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM channels WHERE id = $1 AND guild_id = $2 AND kind = 'text'").bind(cid).bind(id).fetch_optional(&state.db).await?;
        if ok.is_none() { return Err(AppError::BadRequest("The system channel must be a text channel in this server".into())) }
    }
    for (cid, kind, what) in [(req.afk_channel_id.flatten(), "voice", "The AFK channel must be a voice channel"), (req.rules_channel_id.flatten(), "text", "The rules channel must be a text channel")] {
        let Some(cid) = cid else { continue };
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM channels WHERE id = $1 AND guild_id = $2 AND kind = $3").bind(cid).bind(id).bind(kind).fetch_optional(&state.db).await?;
        if ok.is_none() { return Err(AppError::BadRequest(format!("{what} in this server"))) }
    }
    if req.afk_timeout.map(|t| ![60, 300, 900, 1800, 3600].contains(&t)).unwrap_or(false) {
        return Err(AppError::BadRequest("afk_timeout must be 60, 300, 900, 1800 or 3600 seconds".into()));
    }
    let welcome = match &req.welcome_screen {
        Some(w) => {
            if w.channels.len() > 5 { return Err(AppError::BadRequest("The welcome screen can suggest up to 5 channels".into())) }
            for c in &w.channels {
                let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM channels WHERE id = $1 AND guild_id = $2 AND kind <> 'category'").bind(c.channel_id).bind(id).fetch_optional(&state.db).await?;
                if ok.is_none() { return Err(AppError::BadRequest("Welcome screen channels must be in this server".into())) }
            }
            let clean = WelcomeScreen {
                enabled: w.enabled,
                description: w.description.trim().chars().take(140).collect(),
                channels: w.channels.iter().map(|c| WelcomeChannel { channel_id: c.channel_id, description: c.description.trim().chars().take(50).collect(), emoji: c.emoji.as_ref().map(|e| e.trim().chars().take(64).collect::<String>()).filter(|e| !e.is_empty()) }).collect(),
            };
            Some(json!(clean))
        }
        None => None,
    };
    if let Some(code) = req.widget_invite.as_deref().filter(|c| !c.is_empty()) {
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM invites WHERE guild_id = $1 AND code = $2").bind(id).bind(code).fetch_optional(&state.db).await?;
        if ok.is_none() { return Err(AppError::BadRequest("Pick one of this server's invites".into())) }
    }
    crate::routes::users::validate_image_max(&req.invite_splash_url, 2 * 1024 * 1024)?;
    if req.widget_enabled.is_some() || req.widget_invite.is_some() || req.invite_splash_url.is_some() {
        let old: (Option<String>,) = sqlx::query_as("SELECT invite_splash_url FROM guilds WHERE id = $1").bind(id).fetch_one(&state.db).await?;
        sqlx::query("UPDATE guilds SET widget_enabled = COALESCE($2, widget_enabled), widget_invite = COALESCE($3, widget_invite),
                       invite_splash_url = CASE WHEN $4::text IS NULL THEN invite_splash_url WHEN $4 = '' THEN NULL ELSE $4 END WHERE id = $1")
            .bind(id).bind(req.widget_enabled).bind(&req.widget_invite).bind(&req.invite_splash_url).execute(&state.db).await?;
        if req.invite_splash_url.is_some() {
            let new = req.invite_splash_url.as_deref().filter(|s| !s.is_empty());
            crate::routes::images::release_replaced(&state, old.0.as_deref(), new).await;
        }
    }
    if req.raid_threshold.map(|t| !(3..=100).contains(&t)).unwrap_or(false) { return Err(AppError::BadRequest("Raid threshold is 3 to 100 joins a minute".into())) }
    if let Some(Some(cid)) = req.safety_alerts_channel_id {
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM channels WHERE id = $1 AND guild_id = $2 AND kind = 'text'").bind(cid).bind(id).fetch_optional(&state.db).await?;
        if ok.is_none() { return Err(AppError::BadRequest("Safety alerts go to a text channel in this server".into())) }
    }
    if req.raid_protection.is_some() || req.raid_threshold.is_some() || req.safety_alerts_channel_id.is_some() {
        sqlx::query("UPDATE guilds SET raid_protection = COALESCE($2, raid_protection), raid_threshold = COALESCE($3, raid_threshold), safety_alerts_channel_id = CASE WHEN $4 THEN $5 ELSE safety_alerts_channel_id END WHERE id = $1")
            .bind(id).bind(req.raid_protection).bind(req.raid_threshold).bind(req.safety_alerts_channel_id.is_some()).bind(req.safety_alerts_channel_id.flatten()).execute(&state.db).await?;
    }
    if req.afk_channel_id.is_some() || req.afk_timeout.is_some() || req.rules_channel_id.is_some() || welcome.is_some() {
        sqlx::query(
            "UPDATE guilds SET afk_channel_id = CASE WHEN $2 THEN $3 ELSE afk_channel_id END, afk_timeout = COALESCE($4, afk_timeout),
               rules_channel_id = CASE WHEN $5 THEN $6 ELSE rules_channel_id END, welcome_screen = COALESCE($7, welcome_screen) WHERE id = $1")
            .bind(id).bind(req.afk_channel_id.is_some()).bind(req.afk_channel_id.flatten()).bind(req.afk_timeout)
            .bind(req.rules_channel_id.is_some()).bind(req.rules_channel_id.flatten()).bind(&welcome)
            .execute(&state.db).await?;
    }
    let (before_name, before): (String, (Option<String>, Option<String>)) = sqlx::query_as::<_, (String, Option<String>, Option<String>)>("SELECT name, icon_url, banner_url FROM guilds WHERE id = $1").bind(id).fetch_one(&state.db).await.map(|r| (r.0, (r.1, r.2)))?;
    let rules = req.rules.map(|r| r.trim_end().chars().take(4000).collect::<String>());
    let g = sqlx::query_as::<_, Guild>(&format!(
        "UPDATE guilds SET name = COALESCE($2, name),
           icon_url = CASE WHEN $3::text IS NULL THEN icon_url WHEN $3 = '' THEN NULL ELSE $3 END,
           banner_url = CASE WHEN $4::text IS NULL THEN banner_url WHEN $4 = '' THEN NULL ELSE $4 END,
           rules = COALESCE($5, rules), rules_required = COALESCE($6, rules_required),
           description = COALESCE($7, description),
           system_channel_id = CASE WHEN $8 THEN $9 ELSE system_channel_id END,
           join_notices = COALESCE($10, join_notices), join_wave = COALESCE($11, join_wave),
           default_notifications = COALESCE($12, default_notifications), verification_level = COALESCE($13, verification_level),
           mfa_level = COALESCE($14, mfa_level), invites_paused = COALESCE($15, invites_paused),
           dms_paused_until = CASE WHEN $16::int IS NULL THEN dms_paused_until WHEN $16 = 0 THEN NULL ELSE now() + make_interval(hours => $16) END
         WHERE id = $1 RETURNING {GUILD_COLS}"
    ))
    .bind(id)
    .bind(req.name.map(|n| n.trim().to_string()))
    .bind(req.icon_url)
    .bind(req.banner_url)
    .bind(&rules)
    .bind(req.rules_required)
    .bind(req.description.as_ref().map(|d| d.trim().to_string()))
    .bind(req.system_channel_id.is_some())
    .bind(req.system_channel_id.flatten())
    .bind(req.join_notices)
    .bind(req.join_wave)
    .bind(&req.default_notifications)
    .bind(req.verification_level)
    .bind(req.mfa_level)
    .bind(req.invites_paused)
    .bind(req.pause_dms_hours)
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
    if req.description.is_some() { changed.insert("description".into(), json!(g.description)); }
    if req.system_channel_id.is_some() { changed.insert("system_channel".into(), json!(g.system_channel_id)); }
    if let Some(v) = req.join_notices { changed.insert("join_notices".into(), json!(v)); }
    if let Some(v) = req.join_wave { changed.insert("join_wave".into(), json!(v)); }
    if let Some(v) = &req.default_notifications { changed.insert("default_notifications".into(), json!(v)); }
    if let Some(v) = req.verification_level { changed.insert("verification_level".into(), json!(v)); }
    if req.afk_channel_id.is_some() { changed.insert("afk_channel".into(), json!(g.afk_channel_id)); }
    if let Some(v) = req.afk_timeout { changed.insert("afk_timeout".into(), json!(v)); }
    if req.rules_channel_id.is_some() { changed.insert("rules_channel".into(), json!(g.rules_channel_id)); }
    if welcome.is_some() { changed.insert("welcome_screen".into(), json!(true)); }
    if let Some(v) = req.widget_enabled { changed.insert("widget".into(), json!(v)); }
    if req.invite_splash_url.is_some() { changed.insert("invite_splash".into(), json!(g.invite_splash_url.is_some())); }
    if let Some(v) = req.mfa_level { changed.insert("mfa_required".into(), json!(v == 1)); }
    if let Some(v) = req.invites_paused { changed.insert("invites_paused".into(), json!(v)); }
    if let Some(h) = req.pause_dms_hours { changed.insert("dms_paused_hours".into(), json!(h)); }
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
    // Announcement and media channels are text channels and forums with a flag.
    let (kind, news, media) = match kind.as_str() { "announcement" => ("text".to_string(), true, false), "media" => ("forum".to_string(), false, true), _ => (kind, false, false) };
    if !["text", "voice", "stage", "studio", "category", "forum", "directory"].contains(&kind.as_str()) {
        return Err(AppError::BadRequest("kind must be text, announcement, voice, stage, studio, forum, media, directory or category".into()));
    }
    let name = normalize_channel_name(&req.name, &kind)?;
    let parent = check_parent(&state.db, id, &kind, req.parent_id).await?;
    let (pos,): (i32,) = sqlx::query_as("SELECT COALESCE(MAX(position), -1) + 1 FROM channels WHERE guild_id = $1")
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    let mut c = sqlx::query_as::<_, Channel>(&format!(
        "INSERT INTO channels (id, guild_id, name, kind, topic, position, parent_id, audio_mode, audio_low_latency, news, media)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $4 = 'studio' THEN 'music' ELSE 'voice' END, $4 = 'studio', $8, $9) RETURNING {CHANNEL_COLS}"
    ))
    .bind(Uuid::now_v7())
    .bind(id)
    .bind(&name)
    .bind(&kind)
    .bind(req.topic.unwrap_or_default().chars().take(1024).collect::<String>())
    .bind(pos)
    .bind(parent)
    .bind(news)
    .bind(media)
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
    } else if kind == "text" || kind == "forum" || kind == "directory" {
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
        "SELECT m.guild_id, m.user_id, m.nickname, m.joined_at, u.username, u.display_name, u.avatar_url, u.status, u.custom_status, m.timeout_until, m.rules_accepted_at, m.mute, m.deaf, u.avatar_decoration, u.clan_tag, u.name_primary, u.name_accent, u.name_style, u.nameplate, m.quarantined, m.flags, m.guild_avatar, m.guild_banner, m.guild_bio, m.guild_pronouns
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

#[derive(Deserialize, Default)]
struct KickReq {
    reason: Option<String>,
}

async fn kick_member(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
    body: Option<Json<KickReq>>,
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
    let reason: String = body.and_then(|Json(b)| b.reason).unwrap_or_default().trim().chars().take(512).collect();
    remove_member(&state, id, target).await?;
    crate::audit::guild(&state, id, uid, "member.kick", "user", Some(target), &name, json!({ "reason": reason })).await;
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

/// Temporary membership: someone who joined with a temporary invite and still has no role is removed once they
/// are offline everywhere (Discord's behaviour).
pub async fn drop_temporary(state: &AppState, user_id: Uuid) {
    let gids: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT m.guild_id FROM guild_members m WHERE m.user_id = $1 AND m.temporary
           AND NOT EXISTS (SELECT 1 FROM member_roles r WHERE r.guild_id = m.guild_id AND r.user_id = m.user_id)")
        .bind(user_id).fetch_all(&state.db).await.unwrap_or_default();
    for (gid,) in gids {
        if let Err(e) = remove_member(state, gid, user_id).await { tracing::warn!(error = ?e, "temporary member removal failed"); }
    }
}

/// How each member joined, for moderators (Manage Server): the invite code or 'discover', who invited them, and
/// whether the membership is temporary.
async fn member_joins(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<serde_json::Value>>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    if !(perms::has(p, perms::MANAGE_GUILD) || perms::has(p, perms::KICK_MEMBERS) || perms::has(p, perms::BAN_MEMBERS) || perms::has(p, perms::MODERATE_MEMBERS)) { return Err(AppError::Forbidden) }
    let rows: Vec<(Uuid, Option<String>, Option<Uuid>, Option<String>, bool, chrono::DateTime<chrono::Utc>, i64)> = sqlx::query_as(
        "SELECT m.user_id, m.joined_via, m.inviter_id, u.display_name, m.temporary, me.created_at,
                (SELECT count(*) FROM member_warnings w WHERE w.guild_id = m.guild_id AND w.user_id = m.user_id)
         FROM guild_members m JOIN users me ON me.id = m.user_id LEFT JOIN users u ON u.id = m.inviter_id WHERE m.guild_id = $1")
        .bind(id).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(user, via, inviter, inviter_name, temporary, created, warns)| json!({ "user_id": user, "joined_via": via, "inviter_id": inviter, "inviter_name": inviter_name, "temporary": temporary, "account_created_at": created, "warnings": warns })).collect()))
}

pub async fn remove_member(state: &AppState, guild_id: Uuid, user_id: Uuid) -> AppResult<()> {
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
    // Leaving a server takes off its tag.
    let untagged = sqlx::query("UPDATE users SET clan_tag = '', clan_tag_guild = NULL WHERE id = $1 AND clan_tag_guild = $2").bind(user_id).bind(guild_id).execute(&state.db).await?;
    if untagged.rows_affected() > 0 { crate::routes::server_tags::announce(state, &[user_id]).await; }
    // A bot leaving takes its own role with it.
    let gone = sqlx::query("DELETE FROM roles WHERE guild_id = $1 AND managed_app_id IN (SELECT id FROM applications WHERE bot_user_id = $2)").bind(guild_id).bind(user_id).execute(&state.db).await?;
    if gone.rows_affected() > 0 { let _ = crate::routes::roles::emit_roles(state, guild_id).await; }
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
    /// Also delete what they posted in this server in the last N seconds (0 to 7 days).
    #[serde(default)]
    delete_message_seconds: i64,
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
    let req = body.map(|Json(b)| b).unwrap_or_default();
    let ban = ban_one(&state, uid, id, target, req.reason, req.delete_message_seconds).await?;
    Ok((StatusCode::CREATED, Json(ban)))
}

/// One ban, with every check (used by the single and bulk endpoints).
pub async fn ban_one(state: &AppState, uid: Uuid, id: Uuid, target: Uuid, reason: Option<String>, delete_message_seconds: i64) -> AppResult<Ban> {
    let req = BanReq { reason, delete_message_seconds };
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
    if !(0..=7 * 86400).contains(&req.delete_message_seconds) {
        return Err(AppError::BadRequest("delete_message_seconds must be 0 to 604800 (7 days)".into()));
    }
    let reason: String = req.reason.unwrap_or_default().trim().chars().take(512).collect();
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
    try_remove_member(state, id, target).await?;
    let ban = fetch_ban(&state.db, id, target).await?;
    state.hub.emit_guild(id, "GUILD_BAN_ADD", json!(ban));
    let mut deleted = 0;
    if req.delete_message_seconds > 0 {
        let ids: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT m.id FROM messages m JOIN channels c ON c.id = m.channel_id
             WHERE c.guild_id = $1 AND m.author_id = $2 AND m.created_at > now() - make_interval(secs => $3)")
            .bind(id).bind(target).bind(req.delete_message_seconds as f64).fetch_all(&state.db).await?;
        deleted = crate::routes::channels::delete_many(state, &ids.into_iter().map(|r| r.0).collect::<Vec<_>>()).await?;
    }
    crate::audit::guild(state, id, uid, "member.ban", "user", Some(target), &ban.username, json!({ "reason": reason, "messages_deleted": deleted })).await;
    Ok(ban)
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

/// Invite lifetimes people can pick, in seconds (30 minutes to 30 days); leaving it out (or 0) never expires.
pub const INVITE_MAX_AGES: [i64; 7] = [1800, 3600, 6 * 3600, 12 * 3600, 86400, 7 * 86400, 30 * 86400];
/// Use limits people can pick; leaving it out (or 0) allows any number.
pub const INVITE_MAX_USES: [i32; 6] = [1, 5, 10, 25, 50, 100];
/// Servers approved for Discovery may claim this many vanity links.
pub const MAX_VANITY: i64 = 3;
pub const INVITE_COLS: &str = "code, guild_id, creator_id, uses, max_uses, created_at, expires_at, vanity, temporary";

#[derive(Deserialize)]
struct CreateInvite {
    max_uses: Option<i32>,
    /// Seconds until the invite expires: one of INVITE_MAX_AGES, or 0/absent for never.
    max_age: Option<i64>,
    /// A custom code (vanity link) instead of a random one; needs Manage Server and an approved Discovery listing.
    vanity: Option<String>,
    /// Grant temporary membership: they are removed when they go offline unless given a role.
    #[serde(default)]
    temporary: bool,
}

/// A vanity code: 3–32 lowercase letters, digits and hyphens, not starting or ending with a hyphen.
fn vanity_code(raw: &str) -> AppResult<String> {
    let code = raw.trim().to_lowercase();
    let ok = (3..=32).contains(&code.len())
        && code.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !code.starts_with('-')
        && !code.ends_with('-');
    if ok { Ok(code) } else { Err(AppError::BadRequest("Vanity links are 3 to 32 letters, numbers or hyphens, and can't start or end with a hyphen".into())) }
}

async fn create_invite(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateInvite>,
) -> AppResult<(StatusCode, Json<Invite>)> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::CREATE_INVITE)?;
    if let Some(raw) = req.vanity.as_deref() {
        perms::check(p, perms::MANAGE_GUILD)?;
        let code = vanity_code(raw)?;
        let approved: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_discovery WHERE guild_id = $1 AND status = 'approved'").bind(id).fetch_optional(&state.db).await?;
        if approved.is_none() {
            return Err(AppError::Forbidden);
        }
        let mut tx = state.db.begin().await?;
        // Serialise vanity claims per server so two at once can't both slip under the limit.
        sqlx::query("SELECT id FROM guilds WHERE id = $1 FOR UPDATE").bind(id).execute(&mut *tx).await?;
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM invites WHERE guild_id = $1 AND vanity").bind(id).fetch_one(&mut *tx).await?;
        if count >= MAX_VANITY {
            return Err(AppError::BadRequest(format!("A server can have up to {MAX_VANITY} vanity links")));
        }
        let taken: Option<(bool,)> = sqlx::query_as("SELECT true FROM invites WHERE lower(code) = $1").bind(&code).fetch_optional(&mut *tx).await?;
        if taken.is_some() {
            return Err(AppError::Conflict("That link is already taken".into()));
        }
        let inv = sqlx::query_as::<_, Invite>(&format!("INSERT INTO invites (code, guild_id, creator_id, vanity) VALUES ($1, $2, $3, true) RETURNING {INVITE_COLS}"))
            .bind(&code)
            .bind(id)
            .bind(uid)
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        crate::audit::guild(&state, id, uid, "invite.vanity_create", "invite", None, &code, json!({})).await;
        return Ok((StatusCode::CREATED, Json(inv)));
    }
    let max_uses = req.max_uses.filter(|n| *n > 0);
    if max_uses.is_some_and(|n| !INVITE_MAX_USES.contains(&n)) {
        return Err(AppError::BadRequest("Max uses must be 1, 5, 10, 25, 50 or 100".into()));
    }
    let max_age = req.max_age.filter(|n| *n > 0);
    if max_age.is_some_and(|n| !INVITE_MAX_AGES.contains(&n)) {
        return Err(AppError::BadRequest("Invites expire after 30 minutes, 1, 6 or 12 hours, 1, 7 or 30 days, or never".into()));
    }
    let code: String = rand::thread_rng().sample_iter(&Alphanumeric).take(8).map(char::from).collect();
    let inv = sqlx::query_as::<_, Invite>(&format!(
        "INSERT INTO invites (code, guild_id, creator_id, max_uses, expires_at, temporary) VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5), $6)
         RETURNING {INVITE_COLS}"
    ))
    .bind(&code)
    .bind(id)
    .bind(uid)
    .bind(max_uses)
    .bind(max_age.map(|n| n as f64))
    .bind(req.temporary)
    .fetch_one(&state.db)
    .await?;
    Ok((StatusCode::CREATED, Json(inv)))
}

/// Every live invite to the server, newest first (Manage Server). Expired and used-up invites are cleared out first.
async fn list_invites(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<InviteListing>>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    sqlx::query("DELETE FROM invites WHERE guild_id = $1 AND NOT vanity AND (expires_at <= now() OR uses >= max_uses)").bind(id).execute(&state.db).await?;
    let invs = sqlx::query_as::<_, InviteListing>(
        "SELECT i.code, i.guild_id, i.creator_id, i.uses, i.max_uses, i.created_at, i.expires_at, i.vanity, i.temporary,
                u.username AS creator_username, u.display_name AS creator_display_name, u.avatar_url AS creator_avatar_url
         FROM invites i JOIN users u ON u.id = i.creator_id WHERE i.guild_id = $1 ORDER BY i.vanity DESC, i.created_at DESC",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(invs))
}

/// Revoke an invite: anyone with Manage Server, or the person who made a regular invite.
async fn delete_invite(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, code)): Path<(Uuid, String)>,
) -> AppResult<StatusCode> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    let row: Option<(Uuid, bool)> = sqlx::query_as("SELECT creator_id, vanity FROM invites WHERE guild_id = $1 AND code = $2").bind(id).bind(&code).fetch_optional(&state.db).await?;
    let (creator, vanity) = row.ok_or_else(|| AppError::NotFound("Invite not found".into()))?;
    if !(perms::has(p, perms::MANAGE_GUILD) || (creator == uid && !vanity)) {
        return Err(AppError::Forbidden);
    }
    sqlx::query("DELETE FROM invites WHERE guild_id = $1 AND code = $2").bind(id).bind(&code).execute(&state.db).await?;
    crate::audit::guild(&state, id, uid, if vanity { "invite.vanity_delete" } else { "invite.delete" }, "invite", None, &code, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
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
    /// Only this person's actions.
    actor: Option<Uuid>,
    /// Only this action ("member.ban") or family ("member.").
    action: Option<String>,
}

/// Server audit log, newest first, 100 per page; needs Manage Server.
async fn list_audit(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    axum::extract::Query(q): axum::extract::Query<AuditQuery>,
) -> AppResult<Json<Vec<GuildAuditRow>>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check_any(p, perms::MANAGE_GUILD | perms::VIEW_AUDIT_LOG)?;
    let t = q.q.trim().replace('%', "\\%").replace('_', "\\_");
    let pat = if t.is_empty() { None } else { Some(format!("%{t}%")) };
    let rows = sqlx::query_as::<_, GuildAuditRow>(
        "SELECT id, actor_id, actor_name, action, target_kind, target_id, target_name, details, created_at FROM guild_audit
         WHERE guild_id = $1 AND ($2::uuid IS NULL OR id < $2) AND ($3::text IS NULL OR actor_name ILIKE $3 OR action ILIKE $3 OR target_name ILIKE $3)
           AND ($4::uuid IS NULL OR actor_id = $4) AND ($5::text IS NULL OR action = $5 OR (right($5, 1) = '.' AND starts_with(action, $5)))
         ORDER BY id DESC LIMIT 100",
    )
    .bind(id)
    .bind(q.before)
    .bind(pat)
    .bind(q.actor)
    .bind(q.action.filter(|a| !a.is_empty()))
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
