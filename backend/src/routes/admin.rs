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
        .route("/admin/guilds", get(list_guilds))
        .route("/admin/guilds/:id", delete(delete_guild))
        .route("/admin/settings", get(get_settings).put(put_settings))
        .route("/admin/mail", get(admin_mail))
        .route("/admin/audit", get(list_audit))
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
}

pub async fn load_settings(db: &PgPool) -> AppResult<InstanceSettings> {
    let rows: Vec<(String, Value)> = sqlx::query_as("SELECT key, value FROM instance_settings").fetch_all(db).await?;
    let mut s = InstanceSettings { registration_enabled: true, announcement: String::new(), require_email_verification: false, mail_enabled: false };
    for (k, v) in rows {
        match k.as_str() {
            "registration_enabled" => s.registration_enabled = v.as_bool().unwrap_or(true),
            "announcement" => s.announcement = v.as_str().unwrap_or("").to_string(),
            "require_email_verification" => s.require_email_verification = v.as_bool().unwrap_or(false),
            _ => {}
        }
    }
    Ok(s)
}

/// Public (no auth): what the login page and the app banner need.
async fn instance_public(State(state): State<AppState>) -> AppResult<Json<InstanceSettings>> {
    let mut s = load_settings(&state.db).await?;
    s.mail_enabled = crate::mail::enabled(&state.config);
    Ok(Json(s))
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
    guild_count: i64,
    #[sqlx(skip)]
    online: bool,
}

fn pattern(q: &str) -> Option<String> {
    let t = q.trim().replace('%', "\\%").replace('_', "\\_");
    if t.is_empty() { None } else { Some(format!("%{t}%")) }
}

async fn list_users(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<ListQuery>) -> AppResult<Json<Vec<AdminUser>>> {
    require_admin(&state, uid).await?;
    let mut rows = sqlx::query_as::<_, AdminUser>(
        "SELECT u.id, u.username, u.display_name, u.email, u.created_at, u.is_admin, u.suspended_at, (u.totp_secret IS NOT NULL) AS mfa_enabled,
                (SELECT COUNT(*) FROM guild_members m WHERE m.user_id = u.id) AS guild_count
         FROM users u WHERE ($1::text IS NULL OR u.username ILIKE $1 OR u.display_name ILIKE $1 OR u.email ILIKE $1)
         ORDER BY u.created_at DESC LIMIT 200",
    )
    .bind(pattern(&q.q))
    .fetch_all(&state.db)
    .await?;
    let online = crate::ws::bus::online_users(&state.db).await;
    for r in &mut rows { r.online = online.contains(&r.id) }
    Ok(Json(rows))
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
        sqlx::query("UPDATE users SET is_admin = $2 WHERE id = $1").bind(id).bind(admin).execute(&state.db).await?;
        audit::record(&state, uid, if admin { "user.promote" } else { "user.demote" }, "user", Some(id), &audit::username(&state, id).await, json!({})).await;
    }
    if let Some(suspended) = req.suspended {
        if suspended && id == uid { return Err(AppError::BadRequest("You cannot suspend yourself".into())); }
        sqlx::query("UPDATE users SET suspended_at = CASE WHEN $2 THEN COALESCE(suspended_at, now()) ELSE NULL END WHERE id = $1").bind(id).bind(suspended).execute(&state.db).await?;
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
                (SELECT COUNT(*) FROM messages ms JOIN channels c ON c.id = ms.channel_id WHERE c.guild_id = g.id) AS message_count,
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
    if !changed.is_empty() {
        audit::record(&state, uid, "settings.update", "settings", None, "", Value::Object(changed)).await;
    }
    for (k, v) in [("registration_enabled", json!(req.registration_enabled)), ("announcement", json!(announcement)), ("require_email_verification", json!(req.require_email_verification))] {
        sqlx::query("INSERT INTO instance_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(k).bind(v).execute(&state.db).await?;
    }
    let mut s = load_settings(&state.db).await?;
    s.mail_enabled = crate::mail::enabled(&state.config);
    state.hub.emit_all("INSTANCE_UPDATE", json!(s));
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
