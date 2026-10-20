//! Settings → My Account: change username (password + one per day), change email (confirmed from the
//! new address), change password (current password, optional log-out-everywhere-else), and the
//! account standing card.

use crate::{
    auth::{hash_password, verify_password, AuthSession, AuthUser},
    error::{AppError, AppResult},
    models::{PrivateUser, User},
    state::AppState,
};
use axum::{extract::State, middleware::from_fn, routing::{get, patch, post}, Json, Router};
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
