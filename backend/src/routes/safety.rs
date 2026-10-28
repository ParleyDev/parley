//! Safety: raid protection (join spikes pause invites and alert moderators), quarantine (a moderator makes a member
//! read-only until released), a cool-down for mass DMs, and the instance's malicious-link blocklist.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::Channel,
    perms,
    state::AppState,
};
use axum::{extract::{Path, State}, http::StatusCode, routing::{delete, get, post}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/members/:uid/quarantine", post(quarantine))
        .route("/admin/blocked-domains", get(list_domains).post(add_domain))
        .route("/admin/blocked-domains/:domain", delete(remove_domain))
}

/// After someone joins: if more than the server's raid threshold joined in the last minute, flag them, pause
/// invites (once) and tell the moderators.
pub async fn after_join(state: &AppState, gid: Uuid, uid: Uuid) {
    let Ok(Some((on, threshold, paused, alert, system))) = sqlx::query_as::<_, (bool, i32, bool, Option<Uuid>, Option<Uuid>)>(
        "SELECT raid_protection, raid_threshold, invites_paused, safety_alerts_channel_id, system_channel_id FROM guilds WHERE id = $1").bind(gid).fetch_optional(&state.db).await else { return };
    if !on { return }
    let (recent,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM guild_members WHERE guild_id = $1 AND joined_at > now() - interval '60 seconds'").bind(gid).fetch_one(&state.db).await.unwrap_or((0,));
    if recent < threshold as i64 { return }
    // Everyone who arrived in the spike gets the raid flag, for moderators to review.
    let _ = sqlx::query("UPDATE guild_members SET flags = array_append(flags, 'raid') WHERE guild_id = $1 AND joined_at > now() - interval '60 seconds' AND NOT ('raid' = ANY(flags))").bind(gid).execute(&state.db).await;
    if let Ok(m) = crate::routes::guilds::fetch_member(&state.db, gid, uid).await { state.hub.emit_guild(gid, "GUILD_MEMBER_UPDATE", json!(m)); }
    if paused { return }
    if sqlx::query("UPDATE guilds SET invites_paused = true WHERE id = $1 AND NOT invites_paused").bind(gid).execute(&state.db).await.map(|r| r.rows_affected()).unwrap_or(0) == 0 { return }
    if let Ok(g) = sqlx::query_as::<_, crate::models::Guild>(&format!("SELECT {} FROM guilds WHERE id = $1", crate::routes::guilds::GUILD_COLS)).bind(gid).fetch_one(&state.db).await {
        state.hub.emit_guild(gid, "GUILD_UPDATE", json!(g));
    }
    let target = match alert.or(system) {
        Some(c) => Some(c),
        None => sqlx::query_as::<_, (Uuid,)>("SELECT id FROM channels WHERE guild_id = $1 AND kind = 'text' ORDER BY position, created_at LIMIT 1").bind(gid).fetch_optional(&state.db).await.ok().flatten().map(|r| r.0),
    };
    if let Some(cid) = target {
        if let Ok(ch) = sqlx::query_as::<_, Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS)).bind(cid).fetch_one(&state.db).await {
            let text = format!("**Raid alert** · {recent} people joined in the last minute, so invites are paused. Review new members (they're flagged) and resume invites in Server Settings › Safety.");
            let _ = crate::routes::channels::system_message(state, &ch, uid, "automod_alert", &text, vec![], None, None).await;
        }
    }
    let name = crate::audit::guild_name(state, gid).await;
    crate::audit::guild(state, gid, uid, "safety.raid", "guild", Some(gid), &name, json!({ "joins_last_minute": recent })).await;
}

#[derive(Deserialize)]
struct QuarantineReq { on: bool }

/// `POST /guilds/:id/members/:uid/quarantine`: make a member read-only (or release them). Time Out or Kick Members.
async fn quarantine(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, target)): Path<(Uuid, Uuid)>, Json(req): Json<QuarantineReq>) -> AppResult<StatusCode> {
    let (ctx, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check_any(p, perms::MODERATE_MEMBERS | perms::KICK_MEMBERS)?;
    if !ctx.is_member(target) { return Err(AppError::NotFound("Member not found".into())) }
    if target == uid || ctx.is_owner(target) || !ctx.outranks_member(uid, target) { return Err(AppError::Forbidden) }
    let before = perms::visibility(&state.db, gid).await?;
    sqlx::query("UPDATE guild_members SET quarantined = $3, flags = CASE WHEN $3 THEN flags ELSE array_remove(flags, 'raid') END WHERE guild_id = $1 AND user_id = $2").bind(gid).bind(target).bind(req.on).execute(&state.db).await?;
    perms::resync_visibility(&state, gid, &before).await?;
    let m = crate::routes::guilds::fetch_member(&state.db, gid, target).await?;
    state.hub.emit_guild(gid, "GUILD_MEMBER_UPDATE", json!(m));
    crate::audit::guild(&state, gid, uid, if req.on { "member.quarantine" } else { "member.quarantine_remove" }, "user", Some(target), &m.username, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Refuse a message carrying a link to a blocklisted domain (or any of its subdomains).
pub async fn check_links(state: &AppState, content: &str) -> AppResult<()> {
    if !content.contains("://") && !content.contains('.') { return Ok(()) }
    let hosts: Vec<String> = content.split_whitespace().filter_map(|w| {
        let w = w.trim_matches(|c: char| "<>()[]\"'".contains(c));
        let w = if w.contains("://") { w.to_string() } else { return None };
        url::Url::parse(&w).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_lowercase()))
    }).collect();
    if hosts.is_empty() { return Ok(()) }
    let blocked: Option<(String,)> = sqlx::query_as("SELECT domain FROM blocked_domains WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) h WHERE h = domain OR h LIKE '%.' || domain) LIMIT 1")
        .bind(&hosts).fetch_optional(&state.db).await?;
    if let Some((d,)) = blocked { return Err(AppError::Blocked(format!("That link is blocked: {d} is a known malicious site."))) }
    Ok(())
}

/// New conversations: someone posting into lots of different DMs in a short time is cooled down for an hour.
pub async fn check_dm_spam(state: &AppState, uid: Uuid, channel_id: Uuid) -> AppResult<()> {
    let (until,): (Option<chrono::DateTime<chrono::Utc>>,) = sqlx::query_as("SELECT dm_spam_until FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if until.map(|u| u > chrono::Utc::now()).unwrap_or(false) { return Err(AppError::TooMany("You've messaged a lot of people at once. Try again later.".into())) }
    let (n,): (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT m.channel_id) FROM messages m JOIN channels c ON c.id = m.channel_id
         WHERE m.author_id = $1 AND c.guild_id IS NULL AND m.created_at > now() - interval '10 minutes' AND m.channel_id <> $2")
        .bind(uid).bind(channel_id).fetch_one(&state.db).await?;
    if n >= 15 {
        sqlx::query("UPDATE users SET dm_spam_until = now() + interval '1 hour' WHERE id = $1").bind(uid).execute(&state.db).await?;
        crate::audit::record(state, uid, "safety.dm_spam", "user", Some(uid), "", json!({ "dm_channels_10m": n + 1 })).await;
        return Err(AppError::TooMany("You've messaged a lot of people at once. Try again later.".into()));
    }
    Ok(())
}

async fn list_domains(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Value>>> {
    crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::InstanceManage).await?;
    let rows: Vec<(String, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as("SELECT domain, reason, created_at FROM blocked_domains ORDER BY domain").fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(d, r, t)| json!({ "domain": d, "reason": r, "created_at": t })).collect()))
}

#[derive(Deserialize)]
struct DomainReq { domain: String, #[serde(default)] reason: String }

async fn add_domain(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<DomainReq>) -> AppResult<StatusCode> {
    crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::InstanceManage).await?;
    let d = req.domain.trim().trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.").trim_end_matches('/').to_lowercase();
    if d.is_empty() || !d.contains('.') || d.contains('/') || d.len() > 253 { return Err(AppError::BadRequest("Give a domain like bad.example".into())) }
    sqlx::query("INSERT INTO blocked_domains (domain, reason, added_by) VALUES ($1, $2, $3) ON CONFLICT (domain) DO UPDATE SET reason = EXCLUDED.reason").bind(&d).bind(req.reason.trim()).bind(uid).execute(&state.db).await?;
    crate::audit::record(&state, uid, "safety.block_domain", "domain", None, &d, json!({ "reason": req.reason })).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_domain(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(domain): Path<String>) -> AppResult<StatusCode> {
    crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::InstanceManage).await?;
    sqlx::query("DELETE FROM blocked_domains WHERE domain = $1").bind(domain.to_lowercase()).execute(&state.db).await?;
    crate::audit::record(&state, uid, "safety.unblock_domain", "domain", None, &domain, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}
