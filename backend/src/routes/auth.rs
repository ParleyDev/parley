use crate::{
    auth::{hash_password, issue_mfa_ticket, revoke_sessions, start_session, verify_mfa_ticket, verify_password, AuthSession},
    error::{AppError, AppResult},
    mfa,
    models::PrivateUser,
    routes::users::PRIVATE_USER_COLS,
    state::AppState,
};
use axum::{extract::State, http::HeaderMap, middleware::from_fn, routing::post, Json, Router};
use crate::ratelimit::{client_ip, rl_login, rl_register, LIMITER};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register).route_layer(from_fn(rl_register)))
        .route("/auth/login", post(login).route_layer(from_fn(rl_login)))
        .route("/auth/mfa", post(login_mfa).route_layer(from_fn(rl_login)))
        .route("/auth/verify", post(verify_email))
        .route("/auth/resend-verification", post(resend_verification).route_layer(from_fn(crate::ratelimit::rl_mail)))
        .route("/auth/forgot", post(forgot_password).route_layer(from_fn(crate::ratelimit::rl_mail)))
        .route("/auth/reset", post(reset_password))
        .route("/auth/logout", post(logout))
}

#[derive(Deserialize)]
struct RegisterReq {
    username: String,
    email: String,
    password: String,
    display_name: Option<String>,
}

pub fn valid_username(u: &str) -> bool {
    (2..=32).contains(&u.len())
        && u.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
}

async fn register(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<RegisterReq>) -> AppResult<Json<Value>> {
    if !crate::routes::admin::load_settings(&state.db).await?.registration_enabled {
        return Err(AppError::Forbidden);
    }
    let username = req.username.trim().to_lowercase();
    let email = req.email.trim().to_lowercase();
    if !valid_username(&username) {
        return Err(AppError::BadRequest("Username must be 2-32 chars: letters, numbers, _ or .".into()));
    }
    if !email.contains('@') || email.len() > 254 {
        return Err(AppError::BadRequest("Invalid email".into()));
    }
    if req.password.len() < 8 {
        return Err(AppError::BadRequest("Password must be at least 8 characters".into()));
    }
    let display_name = req
        .display_name
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| username.clone());

    let exists: Option<(bool,)> =
        sqlx::query_as("SELECT true FROM users WHERE username = $1 OR email = $2 LIMIT 1")
            .bind(&username)
            .bind(&email)
            .fetch_optional(&state.db)
            .await?;
    if exists.is_some() {
        return Err(AppError::Conflict("Username or email already taken".into()));
    }

    let hash = hash_password(&req.password)?;
    let id = Uuid::now_v7();
    let user = sqlx::query_as::<_, PrivateUser>(
        "INSERT INTO users (id, username, display_name, email, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, username, display_name, email, avatar_url, bio, status, created_at, banner_url, theme_primary, theme_accent, pronouns, name_primary, name_accent",
    )
    .bind(id)
    .bind(&username)
    .bind(&display_name)
    .bind(&email)
    .bind(&hash)
    .fetch_one(&state.db)
    .await?;

    send_verification(&state, user.id, &user.email).await;
    let token = start_session(&state, user.id, &headers).await?;
    Ok(Json(json!({ "token": token, "user": user })))
}

/// Create a 24h verification token and mail the link (no-op when mail is off).
pub async fn send_verification(state: &AppState, uid: Uuid, email: &str) {
    if !crate::mail::enabled(&state.config) {
        return;
    }
    let token = crate::mail::new_token();
    if sqlx::query("INSERT INTO email_tokens (token, user_id, kind, email, expires_at) VALUES ($1, $2, 'verify', $3, now() + interval '24 hours')")
        .bind(&token).bind(uid).bind(email).execute(&state.db).await.is_err() {
        return;
    }
    let link = format!("{}/verify?token={token}", state.config.app_url);
    let body = format!("Welcome to Parley!\n\nConfirm your email address by opening this link (valid for 24 hours):\n\n{link}\n\nIf you did not create an account, ignore this message.");
    let _ = crate::mail::send(&state, email, "Verify your Parley email", &body).await;
}

#[derive(Deserialize)]
struct VerifyReq {
    token: String,
}

/// Mark the account verified. Anyone holding a valid token may use it; it is single-use.
async fn verify_email(State(state): State<AppState>, Json(req): Json<VerifyReq>) -> AppResult<Json<Value>> {
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "UPDATE email_tokens SET used_at = now() WHERE token = $1 AND kind = 'verify' AND used_at IS NULL AND expires_at > now() RETURNING user_id, email",
    )
    .bind(req.token.trim())
    .fetch_optional(&state.db)
    .await?;
    let (uid, email) = row.ok_or_else(|| AppError::BadRequest("This verification link is invalid or has expired. Request a new one from Account settings.".into()))?;
    sqlx::query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 AND email = $2").bind(uid).bind(&email).execute(&state.db).await?;
    let user = sqlx::query_as::<_, PrivateUser>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::PRIVATE_USER_COLS)).bind(uid).fetch_one(&state.db).await?;
    state.hub.emit_users(vec![uid], "USER_UPDATE", json!(user));
    Ok(Json(json!({ "ok": true, "user_id": uid })))
}

/// Logged-in users can ask for a fresh link (rate limited per user).
async fn resend_verification(State(state): State<AppState>, crate::auth::AuthUser(uid): crate::auth::AuthUser) -> AppResult<Json<Value>> {
    let row: (String, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as("SELECT email, email_verified_at FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if row.1.is_some() {
        return Err(AppError::BadRequest("Your email is already verified.".into()));
    }
    if !crate::mail::enabled(&state.config) {
        return Err(AppError::BadRequest("This server cannot send email.".into()));
    }
    send_verification(&state, uid, &row.0).await;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ForgotReq {
    email: String,
}

/// Always answers ok (no account enumeration). When the address is known and mail is on, sends a
/// one-hour single-use reset link.
async fn forgot_password(State(state): State<AppState>, Json(req): Json<ForgotReq>) -> AppResult<Json<Value>> {
    let email = req.email.trim().to_lowercase();
    if !crate::mail::enabled(&state.config) {
        return Err(AppError::BadRequest("This server cannot send email; ask an admin to reset your password.".into()));
    }
    let row: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE email = $1 AND suspended_at IS NULL").bind(&email).fetch_optional(&state.db).await?;
    if let Some((uid,)) = row {
        let token = crate::mail::new_token();
        sqlx::query("INSERT INTO email_tokens (token, user_id, kind, email, expires_at) VALUES ($1, $2, 'reset', $3, now() + interval '1 hour')")
            .bind(&token).bind(uid).bind(&email).execute(&state.db).await?;
        let link = format!("{}/reset?token={token}", state.config.app_url);
        let body = format!("Someone asked to reset the password for your Parley account.\n\nOpen this link within one hour to choose a new password:\n\n{link}\n\nIf that wasn't you, ignore this message; your password stays the same.");
        let _ = crate::mail::send(&state, &email, "Reset your Parley password", &body).await;
    }
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ResetReq {
    token: String,
    password: String,
}

/// Set a new password from a reset token; also counts as proof of the address, so it verifies it.
async fn reset_password(State(state): State<AppState>, Json(req): Json<ResetReq>) -> AppResult<Json<Value>> {
    if req.password.len() < 8 {
        return Err(AppError::BadRequest("Password must be at least 8 characters".into()));
    }
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "UPDATE email_tokens SET used_at = now() WHERE token = $1 AND kind = 'reset' AND used_at IS NULL AND expires_at > now() RETURNING user_id, email",
    )
    .bind(req.token.trim())
    .fetch_optional(&state.db)
    .await?;
    let (uid, email) = row.ok_or_else(|| AppError::BadRequest("This reset link is invalid or has expired. Request a new one.".into()))?;
    let hash = hash_password(&req.password)?;
    sqlx::query("UPDATE users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 AND email = $3")
        .bind(uid).bind(&hash).bind(&email).execute(&state.db).await?;
    // Any other reset links for this account are now moot.
    sqlx::query("UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND kind = 'reset' AND used_at IS NULL").bind(uid).execute(&state.db).await?;
    // Whoever had the old password is out everywhere.
    revoke_sessions(&state, uid, None, None, "Your password was reset. Log in again.").await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct LoginReq {
    login: String,
    password: String,
}

async fn login(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<LoginReq>) -> AppResult<Json<Value>> {
    let login = req.login.trim().to_lowercase();
    let row: Option<(Uuid, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE username = $1 OR email = $1")
            .bind(&login)
            .fetch_optional(&state.db)
            .await?;
    // Wrong user or wrong password: both spend a login_fail token for this IP (brute-force guard).
    let Some((id, hash)) = row else {
        let _ = LIMITER.take("login_fail", &client_ip(&headers), LIMITER.limit("login_fail"));
        return Err(AppError::BadRequest("Invalid credentials".into()));
    };
    if !verify_password(&req.password, &hash) {
        let _ = LIMITER.take("login_fail", &client_ip(&headers), LIMITER.limit("login_fail"));
        return Err(AppError::BadRequest("Invalid credentials".into()));
    }
    let (suspended, mfa, bot): (bool, bool, bool) = sqlx::query_as("SELECT suspended_at IS NOT NULL, totp_secret IS NOT NULL, bot FROM users WHERE id = $1").bind(id).fetch_one(&state.db).await?;
    if bot {
        return Err(AppError::BadRequest("Bot accounts log in with their token, not a password.".into()));
    }
    if suspended {
        return Err(AppError::BadRequest("This account has been suspended.".into()));
    }
    if mfa {
        // Password is right but the account needs its second factor: hand back a ticket for /auth/mfa, not a session.
        let (keys,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM passkeys WHERE user_id = $1").bind(id).fetch_one(&state.db).await?;
        return Ok(Json(json!({ "mfa": true, "ticket": issue_mfa_ticket(&state.config.jwt_secret, id)?, "security_keys": keys > 0 })));
    }
    session(&state, id, &headers).await
}

pub(crate) async fn session(state: &AppState, id: Uuid, headers: &HeaderMap) -> AppResult<Json<Value>> {
    // A disabled account comes back to life on its next successful login.
    let reenabled: Option<(bool,)> = sqlx::query_as("UPDATE users SET disabled_at = NULL WHERE id = $1 AND disabled_at IS NOT NULL RETURNING true").bind(id).fetch_optional(&state.db).await?;
    let user = sqlx::query_as::<_, PrivateUser>(&format!("SELECT {PRIVATE_USER_COLS} FROM users WHERE id = $1"))
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    let token = start_session(state, id, headers).await?;
    Ok(Json(json!({ "token": token, "user": user, "reenabled": reenabled.is_some() })))
}

/// End the calling session; the token stops working at once.
async fn logout(State(state): State<AppState>, AuthSession(uid, sid): AuthSession) -> AppResult<axum::http::StatusCode> {
    revoke_sessions(&state, uid, Some(sid), None, "You logged out.").await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct MfaReq {
    ticket: String,
    code: String,
}

/// Second login step: a TOTP code or a backup code, presented with the ticket from `/auth/login`.
async fn login_mfa(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<MfaReq>) -> AppResult<Json<Value>> {
    let id = verify_mfa_ticket(&state.config.jwt_secret, &req.ticket).ok_or(AppError::BadRequest("Your login expired, start again".into()))?;
    let row: Option<(Option<String>, i64, bool)> = sqlx::query_as("SELECT totp_secret, totp_last_step, suspended_at IS NOT NULL FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let Some((Some(secret), last_step, suspended)) = row else {
        return Err(AppError::BadRequest("Two-factor authentication is not enabled on this account".into()));
    };
    if suspended {
        return Err(AppError::BadRequest("This account has been suspended.".into()));
    }
    if !check_second_factor(&state, id, &secret, last_step, &req.code).await? {
        let _ = LIMITER.take("login_fail", &client_ip(&headers), LIMITER.limit("login_fail"));
        return Err(AppError::BadRequest("Invalid code".into()));
    }
    session(&state, id, &headers).await
}

/// Accept a TOTP code (recording its step so it cannot be replayed) or burn a matching unused backup code.
pub async fn check_second_factor(state: &AppState, id: Uuid, secret: &str, last_step: i64, code: &str) -> AppResult<bool> {
    if let Some(step) = mfa::verify(secret, code, last_step) {
        sqlx::query("UPDATE users SET totp_last_step = GREATEST(totp_last_step, $2) WHERE id = $1").bind(id).bind(step).execute(&state.db).await?;
        return Ok(true);
    }
    let burned = sqlx::query("UPDATE mfa_backup_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL")
        .bind(id)
        .bind(mfa::hash_backup_code(code))
        .execute(&state.db)
        .await?;
    Ok(burned.rows_affected() == 1)
}
