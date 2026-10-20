//! Settings → My Account: change username (password + one per day), change email (confirmed from the
//! new address), change password (current password, optional log-out-everywhere-else), and the
//! account standing card.

use crate::{
    auth::{hash_password, verify_password, AuthSession, AuthUser},
    error::{AppError, AppResult},
    models::{PrivateUser, User},
    state::AppState,
};
use axum::{body::Body, extract::{Path, State}, http::header, middleware::from_fn, response::Response, routing::{get, patch, post}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/username", patch(change_username))
        .route("/users/@me/email", post(change_email).route_layer(from_fn(crate::ratelimit::rl_mail)))
        .route("/users/@me/password", post(change_password))
        .route("/users/@me/standing", get(standing))
        .route("/auth/confirm-email", post(confirm_email))
        .route("/users/@me/disable", post(disable_account))
        .route("/users/@me/privacy", patch(update_privacy))
        .route("/users/@me/notification-prefs", patch(update_notif_prefs))
        .route("/users/@me/mentions", get(recent_mentions))
        .route("/users/@me/data-exports", get(list_exports).post(request_export))
        .route("/users/@me/data-exports/:id/download", get(download_export))
}

async fn check_password(state: &AppState, uid: Uuid, password: &str) -> AppResult<()> {
    let (hash,): (String,) = sqlx::query_as("SELECT password_hash FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if !verify_password(password, &hash) {
        return Err(AppError::BadRequest("That password is not right.".into()));
    }
    Ok(())
}

async fn private(state: &AppState, uid: Uuid) -> AppResult<PrivateUser> {
    Ok(sqlx::query_as::<_, PrivateUser>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::PRIVATE_USER_COLS)).bind(uid).fetch_one(&state.db).await?)
}

/// Tell everyone the public part of this user changed (username in this case).
fn broadcast(state: &AppState, u: &PrivateUser) {
    let public = User {
        id: u.id, username: u.username.clone(), display_name: u.display_name.clone(), avatar_url: u.avatar_url.clone(), bio: u.bio.clone(),
        status: u.status.clone(), custom_status: u.custom_status.clone(), created_at: u.created_at, banner_url: u.banner_url.clone(),
        theme_primary: u.theme_primary.clone(), theme_accent: u.theme_accent.clone(), pronouns: u.pronouns.clone(), name_primary: u.name_primary.clone(),
        name_accent: u.name_accent.clone(), avatar_decoration: u.avatar_decoration.clone(), clan_tag: u.clan_tag.clone(), panels: u.panels.clone(),
    };
    state.hub.emit_all("USER_UPDATE", json!(public));
}

#[derive(Deserialize)]
struct UsernameReq { username: String, password: String }

pub const USERNAME_COOLDOWN_HOURS: i64 = 24;

async fn change_username(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<UsernameReq>) -> AppResult<Json<PrivateUser>> {
    let username = req.username.trim().to_lowercase();
    if !crate::routes::auth::valid_username(&username) {
        return Err(AppError::BadRequest("Username must be 2-32 chars: letters, numbers, _ or .".into()));
    }
    check_password(&state, uid, &req.password).await?;
    let (current, changed_at): (String, Option<chrono::DateTime<chrono::Utc>>) =
        sqlx::query_as("SELECT username, username_changed_at FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if current == username {
        return Err(AppError::BadRequest("That is already your username.".into()));
    }
    if let Some(t) = changed_at {
        let next = t + chrono::Duration::hours(USERNAME_COOLDOWN_HOURS);
        if next > chrono::Utc::now() {
            let mins = (next - chrono::Utc::now()).num_minutes().max(1);
            return Err(AppError::TooMany(format!("You changed your username recently. Try again in {}.", if mins >= 60 { format!("{} hour{}", mins / 60, if mins / 60 == 1 { "" } else { "s" }) } else { format!("{mins} min") })));
        }
    }
    let taken: Option<(bool,)> = sqlx::query_as("SELECT true FROM users WHERE username = $1 AND id <> $2").bind(&username).bind(uid).fetch_optional(&state.db).await?;
    if taken.is_some() {
        return Err(AppError::Conflict("That username is taken.".into()));
    }
    sqlx::query("UPDATE users SET username = $2, username_changed_at = now() WHERE id = $1").bind(uid).bind(&username).execute(&state.db).await?;
    let u = private(&state, uid).await?;
    broadcast(&state, &u);
    Ok(Json(u))
}

#[derive(Deserialize)]
struct EmailReq { email: String, password: String }

/// Start an email change: a confirmation link goes to the NEW address; nothing changes until it is opened.
/// When this server cannot send mail the change applies at once (and the address counts as unverified).
async fn change_email(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<EmailReq>) -> AppResult<Json<Value>> {
    let email = req.email.trim().to_lowercase();
    if !email.contains('@') || email.len() > 254 {
        return Err(AppError::BadRequest("Invalid email".into()));
    }
    check_password(&state, uid, &req.password).await?;
    let (current,): (String,) = sqlx::query_as("SELECT email FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if current == email {
        return Err(AppError::BadRequest("That is already your email address.".into()));
    }
    let taken: Option<(bool,)> = sqlx::query_as("SELECT true FROM users WHERE email = $1 AND id <> $2").bind(&email).bind(uid).fetch_optional(&state.db).await?;
    if taken.is_some() {
        return Err(AppError::Conflict("That email address is already in use.".into()));
    }
    if !crate::mail::enabled(&state.config) {
        sqlx::query("UPDATE users SET email = $2, email_verified_at = NULL WHERE id = $1").bind(uid).bind(&email).execute(&state.db).await?;
        let u = private(&state, uid).await?;
        state.hub.emit_users(vec![uid], "USER_UPDATE", json!(u));
        return Ok(Json(json!({ "ok": true, "pending": false, "user": u })));
    }
    // Only the newest request for this account stays valid.
    sqlx::query("UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND kind = 'change_email' AND used_at IS NULL").bind(uid).execute(&state.db).await?;
    let token = crate::mail::new_token();
    sqlx::query("INSERT INTO email_tokens (token, user_id, kind, email, expires_at) VALUES ($1, $2, 'change_email', $3, now() + interval '1 hour')")
        .bind(&token).bind(uid).bind(&email).execute(&state.db).await?;
    let link = format!("{}/confirm-email?token={token}", state.config.app_url);
    let body = format!("You asked to use this address for your Parley account.\n\nOpen this link within one hour to confirm the change:\n\n{link}\n\nIf that wasn't you, ignore this message; nothing changes.");
    let _ = crate::mail::send(&state.config, &email, "Confirm your new Parley email", &body).await;
    // A heads-up to the old address as well.
    let _ = crate::mail::send(&state.config, &current, "Your Parley email is being changed", &format!("A request was made to change the email on your Parley account to {email}. If that wasn't you, change your password now.")).await;
    Ok(Json(json!({ "ok": true, "pending": true, "email": email })))
}

#[derive(Deserialize)]
struct ConfirmReq { token: String }

/// Finish an email change from the link sent to the new address (works logged in or not).
async fn confirm_email(State(state): State<AppState>, Json(req): Json<ConfirmReq>) -> AppResult<Json<Value>> {
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "UPDATE email_tokens SET used_at = now() WHERE token = $1 AND kind = 'change_email' AND used_at IS NULL AND expires_at > now() RETURNING user_id, email",
    ).bind(req.token.trim()).fetch_optional(&state.db).await?;
    let (uid, email) = row.ok_or_else(|| AppError::BadRequest("This confirmation link is invalid or has expired. Start the change again from Account settings.".into()))?;
    let taken: Option<(bool,)> = sqlx::query_as("SELECT true FROM users WHERE email = $1 AND id <> $2").bind(&email).bind(uid).fetch_optional(&state.db).await?;
    if taken.is_some() {
        return Err(AppError::Conflict("That email address is already in use.".into()));
    }
    sqlx::query("UPDATE users SET email = $2, email_verified_at = now() WHERE id = $1").bind(uid).bind(&email).execute(&state.db).await?;
    let u = private(&state, uid).await?;
    state.hub.emit_users(vec![uid], "USER_UPDATE", json!(u));
    Ok(Json(json!({ "ok": true, "user_id": uid, "email": email })))
}

#[derive(Deserialize)]
struct PasswordReq { current_password: String, new_password: String, #[serde(default)] logout_others: bool }

async fn change_password(State(state): State<AppState>, AuthSession(uid, sid): AuthSession, Json(req): Json<PasswordReq>) -> AppResult<Json<Value>> {
    if req.new_password.len() < 8 {
        return Err(AppError::BadRequest("Password must be at least 8 characters".into()));
    }
    check_password(&state, uid, &req.current_password).await?;
    if req.current_password == req.new_password {
        return Err(AppError::BadRequest("The new password must be different.".into()));
    }
    let hash = hash_password(&req.new_password)?;
    sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1").bind(uid).bind(&hash).execute(&state.db).await?;
    sqlx::query("UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND kind = 'reset' AND used_at IS NULL").bind(uid).execute(&state.db).await?;
    let mut logged_out = 0;
    if req.logout_others {
        logged_out = crate::auth::revoke_sessions(&state, uid, None, Some(sid), "Your password was changed on another device. Log in again.").await?.len();
    }
    let (email,): (String,) = sqlx::query_as("SELECT email FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if crate::mail::enabled(&state.config) {
        let _ = crate::mail::send(&state.config, &email, "Your Parley password was changed", "The password on your Parley account was just changed. If that wasn't you, reset it from the login page right away.").await;
    }
    Ok(Json(json!({ "ok": true, "logged_out": logged_out })))
}

/// Account standing: a summary of moderation action against this account, Discord-style.
/// all_good → limited (some action in the last 90 days) → very_limited → at_risk → suspended.
async fn standing(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    let (suspended,): (bool,) = sqlx::query_as("SELECT suspended_at IS NOT NULL FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    let (actioned,): (i64,) = sqlx::query_as("SELECT count(*) FROM reports WHERE target_user_id = $1 AND status = 'resolved' AND created_at > now() - interval '90 days'").bind(uid).fetch_one(&state.db).await?;
    let (bans,): (i64,) = sqlx::query_as("SELECT count(*) FROM guild_bans WHERE user_id = $1").bind(uid).fetch_one(&state.db).await?;
    let (timeouts,): (i64,) = sqlx::query_as("SELECT count(*) FROM guild_members WHERE user_id = $1 AND timeout_until > now()").bind(uid).fetch_one(&state.db).await?;
    let score = actioned + bans + timeouts;
    let level = if suspended { "suspended" } else if score >= 5 { "at_risk" } else if score >= 3 { "very_limited" } else if score >= 1 { "limited" } else { "all_good" };
    Ok(Json(json!({ "level": level, "actioned_reports": actioned, "bans": bans, "active_timeouts": timeouts, "suspended": suspended })))
}

#[derive(Deserialize)]
struct DisableReq { password: String, code: Option<String> }

/// Disable the account: every session ends and the account stays hidden until the next successful login,
/// which re-enables it. Nothing is deleted.
async fn disable_account(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<DisableReq>) -> AppResult<axum::http::StatusCode> {
    crate::routes::mfa::check_password_and_factor(&state, uid, &req.password, req.code.as_deref()).await?;
    sqlx::query("UPDATE users SET disabled_at = now() WHERE id = $1").bind(uid).execute(&state.db).await?;
    crate::auth::revoke_sessions(&state, uid, None, None, "Your account was disabled. Log in again to re-enable it.").await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ---- Data export -----------------------------------------------------------------------------------

pub const EXPORT_COOLDOWN_HOURS: i64 = 24;
pub const EXPORT_KEEP_DAYS: i64 = 7;

fn export_path(state: &AppState, id: Uuid) -> std::path::PathBuf {
    state.config.upload_dir.join("exports").join(format!("{id}.json"))
}

#[derive(serde::Serialize, sqlx::FromRow)]
struct Export { id: Uuid, status: String, requested_at: chrono::DateTime<chrono::Utc>, ready_at: Option<chrono::DateTime<chrono::Utc>>, size: i64, error: Option<String> }

/// Your exports (newest first). Ones older than EXPORT_KEEP_DAYS are dropped on the way.
async fn list_exports(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Export>>> {
    let old: Vec<(Uuid,)> = sqlx::query_as("DELETE FROM data_exports WHERE user_id = $1 AND requested_at < now() - make_interval(days => $2) RETURNING id")
        .bind(uid).bind(EXPORT_KEEP_DAYS as i32).fetch_all(&state.db).await?;
    for (id,) in old { let _ = tokio::fs::remove_file(export_path(&state, id)).await; }
    let rows = sqlx::query_as::<_, Export>("SELECT id, status, requested_at, ready_at, size, error FROM data_exports WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 10")
        .bind(uid).fetch_all(&state.db).await?;
    Ok(Json(rows))
}

/// Start an export of everything we hold about you (one per EXPORT_COOLDOWN_HOURS). Built in the
/// background; the list shows when it is ready and a mail goes out too.
async fn request_export(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Export>> {
    let last: Option<(chrono::DateTime<chrono::Utc>,)> = sqlx::query_as("SELECT requested_at FROM data_exports WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1").bind(uid).fetch_optional(&state.db).await?;
    if let Some((t,)) = last {
        let next = t + chrono::Duration::hours(EXPORT_COOLDOWN_HOURS);
        if next > chrono::Utc::now() {
            let mins = (next - chrono::Utc::now()).num_minutes().max(1);
            return Err(AppError::TooMany(format!("You can request one export a day. Try again in {}.", if mins >= 60 { format!("{} hours", mins / 60) } else { format!("{mins} min") })));
        }
    }
    let id = Uuid::now_v7();
    let row = sqlx::query_as::<_, Export>("INSERT INTO data_exports (id, user_id) VALUES ($1, $2) RETURNING id, status, requested_at, ready_at, size, error")
        .bind(id).bind(uid).fetch_one(&state.db).await?;
    let st = state.clone();
    tokio::spawn(async move {
        match build_export(&st, uid, id).await {
            Ok(size) => {
                let _ = sqlx::query("UPDATE data_exports SET status = 'ready', ready_at = now(), size = $2 WHERE id = $1").bind(id).bind(size).execute(&st.db).await;
                if crate::mail::enabled(&st.config) {
                    if let Ok((email,)) = sqlx::query_as::<_, (String,)>("SELECT email FROM users WHERE id = $1").bind(uid).fetch_one(&st.db).await {
                        let _ = crate::mail::send(&st.config, &email, "Your Parley data is ready", &format!("The copy of your data you asked for is ready. Download it from Settings → My Account → Your data within {EXPORT_KEEP_DAYS} days.")).await;
                    }
                }
            }
            Err(e) => {
                tracing::warn!(error = ?e, "data export failed");
                let _ = sqlx::query("UPDATE data_exports SET status = 'failed', error = $2 WHERE id = $1").bind(id).bind(e.to_string()).execute(&st.db).await;
            }
        }
    });
    Ok(Json(row))
}

/// Everything about one user as a JSON document: account, memberships, messages, relationships, settings.
async fn build_export(state: &AppState, uid: Uuid, id: Uuid) -> AppResult<i64> {
    let db = &state.db;
    let rows = |sql: &'static str| async move {
        sqlx::query_scalar::<_, Value>(sql).bind(uid).fetch_one(db).await
    };
    let user = sqlx::query_as::<_, PrivateUser>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::PRIVATE_USER_COLS)).bind(uid).fetch_one(db).await?;
    let doc = json!({
        "exported_at": chrono::Utc::now(),
        "format": "parley-data-export/1",
        "account": user,
        "servers": rows("SELECT COALESCE(json_agg(json_build_object('id', g.id, 'name', g.name, 'joined_at', gm.joined_at, 'nickname', gm.nickname, 'owner', g.owner_id = gm.user_id) ORDER BY gm.joined_at), '[]'::json) FROM guild_members gm JOIN guilds g ON g.id = gm.guild_id WHERE gm.user_id = $1").await?,
        "direct_messages": rows("SELECT COALESCE(json_agg(json_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'recipients', (SELECT json_agg(json_build_object('id', u.id, 'username', u.username)) FROM channel_members m2 JOIN users u ON u.id = m2.user_id WHERE m2.channel_id = c.id))), '[]'::json) FROM channel_members cm JOIN channels c ON c.id = cm.channel_id WHERE cm.user_id = $1").await?,
        "messages": rows("SELECT COALESCE(json_agg(json_build_object('id', m.id, 'channel_id', m.channel_id, 'content', m.content, 'created_at', m.created_at, 'edited_at', m.edited_at, 'reply_to', m.reply_to, 'kind', m.kind, 'attachments', (SELECT COALESCE(json_agg(json_build_object('id', a.id, 'filename', a.filename, 'content_type', a.content_type, 'size', a.size)), '[]'::json) FROM attachments a WHERE a.message_id = m.id)) ORDER BY m.id), '[]'::json) FROM messages m WHERE m.author_id = $1").await?,
        "reactions": rows("SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) FROM reactions r WHERE r.user_id = $1").await?,
        "relationships": rows("SELECT COALESCE(json_agg(json_build_object('user_id', r.target_id, 'username', u.username, 'kind', r.kind, 'created_at', r.created_at)), '[]'::json) FROM relationships r JOIN users u ON u.id = r.target_id WHERE r.user_id = $1").await?,
        "notes": rows("SELECT COALESCE(json_agg(row_to_json(n)), '[]'::json) FROM user_notes n WHERE n.user_id = $1").await?,
        "bookmarks": rows("SELECT COALESCE(json_agg(row_to_json(b)), '[]'::json) FROM bookmarks b WHERE b.user_id = $1").await?,
        "notification_settings": rows("SELECT COALESCE(json_agg(row_to_json(n)), '[]'::json) FROM notification_settings n WHERE n.user_id = $1").await?,
        "reviews_written": rows("SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json) FROM user_reviews r WHERE r.author_id = $1").await?,
        "reports_filed": rows("SELECT COALESCE(json_agg(json_build_object('id', r.id, 'kind', r.kind, 'reason', r.reason, 'status', r.status, 'created_at', r.created_at)), '[]'::json) FROM reports r WHERE r.reporter_id = $1").await?,
        "sessions": rows("SELECT COALESCE(json_agg(json_build_object('ip', s.ip, 'user_agent', s.user_agent, 'created_at', s.created_at, 'last_seen_at', s.last_seen_at, 'revoked_at', s.revoked_at)), '[]'::json) FROM sessions s WHERE s.user_id = $1").await?,
        "uploads": rows("SELECT COALESCE(json_agg(json_build_object('id', a.id, 'filename', a.filename, 'content_type', a.content_type, 'size', a.size, 'created_at', a.created_at)), '[]'::json) FROM attachments a WHERE a.uploader_id = $1").await?,
    });
    let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| AppError::Other(e.into()))?;
    let path = export_path(state, id);
    if let Some(dir) = path.parent() { tokio::fs::create_dir_all(dir).await.map_err(|e| AppError::Other(e.into()))?; }
    tokio::fs::write(&path, &bytes).await.map_err(|e| AppError::Other(e.into()))?;
    Ok(bytes.len() as i64)
}

async fn download_export(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Response> {
    let row: Option<(String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as("SELECT status, requested_at FROM data_exports WHERE id = $1 AND user_id = $2").bind(id).bind(uid).fetch_optional(&state.db).await?;
    let (status, at) = row.ok_or_else(|| AppError::NotFound("Export not found".into()))?;
    if status != "ready" {
        return Err(AppError::BadRequest("That export is not ready yet.".into()));
    }
    let file = tokio::fs::File::open(export_path(&state, id)).await.map_err(|_| AppError::NotFound("Export file missing".into()))?;
    let stream = tokio_util::io::ReaderStream::new(file);
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"parley-data-{}.json\"", at.format("%Y-%m-%d")))
        .body(Body::from_stream(stream))
        .map_err(|e| AppError::Other(e.into()))?)
}

#[derive(Deserialize)]
struct PrivacyReq { dm_privacy: Option<String>, message_requests: Option<bool>, friend_request_from: Option<Vec<String>>, group_dm_privacy: Option<String> }

/// Content & Social settings.
async fn update_privacy(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<PrivacyReq>) -> AppResult<Json<PrivateUser>> {
    if let Some(p) = &req.dm_privacy { if !["everyone", "friends_and_servers", "friends"].contains(&p.as_str()) { return Err(AppError::BadRequest("Bad dm_privacy".into())) } }
    if let Some(p) = &req.group_dm_privacy { if !["friends", "nobody"].contains(&p.as_str()) { return Err(AppError::BadRequest("Bad group_dm_privacy".into())) } }
    let from = match &req.friend_request_from {
        Some(list) => {
            let mut v: Vec<String> = list.iter().filter(|x| ["everyone", "friends_of_friends", "server_members"].contains(&x.as_str())).cloned().collect();
            v.sort(); v.dedup();
            Some(v)
        }
        None => None,
    };
    sqlx::query("UPDATE users SET dm_privacy = COALESCE($2, dm_privacy), message_requests = COALESCE($3, message_requests), friend_request_from = COALESCE($4, friend_request_from), group_dm_privacy = COALESCE($5, group_dm_privacy) WHERE id = $1")
        .bind(uid).bind(req.dm_privacy).bind(req.message_requests).bind(from).bind(req.group_dm_privacy).execute(&state.db).await?;
    let u = private(&state, uid).await?;
    state.hub.emit_users(vec![uid], "USER_UPDATE", json!(u));
    Ok(Json(u))
}

/// Notification preferences kept on the server (they affect push, mail and new servers):
/// push_timeout_min (1–120), email_dms, email_friend_requests, default_suppress_everyone, default_suppress_roles.
async fn update_notif_prefs(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<Value>) -> AppResult<Json<PrivateUser>> {
    let Some(obj) = req.as_object() else { return Err(AppError::BadRequest("Expected an object".into())) };
    let mut clean = serde_json::Map::new();
    for (k, v) in obj {
        match k.as_str() {
            "push_timeout_min" => { let n = v.as_i64().ok_or_else(|| AppError::BadRequest("push_timeout_min must be a number".into()))?; clean.insert(k.clone(), json!(n.clamp(1, 120))); }
            "email_dms" | "email_friend_requests" | "default_suppress_everyone" | "default_suppress_roles" => { let b = v.as_bool().ok_or_else(|| AppError::BadRequest(format!("{k} must be true or false")))?; clean.insert(k.clone(), json!(b)); }
            _ => return Err(AppError::BadRequest(format!("Unknown preference {k}"))),
        }
    }
    sqlx::query("UPDATE users SET notif_prefs = notif_prefs || $2 WHERE id = $1").bind(uid).bind(Value::Object(clean)).execute(&state.db).await?;
    let u = private(&state, uid).await?;
    state.hub.emit_users(vec![uid], "USER_UPDATE", json!(u));
    Ok(Json(u))
}

#[derive(Deserialize)]
struct MentionsQ { limit: Option<i64> }

/// Inbox: recent messages that mention you by name (last 30 days, newest first) in channels you can read.
async fn recent_mentions(State(state): State<AppState>, AuthUser(uid): AuthUser, axum::extract::Query(q): axum::extract::Query<MentionsQ>) -> AppResult<Json<Vec<crate::models::Message>>> {
    let limit = q.limit.unwrap_or(30).clamp(1, 100);
    let rows = sqlx::query_as::<_, crate::models::MessageRow>(&format!(
        "{} JOIN channels c ON c.id = m.channel_id
         WHERE m.mentions @> ARRAY[$1]::uuid[] AND m.author_id <> $1 AND m.created_at > now() - interval '30 days'
           AND (c.guild_id IN (SELECT guild_id FROM guild_members WHERE user_id = $1) OR c.id IN (SELECT channel_id FROM channel_members WHERE user_id = $1))
         ORDER BY m.id DESC LIMIT $2", crate::routes::channels::MESSAGE_SELECT))
        .bind(uid).bind(limit).fetch_all(&state.db).await?;
    Ok(Json(crate::routes::channels::hydrate(&state.db, rows, uid, false).await?))
}
