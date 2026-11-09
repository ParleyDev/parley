//! The admin user page: what an account is and does (`GET /admin/users/:id/overview`, account metadata), and where it
//! has been seen from (`POST /admin/users/:id/signals`, the PII reveal: needs a justification and is logged). Every
//! address a signed-in client connects from is kept in `user_network_log` for `NETWORK_LOG_DAYS`.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{self, Entry, Justified, Perm},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

pub const NETWORK_LOG_DAYS: i32 = 90;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/users/:id/overview", get(overview))
        .route("/admin/users/:id/signals", post(signals))
}

/// A signed-in client connected from here (login, or a realtime connection). Bots and webhooks aren't tracked.
pub async fn seen(state: &AppState, uid: Uuid, headers: &HeaderMap, platform: &str) {
    let ip = crate::ratelimit::client_ip(headers);
    if ip == "unknown" { return }
    let ua: String = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("").chars().take(256).collect();
    let r = sqlx::query(
        "INSERT INTO user_network_log (user_id, ip, user_agent, platform) SELECT $1, $2, $3, $4 FROM users WHERE id = $1 AND NOT bot AND NOT webhook
         ON CONFLICT (user_id, ip, user_agent) DO UPDATE SET last_seen = now(), hits = user_network_log.hits + 1,
           platform = CASE WHEN EXCLUDED.platform = '' THEN user_network_log.platform ELSE EXCLUDED.platform END",
    ).bind(uid).bind(&ip).bind(&ua).bind(platform).execute(&state.db).await;
    if let Err(e) = r { tracing::warn!(error = ?e, "network log write failed") }
}

/// Daily: forget addresses not seen for `NETWORK_LOG_DAYS`.
pub async fn prune_loop(state: AppState) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(24 * 3600));
    loop {
        tick.tick().await;
        if let Err(e) = sqlx::query("DELETE FROM user_network_log WHERE last_seen < now() - make_interval(days => $1)").bind(NETWORK_LOG_DAYS).execute(&state.db).await {
            tracing::warn!(error = ?e, "network log prune failed");
        }
    }
}

async fn count(state: &AppState, sql: &str, id: Uuid) -> AppResult<i64> {
    Ok(sqlx::query_as::<_, (i64,)>(sql).bind(id).fetch_one(&state.db).await?.0)
}

/// `GET /admin/users/:id/overview`: the account, its activity and its standing. No PII: the email is masked unless
/// the admin's role sees it unmasked, and addresses are only counted.
async fn overview(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let a = admin_access::require_perm(&state, uid, Perm::AccountMetadataRead).await?;
    type Row = (String, String, Option<String>, Option<String>, DateTime<Utc>, String, Option<DateTime<Utc>>, Option<DateTime<Utc>>, bool, bool, bool, Option<DateTime<Utc>>, bool, String, Option<DateTime<Utc>>, String);
    let row: Option<Row> = sqlx::query_as(
        "SELECT username, display_name, avatar_url, email, created_at, account_state, deletion_scheduled_for, suspended_at, is_admin, bot, guest, guest_seen_at,
                totp_secret IS NOT NULL, status,
                email_verified_at,
                CASE WHEN birthdate IS NULL THEN 'unknown' WHEN birthdate > (now() - interval '18 years')::date THEN 'teen' ELSE 'adult' END
         FROM users WHERE id = $1",
    ).bind(id).fetch_optional(&state.db).await?;
    let Some((username, display_name, avatar_url, email, created_at, account_state, deletion_scheduled_for, suspended_at, is_admin, bot, guest, guest_seen_at, mfa, status, email_verified_at, age_group)) = row
        else { return Err(AppError::NotFound("User not found".into())) };
    let (custom_status,): (String,) = sqlx::query_as("SELECT custom_status FROM users WHERE id = $1").bind(id).fetch_one(&state.db).await?;
    let email = email.map(|e| if a.pii_unmasked() { e } else { admin_access::mask_email(&e) });
    let online = crate::ws::bus::online_users(&state.db).await.contains(&id);
    let platforms = crate::ws::bus::platforms_for(&state.db, id).await;
    let last_seen: Option<DateTime<Utc>> = sqlx::query_as::<_, (Option<DateTime<Utc>>,)>(
        "SELECT GREATEST((SELECT MAX(last_seen_at) FROM sessions WHERE user_id = $1), (SELECT MAX(last_seen) FROM user_network_log WHERE user_id = $1))",
    ).bind(id).fetch_one(&state.db).await?.0;

    // Messages: totals, where, and a 30-day daily series for the activity chart.
    let (total, in_servers, in_dms, day, week, month, first_at, last_at): (i64, i64, i64, i64, i64, i64, Option<DateTime<Utc>>, Option<DateTime<Utc>>) = sqlx::query_as(
        "SELECT COUNT(*), COUNT(*) FILTER (WHERE c.guild_id IS NOT NULL), COUNT(*) FILTER (WHERE c.guild_id IS NULL),
                COUNT(*) FILTER (WHERE m.created_at > now() - interval '1 day'), COUNT(*) FILTER (WHERE m.created_at > now() - interval '7 days'),
                COUNT(*) FILTER (WHERE m.created_at > now() - interval '30 days'), MIN(m.created_at), MAX(m.created_at)
         FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.author_id = $1 AND m.kind = 'default'",
    ).bind(id).fetch_one(&state.db).await?;
    let daily: Vec<(chrono::NaiveDate, i64)> = sqlx::query_as(
        "SELECT d::date, COALESCE((SELECT COUNT(*) FROM messages m WHERE m.author_id = $1 AND m.kind = 'default' AND m.created_at >= d AND m.created_at < d + interval '1 day'), 0)
         FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d ORDER BY d",
    ).bind(id).fetch_all(&state.db).await?;

    let servers = if a.has(Perm::ConversationMetadataRead) {
        let rows: Vec<(Uuid, String, Option<String>, bool, DateTime<Utc>)> = sqlx::query_as(
            "SELECT g.id, g.name, g.icon_url, g.owner_id = $1, m.joined_at FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.user_id = $1 ORDER BY m.joined_at DESC LIMIT 100",
        ).bind(id).fetch_all(&state.db).await?;
        Some(rows.into_iter().map(|(gid, name, icon, owner, joined)| json!({ "id": gid, "name": name, "icon_url": icon, "owner": owner, "joined_at": joined })).collect::<Vec<_>>())
    } else { None };
    // What admins did to (or looked up about) this account, from the audit log: only for those who may read all of it.
    let audit: Vec<(String, String, Value, DateTime<Utc>)> = if a.has(Perm::AuditReadAll) {
        sqlx::query_as(
            "SELECT l.action, COALESCE(au.username, ''), l.filters, l.at FROM admin_access_log l LEFT JOIN users au ON au.id = l.actor_id
             WHERE $1 = ANY(l.target_ids) ORDER BY l.at DESC LIMIT 20",
        ).bind(id).fetch_all(&state.db).await?
    } else { Vec::new() };
    let push: Vec<(String, i64, Option<DateTime<Utc>>)> = sqlx::query_as("SELECT platform, COUNT(*), MAX(seen_at) FROM push_tokens WHERE user_id = $1 GROUP BY platform ORDER BY platform").bind(id).fetch_all(&state.db).await?;

    Ok(Json(json!({
        "user": {
            "id": id, "username": username, "display_name": display_name, "avatar_url": avatar_url, "email": email,
            "email_verified_at": email_verified_at, "created_at": created_at, "account_state": account_state, "deletion_scheduled_for": deletion_scheduled_for,
            "suspended_at": suspended_at, "is_admin": is_admin, "bot": bot, "guest": guest, "guest_seen_at": guest_seen_at, "mfa_enabled": mfa,
            "status": status, "custom_status": custom_status, "age_group": age_group, "online": online, "platforms": platforms, "last_seen_at": last_seen,
        },
        "messages": {
            "total": total, "in_servers": in_servers, "in_dms": in_dms, "last_day": day, "last_week": week, "last_month": month,
            "first_at": first_at, "last_at": last_at, "daily": daily.into_iter().map(|(d, n)| json!({ "day": d, "count": n })).collect::<Vec<_>>(),
            "reactions": count(&state, "SELECT COUNT(*) FROM reactions WHERE user_id = $1", id).await?,
        },
        "social": {
            "servers": count(&state, "SELECT COUNT(*) FROM guild_members WHERE user_id = $1", id).await?,
            "servers_owned": count(&state, "SELECT COUNT(*) FROM guilds WHERE owner_id = $1 AND state = 'active'", id).await?,
            "friends": count(&state, "SELECT COUNT(*) FROM relationships WHERE user_id = $1 AND kind = 'friend'", id).await?,
            "blocked": count(&state, "SELECT COUNT(*) FROM relationships WHERE user_id = $1 AND kind = 'blocked'", id).await?,
            "blocked_by": count(&state, "SELECT COUNT(*) FROM relationships WHERE target_id = $1 AND kind = 'blocked'", id).await?,
            "apps_owned": count(&state, "SELECT COUNT(*) FROM applications WHERE owner_id = $1", id).await?,
            "server_list": servers,
        },
        "standing": {
            "reports_against": count(&state, "SELECT COUNT(*) FROM reports WHERE target_user_id = $1", id).await?,
            "reports_open": count(&state, "SELECT COUNT(*) FROM reports WHERE target_user_id = $1 AND status = 'open'", id).await?,
            "reports_filed": count(&state, "SELECT COUNT(*) FROM reports WHERE reporter_id = $1", id).await?,
            "server_bans": count(&state, "SELECT COUNT(*) FROM guild_bans WHERE user_id = $1", id).await?,
            "audit": audit.into_iter().map(|(action, actor, details, at)| json!({ "action": action, "actor": actor, "details": details, "at": at })).collect::<Vec<_>>(),
        },
        "storage": {
            "attachments": count(&state, "SELECT COUNT(*) FROM attachments WHERE uploader_id = $1", id).await?,
            "attachment_bytes": count(&state, "SELECT COALESCE(SUM(size), 0)::bigint FROM attachments WHERE uploader_id = $1", id).await?,
            "images": count(&state, "SELECT COUNT(*) FROM images WHERE owner_id = $1", id).await?,
            "image_bytes": count(&state, "SELECT COALESCE(SUM(size), 0)::bigint FROM images WHERE owner_id = $1", id).await?,
        },
        "devices": {
            "active_sessions": count(&state, "SELECT COUNT(*) FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND created_at > now() - interval '30 days'", id).await?,
            "addresses": count(&state, "SELECT COUNT(DISTINCT ip) FROM user_network_log WHERE user_id = $1", id).await?,
            "clients": count(&state, "SELECT COUNT(DISTINCT user_agent) FROM user_network_log WHERE user_id = $1", id).await?,
            "passkeys": count(&state, "SELECT COUNT(*) FROM passkeys WHERE user_id = $1", id).await?,
            "connections": count(&state, "SELECT COUNT(*) FROM connections WHERE user_id = $1", id).await?,
            "authorized_apps": count(&state, "SELECT COUNT(DISTINCT app_id) FROM oauth_tokens WHERE user_id = $1", id).await?,
            "push": push.into_iter().map(|(p, n, at)| json!({ "platform": p, "count": n, "seen_at": at })).collect::<Vec<_>>(),
        },
        "can_reveal": a.has(Perm::AccountPiiReveal),
    })))
}

/// `POST /admin/users/:id/signals {justification}`: everything that identifies where and on what the account is
/// used: the unmasked email, every address and client seen in the last 90 days, push devices, linked accounts
/// elsewhere, and other accounts seen on the same addresses. PII reveal; logged with the reason.
async fn signals(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path(id): Path<Uuid>, Json(j): Json<Justified>) -> AppResult<Json<Value>> {
    let a = admin_access::require_perm(&state, uid, Perm::AccountPiiReveal).await?;
    let why = admin_access::justification(j.justification.as_deref())?;
    let (email,): (Option<String>,) = sqlx::query_as("SELECT email FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("User not found".into()))?;
    let addresses: Vec<(String, i64, i64, DateTime<Utc>, DateTime<Utc>, i64)> = sqlx::query_as(
        "SELECT l.ip, SUM(l.hits)::bigint, COUNT(DISTINCT l.user_agent), MIN(l.first_seen), MAX(l.last_seen),
                (SELECT COUNT(DISTINCT o.user_id) FROM user_network_log o WHERE o.ip = l.ip AND o.user_id <> $1)
         FROM user_network_log l WHERE l.user_id = $1 GROUP BY l.ip ORDER BY MAX(l.last_seen) DESC LIMIT 200",
    ).bind(id).fetch_all(&state.db).await?;
    let clients: Vec<(String, String, i64, DateTime<Utc>, DateTime<Utc>, i64)> = sqlx::query_as(
        "SELECT user_agent, MAX(platform), SUM(hits)::bigint, MIN(first_seen), MAX(last_seen), COUNT(DISTINCT ip) FROM user_network_log WHERE user_id = $1 GROUP BY user_agent ORDER BY MAX(last_seen) DESC LIMIT 100",
    ).bind(id).fetch_all(&state.db).await?;
    let shared: Vec<(Uuid, String, String, DateTime<Utc>, String, Option<DateTime<Utc>>, bool, Vec<String>)> = sqlx::query_as(
        "SELECT u.id, u.username, u.display_name, u.created_at, u.account_state, u.suspended_at, u.guest, array_agg(DISTINCT o.ip ORDER BY o.ip)
         FROM user_network_log o JOIN users u ON u.id = o.user_id
         WHERE o.user_id <> $1 AND o.ip IN (SELECT ip FROM user_network_log WHERE user_id = $1)
         GROUP BY u.id ORDER BY MAX(o.last_seen) DESC LIMIT 50",
    ).bind(id).fetch_all(&state.db).await?;
    let connections: Vec<(String, String, String, DateTime<Utc>)> = sqlx::query_as("SELECT provider, name, url, created_at FROM connections WHERE user_id = $1 ORDER BY provider").bind(id).fetch_all(&state.db).await?;
    let push: Vec<(String, DateTime<Utc>, DateTime<Utc>)> = sqlx::query_as("SELECT platform, created_at, seen_at FROM push_tokens WHERE user_id = $1 ORDER BY seen_at DESC").bind(id).fetch_all(&state.db).await?;
    let passkeys: Vec<(String, DateTime<Utc>)> = sqlx::query_as("SELECT name, created_at FROM passkeys WHERE user_id = $1 ORDER BY created_at").bind(id).fetch_all(&state.db).await?;
    admin_access::log(&state, uid, &a.roles, &headers, Entry { action: "pii.signals", query: "", filters: json!({}), justification: &why, targets: &[id] }).await?;
    Ok(Json(json!({
        "email": email,
        "email_domain": email.as_deref().and_then(|e| e.split_once('@')).map(|(_, d)| d.to_lowercase()),
        "addresses": addresses.into_iter().map(|(ip, hits, clients, first, last, others)| json!({ "ip": ip, "hits": hits, "clients": clients, "first_seen": first, "last_seen": last, "other_accounts": others })).collect::<Vec<_>>(),
        "clients": clients.into_iter().map(|(ua, platform, hits, first, last, ips)| json!({ "user_agent": ua, "platform": platform, "hits": hits, "first_seen": first, "last_seen": last, "addresses": ips })).collect::<Vec<_>>(),
        "shared": shared.into_iter().map(|(sid, username, display_name, created, st, suspended, guest, ips)| json!({ "id": sid, "username": username, "display_name": display_name, "created_at": created, "account_state": st, "suspended_at": suspended, "guest": guest, "ips": ips })).collect::<Vec<_>>(),
        "connections": connections.into_iter().map(|(p, name, url, at)| json!({ "provider": p, "name": name, "url": url, "created_at": at })).collect::<Vec<_>>(),
        "push": push.into_iter().map(|(p, created, seen)| json!({ "platform": p, "created_at": created, "seen_at": seen })).collect::<Vec<_>>(),
        "passkeys": passkeys.into_iter().map(|(name, at)| json!({ "name": name, "created_at": at })).collect::<Vec<_>>(),
        "retention_days": NETWORK_LOG_DAYS,
    })))
}
