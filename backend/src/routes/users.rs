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
    routing::{delete, get, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

pub const MAX_IMAGE_DATA_URL: usize = 512 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me", get(me).patch(update_me).delete(delete_me))
        .route("/users/search", get(search))
        .route("/users/:id", get(get_user))
        .route("/users/:id/reviews", get(list_reviews).put(put_review))
        .route("/users/:id/reviews/:rid", delete(delete_review))
        .route("/users/@me/guild-layout", get(get_layout).put(put_layout))
        .route("/users/@me/push-tokens", put(put_push_token).delete(delete_push_token))
        .route("/users/@me/notes", get(list_notes))
        .route("/users/@me/notes/:id", put(put_note))
        .route("/users/@me/notification-settings", get(list_notif))
        .route("/users/@me/notification-settings/:target", put(put_notif).delete(delete_notif))
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct NotifSetting {
    pub target_id: Uuid,
    pub level: String,
    pub muted_until: Option<chrono::DateTime<chrono::Utc>>,
    pub suppress_everyone: bool,
    #[sqlx(default)]
    #[serde(default)]
    pub suppress_roles: bool,
}

/// On joining a server, seed its notification setting from the user's defaults (suppress @everyone / role mentions).
pub async fn apply_join_defaults(db: &sqlx::PgPool, uid: Uuid, guild_id: Uuid) {
    let _ = sqlx::query(
        "INSERT INTO notification_settings (user_id, target_id, suppress_everyone, suppress_roles)
         SELECT id, $2, COALESCE((notif_prefs->>'default_suppress_everyone')::bool, false), COALESCE((notif_prefs->>'default_suppress_roles')::bool, false)
         FROM users WHERE id = $1 AND (COALESCE((notif_prefs->>'default_suppress_everyone')::bool, false) OR COALESCE((notif_prefs->>'default_suppress_roles')::bool, false))
         ON CONFLICT (user_id, target_id) DO NOTHING",
    ).bind(uid).bind(guild_id).execute(db).await;
}

pub async fn notif_settings_for(db: &sqlx::PgPool, uid: Uuid) -> AppResult<Vec<NotifSetting>> {
    Ok(sqlx::query_as::<_, NotifSetting>("SELECT target_id, level, muted_until, suppress_everyone, suppress_roles FROM notification_settings WHERE user_id = $1").bind(uid).fetch_all(db).await?)
}

async fn list_notif(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<NotifSetting>>> {
    Ok(Json(notif_settings_for(&state.db, uid).await?))
}

#[derive(Deserialize)]
struct PutNotif {
    level: Option<String>,
    /// Minutes to mute for; 0 = forever; null/absent = leave as is. Use `unmute: true` to clear.
    mute_minutes: Option<i64>,
    #[serde(default)]
    unmute: bool,
    suppress_everyone: Option<bool>,
    suppress_roles: Option<bool>,
}

/// Upsert the setting for a server or channel the user can see.
async fn put_notif(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(target): Path<Uuid>, Json(req): Json<PutNotif>) -> AppResult<Json<NotifSetting>> {
    // The target must be one of my servers, one of its channels, or one of my DM channels.
    let ok: Option<(bool,)> = sqlx::query_as(
        "SELECT true WHERE EXISTS (SELECT 1 FROM guild_members WHERE guild_id = $1 AND user_id = $2)
            OR EXISTS (SELECT 1 FROM channels c JOIN guild_members m ON m.guild_id = c.guild_id AND m.user_id = $2 WHERE c.id = $1)
            OR EXISTS (SELECT 1 FROM channel_members WHERE channel_id = $1 AND user_id = $2)",
    )
    .bind(target)
    .bind(uid)
    .fetch_optional(&state.db)
    .await?;
    if ok.is_none() {
        return Err(AppError::NotFound("Unknown server or channel".into()));
    }
    if let Some(l) = &req.level {
        if !["default", "all", "mentions", "nothing"].contains(&l.as_str()) {
            return Err(AppError::BadRequest("level must be default, all, mentions or nothing".into()));
        }
    }
    let muted_until: Option<Option<chrono::DateTime<chrono::Utc>>> = if req.unmute {
        Some(None)
    } else {
        req.mute_minutes.map(|m| Some(if m <= 0 { chrono::Utc::now() + chrono::Duration::days(365 * 100) } else { chrono::Utc::now() + chrono::Duration::minutes(m.min(60 * 24 * 365)) }))
    };
    sqlx::query(
        "INSERT INTO notification_settings (user_id, target_id, level, muted_until, suppress_everyone, suppress_roles)
         VALUES ($1, $2, COALESCE($3, 'default'), $4, COALESCE($5, false), COALESCE($7, false))
         ON CONFLICT (user_id, target_id) DO UPDATE SET
           level = COALESCE($3, notification_settings.level),
           muted_until = CASE WHEN $6 THEN $4 ELSE notification_settings.muted_until END,
           suppress_everyone = COALESCE($5, notification_settings.suppress_everyone),
           suppress_roles = COALESCE($7, notification_settings.suppress_roles),
           updated_at = now()",
    )
    .bind(uid)
    .bind(target)
    .bind(req.level.as_deref())
    .bind(muted_until.clone().flatten())
    .bind(req.suppress_everyone)
    .bind(muted_until.is_some())
    .bind(req.suppress_roles)
    .execute(&state.db)
    .await?;
    let row = sqlx::query_as::<_, NotifSetting>("SELECT target_id, level, muted_until, suppress_everyone FROM notification_settings WHERE user_id = $1 AND target_id = $2").bind(uid).bind(target).fetch_one(&state.db).await?;
    state.hub.emit_users(vec![uid], "NOTIFICATION_SETTINGS_UPDATE", json!(row));
    Ok(Json(row))
}

async fn delete_notif(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(target): Path<Uuid>) -> AppResult<StatusCode> {
    sqlx::query("DELETE FROM notification_settings WHERE user_id = $1 AND target_id = $2").bind(uid).bind(target).execute(&state.db).await?;
    state.hub.emit_users(vec![uid], "NOTIFICATION_SETTINGS_UPDATE", json!({ "target_id": target, "level": "default", "muted_until": null, "suppress_everyone": false, "deleted": true }));
    Ok(StatusCode::NO_CONTENT)
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

pub const USER_COLS: &str = "id, username, display_name, avatar_url, bio, status, created_at, banner_url, theme_primary, theme_accent, pronouns, name_primary, name_accent, custom_status, avatar_decoration, clan_tag, panels";
pub const PRIVATE_USER_COLS: &str = "id, username, display_name, email, avatar_url, bio, status, created_at, banner_url, theme_primary, theme_accent, pronouns, name_primary, name_accent, custom_status, dm_privacy, message_requests, friend_request_from, group_dm_privacy, notif_prefs, avatar_decoration, clan_tag, panels, is_admin, email_verified_at, (totp_secret IS NOT NULL) AS mfa_enabled";

/// Refuse (403, `email_unverified`) when the instance requires verified emails and this user's isn't.
pub async fn require_verified(state: &AppState, uid: Uuid) -> AppResult<()> {
    if !crate::routes::admin::load_settings(&state.db).await?.require_email_verification {
        return Ok(());
    }
    let row: Option<(bool,)> = sqlx::query_as("SELECT true FROM users WHERE id = $1 AND email_verified_at IS NOT NULL").bind(uid).fetch_optional(&state.db).await?;
    if row.is_some() { Ok(()) } else { Err(AppError::BadRequest("Verify your email address to do that. Check your inbox or resend the link from Account settings.".into())) }
}

/// Is this user a Parley admin? The `is_admin` flag, or an email listed in `ADMIN_EMAILS` (persisted as the flag,
/// marked `admin_via_env`). Removing an email from the list demotes an env-granted admin the next time they are
/// checked, unless they are the last admin; admins promoted from the console are never demoted this way.
pub async fn ensure_admin(state: &AppState, uid: Uuid) -> AppResult<bool> {
    let row: Option<(bool, String, bool)> = sqlx::query_as("SELECT is_admin, email, admin_via_env FROM users WHERE id = $1").bind(uid).fetch_optional(&state.db).await?;
    let Some((flag, email, via_env)) = row else { return Ok(false) };
    let listed = state.config.admin_emails.iter().any(|e| e.eq_ignore_ascii_case(&email));
    if listed {
        if !flag || !via_env {
            sqlx::query("UPDATE users SET is_admin = true, admin_via_env = true WHERE id = $1").bind(uid).execute(&state.db).await?;
        }
        return Ok(true);
    }
    if flag && via_env {
        let (others,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE is_admin AND id <> $1").bind(uid).fetch_one(&state.db).await?;
        if others == 0 {
            tracing::warn!(user = %uid, "ADMIN_EMAILS no longer lists the only admin; keeping their rights");
            return Ok(true);
        }
        sqlx::query("UPDATE users SET is_admin = false, admin_via_env = false WHERE id = $1").bind(uid).execute(&state.db).await?;
        crate::audit::record(state, uid, "user.demote", "user", Some(uid), &crate::audit::username(state, uid).await, serde_json::json!({ "reason": "removed from ADMIN_EMAILS" })).await;
        return Ok(false);
    }
    Ok(flag)
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
    /// Flair: one of DECORATIONS ('' clears), a 2–4 character tag ('' clears), panels {wishlist, games} of {title, url?}.
    avatar_decoration: Option<String>,
    clan_tag: Option<String>,
    panels: Option<serde_json::Value>,
}

pub const DECORATIONS: [&str; 7] = ["", "gold", "rainbow", "glow", "ice", "dashed", "ember"];

/// Validate and normalise the optional profile panels: up to 25 items each, titles ≤ 60 chars, http(s) urls ≤ 200.
fn clean_panels(v: &serde_json::Value) -> Result<serde_json::Value, AppError> {
    let mut out = serde_json::Map::new();
    for key in ["wishlist", "games"] {
        let Some(items) = v.get(key).and_then(|x| x.as_array()) else { continue };
        if items.len() > 25 {
            return Err(AppError::BadRequest(format!("At most 25 items in {key}")));
        }
        let mut list = Vec::new();
        for it in items {
            let title: String = it.get("title").and_then(|t| t.as_str()).unwrap_or("").trim().chars().take(60).collect();
            if title.is_empty() { continue; }
            let url = it.get("url").and_then(|u| u.as_str()).map(str::trim).filter(|u| !u.is_empty());
            if let Some(u) = url {
                if u.len() > 200 || !(u.starts_with("https://") || u.starts_with("http://")) {
                    return Err(AppError::BadRequest("Panel links must be http(s) URLs".into()));
                }
            }
            let mut o = serde_json::Map::new();
            o.insert("title".into(), serde_json::Value::String(title));
            if let Some(u) = url { o.insert("url".into(), serde_json::Value::String(u.to_string())); }
            list.push(serde_json::Value::Object(o));
        }
        if !list.is_empty() { out.insert(key.into(), serde_json::Value::Array(list)); }
    }
    Ok(serde_json::Value::Object(out))
}

pub fn validate_image(url: &Option<String>) -> AppResult<()> {
    validate_image_max(url, MAX_IMAGE_DATA_URL)
}

pub fn validate_image_max(url: &Option<String>, max: usize) -> AppResult<()> {
    if let Some(u) = url {
        if u.len() > max {
            return Err(AppError::BadRequest(format!("Image too large (max {}KB)", max / 1024)));
        }
        if !u.is_empty() && !(u.starts_with("https://") || u.starts_with("http://") || crate::routes::images::image_id(u).is_some()) {
            return Err(AppError::BadRequest("Image must be an uploaded image (POST /images) or an http(s) URL".into()));
        }
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct DeleteMeReq {
    password: String,
    #[serde(default)]
    code: Option<String>,
}

/// Self-service account deletion: password (and 2FA code) required; the last admin cannot leave the instance adminless.
async fn delete_me(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<DeleteMeReq>) -> AppResult<StatusCode> {
    crate::routes::mfa::check_password_and_factor(&state, uid, &req.password, req.code.as_deref()).await?;
    let (is_admin,): (bool,) = sqlx::query_as("SELECT is_admin FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if is_admin {
        let (others,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE is_admin AND id <> $1").bind(uid).fetch_one(&state.db).await?;
        if others == 0 {
            return Err(AppError::BadRequest("You are the only admin. Make someone else an admin before deleting your account.".into()));
        }
    }
    crate::routes::admin::delete_account(&state, uid).await?;
    Ok(StatusCode::NO_CONTENT)
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
    if let Some(d) = &req.avatar_decoration {
        if !DECORATIONS.contains(&d.as_str()) {
            return Err(AppError::BadRequest("Unknown avatar decoration".into()));
        }
    }
    let clan_tag = req.clan_tag.as_ref().map(|t| t.trim().to_uppercase());
    if let Some(t) = &clan_tag {
        if !t.is_empty() && (t.chars().count() < 2 || t.chars().count() > 4 || !t.chars().all(|c| c.is_ascii_alphanumeric())) {
            return Err(AppError::BadRequest("Tag must be 2-4 letters or digits".into()));
        }
    }
    let panels = match &req.panels { Some(v) => Some(clean_panels(v)?), None => None };
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
            name_accent = CASE WHEN $11::text IS NULL THEN name_accent WHEN $11 = '' THEN NULL ELSE $11 END,
            avatar_decoration = COALESCE($13, avatar_decoration),
            clan_tag = COALESCE($14, clan_tag),
            panels = COALESCE($15, panels)
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
    .bind(req.avatar_decoration)
    .bind(clan_tag)
    .bind(panels)
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
        avatar_decoration: u.avatar_decoration.clone(),
        clan_tag: u.clan_tag.clone(),
        panels: u.panels.clone(),
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
    let badges = badges_for(&state.db, id).await?;
    let mut v = json!(u);
    v["badges"] = json!(badges);
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

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct UserNote {
    #[serde(rename = "user_id")]
    pub target_id: Uuid,
    pub nickname: String,
    pub note: String,
}

/// Everything you have written about other users (nicknames and notes); loaded once on connect.
async fn list_notes(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<UserNote>>> {
    Ok(Json(sqlx::query_as::<_, UserNote>("SELECT target_id, nickname, note FROM user_notes WHERE user_id = $1").bind(uid).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
struct PutNote {
    nickname: Option<String>,
    note: Option<String>,
}

/// Set a friend nickname (friends only, up to 32 chars) and/or a private note (anyone, up to 256 chars).
/// Clearing both removes the row. Only you ever see either.
async fn put_note(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<PutNote>) -> AppResult<Json<UserNote>> {
    if id == uid {
        return Err(AppError::BadRequest("You cannot write a note about yourself".into()));
    }
    let exists: Option<(bool,)> = sqlx::query_as("SELECT true FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    if exists.is_none() {
        return Err(AppError::NotFound("User not found".into()));
    }
    let nickname = req.nickname.map(|n| n.trim().chars().take(32).collect::<String>());
    let note = req.note.map(|n| n.trim_end().chars().take(256).collect::<String>());
    if nickname.as_ref().map(|n| !n.is_empty()).unwrap_or(false) && !crate::routes::dms::are_friends(&state.db, uid, id).await? {
        return Err(AppError::BadRequest("You can only set a nickname for a friend".into()));
    }
    let row = sqlx::query_as::<_, UserNote>(
        "INSERT INTO user_notes (user_id, target_id, nickname, note) VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, ''))
         ON CONFLICT (user_id, target_id) DO UPDATE SET nickname = COALESCE($3, user_notes.nickname), note = COALESCE($4, user_notes.note), updated_at = now()
         RETURNING target_id, nickname, note",
    )
    .bind(uid).bind(id).bind(&nickname).bind(&note)
    .fetch_one(&state.db)
    .await?;
    if row.nickname.is_empty() && row.note.is_empty() {
        sqlx::query("DELETE FROM user_notes WHERE user_id = $1 AND target_id = $2").bind(uid).bind(id).execute(&state.db).await?;
    }
    Ok(Json(row))
}

/// Profile badges, computed: admin (instance admin), founder (one of the first ten accounts), veteran (over a year),
/// host (owns a server), verified (email confirmed), secure (2FA on).
pub async fn badges_for(db: &sqlx::PgPool, id: Uuid) -> AppResult<Vec<&'static str>> {
    let row: Option<(bool, bool, bool, bool, bool, bool)> = sqlx::query_as(
        "SELECT u.is_admin,
                (SELECT COUNT(*) FROM users o WHERE o.created_at < u.created_at) < 10,
                u.created_at < now() - interval '1 year',
                EXISTS (SELECT 1 FROM guilds g WHERE g.owner_id = u.id),
                u.email_verified_at IS NOT NULL,
                u.totp_secret IS NOT NULL
         FROM users u WHERE u.id = $1",
    )
    .bind(id)
    .fetch_optional(db)
    .await?;
    let Some((admin, founder, veteran, host, verified, secure)) = row else { return Ok(vec![]) };
    let mut out = Vec::new();
    if admin { out.push("admin"); }
    if founder { out.push("founder"); }
    if veteran { out.push("veteran"); }
    if host { out.push("host"); }
    if verified { out.push("verified"); }
    if secure { out.push("secure"); }
    Ok(out)
}

#[derive(Deserialize)]
struct PushTokenReq { platform: String, token: String }

/// The native app registers its device token after login (and again on every launch, which refreshes `seen_at`).
async fn put_push_token(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<PushTokenReq>) -> AppResult<Json<serde_json::Value>> {
    if !["android", "ios", "web"].contains(&req.platform.as_str()) { return Err(AppError::BadRequest("platform must be android, ios or web".into())); }
    let token = req.token.trim().to_string();
    if token.len() < 16 || token.len() > 4096 { return Err(AppError::BadRequest("Invalid token".into())); }
    sqlx::query("INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, $3) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, seen_at = now()")
        .bind(&token).bind(uid).bind(&req.platform).execute(&state.db).await?;
    Ok(Json(serde_json::json!({ "ok": true, "push_enabled": crate::push::enabled(&state).await })))
}

#[derive(Deserialize)]
struct DeletePushToken { token: String }
async fn delete_push_token(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<DeletePushToken>) -> AppResult<StatusCode> {
    sqlx::query("DELETE FROM push_tokens WHERE token = $1 AND user_id = $2").bind(req.token.trim()).bind(uid).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
