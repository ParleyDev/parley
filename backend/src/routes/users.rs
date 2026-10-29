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
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

pub const MAX_IMAGE_DATA_URL: usize = 512 * 1024;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/client-settings", axum::routing::put(put_client_settings))
        .route("/users/@me", get(me).patch(update_me).delete(delete_me))
        .route("/users/search", get(search))
        .route("/users/:id", get(get_user))
        .route("/users/:id/reviews", get(list_reviews).put(put_review))
        .route("/users/:id/reviews/:rid", delete(delete_review))
        .route("/users/@me/guild-layout", get(get_layout).put(put_layout))
        .route("/users/@me/push-tokens", put(put_push_token).delete(delete_push_token))
        .route("/users/@me/push-tokens/test", post(test_push))
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
    #[sqlx(default)]
    #[serde(default)]
    pub mobile_push: bool,
    #[sqlx(default)]
    #[serde(default)]
    pub suppress_highlights: bool,
    #[sqlx(default)]
    #[serde(default)]
    pub mute_events: bool,
}

const NOTIF_COLS: &str = "target_id, level, muted_until, suppress_everyone, suppress_roles, mobile_push, suppress_highlights, mute_events";

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
    Ok(sqlx::query_as::<_, NotifSetting>(&format!("SELECT {NOTIF_COLS} FROM notification_settings WHERE user_id = $1")).bind(uid).fetch_all(db).await?)
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
    mobile_push: Option<bool>,
    suppress_highlights: Option<bool>,
    mute_events: Option<bool>,
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
        "INSERT INTO notification_settings (user_id, target_id, level, muted_until, suppress_everyone, suppress_roles, mobile_push, suppress_highlights, mute_events)
         VALUES ($1, $2, COALESCE($3, 'default'), $4, COALESCE($5, false), COALESCE($7, false), COALESCE($8, true), COALESCE($9, false), COALESCE($10, false))
         ON CONFLICT (user_id, target_id) DO UPDATE SET
           level = COALESCE($3, notification_settings.level),
           muted_until = CASE WHEN $6 THEN $4 ELSE notification_settings.muted_until END,
           suppress_everyone = COALESCE($5, notification_settings.suppress_everyone),
           suppress_roles = COALESCE($7, notification_settings.suppress_roles),
           mobile_push = COALESCE($8, notification_settings.mobile_push),
           suppress_highlights = COALESCE($9, notification_settings.suppress_highlights),
           mute_events = COALESCE($10, notification_settings.mute_events),
           updated_at = now()",
    )
    .bind(uid)
    .bind(target)
    .bind(req.level.as_deref())
    .bind(muted_until.clone().flatten())
    .bind(req.suppress_everyone)
    .bind(muted_until.is_some())
    .bind(req.suppress_roles)
    .bind(req.mobile_push)
    .bind(req.suppress_highlights)
    .bind(req.mute_events)
    .execute(&state.db)
    .await?;
    let row = sqlx::query_as::<_, NotifSetting>(&format!("SELECT {NOTIF_COLS} FROM notification_settings WHERE user_id = $1 AND target_id = $2")).bind(uid).bind(target).fetch_one(&state.db).await?;
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

/// Cosmetic presets the client draws (CSS); the server only checks the id.
pub const PROFILE_FRAMES: &[&str] = &["gold", "neon", "vines", "pixel", "frost", "ember"];
pub const NAMEPLATES: &[&str] = &["dusk", "ocean", "forest", "candy", "aurora", "mono"];
pub const PROFILE_EFFECTS: &[&str] = &["sparkles", "snow", "hearts", "confetti", "bubbles"];

pub const USER_COLS: &str = "id, username, display_name, avatar_url, bio, status, created_at, banner_url, theme_primary, theme_accent, pronouns, name_primary, name_accent, custom_status, bot, verified_bot, name_style, avatar_decoration, clan_tag, clan_tag_guild, panels, profile_privacy, profile_frame, nameplate, profile_effect, account_state, system";
pub const PRIVATE_USER_COLS: &str = "id, username, display_name, email, avatar_url, bio, status, created_at, banner_url, theme_primary, theme_accent, pronouns, name_primary, name_accent, custom_status, bot, name_style, max_upload_bytes, dm_privacy, message_requests, friend_request_from, group_dm_privacy, searchable, guild_dms_default, show_read_receipts, show_typing, sensitive_media, spam_filter, notif_prefs, avatar_decoration, clan_tag, clan_tag_guild, panels, is_admin, email_verified_at, (totp_secret IS NOT NULL) AS mfa_enabled, status_expires_at, custom_status_expires_at, pinned_channels, ignored_users, online_alerts, avatar_history, profile_privacy, profile_frame, nameplate, profile_effect, entrance_sound, client_settings, birthdate, custom_activity, share_activity, house, CASE WHEN birthdate IS NULL THEN 'unknown' WHEN birthdate > (now() - interval '18 years')::date THEN 'teen' ELSE 'adult' END AS age_group";

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
    /// {font, effect} from the style picker; unknown values are refused.
    name_style: Option<serde_json::Value>,
    custom_status: Option<String>,
    /// Pinned channels and DMs, in order (up to 100).
    pinned_channels: Option<Vec<Uuid>>,
    /// 'everyone' | 'friends'.
    profile_privacy: Option<String>,
    /// A sound id from a server you're in, 'builtin:<name>', or '' for none.
    entrance_sound: Option<String>,
    /// Cosmetics: a preset id from the client's list, or '' for none.
    profile_frame: Option<String>,
    nameplate: Option<String>,
    profile_effect: Option<String>,
    /// A house badge: ember, tide, grove, or '' for none.
    house: Option<String>,
    /// Ignored people (up to 500).
    ignored_users: Option<Vec<Uuid>>,
    /// Friends to be told about when they come online (up to 200).
    online_alerts: Option<Vec<Uuid>>,
    /// With `status`: revert to Online after this many seconds (up to 3 days); without it the status stays.
    status_for_secs: Option<i64>,
    /// With `custom_status`: clear it after this many seconds (up to 7 days); without it the status stays.
    custom_status_for_secs: Option<i64>,
    /// Flair: one of DECORATIONS or `asset:<id>` from the assets folder ('' clears), a 2–4 character tag ('' clears), panels {wishlist, games} of {title, url?}.
    avatar_decoration: Option<String>,
    clan_tag: Option<String>,
    panels: Option<serde_json::Value>,
}

/// Check a {font, effect, colors} style; returns the cleaned style plus (first colour, second colour for gradients).
pub fn validate_name_style(v: &serde_json::Value) -> AppResult<(serde_json::Value, Option<String>, Option<String>)> {
    let o = v.as_object().ok_or_else(|| AppError::BadRequest("name_style must be an object".into()))?;
    let font = o.get("font").and_then(|x| x.as_str()).unwrap_or("default");
    let effect = o.get("effect").and_then(|x| x.as_str()).unwrap_or("solid");
    if !NAME_FONTS.contains(&font) { return Err(AppError::BadRequest(format!("Unknown font {font}"))); }
    if !NAME_EFFECTS.contains(&effect) { return Err(AppError::BadRequest(format!("Unknown effect {effect}"))); }
    let mut colors: Vec<String> = Vec::new();
    for c in o.get("colors").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
        let c = c.as_str().unwrap_or("").to_lowercase();
        if c.len() != 7 || !c.starts_with('#') || !c[1..].chars().all(|ch| ch.is_ascii_hexdigit()) { return Err(AppError::BadRequest(format!("Bad colour {c}"))); }
        colors.push(c);
    }
    if colors.len() > 6 { return Err(AppError::BadRequest("At most 6 colours".into())); }
    let primary = colors.first().cloned();
    let accent = if effect == "gradient" { colors.get(1).cloned() } else { None };
    Ok((serde_json::json!({ "font": font, "effect": effect, "colors": colors }), primary, accent))
}

pub const NAME_FONTS: [&str; 12] = ["default", "serif", "mono", "rounded", "display", "script", "smallcaps", "condensed", "wide", "italic", "slab", "pixel"];
pub const NAME_EFFECTS: [&str; 10] = ["solid", "gradient", "neon", "toon", "pop", "gummy", "prism", "glitch", "wave", "holographic"];

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
/// `DELETE /users/@me`: same as `POST /users/@me/deletion` (kept for older clients): schedules the deletion.
async fn delete_me(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<DeleteMeReq>) -> AppResult<Json<serde_json::Value>> {
    crate::routes::mfa::check_password_and_factor(&state, uid, &req.password, req.code.as_deref()).await?;
    let at = crate::routes::deletion::request_deletion(&state, uid).await?;
    Ok(Json(json!({ "scheduled_for": at })))
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
    if req.pinned_channels.as_ref().map(|p| p.len() > 100).unwrap_or(false) {
        return Err(AppError::BadRequest("You can pin up to 100 channels and DMs".into()));
    }
    if req.ignored_users.as_ref().map(|p| p.len() > 500).unwrap_or(false) || req.online_alerts.as_ref().map(|p| p.len() > 200).unwrap_or(false) {
        return Err(AppError::BadRequest("That list is full".into()));
    }
    if req.status_for_secs.map(|s| !(60..=3 * 86400).contains(&s)).unwrap_or(false) {
        return Err(AppError::BadRequest("A status can last from a minute to 3 days".into()));
    }
    if req.custom_status_for_secs.map(|s| !(60..=7 * 86400).contains(&s)).unwrap_or(false) {
        return Err(AppError::BadRequest("A custom status can clear after a minute to 7 days".into()));
    }
    let status_changed = req.status.is_some();
    if let Some(s) = &req.status {
        if !["online", "idle", "dnd", "invisible"].contains(&s.as_str()) {
            return Err(AppError::BadRequest("Invalid status".into()));
        }
    }
    validate_image(&req.avatar_url)?;
    if let Some(d) = &req.avatar_decoration {
        if !DECORATIONS.contains(&d.as_str()) && !crate::routes::assets::decoration_exists(&state.config, d).await {
            return Err(AppError::BadRequest("Unknown avatar decoration".into()));
        }
    }
    let clan_tag = req.clan_tag.as_ref().map(|t| t.trim().to_uppercase());
    if let Some(t) = &clan_tag {
        if !t.is_empty() && (t.chars().count() < 2 || t.chars().count() > 4 || !t.chars().all(|c| c.is_ascii_alphanumeric())) {
            return Err(AppError::BadRequest("Tag must be 2-4 letters or digits".into()));
        }
        // Typing a different tag of your own replaces a server's (saving the same one keeps it).
        sqlx::query("UPDATE users SET clan_tag_guild = NULL WHERE id = $1 AND clan_tag IS DISTINCT FROM $2").bind(uid).bind(t).execute(&state.db).await?;
    }
    let panels = match &req.panels { Some(v) => Some(clean_panels(v)?), None => None };
    let (name_style, derived) = match &req.name_style {
        Some(v) => { let (st, p, a) = validate_name_style(v)?; (Some(st), Some((p, a))) }
        None => (None, None),
    };
    // A style with colours also sets the classic colour fields so older clients keep a sensible name colour.
    let (name_primary, name_accent) = match derived {
        Some((p, a)) => (Some(p.unwrap_or_default()), Some(a.unwrap_or_default())),
        None => (req.name_primary.clone(), req.name_accent.clone()),
    };
    if req.profile_privacy.as_deref().map(|p| p != "everyone" && p != "friends").unwrap_or(false) {
        return Err(AppError::BadRequest("profile_privacy must be 'everyone' or 'friends'".into()));
    }
    for (v, list, what) in [(&req.profile_frame, PROFILE_FRAMES, "frame"), (&req.nameplate, NAMEPLATES, "nameplate"), (&req.profile_effect, PROFILE_EFFECTS, "profile effect")] {
        if let Some(v) = v {
            // Each can also come from the instance's assets folder (`asset:<id>`).
            let asset = v.starts_with(crate::routes::assets::ASSET_PREFIX) && match what {
                "nameplate" => crate::routes::assets::nameplate_exists(&state.config, v).await,
                "frame" => crate::routes::asset_layers::frame_exists(&state.config, v).await,
                _ => crate::routes::asset_layers::effect_exists(&state.config, v).await,
            };
            if !v.is_empty() && !asset && !list.contains(&v.as_str()) { return Err(AppError::BadRequest(format!("Unknown {what}"))) }
        }
    }
    if let Some(h) = &req.house {
        if !["", "ember", "tide", "grove"].contains(&h.as_str()) { return Err(AppError::BadRequest("house is ember, tide, grove or empty".into())) }
        sqlx::query("UPDATE users SET house = $2 WHERE id = $1").bind(uid).bind(h).execute(&state.db).await?;
    }
    if let Some(es) = &req.entrance_sound {
        if !es.is_empty() && crate::routes::sounds::resolve(&state.db, uid, es).await?.is_none() { return Err(AppError::BadRequest("Pick a sound from one of your servers".into())) }
        sqlx::query("UPDATE users SET entrance_sound = $2 WHERE id = $1").bind(uid).bind(es).execute(&state.db).await?;
    }
    if req.profile_privacy.is_some() || req.profile_frame.is_some() || req.nameplate.is_some() || req.profile_effect.is_some() {
        sqlx::query("UPDATE users SET profile_privacy = COALESCE($2, profile_privacy), profile_frame = COALESCE($3, profile_frame), nameplate = COALESCE($4, nameplate), profile_effect = COALESCE($5, profile_effect) WHERE id = $1")
            .bind(uid).bind(&req.profile_privacy).bind(&req.profile_frame).bind(&req.nameplate).bind(&req.profile_effect).execute(&state.db).await?;
    }
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
            panels = COALESCE($15, panels),
            name_style = COALESCE($16, name_style),
            status_expires_at = CASE WHEN $5::text IS NULL THEN status_expires_at WHEN $17::bigint IS NULL OR $5 = 'online' THEN NULL ELSE now() + make_interval(secs => $17::float8) END,
            custom_status_expires_at = CASE WHEN $12::text IS NULL THEN custom_status_expires_at WHEN $18::bigint IS NULL OR $12 = '' THEN NULL ELSE now() + make_interval(secs => $18::float8) END,
            pinned_channels = COALESCE($19, pinned_channels),
            ignored_users = COALESCE($20, ignored_users),
            online_alerts = COALESCE($21, online_alerts)
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
    .bind(name_primary)
    .bind(name_accent)
    .bind(req.custom_status.as_ref().map(|c| c.trim().chars().take(128).collect::<String>()))
    .bind(req.avatar_decoration)
    .bind(clan_tag)
    .bind(panels)
    .bind(name_style)
    .bind(req.status_for_secs)
    .bind(req.custom_status_for_secs)
    .bind(&req.pinned_channels)
    .bind(req.ignored_users.as_ref().map(|v| { let mut v: Vec<Uuid> = v.iter().copied().filter(|x| *x != uid).collect(); v.dedup(); v }))
    .bind(&req.online_alerts)
    .fetch_one(&state.db)
    .await?;
    // Avatar history: the one you replaced goes to the front (up to 6 kept); only avatars that fall off are deleted.
    let mut u = u;
    if u.avatar_url != before.0 {
        let mut hist: Vec<String> = before.0.iter().cloned().chain(u.avatar_history.iter().cloned()).filter(|a| Some(a) != u.avatar_url.as_ref()).collect();
        hist.dedup();
        let dropped: Vec<String> = hist.split_off(hist.len().min(6));
        sqlx::query("UPDATE users SET avatar_history = $2 WHERE id = $1").bind(uid).bind(&hist).execute(&state.db).await?;
        for old in &dropped { crate::routes::images::release_replaced(&state, Some(old), u.avatar_url.as_deref()).await; }
        u.avatar_history = hist;
    }
    crate::routes::images::release_replaced(&state, before.1.as_deref(), u.banner_url.as_deref()).await;

    let public = User::from(&u);
    state.hub.emit_all("USER_UPDATE", json!(public));
    // Going Invisible shows you offline (no devices, not away) at once; coming back shows you online again.
    if status_changed { crate::ws::bus::announce(&state, uid).await; }
    // Your other devices: settings only you see.
    if req.pinned_channels.is_some() { state.hub.emit_users(vec![uid], "USER_SETTINGS_UPDATE", json!({ "pinned_channels": u.pinned_channels })); }
    if req.ignored_users.is_some() || req.online_alerts.is_some() { state.hub.emit_users(vec![uid], "USER_SETTINGS_UPDATE", json!({ "ignored_users": u.ignored_users, "online_alerts": u.online_alerts })); }
    Ok(Json(u))
}

/// Background task: statuses chosen "for 1 hour" go back to Online, and custom statuses with "Clear after" clear,
/// when their time is up. Safe on every instance: each row is claimed by the UPDATE that resets it.
pub async fn expire_statuses(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        let mut ids: Vec<Uuid> = sqlx::query_as::<_, (Uuid,)>("UPDATE users SET status = 'online', status_expires_at = NULL WHERE status_expires_at <= now() RETURNING id")
            .fetch_all(&state.db).await.unwrap_or_default().into_iter().map(|r| r.0).collect();
        // An Invisible that ran out: they show up online again.
        for id in &ids { crate::ws::bus::announce(&state, *id).await; }
        ids.extend(sqlx::query_as::<_, (Uuid,)>("UPDATE users SET custom_status = '', custom_status_expires_at = NULL WHERE custom_status_expires_at <= now() RETURNING id")
            .fetch_all(&state.db).await.unwrap_or_default().into_iter().map(|r| r.0));
        if ids.is_empty() { continue }
        ids.sort(); ids.dedup();
        let users = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = ANY($1)")).bind(&ids).fetch_all(&state.db).await.unwrap_or_default();
        for u in users { state.hub.emit_all("USER_UPDATE", json!(u)); }
    }
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
    // An exact username always matches (that is all a friend request needs). Partial matches only return people who
    // opted in to being found, plus your existing friends; admins search everyone.
    let (admin,): (bool,) = sqlx::query_as("SELECT is_admin FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    let users = sqlx::query_as::<_, User>(&format!(
        "SELECT {USER_COLS} FROM users WHERE id <> $1 AND NOT webhook AND (
             lower(username) = $3
             OR ((username ILIKE $2 OR display_name ILIKE $2)
                 AND ($4 OR searchable OR EXISTS (SELECT 1 FROM relationships r WHERE r.user_id = $1 AND r.target_id = users.id AND r.kind = 'friend'))))
         ORDER BY lower(username) = $3 DESC, username LIMIT 20"
    ))
    .bind(uid)
    .bind(pattern)
    .bind(&term)
    .bind(admin)
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
    let mut u = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;
    // An account waiting to be deleted is hidden from everyone else; a deleted one is a bare tombstone.
    if u.account_state == "pending_deletion" && me != id { return Err(AppError::NotFound("User not found".into())) }
    if u.account_state == "deleted" { return Ok(Json(serde_json::json!(u))) }
    // Friends-only profiles show in full to you and your friends.
    u.reveal = me == id || sqlx::query_as::<_, (bool,)>("SELECT true FROM relationships WHERE user_id = $1 AND target_id = $2 AND kind = 'friend'").bind(me).bind(id).fetch_optional(&state.db).await?.is_some();
    let mutual: Vec<(Uuid, String, Option<String>)> = if me == id {
        Vec::new()
    } else {
        sqlx::query_as(
            "SELECT g.id, g.name, g.icon_url FROM guilds g
             JOIN guild_members a ON a.guild_id = g.id AND a.user_id = $1
             JOIN guild_members b ON b.guild_id = g.id AND b.user_id = $2
             WHERE g.state = 'active'
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
    v["connections"] = json!(crate::routes::connections::visible_for(&state.db, id, me == id).await?.into_iter().map(|c| json!({ "id": c.id, "provider": c.provider, "name": c.name, "url": c.url, "visible": c.visible })).collect::<Vec<_>>());
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
/// host (owns a server), verified (email confirmed), secure (2FA on), and the house the user picked (house_*).
pub async fn badges_for(db: &sqlx::PgPool, id: Uuid) -> AppResult<Vec<&'static str>> {
    let row: Option<(bool, bool, bool, bool, bool, bool, String)> = sqlx::query_as(
        "SELECT u.is_admin,
                (SELECT COUNT(*) FROM users o WHERE o.created_at < u.created_at) < 10,
                u.created_at < now() - interval '1 year',
                EXISTS (SELECT 1 FROM guilds g WHERE g.owner_id = u.id),
                u.email_verified_at IS NOT NULL,
                u.totp_secret IS NOT NULL,
                u.house
         FROM users u WHERE u.id = $1",
    )
    .bind(id)
    .fetch_optional(db)
    .await?;
    let Some((admin, founder, veteran, host, verified, secure, house)) = row else { return Ok(vec![]) };
    let mut out = Vec::new();
    if admin { out.push("admin"); }
    if founder { out.push("founder"); }
    if veteran { out.push("veteran"); }
    if host { out.push("host"); }
    if verified { out.push("verified"); }
    if secure { out.push("secure"); }
    match house.as_str() { "ember" => out.push("house_ember"), "tide" => out.push("house_tide"), "grove" => out.push("house_grove"), _ => {} }
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
/// Send a test notification to each of the caller's registered devices and report the outcome per device.
async fn test_push(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(crate::push::test(&state, uid).await))
}

async fn delete_push_token(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<DeletePushToken>) -> AppResult<StatusCode> {
    sqlx::query("DELETE FROM push_tokens WHERE token = $1 AND user_id = $2").bind(req.token.trim()).bind(uid).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `PUT /users/@me/client-settings`: the whole settings blob (up to 32 KB); your other sessions are told.
async fn put_client_settings(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(v): Json<serde_json::Value>) -> AppResult<StatusCode> {
    if !v.is_object() { return Err(AppError::BadRequest("Settings must be an object".into())) }
    if v.to_string().len() > 32 * 1024 { return Err(AppError::BadRequest("Settings are too large".into())) }
    sqlx::query("UPDATE users SET client_settings = $2 WHERE id = $1").bind(uid).bind(&v).execute(&state.db).await?;
    state.hub.emit_users(vec![uid], "USER_SETTINGS_UPDATE", json!({ "client_settings": v }));
    Ok(StatusCode::NO_CONTENT)
}
