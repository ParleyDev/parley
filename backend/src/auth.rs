use crate::{error::{AppError, AppResult}, ratelimit::client_ip, state::AppState};
use argon2::{password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2};
use axum::{async_trait, extract::{FromRef, FromRequestParts}, http::{header, request::Parts, HeaderMap}};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub exp: i64,
    pub iat: i64,
    /// None for a session; "mfa" for the short-lived ticket issued between password and second factor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typ: Option<String>,
    /// Row in `sessions`; a token without one (pre-sessions) is no longer accepted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sid: Option<Uuid>,
}

pub fn hash_password(pw: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!(e))?
        .to_string())
}

pub fn verify_password(pw: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok())
        .unwrap_or(false)
}

pub fn issue_token(secret: &str, user_id: Uuid, session_id: Uuid) -> anyhow::Result<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        iat: now.timestamp(),
        exp: (now + Duration::days(30)).timestamp(),
        typ: None,
        sid: Some(session_id),
    };
    Ok(encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))?)
}

/// Session token: rejects MFA tickets, which must never act as a login. Signature only; see `check_session`.
pub fn verify_token(secret: &str, token: &str) -> Option<Uuid> {
    verify_session_token(secret, token).map(|(u, _)| u)
}

/// (user, session) from a session token.
pub fn verify_session_token(secret: &str, token: &str) -> Option<(Uuid, Uuid)> {
    let c = decode_claims(secret, token).filter(|c| c.typ.is_none())?;
    Some((c.sub, c.sid?))
}

/// Record a login and mint its token. Also prunes this user's expired/long-revoked rows.
pub async fn start_session(state: &AppState, user_id: Uuid, headers: &HeaderMap) -> AppResult<String> {
    let sid = Uuid::now_v7();
    let ua: String = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("").chars().take(256).collect();
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND (created_at < now() - interval '30 days' OR revoked_at < now() - interval '1 day')")
        .bind(user_id)
        .execute(&state.db)
        .await?;
    sqlx::query("INSERT INTO sessions (id, user_id, ip, user_agent) VALUES ($1, $2, $3, $4)")
        .bind(sid)
        .bind(user_id)
        .bind(client_ip(headers))
        .bind(ua)
        .execute(&state.db)
        .await?;
    Ok(issue_token(&state.config.jwt_secret, user_id, sid)?)
}

/// How long a confirmed session check is trusted before asking the DB again. Revocation, suspension and
/// deletion clear the cache on the instance that performs them (and, via the bus, on the others), so the
/// window only matters for a suspension done directly in SQL.
pub const SESSION_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(15);

/// Is this (user, session) still good: session not revoked, user not suspended or deleted?
/// Cached per instance for SESSION_CACHE_TTL; bumps `last_seen_at` at most once a minute.
pub async fn check_session(state: &AppState, user_id: Uuid, session_id: Uuid) -> AppResult<bool> {
    if state.hub.session_fresh(user_id, session_id, SESSION_CACHE_TTL) {
        return Ok(true);
    }
    let row: Option<(bool,)> = sqlx::query_as(
        "SELECT s.last_seen_at < now() - interval '1 minute' FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND u.suspended_at IS NULL AND u.disabled_at IS NULL",
    )
    .bind(session_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;
    match row {
        None => Ok(false),
        Some((stale,)) => {
            if stale {
                sqlx::query("UPDATE sessions SET last_seen_at = now() WHERE id = $1").bind(session_id).execute(&state.db).await?;
            }
            state.hub.session_confirm(user_id, session_id);
            Ok(true)
        }
    }
}

/// Revoke sessions and tell their open sockets to log out. `except` keeps one (the caller's own).
pub async fn revoke_sessions(state: &AppState, user_id: Uuid, only: Option<Uuid>, except: Option<Uuid>, reason: &str) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as(
        "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id = $2) AND ($3::uuid IS NULL OR id <> $3) RETURNING id",
    )
    .bind(user_id)
    .bind(only)
    .bind(except)
    .fetch_all(&state.db)
    .await?;
    let ids: Vec<Uuid> = rows.into_iter().map(|r| r.0).collect();
    state.hub.session_forget(user_id);
    for sid in &ids {
        state.hub.emit(crate::ws::hub::Target::Session(*sid), "SESSION_REVOKED", serde_json::json!({ "reason": reason }));
    }
    Ok(ids)
}

/// Proof that the password step passed; worth nothing except at `POST /auth/mfa`, and only for five minutes.
pub fn issue_mfa_ticket(secret: &str, user_id: Uuid) -> anyhow::Result<String> {
    let now = Utc::now();
    let claims = Claims { sub: user_id, iat: now.timestamp(), exp: (now + Duration::minutes(5)).timestamp(), typ: Some("mfa".into()), sid: None };
    Ok(encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))?)
}

pub fn verify_mfa_ticket(secret: &str, token: &str) -> Option<Uuid> {
    decode_claims(secret, token).filter(|c| c.typ.as_deref() == Some("mfa")).map(|c| c.sub)
}

fn decode_claims(secret: &str, token: &str) -> Option<Claims> {
    decode::<Claims>(token, &DecodingKey::from_secret(secret.as_bytes()), &Validation::default()).ok().map(|d| d.claims)
}

/// Extractor: authenticated user id from `Authorization: Bearer <jwt>`.
#[derive(Debug, Clone, Copy)]
pub struct AuthUser(pub Uuid);

/// Extractor: (user id, session id) for routes that act on the caller's own session.
#[derive(Debug, Clone, Copy)]
pub struct AuthSession(pub Uuid, pub Uuid);

#[async_trait]
impl<S> FromRequestParts<S> for AuthSession
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = AppState::from_ref(state);
        let header = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Unauthorized)?;
        let token = header.strip_prefix("Bearer ").ok_or(AppError::Unauthorized)?;
        let (uid, sid) = verify_session_token(&state.config.jwt_secret, token).ok_or(AppError::Unauthorized)?;
        // Revoked sessions and suspended or deleted accounts lose access immediately, token or not.
        if !check_session(&state, uid, sid).await? {
            return Err(AppError::Unauthorized);
        }
        Ok(AuthSession(uid, sid))
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        AuthSession::from_request_parts(parts, state).await.map(|AuthSession(uid, _)| AuthUser(uid))
    }
}
