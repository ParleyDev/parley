//! Self-service two-factor authentication: enrol (secret + otpauth URL for a QR code), confirm with a first
//! code (returns backup codes), regenerate backup codes, disable. Admins clear 2FA via `PATCH /admin/users/:id`.

use crate::{
    auth::{verify_password, AuthUser},
    error::{AppError, AppResult},
    mfa,
    models::PrivateUser,
    routes::{auth::check_second_factor, users::PRIVATE_USER_COLS},
    state::AppState,
};
use axum::{extract::State, routing::post, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/mfa/enroll", post(enroll))
        .route("/users/@me/mfa/confirm", post(confirm))
        .route("/users/@me/mfa/backup-codes", post(regenerate))
        .route("/users/@me/mfa/disable", post(disable))
}

async fn me(state: &AppState, uid: Uuid) -> AppResult<PrivateUser> {
    Ok(sqlx::query_as::<_, PrivateUser>(&format!("SELECT {PRIVATE_USER_COLS} FROM users WHERE id = $1")).bind(uid).fetch_one(&state.db).await?)
}

pub async fn check_password(state: &AppState, uid: Uuid, password: &str) -> AppResult<()> {
    let (hash,): (String,) = sqlx::query_as("SELECT password_hash FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if verify_password(password, &hash) { Ok(()) } else { Err(AppError::BadRequest("Incorrect password".into())) }
}

/// Replace the user's backup codes and return the new plaintext set (shown once).
pub async fn reset_backup_codes(state: &AppState, uid: Uuid) -> AppResult<Vec<String>> {
    let codes = mfa::new_backup_codes();
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM mfa_backup_codes WHERE user_id = $1").bind(uid).execute(&mut *tx).await?;
    for c in &codes {
        sqlx::query("INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)").bind(uid).bind(mfa::hash_backup_code(c)).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(codes)
}

#[derive(Deserialize)]
struct PasswordReq {
    password: String,
}

/// Start enrolment: a fresh secret is parked in `totp_pending` until the first code proves the app has it.
async fn enroll(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<PasswordReq>) -> AppResult<Json<Value>> {
    check_password(&state, uid, &req.password).await?;
    let (enabled, email): (bool, String) = sqlx::query_as("SELECT totp_secret IS NOT NULL, email FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if enabled {
        return Err(AppError::BadRequest("Two-factor authentication is already enabled".into()));
    }
    let secret = mfa::new_secret();
    sqlx::query("UPDATE users SET totp_pending = $2 WHERE id = $1").bind(uid).bind(&secret).execute(&state.db).await?;
    Ok(Json(json!({ "secret": secret, "otpauth_url": mfa::otpauth_url("Parley", &email, &secret) })))
}

#[derive(Deserialize)]
struct CodeReq {
    code: String,
}

async fn confirm(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<CodeReq>) -> AppResult<Json<Value>> {
    let (pending, enabled): (Option<String>, bool) = sqlx::query_as("SELECT totp_pending, totp_secret IS NOT NULL FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if enabled {
        return Err(AppError::BadRequest("Two-factor authentication is already enabled".into()));
    }
    let Some(secret) = pending else {
        return Err(AppError::BadRequest("Start enrolment first".into()));
    };
    let Some(step) = mfa::verify(&secret, &req.code, 0) else {
        return Err(AppError::BadRequest("That code didn't match. Check the time on your device and try again.".into()));
    };
    sqlx::query("UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = now(), totp_last_step = $2 WHERE id = $1")
        .bind(uid)
        .bind(step)
        .execute(&state.db)
        .await?;
    let backup_codes = reset_backup_codes(&state, uid).await?;
    Ok(Json(json!({ "backup_codes": backup_codes, "user": me(&state, uid).await? })))
}

async fn regenerate(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<PasswordReq>) -> AppResult<Json<Value>> {
    check_password(&state, uid, &req.password).await?;
    let (enabled,): (bool,) = sqlx::query_as("SELECT totp_secret IS NOT NULL FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if !enabled {
        return Err(AppError::BadRequest("Two-factor authentication is not enabled".into()));
    }
    Ok(Json(json!({ "backup_codes": reset_backup_codes(&state, uid).await? })))
}

#[derive(Deserialize)]
struct DisableReq {
    password: String,
    code: String,
}

/// Turning 2FA off needs the password and a current code (or a backup code).
async fn disable(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<DisableReq>) -> AppResult<Json<Value>> {
    check_password(&state, uid, &req.password).await?;
    let (secret, last_step): (Option<String>, i64) = sqlx::query_as("SELECT totp_secret, totp_last_step FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    let Some(secret) = secret else {
        return Err(AppError::BadRequest("Two-factor authentication is not enabled".into()));
    };
    if !check_second_factor(&state, uid, &secret, last_step, &req.code).await? {
        return Err(AppError::BadRequest("Invalid code".into()));
    }
    clear_mfa(&state, uid).await?;
    Ok(Json(json!(me(&state, uid).await?)))
}

/// For destructive self-service actions: the password, plus a TOTP/backup code when 2FA is on.
pub async fn check_password_and_factor(state: &AppState, uid: Uuid, password: &str, code: Option<&str>) -> AppResult<()> {
    check_password(state, uid, password).await?;
    let (secret, last_step): (Option<String>, i64) = sqlx::query_as("SELECT totp_secret, totp_last_step FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if let Some(secret) = secret {
        let code = code.unwrap_or("");
        if code.trim().is_empty() {
            return Err(AppError::BadRequest("Enter your two-factor code".into()));
        }
        if !check_second_factor(state, uid, &secret, last_step, code).await? {
            return Err(AppError::BadRequest("Invalid code".into()));
        }
    }
    Ok(())
}

pub async fn clear_mfa(state: &AppState, uid: Uuid) -> AppResult<()> {
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = 0 WHERE id = $1").bind(uid).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM mfa_backup_codes WHERE user_id = $1").bind(uid).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
