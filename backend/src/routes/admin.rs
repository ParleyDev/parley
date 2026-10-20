//! Root console for Parley admins (`users.is_admin`): instance stats, user and server
//! management, and instance settings (registration on/off, sitewide announcement).

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::users::require_admin,
    state::AppState,
};
use axum::{
    response::IntoResponse,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/instance", get(instance_public))
        .route("/admin/stats", get(stats))
        .route("/admin/users", get(list_users))
        .route("/admin/users/:id", axum::routing::patch(patch_user).delete(delete_user))
        .route("/admin/users/bulk", axum::routing::post(bulk_users))
        .route("/admin/guilds", get(list_guilds))
        .route("/admin/guilds/:id", delete(delete_guild))
        .route("/admin/settings", get(get_settings).put(put_settings))
        .route("/admin/mail", get(admin_mail))
        .route("/admin/audit", get(list_audit))
        .route("/admin/maintenance/sweep-images", axum::routing::post(sweep_images))
}

#[derive(Deserialize)]
struct SweepQuery {
    /// Only images older than this are considered (default: the sweeper's own grace period).
    min_age_secs: Option<f64>,
}

/// Run the orphan-image sweep now (what the background task does every 15 minutes).
async fn sweep_images(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<SweepQuery>) -> AppResult<Json<Value>> {
    require_admin(&state, uid).await?;
    let age = q.min_age_secs.unwrap_or(crate::routes::images::ORPHAN_TTL_SECS as f64).max(0.0);
    let removed = crate::routes::images::sweep_now(&state, age).await;
    audit::record(&state, uid, "maintenance.sweep_images", "", None, "", json!({ "removed": removed, "min_age_secs": age })).await;
    Ok(Json(json!({ "removed": removed })))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceSettings {
    pub registration_enabled: bool,
    pub announcement: String,
    /// Gate creating servers and using Discover until the email is verified.
    #[serde(default)]
    pub require_email_verification: bool,
    /// Whether the server can send mail at all (so the UI can hide resend when it cannot).
    #[serde(default)]
    pub mail_enabled: bool,
    /// Voice transport: "mesh" (peer to peer, default) or "sfu" when a LiveKit server is configured.
    #[serde(default)]
    pub voice_mode: String,
    /// LiveKit server URL browsers connect to (ws:// or wss://). Empty = mesh voice.
    #[serde(default)]
    pub livekit_url: String,
    #[serde(default)]
    pub livekit_api_key: String,
    #[serde(default)]
    pub livekit_api_secret: String,
    /// Speech-to-text for voice messages: base URL of an OpenAI-compatible `/v1/audio/transcriptions` server. Empty = off.
    #[serde(default)]
    pub stt_url: String,
    #[serde(default)]
    pub stt_api_key: String,
    #[serde(default)]
    pub stt_model: String,
    /// Whether voice messages get transcribed (derived; clients use it to show "Transcribing…").
    #[serde(default)]
    pub transcription: bool,
    /// Rate limit overrides as `count/seconds` by bucket (register, login, login_fail, messages, uploads, gifs, mail);
    /// a missing bucket uses the RL_* environment value, shown in `rate_limit_defaults`.
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub rate_limits: std::collections::HashMap<String, String>,
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub rate_limit_defaults: std::collections::HashMap<String, String>,
    /// Antivirus: clamd host:port (compose `av` profile: clamav:3310). Empty = uploads are not scanned.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub av_addr: String,
    /// When the scanner is unreachable: refuse uploads (true) or let them through with an error logged (false).
    #[serde(default)]
    pub av_fail_closed: bool,
}

impl InstanceSettings {
    pub fn stt_configured(&self) -> bool { !self.stt_url.trim().is_empty() }
    pub fn sfu_configured(&self) -> bool {
        !self.livekit_url.trim().is_empty() && !self.livekit_api_key.trim().is_empty() && !self.livekit_api_secret.trim().is_empty()
    }
    /// What anyone may see: no API credentials.
    pub fn public(mut self) -> Self {
        self.livekit_api_key = String::new();
        self.livekit_api_secret = String::new();
        self.stt_url = String::new();
        self.stt_api_key = String::new();
        self.rate_limits.clear();
        self.rate_limit_defaults.clear();
        self.av_addr = String::new();
        self
    }
}

pub async fn load_settings(db: &PgPool) -> AppResult<InstanceSettings> {
    let rows: Vec<(String, Value)> = sqlx::query_as("SELECT key, value FROM instance_settings").fetch_all(db).await?;
    let mut s = InstanceSettings { registration_enabled: true, announcement: String::new(), require_email_verification: false, mail_enabled: false, voice_mode: "mesh".into(), livekit_url: String::new(), livekit_api_key: String::new(), livekit_api_secret: String::new(), stt_url: String::new(), stt_api_key: String::new(), stt_model: String::new(), transcription: false, rate_limits: Default::default(), rate_limit_defaults: Default::default(), av_addr: String::new(), av_fail_closed: false };
    for (k, v) in rows {
        match k.as_str() {
            "registration_enabled" => s.registration_enabled = v.as_bool().unwrap_or(true),
            "announcement" => s.announcement = v.as_str().unwrap_or("").to_string(),
            "require_email_verification" => s.require_email_verification = v.as_bool().unwrap_or(false),
            "livekit_url" => s.livekit_url = v.as_str().unwrap_or("").to_string(),
            "livekit_api_key" => s.livekit_api_key = v.as_str().unwrap_or("").to_string(),
            "livekit_api_secret" => s.livekit_api_secret = v.as_str().unwrap_or("").to_string(),
            "stt_url" => s.stt_url = v.as_str().unwrap_or("").to_string(),
            "stt_api_key" => s.stt_api_key = v.as_str().unwrap_or("").to_string(),
            "stt_model" => s.stt_model = v.as_str().unwrap_or("").to_string(),
            "av_addr" => s.av_addr = v.as_str().unwrap_or("").to_string(),
            "av_fail_closed" => s.av_fail_closed = v.as_bool().unwrap_or(false),
            "rate_limits" => s.rate_limits = v.as_object().map(|o| o.iter().filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string()))).collect()).unwrap_or_default(),
            _ => {}
        }
    }
    s.rate_limit_defaults = crate::ratelimit::LIMITER.env_defaults();
    s.voice_mode = if s.sfu_configured() { "sfu".into() } else { "mesh".into() };
    s.transcription = s.stt_configured();
    Ok(s)
}

/// Public (no auth): what the login page and the app banner need.
async fn instance_public(State(state): State<AppState>) -> AppResult<Json<InstanceSettings>> {
    let mut s = load_settings(&state.db).await?;
    s.mail_enabled = crate::mail::enabled(&state.config);
    Ok(Json(s.public()))
}

/// Admin: recently sent mail (the in-memory outbox), optionally filtered by recipient. How dev and tests read links.
async fn admin_mail(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<MailQuery>) -> AppResult<Json<Vec<crate::mail::SentMail>>> {
    require_admin(&state, uid).await?;
    Ok(Json(crate::mail::outbox(q.to.as_deref())))
}

#[derive(Deserialize)]
struct MailQuery {
    to: Option<String>,
}

async fn stats(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_admin(&state, uid).await?;
    let (users,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users").fetch_one(&state.db).await?;
    let (admins,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE is_admin").fetch_one(&state.db).await?;
    let (suspended,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE suspended_at IS NOT NULL").fetch_one(&state.db).await?;
    let (guilds,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM guilds").fetch_one(&state.db).await?;
    let (messages,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM messages").fetch_one(&state.db).await?;
    let (pending,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM guild_discovery WHERE status = 'pending'").fetch_one(&state.db).await?;
    let (approved,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM guild_discovery WHERE status = 'approved'").fetch_one(&state.db).await?;
    let (uploads,): (i64,) = sqlx::query_as("SELECT COALESCE(SUM(size), 0)::bigint FROM (SELECT size FROM attachments UNION ALL SELECT size FROM images) x").fetch_one(&state.db).await?;
    let (reports_open,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM reports WHERE status = 'open'").fetch_one(&state.db).await?;
    Ok(Json(json!({
        "users": users, "admins": admins, "suspended": suspended, "online": crate::ws::bus::online_users(&state.db).await.len(),
        "guilds": guilds, "messages": messages, "discovery_pending": pending, "discovery_approved": approved, "upload_bytes": uploads,
        "reports_open": reports_open,
    })))
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default)]
    q: String,
    /// Filters (all optional, AND-ed): admin, suspended, verified, mfa, online as true/false;
    /// joined_before / joined_after as YYYY-MM-DD; inactive_days = no session activity for N days.
    admin: Option<bool>,
    suspended: Option<bool>,
    verified: Option<bool>,
    mfa: Option<bool>,
    online: Option<bool>,
    joined_before: Option<chrono::NaiveDate>,
    joined_after: Option<chrono::NaiveDate>,
    inactive_days: Option<i64>,
    /// Users who have had a session from this client IP (exact match) in the last 30 days.
    ip: Option<String>,
    #[serde(default)]
    offset: i64,
    limit: Option<i64>,
}

#[derive(Debug, Serialize, FromRow)]
struct AdminUser {
    id: Uuid,
    username: String,
    display_name: String,
    email: String,
    created_at: DateTime<Utc>,
    is_admin: bool,
    suspended_at: Option<DateTime<Utc>>,
    mfa_enabled: bool,
    #[sqlx(default)]
    email_verified_at: Option<DateTime<Utc>>,
    #[sqlx(default)]
    upload_quota_bytes: Option<i64>,
    /// Newest session activity (any device), None if never logged in since sessions were introduced.
    #[sqlx(default)]
    last_seen_at: Option<DateTime<Utc>>,
    guild_count: i64,
    #[sqlx(skip)]
    online: bool,
}

fn pattern(q: &str) -> Option<String> {
    let t = q.trim().replace('%', "\\%").replace('_', "\\_");
    if t.is_empty() { None } else { Some(format!("%{t}%")) }
}

/// Filtered, paged user list (newest first). The total for the filter is in the X-Total-Count header so the
/// response stays a plain array.
async fn list_users(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<ListQuery>) -> AppResult<axum::response::Response> {
    require_admin(&state, uid).await?;
    let online = crate::ws::bus::online_users(&state.db).await;
    let limit = q.limit.unwrap_or(200).clamp(1, 200);
    let before: Option<DateTime<Utc>> = q.joined_before.and_then(|d| d.and_hms_opt(0, 0, 0)).map(|t| t.and_utc());
    let after: Option<DateTime<Utc>> = q.joined_after.and_then(|d| (d + chrono::Duration::days(1)).and_hms_opt(0, 0, 0)).map(|t| t.and_utc());
    let where_sql = "($1::text IS NULL OR u.username ILIKE $1 OR u.display_name ILIKE $1 OR u.email ILIKE $1)
         AND ($2::bool IS NULL OR u.is_admin = $2)
         AND ($3::bool IS NULL OR (u.suspended_at IS NOT NULL) = $3)
         AND ($4::bool IS NULL OR (u.email_verified_at IS NOT NULL) = $4)
         AND ($5::bool IS NULL OR (u.totp_secret IS NOT NULL) = $5)
         AND ($6::bool IS NULL OR (u.id = ANY($7)) = $6)
         AND ($8::timestamptz IS NULL OR u.created_at < $8)
         AND ($9::timestamptz IS NULL OR u.created_at >= $9)
         AND ($10::bigint IS NULL OR COALESCE((SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id), u.created_at) < now() - make_interval(days => $10::int))
         AND ($13::text IS NULL OR EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.ip = $13 AND s.created_at > now() - interval '30 days'))";
    let ip = q.ip.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let (total,): (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM users u WHERE {where_sql}"))
        .bind(pattern(&q.q)).bind(q.admin).bind(q.suspended).bind(q.verified).bind(q.mfa).bind(q.online).bind(&online).bind(before).bind(after).bind(q.inactive_days).bind(0i64).bind(0i64).bind(&ip)
        .fetch_one(&state.db)
        .await?;
    let mut rows = sqlx::query_as::<_, AdminUser>(&format!(
        "SELECT u.id, u.username, u.display_name, u.email, u.created_at, u.is_admin, u.suspended_at, (u.totp_secret IS NOT NULL) AS mfa_enabled,
                u.email_verified_at, u.upload_quota_bytes, (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
                (SELECT COUNT(*) FROM guild_members m WHERE m.user_id = u.id) AS guild_count
         FROM users u WHERE {where_sql}
         ORDER BY u.created_at DESC LIMIT $11 OFFSET $12"))
    .bind(pattern(&q.q)).bind(q.admin).bind(q.suspended).bind(q.verified).bind(q.mfa).bind(q.online).bind(&online).bind(before).bind(after).bind(q.inactive_days)
    .bind(limit).bind(q.offset.max(0)).bind(&ip)
    .fetch_all(&state.db)
    .await?;
    for r in &mut rows { r.online = online.contains(&r.id) }
    let mut resp = Json(rows).into_response();
    resp.headers_mut().insert("x-total-count", axum::http::HeaderValue::from(total as u64));
    Ok(resp)
}

#[derive(Deserialize)]
struct BulkReq {
    ids: Vec<Uuid>,
    /// suspend | unsuspend | logout | delete | quota | clear_mfa
    action: String,
    upload_quota_bytes: Option<i64>,
}

/// Apply one action to many accounts; the caller is skipped for destructive actions. Each change is audited.
async fn bulk_users(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<BulkReq>) -> AppResult<Json<Value>> {
    require_admin(&state, uid).await?;
    if req.ids.len() > 500 {
        return Err(AppError::BadRequest("At most 500 accounts per request".into()));
    }
    if !["suspend", "unsuspend", "logout", "delete", "quota", "clear_mfa"].contains(&req.action.as_str()) {
        return Err(AppError::BadRequest("Unknown action".into()));
    }
    let mut done = 0usize;
    let mut failed: Vec<Value> = Vec::new();
    for id in req.ids.iter().copied().collect::<std::collections::BTreeSet<_>>() {
        let res: AppResult<()> = async {
            let name = audit::username(&state, id).await;
            if name.is_empty() { return Err(AppError::NotFound("User not found".into())) }
            match req.action.as_str() {
                "suspend" => {
                    if id == uid { return Err(AppError::BadRequest("You cannot suspend yourself".into())) }
                    sqlx::query("UPDATE users SET suspended_at = COALESCE(suspended_at, now()) WHERE id = $1").bind(id).execute(&state.db).await?;
                    state.hub.session_forget(id);
                    state.hub.emit_users(vec![id], "SESSION_REVOKED", json!({ "reason": "Your account has been suspended." }));
                    state.hub.voice_evict(|v| v.user_id == id);
                    audit::record(&state, uid, "user.suspend", "user", Some(id), &name, json!({ "bulk": true })).await;
                }
                "unsuspend" => {
                    sqlx::query("UPDATE users SET suspended_at = NULL WHERE id = $1").bind(id).execute(&state.db).await?;
                    audit::record(&state, uid, "user.unsuspend", "user", Some(id), &name, json!({ "bulk": true })).await;
                }
                "logout" => {
                    let n = crate::auth::revoke_sessions(&state, id, None, None, "An administrator logged you out of all devices.").await?.len();
                    audit::record(&state, uid, "user.logout_all", "user", Some(id), &name, json!({ "revoked": n, "bulk": true })).await;
                }
                "delete" => {
                    if id == uid { return Err(AppError::BadRequest("You cannot delete your own account from here".into())) }
                    delete_account(&state, id).await?;
                    audit::record(&state, uid, "user.delete", "user", Some(id), &name, json!({ "bulk": true })).await;
                }
                "quota" => {
                    let q = req.upload_quota_bytes;
                    if q.map(|v| v < 0).unwrap_or(false) { return Err(AppError::BadRequest("Quota cannot be negative".into())) }
                    sqlx::query("UPDATE users SET upload_quota_bytes = $2 WHERE id = $1").bind(id).bind(q).execute(&state.db).await?;
                    audit::record(&state, uid, "user.quota", "user", Some(id), &name, json!({ "upload_quota_bytes": q, "bulk": true })).await;
                }
                "clear_mfa" => {
                    crate::routes::mfa::clear_mfa(&state, id).await?;
                    audit::record(&state, uid, "user.clear_mfa", "user", Some(id), &name, json!({ "bulk": true })).await;
                }
                _ => unreachable!(),
            }
            Ok(())
        }.await;
        match res {
            Ok(()) => done += 1,
            Err(e) => failed.push(json!({ "id": id, "error": match &e { AppError::BadRequest(m) | AppError::NotFound(m) => m.clone(), _ => "failed".to_string() } })),
        }
    }
    Ok(Json(json!({ "done": done, "failed": failed })))
}

#[derive(Deserialize)]
struct PatchUser {
    is_admin: Option<bool>,
    suspended: Option<bool>,
    /// Only `false` is meaningful: clears a locked-out user's second factor so they can log in with their password.
    mfa: Option<bool>,
    /// Per-user storage quota in bytes; null restores the instance default; 0 = unlimited.
    #[serde(default, deserialize_with = "deserialize_nullable_i64")]
    upload_quota_bytes: Option<Option<i64>>,
}

fn deserialize_nullable_i64<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<i64>>, D::Error> {
    Ok(Some(Option::<i64>::deserialize(d)?))
}

async fn patch_user(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<PatchUser>) -> AppResult<Json<Value>> {
    require_admin(&state, uid).await?;
    let exists: Option<(bool,)> = sqlx::query_as("SELECT true FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    if exists.is_none() {
        return Err(AppError::NotFound("User not found".into()));
    }
    if let Some(admin) = req.is_admin {
        if !admin {
            if id == uid { return Err(AppError::BadRequest("You cannot remove your own admin rights".into())); }
            let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users WHERE is_admin AND id <> $1").bind(id).fetch_one(&state.db).await?;
            if n == 0 { return Err(AppError::BadRequest("At least one admin must remain".into())); }
        }
        // Console grants are not tied to ADMIN_EMAILS; a console demotion of a listed email is undone at their next check.
        sqlx::query("UPDATE users SET is_admin = $2, admin_via_env = false WHERE id = $1").bind(id).bind(admin).execute(&state.db).await?;
        audit::record(&state, uid, if admin { "user.promote" } else { "user.demote" }, "user", Some(id), &audit::username(&state, id).await, json!({})).await;
    }
    if let Some(suspended) = req.suspended {
        if suspended && id == uid { return Err(AppError::BadRequest("You cannot suspend yourself".into())); }
        sqlx::query("UPDATE users SET suspended_at = CASE WHEN $2 THEN COALESCE(suspended_at, now()) ELSE NULL END WHERE id = $1").bind(id).bind(suspended).execute(&state.db).await?;
        state.hub.session_forget(id);
        if suspended {
            // Their token stops working at once (the auth extractor checks suspension); tell open clients to log out.
            state.hub.emit_users(vec![id], "SESSION_REVOKED", json!({ "reason": "Your account has been suspended." }));
            state.hub.voice_evict(|v| v.user_id == id);
        }
        audit::record(&state, uid, if suspended { "user.suspend" } else { "user.unsuspend" }, "user", Some(id), &audit::username(&state, id).await, json!({})).await;
    }
    if let Some(q) = req.upload_quota_bytes {
        if q.map(|v| v < 0).unwrap_or(false) { return Err(AppError::BadRequest("Quota cannot be negative".into())); }
        sqlx::query("UPDATE users SET upload_quota_bytes = $2 WHERE id = $1").bind(id).bind(q).execute(&state.db).await?;
        audit::record(&state, uid, "user.quota", "user", Some(id), &audit::username(&state, id).await, json!({ "upload_quota_bytes": q })).await;
    }
    match req.mfa {
        Some(false) => {
            crate::routes::mfa::clear_mfa(&state, id).await?;
            audit::record(&state, uid, "user.clear_mfa", "user", Some(id), &audit::username(&state, id).await, json!({})).await;
        }
        Some(true) => return Err(AppError::BadRequest("Only the user can enrol in two-factor authentication".into())),
        None => {}
    }
    let row: (bool, Option<DateTime<Utc>>, bool) = sqlx::query_as("SELECT is_admin, suspended_at, totp_secret IS NOT NULL FROM users WHERE id = $1").bind(id).fetch_one(&state.db).await?;
    Ok(Json(json!({ "id": id, "is_admin": row.0, "suspended_at": row.1, "mfa_enabled": row.2 })))
}

/// Delete an account outright (their servers, messages and uploads go with it).
async fn delete_user(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    require_admin(&state, uid).await?;
    if id == uid {
        return Err(AppError::BadRequest("You cannot delete your own account from here".into()));
    }
    let name = audit::username(&state, id).await;
    delete_account(&state, id).await?;
    audit::record(&state, uid, "user.delete", "user", Some(id), &name, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Remove an account and everything hanging off it (servers they own, messages, uploads, sessions);
/// members of their servers and their own open clients hear about it live.
pub async fn delete_account(state: &AppState, id: Uuid) -> AppResult<()> {
    state.hub.session_forget(id);
    let owned: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM guilds WHERE owner_id = $1").bind(id).fetch_all(&state.db).await?;
    for (gid,) in &owned {
        state.hub.voice_evict(|v| v.guild_id == Some(*gid));
        state.hub.emit_guild(*gid, "GUILD_DELETE", json!({ "id": gid }));
    }
    state.hub.emit_users(vec![id], "SESSION_REVOKED", json!({ "reason": "Your account has been deleted." }));
    state.hub.voice_evict(|v| v.user_id == id);
    let res = sqlx::query("DELETE FROM users WHERE id = $1").bind(id).execute(&state.db).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("User not found".into()));
    }
    Ok(())
}

#[derive(Debug, Serialize, FromRow)]
struct AdminGuild {
    id: Uuid,
    name: String,
    icon_url: Option<String>,
    created_at: DateTime<Utc>,
    owner_id: Uuid,
    owner_username: String,
    member_count: i64,
    message_count: i64,
    discovery_status: Option<String>,
}

async fn list_guilds(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<ListQuery>) -> AppResult<Json<Vec<AdminGuild>>> {
    require_admin(&state, uid).await?;
    let rows = sqlx::query_as::<_, AdminGuild>(
        "SELECT g.id, g.name, g.icon_url, g.created_at, g.owner_id, u.username AS owner_username,
                (SELECT COUNT(*) FROM guild_members m WHERE m.guild_id = g.id) AS member_count,
                (SELECT COUNT(*) FROM messages ms JOIN channels c ON c.id = ms.channel_id WHERE c.guild_id = g.id AND ms.kind = 'default') AS message_count,
                d.status AS discovery_status
         FROM guilds g JOIN users u ON u.id = g.owner_id LEFT JOIN guild_discovery d ON d.guild_id = g.id
         WHERE ($1::text IS NULL OR g.name ILIKE $1 OR u.username ILIKE $1)
         ORDER BY member_count DESC, g.created_at DESC LIMIT 200",
    )
    .bind(pattern(&q.q))
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

async fn delete_guild(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    require_admin(&state, uid).await?;
    let name = audit::guild_name(&state, id).await;
    state.hub.voice_evict(|v| v.guild_id == Some(id));
    state.hub.emit_guild(id, "GUILD_DELETE", json!({ "id": id }));
    let res = sqlx::query("DELETE FROM guilds WHERE id = $1").bind(id).execute(&state.db).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Server not found".into()));
    }
    audit::record(&state, uid, "guild.delete", "guild", Some(id), &name, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_settings(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<InstanceSettings>> {
    require_admin(&state, uid).await?;
    let mut s = load_settings(&state.db).await?;
    s.mail_enabled = crate::mail::enabled(&state.config);
    Ok(Json(s))
}

async fn put_settings(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<InstanceSettings>) -> AppResult<Json<InstanceSettings>> {
    require_admin(&state, uid).await?;
    let announcement: String = req.announcement.trim().chars().take(300).collect();
    let before = load_settings(&state.db).await?;
    let mut changed = serde_json::Map::new();
    if before.registration_enabled != req.registration_enabled { changed.insert("registration_enabled".into(), json!(req.registration_enabled)); }
    if before.announcement != announcement { changed.insert("announcement".into(), json!(announcement)); }
    if before.require_email_verification != req.require_email_verification { changed.insert("require_email_verification".into(), json!(req.require_email_verification)); }
    let lk_url = req.livekit_url.trim().to_string();
    if !lk_url.is_empty() && !(lk_url.starts_with("ws://") || lk_url.starts_with("wss://") || lk_url.starts_with("http://") || lk_url.starts_with("https://")) {
        return Err(AppError::BadRequest("LiveKit URL must start with ws://, wss://, http:// or https://".into()));
    }
    let lk_key = req.livekit_api_key.trim().to_string();
    let lk_secret = req.livekit_api_secret.trim().to_string();
    if before.livekit_url != lk_url { changed.insert("livekit_url".into(), json!(lk_url)); }
    if before.livekit_api_key != lk_key { changed.insert("livekit_api_key".into(), json!(lk_key)); }
    if before.livekit_api_secret != lk_secret { changed.insert("livekit_api_secret".into(), json!(if lk_secret.is_empty() { "cleared" } else { "set" })); }
    let stt_url = req.stt_url.trim().trim_end_matches('/').to_string();
    if !stt_url.is_empty() && !(stt_url.starts_with("http://") || stt_url.starts_with("https://")) {
        return Err(AppError::BadRequest("Transcription URL must start with http:// or https://".into()));
    }
    let stt_key = req.stt_api_key.trim().to_string();
    let stt_model = req.stt_model.trim().chars().take(100).collect::<String>();
    if before.stt_url != stt_url { changed.insert("stt_url".into(), json!(stt_url)); }
    if before.stt_api_key != stt_key { changed.insert("stt_api_key".into(), json!(if stt_key.is_empty() { "cleared" } else { "set" })); }
    if before.stt_model != stt_model { changed.insert("stt_model".into(), json!(stt_model)); }
    let mut rate_limits: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for (k, v) in &req.rate_limits {
        let v = v.trim();
        if v.is_empty() { continue; }
        if !crate::ratelimit::BUCKETS.contains(&k.as_str()) {
            return Err(AppError::BadRequest(format!("Unknown rate limit bucket '{k}'")));
        }
        if crate::ratelimit::Limit::parse(v).is_none() {
            return Err(AppError::BadRequest(format!("Rate limit for {k} must be count/seconds, e.g. 10/5")));
        }
        rate_limits.insert(k.clone(), v.to_string());
    }
    if before.rate_limits != rate_limits { changed.insert("rate_limits".into(), json!(rate_limits)); }
    let av_addr = req.av_addr.trim().to_string();
    if !av_addr.is_empty() && (av_addr.contains('/') || !av_addr.contains(':')) {
        return Err(AppError::BadRequest("Antivirus address must be host:port, e.g. clamav:3310".into()));
    }
    if before.av_addr != av_addr { changed.insert("av_addr".into(), json!(av_addr)); }
    if before.av_fail_closed != req.av_fail_closed { changed.insert("av_fail_closed".into(), json!(req.av_fail_closed)); }
    if !changed.is_empty() {
        audit::record(&state, uid, "settings.update", "settings", None, "", Value::Object(changed)).await;
    }
    for (k, v) in [("registration_enabled", json!(req.registration_enabled)), ("announcement", json!(announcement)), ("require_email_verification", json!(req.require_email_verification)), ("livekit_url", json!(lk_url)), ("livekit_api_key", json!(lk_key)), ("livekit_api_secret", json!(lk_secret)), ("stt_url", json!(stt_url)), ("stt_api_key", json!(stt_key)), ("stt_model", json!(stt_model)), ("rate_limits", json!(rate_limits)), ("av_addr", json!(av_addr)), ("av_fail_closed", json!(req.av_fail_closed))] {
        sqlx::query("INSERT INTO instance_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(k).bind(v).execute(&state.db).await?;
    }
    let mut s = load_settings(&state.db).await?;
    crate::ratelimit::LIMITER.apply_overrides(&s.rate_limits);
    s.mail_enabled = crate::mail::enabled(&state.config);
    state.hub.emit_all("INSTANCE_UPDATE", json!(s.clone().public()));
    Ok(Json(s))
}

#[derive(Debug, Serialize, FromRow)]
struct AuditRow {
    id: Uuid,
    actor_id: Option<Uuid>,
    actor_name: String,
    action: String,
    target_kind: String,
    target_id: Option<Uuid>,
    target_name: String,
    details: Value,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct AuditQuery {
    #[serde(default)]
    q: String,
    /// Page by the id of the last row seen (ids are time-ordered v7 UUIDs).
    before: Option<Uuid>,
}

/// Newest first, 100 per page; `q` matches actor, action or target name.
async fn list_audit(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<AuditQuery>) -> AppResult<Json<Vec<AuditRow>>> {
    require_admin(&state, uid).await?;
    let rows = sqlx::query_as::<_, AuditRow>(
        "SELECT id, actor_id, actor_name, action, target_kind, target_id, target_name, details, created_at FROM admin_audit
         WHERE ($1::text IS NULL OR actor_name ILIKE $1 OR action ILIKE $1 OR target_name ILIKE $1)
           AND ($2::uuid IS NULL OR id < $2)
         ORDER BY id DESC LIMIT 100",
    )
    .bind(pattern(&q.q))
    .bind(q.before)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}
