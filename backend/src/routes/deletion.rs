//! Account deletion: soft delete, then anonymize (docs/account-deletion.md).
//!
//! Asking to delete moves the account to `pending_deletion` for `ACCOUNT_DELETION_GRACE_DAYS` (14): every session,
//! app grant and push subscription dies at once and the profile is hidden. Signing in before the date offers to
//! restore it. After the date, `finalize_due` (a loop on every replica; rows are claimed with SKIP LOCKED) scrubs the
//! account in one transaction: the row stays under the same id, so messages and other content keep pointing at it
//! and show as "Deleted User", while everything personal is cleared or deleted and its files removed. Nothing maps
//! the placeholder back to the person, and finalizing an already-deleted account does nothing.
use crate::{
    auth::{issue_typed, verify_typed, AuthUser},
    error::{AppError, AppResult},
    state::AppState,
};
use axum::{extract::State, http::HeaderMap, routing::{get, post}, Json, Router};
use chrono::{DateTime, Duration, Utc};
use rand::{distributions::Alphanumeric, rngs::OsRng, Rng};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{Postgres, Transaction};
use std::path::PathBuf;
use uuid::Uuid;

/// What a deleted account's display name becomes.
pub const DELETED_NAME: &str = "Deleted User";
/// Placeholder usernames start with this; nobody can pick a name that does.
pub const DELETED_PREFIX: &str = "deleted_user_";
/// How long an email stays blocked from signing up again after an account deleted while banned or suspended.
const EVASION_BLOCK_DAYS: i64 = 90;
/// How long the restore ticket from a sign-in is good for.
const RESTORE_TICKET_MINUTES: i64 = 15;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/deletion", get(status).post(request))
        .route("/auth/restore", post(restore))
        .route("/admin/deletions/run", post(run_now))
}

/// `POST /admin/deletions/run` (instance admins): finalize every due deletion now instead of at the next run.
async fn run_now(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::InstanceManage).await?;
    Ok(Json(json!({ "finalized": finalize_due(&state).await? })))
}

/// `deleted_user_` and 12 random letters and digits from the OS generator: not derived from anything about the person.
pub fn placeholder_username() -> String {
    let tail: String = OsRng.sample_iter(&Alphanumeric).take(12).map(|c| (c as char).to_ascii_lowercase()).collect();
    format!("{DELETED_PREFIX}{tail}")
}

/// Whether a chosen username would look like a deleted account's placeholder.
pub fn reserved_username(u: &str) -> bool { u.to_ascii_lowercase().starts_with(DELETED_PREFIX) }

/// Keyed hash of an email for the ban-evasion block (never stored next to the account).
fn email_block_hash(secret: &str, email: &str) -> String {
    use hmac::{Hmac, Mac};
    let mut mac = <Hmac<sha2::Sha256> as Mac>::new_from_slice(format!("parley-deletion-block:{secret}").as_bytes()).expect("any key length");
    mac.update(email.trim().to_lowercase().as_bytes());
    mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

/// Signing up (or changing to) an email blocked after an account was deleted to dodge a ban.
pub async fn email_blocked(state: &AppState, email: &str) -> AppResult<bool> {
    let row: Option<(bool,)> = sqlx::query_as("SELECT true FROM deletion_email_blocks WHERE email_hash = $1 AND expires_at > now()")
        .bind(email_block_hash(&state.config.jwt_secret, email)).fetch_optional(&state.db).await?;
    Ok(row.is_some())
}

/// What stands in the way of deleting: servers you own, and apps (bots) you own. Transfer or delete them first.
async fn blockers(state: &AppState, uid: Uuid) -> AppResult<Value> {
    let guilds: Vec<(Uuid, String, Option<String>)> = sqlx::query_as("SELECT id, name, icon_url FROM guilds WHERE owner_id = $1 ORDER BY name").bind(uid).fetch_all(&state.db).await?;
    let apps: Vec<(Uuid, String)> = sqlx::query_as("SELECT id, name FROM applications WHERE owner_id = $1 ORDER BY name").bind(uid).fetch_all(&state.db).await?;
    let (sole_admin,): (bool,) = sqlx::query_as("SELECT u.is_admin AND NOT EXISTS (SELECT 1 FROM users o WHERE o.is_admin AND o.id <> u.id AND o.account_state = 'active') FROM users u WHERE u.id = $1")
        .bind(uid).fetch_one(&state.db).await?;
    Ok(json!({
        "guilds": guilds.iter().map(|(id, n, i)| json!({ "id": id, "name": n, "icon_url": i })).collect::<Vec<_>>(),
        "apps": apps.iter().map(|(id, n)| json!({ "id": id, "name": n })).collect::<Vec<_>>(),
        "sole_admin": sole_admin,
    }))
}

/// `GET /users/@me/deletion`: the grace period and anything that has to be dealt with first.
async fn status(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    Ok(Json(json!({ "grace_days": state.config.deletion_grace_days, "blockers": blockers(&state, uid).await? })))
}

#[derive(Deserialize)]
pub struct RequestIn { pub password: String, #[serde(default)] pub code: Option<String> }

/// `POST /users/@me/deletion` (password, and the second factor when on): schedule the account for deletion.
async fn request(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<RequestIn>) -> AppResult<Json<Value>> {
    crate::routes::mfa::check_password_and_factor(&state, uid, &req.password, req.code.as_deref()).await?;
    let at = request_deletion(&state, uid).await?;
    Ok(Json(json!({ "scheduled_for": at })))
}

/// Move an account to `pending_deletion`, refusing while it owns servers or apps or is the last admin. Kills every way
/// in (sessions, app grants, QR logins) and every push subscription, and drops it from voice.
pub async fn request_deletion(state: &AppState, uid: Uuid) -> AppResult<DateTime<Utc>> {
    let b = blockers(state, uid).await?;
    if b["sole_admin"].as_bool().unwrap_or(false) {
        return Err(AppError::BadRequest("You are the only admin. Make someone else an admin before deleting your account.".into()));
    }
    let (ng, na) = (b["guilds"].as_array().map_or(0, |a| a.len()), b["apps"].as_array().map_or(0, |a| a.len()));
    if ng > 0 || na > 0 {
        return Err(AppError::BadRequest(match (ng, na) {
            (_, 0) => "Transfer or delete the servers you own before deleting your account.".into(),
            (0, _) => "Delete the apps you own (Settings › Applications) before deleting your account.".into(),
            _ => "Transfer or delete the servers and apps you own before deleting your account.".into(),
        }));
    }
    let at = Utc::now() + Duration::days(state.config.deletion_grace_days);
    let mut tx = state.db.begin().await?;
    let done = sqlx::query("UPDATE users SET account_state = 'pending_deletion', deletion_requested_at = now(), deletion_scheduled_for = $2, status = 'offline' WHERE id = $1 AND account_state = 'active'")
        .bind(uid).bind(at).execute(&mut *tx).await?;
    if done.rows_affected() == 0 { return Err(AppError::BadRequest("This account is already being deleted".into())) }
    for table in ["oauth_tokens", "oauth_codes", "mcp_grants", "mcp_codes", "qr_logins", "push_tokens", "web_push_subs", "presence"] {
        sqlx::query(&format!("DELETE FROM {table} WHERE user_id = $1")).bind(uid).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    crate::auth::revoke_sessions(state, uid, None, None, "Your account is scheduled for deletion.").await?;
    state.hub.voice_evict(|v| v.user_id == uid);
    state.hub.emit_all("PRESENCE_UPDATE", json!({ "user_id": uid, "status": "offline" }));
    Ok(at)
}

/// Sign-in for an account waiting to be deleted: no session, but the date and a ticket to restore it.
pub async fn pending_login(state: &AppState, uid: Uuid) -> AppResult<Option<Value>> {
    let row: Option<(DateTime<Utc>,)> = sqlx::query_as("SELECT deletion_scheduled_for FROM users WHERE id = $1 AND account_state = 'pending_deletion'").bind(uid).fetch_optional(&state.db).await?;
    let Some((at,)) = row else { return Ok(None) };
    let ticket = issue_typed(&state.config.jwt_secret, uid, "restore", RESTORE_TICKET_MINUTES).map_err(AppError::Other)?;
    Ok(Some(json!({ "pending_deletion": true, "scheduled_for": at, "restore_ticket": ticket })))
}

#[derive(Deserialize)]
struct RestoreIn { ticket: String }

/// `POST /auth/restore`: cancel the deletion and sign in.
async fn restore(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<RestoreIn>) -> AppResult<Json<Value>> {
    let uid = verify_typed(&state.config.jwt_secret, &req.ticket, "restore").ok_or_else(|| AppError::BadRequest("That sign-in expired. Sign in again to restore your account.".into()))?;
    let back = sqlx::query("UPDATE users SET account_state = 'active', deletion_requested_at = NULL, deletion_scheduled_for = NULL WHERE id = $1 AND account_state = 'pending_deletion'")
        .bind(uid).execute(&state.db).await?;
    if back.rows_affected() == 0 { return Err(AppError::BadRequest("This account can no longer be restored.".into())) }
    crate::routes::auth::session(&state, uid, &headers).await
}

/// Background loop: finalize accounts whose grace period is over, every ten minutes (and right away at start).
pub async fn finalize_loop(state: AppState) {
    loop {
        match finalize_due(&state).await {
            Ok(n) if n > 0 => tracing::info!(accounts = n, "finalized account deletions"),
            Ok(_) => {}
            Err(e) => tracing::warn!(error = ?e, "account deletion run failed"),
        }
        tokio::time::sleep(std::time::Duration::from_secs(600)).await;
    }
}

/// Finalize every account that is due. Each is claimed with `FOR UPDATE SKIP LOCKED`, so replicas running this at
/// the same time never take the same account, and a failure leaves it pending for the next run.
pub async fn finalize_due(state: &AppState) -> AppResult<usize> {
    let mut n = 0;
    for _ in 0..200 {
        let mut tx = state.db.begin().await?;
        let due: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE account_state = 'pending_deletion' AND deletion_scheduled_for <= now() ORDER BY deletion_scheduled_for LIMIT 1 FOR UPDATE SKIP LOCKED")
            .fetch_optional(&mut *tx).await?;
        let Some((uid,)) = due else { break };
        let done = scrub(state, &mut tx, uid).await?;
        tx.commit().await?;
        after(state, uid, done).await;
        n += 1;
    }
    Ok(n)
}

/// Finalize one account now, whatever its state (an admin deleting it). Returns false when it was already deleted.
pub async fn finalize_now(state: &AppState, uid: Uuid) -> AppResult<bool> {
    let mut tx = state.db.begin().await?;
    let row: Option<(String,)> = sqlx::query_as("SELECT account_state FROM users WHERE id = $1 FOR UPDATE").bind(uid).fetch_optional(&mut *tx).await?;
    match row {
        None => return Err(AppError::NotFound("User not found".into())),
        Some((s,)) if s == "deleted" => return Ok(false),
        _ => {}
    }
    let done = scrub(state, &mut tx, uid).await?;
    tx.commit().await?;
    after(state, uid, done).await;
    Ok(true)
}

/// What to clean up once the transaction has committed.
struct Scrubbed { files: Vec<PathBuf>, guilds: Vec<Uuid> }

/// `/api/images/<uuid>` (or a bare uuid) → the image id.
fn image_id(url: &str) -> Option<Uuid> { url.trim_end_matches('/').rsplit('/').next().and_then(|s| Uuid::parse_str(s).ok()) }

/// Scrub one account inside `tx` (which holds its row lock). See the field list in docs/account-deletion.md.
async fn scrub(state: &AppState, tx: &mut Transaction<'_, Postgres>, uid: Uuid) -> AppResult<Scrubbed> {
    let (email, suspended, avatar, banner, history): (Option<String>, bool, Option<String>, Option<String>, Vec<String>) = sqlx::query_as(
        "SELECT email, suspended_at IS NOT NULL, avatar_url, banner_url, COALESCE(avatar_history, '{}') FROM users WHERE id = $1").bind(uid).fetch_one(&mut **tx).await?;
    // Ban evasion: an account deleted while suspended or banned from a server keeps a keyed hash of its email, for a while.
    let (banned,): (bool,) = sqlx::query_as("SELECT EXISTS (SELECT 1 FROM guild_bans WHERE user_id = $1)").bind(uid).fetch_one(&mut **tx).await?;
    if let Some(e) = email.as_deref().filter(|e| !e.is_empty()) {
        if suspended || banned {
            sqlx::query("INSERT INTO deletion_email_blocks (email_hash, expires_at) VALUES ($1, now() + make_interval(days => $2)) ON CONFLICT (email_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at")
                .bind(email_block_hash(&state.config.jwt_secret, e)).bind(EVASION_BLOCK_DAYS as i32).execute(&mut **tx).await?;
        }
        sqlx::query("DELETE FROM mail_log WHERE lower(to_addr) = lower($1)").bind(e).execute(&mut **tx).await?;
    }

    // Their avatar and banner (current and past): rows now, files after commit. Server emoji/stickers they made stay.
    let mut ids: Vec<Uuid> = avatar.iter().chain(banner.iter()).chain(history.iter()).filter_map(|u| image_id(u)).collect();
    let owned: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM images WHERE owner_id = $1 AND kind IN ('avatar', 'banner')").bind(uid).fetch_all(&mut **tx).await?;
    ids.extend(owned.into_iter().map(|r| r.0));
    ids.sort(); ids.dedup();
    let gone: Vec<(Uuid,)> = sqlx::query_as("DELETE FROM images WHERE id = ANY($1) AND (owner_id = $2 OR kind IN ('avatar', 'banner')) RETURNING id").bind(&ids).bind(uid).fetch_all(&mut **tx).await?;
    let mut files: Vec<PathBuf> = gone.iter().map(|(id,)| state.config.upload_dir.join(id.to_string())).collect();
    let exports: Vec<(Uuid,)> = sqlx::query_as("DELETE FROM data_exports WHERE user_id = $1 RETURNING id").bind(uid).fetch_all(&mut **tx).await?;
    files.extend(exports.iter().map(|(id,)| crate::routes::account::export_path(state, *id)));

    // Servers they leave (for GUILD_MEMBER_REMOVE once committed).
    let guilds: Vec<(Uuid,)> = sqlx::query_as("SELECT guild_id FROM guild_members WHERE user_id = $1").bind(uid).fetch_all(&mut **tx).await?;

    // Personal rows, and rows that mean nothing without the person.
    for (table, col) in [
        ("sessions", "user_id"), ("oauth_tokens", "user_id"), ("oauth_codes", "user_id"), ("mcp_grants", "user_id"), ("mcp_codes", "user_id"),
        ("qr_logins", "user_id"), ("passkeys", "user_id"), ("webauthn_challenges", "user_id"), ("mfa_backup_codes", "user_id"), ("email_tokens", "user_id"),
        ("push_tokens", "user_id"), ("web_push_subs", "user_id"), ("connections", "user_id"), ("user_role_connections", "user_id"), ("user_app_installs", "user_id"),
        ("notification_settings", "user_id"), ("read_states", "user_id"), ("bookmarks", "user_id"), ("user_notes", "user_id"), ("user_notes", "target_id"),
        ("relationships", "user_id"), ("relationships", "target_id"), ("user_reviews", "author_id"), ("user_reviews", "target_id"),
        ("activities", "user_id"), ("presence", "user_id"), ("listen_along", "host_id"), ("listen_along", "listener_id"), ("stream_previews", "user_id"),
        ("family_links", "parent_id"), ("family_links", "teen_id"), ("family_codes", "teen_id"),
        ("guild_members", "user_id"), ("thread_members", "user_id"), ("event_rsvps", "user_id"), ("guild_applications", "user_id"), ("ban_appeals", "user_id"), ("poll_votes", "user_id"),
    ] {
        sqlx::query(&format!("DELETE FROM {table} WHERE {col} = $1")).bind(uid).execute(&mut **tx).await?;
    }
    // Group DMs: they leave (a group they own passes to someone still in it). 1:1 DMs keep both members, so the
    // other person keeps the conversation (with "Deleted User", who can't be messaged).
    sqlx::query("UPDATE channels c SET owner_id = (SELECT m.user_id FROM channel_members m WHERE m.channel_id = c.id AND m.user_id <> $1 ORDER BY m.user_id LIMIT 1) WHERE c.owner_id = $1 AND c.kind = 'group'")
        .bind(uid).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM channel_members m USING channels c WHERE m.channel_id = c.id AND c.kind = 'group' AND m.user_id = $1").bind(uid).execute(&mut **tx).await?;

    // Copies of their name kept by logs and reports: moderation keeps the record, not the name.
    for q in [
        "UPDATE guild_audit SET actor_name = $2 WHERE actor_id = $1", "UPDATE guild_audit SET target_name = $2 WHERE target_id = $1",
        "UPDATE admin_audit SET actor_name = $2 WHERE actor_id = $1", "UPDATE admin_audit SET target_name = $2 WHERE target_id = $1",
        "UPDATE reports SET target_username = $2 WHERE target_user_id = $1",
    ] {
        sqlx::query(q).bind(uid).bind(DELETED_NAME).execute(&mut **tx).await?;
    }

    // The row itself: a fresh placeholder name (retried on the rare collision) and every personal field cleared.
    for attempt in 0.. {
        let name = placeholder_username();
        let r = sqlx::query(
            "UPDATE users SET username = $2, display_name = $3, email = NULL, email_verified_at = NULL, password_hash = NULL,
                totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = 0,
                avatar_url = NULL, banner_url = NULL, avatar_history = '{}', bio = '', pronouns = '', custom_status = '', custom_activity = NULL,
                birthdate = NULL, house = DEFAULT, theme_primary = NULL, theme_accent = NULL, name_primary = NULL, name_accent = NULL, name_style = DEFAULT,
                avatar_decoration = DEFAULT, clan_tag = '', clan_tag_guild = NULL, panels = DEFAULT, profile_frame = DEFAULT, nameplate = DEFAULT, profile_effect = DEFAULT,
                entrance_sound = DEFAULT, notif_prefs = DEFAULT, client_settings = DEFAULT, guild_layout = DEFAULT, pinned_channels = '{}', ignored_users = '{}',
                online_alerts = '{}', friend_request_from = DEFAULT, sensitive_media = DEFAULT, dm_privacy = DEFAULT, message_requests = DEFAULT,
                group_dm_privacy = DEFAULT, searchable = false, share_activity = false, is_admin = false, admin_via_env = false,
                active_at = NULL, notify_mailed_at = NULL, username_changed_at = NULL, suspended_at = NULL, disabled_at = NULL,
                status = 'offline', status_expires_at = NULL, custom_status_expires_at = NULL, dm_spam_until = NULL, profile_privacy = DEFAULT,
                account_state = 'deleted', deleted_at = now(), deletion_requested_at = NULL, deletion_scheduled_for = NULL
             WHERE id = $1",
        ).bind(uid).bind(&name).bind(DELETED_NAME).execute(&mut **tx).await;
        match r {
            Ok(_) => break,
            Err(sqlx::Error::Database(e)) if e.is_unique_violation() && attempt < 5 => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(Scrubbed { files, guilds: guilds.into_iter().map(|g| g.0).collect() })
}

/// After commit: remove the files (a missing one counts as done) and tell everyone who could see the account.
async fn after(state: &AppState, uid: Uuid, done: Scrubbed) {
    for f in done.files { if let Err(e) = tokio::fs::remove_file(&f).await { if e.kind() != std::io::ErrorKind::NotFound { tracing::warn!(file = %f.display(), "deleted account file not removed: {e}") } } }
    state.hub.session_forget(uid);
    state.hub.voice_evict(|v| v.user_id == uid);
    for g in done.guilds { state.hub.emit_guild(g, "GUILD_MEMBER_REMOVE", json!({ "guild_id": g, "user_id": uid })); }
    if let Ok(u) = sqlx::query_as::<_, crate::models::User>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::USER_COLS)).bind(uid).fetch_one(&state.db).await {
        state.hub.emit_all("USER_UPDATE", json!(u));
    }
    state.hub.emit_users(vec![uid], "SESSION_REVOKED", json!({ "reason": "Your account has been deleted." }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholders_are_random_and_reserved() {
        let a = placeholder_username();
        let b = placeholder_username();
        assert!(a.starts_with(DELETED_PREFIX) && a.len() == DELETED_PREFIX.len() + 12, "{a}");
        assert!(a[DELETED_PREFIX.len()..].chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
        assert_ne!(a, b);
        assert!(crate::routes::auth::valid_username(&a), "placeholders must be valid usernames");
        assert!(reserved_username(&a) && reserved_username("Deleted_User_x") && !reserved_username("deleted_userx"));
    }

    #[test]
    fn email_block_hash_is_keyed_and_case_insensitive() {
        assert_eq!(email_block_hash("k", "A@x.io"), email_block_hash("k", " a@x.io"));
        assert_ne!(email_block_hash("k", "a@x.io"), email_block_hash("other", "a@x.io"));
        assert!(!email_block_hash("k", "a@x.io").contains('@'));
    }

    #[test]
    fn image_ids_from_urls() {
        let id = Uuid::now_v7();
        assert_eq!(image_id(&format!("/api/images/{id}")), Some(id));
        assert_eq!(image_id("https://example.com/a.png"), None);
    }
}
