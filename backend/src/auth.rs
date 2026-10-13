use crate::{error::AppError, state::AppState};
use argon2::{password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2};
use axum::{async_trait, extract::{FromRef, FromRequestParts}, http::{header, request::Parts}};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub exp: i64,
    pub iat: i64,
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

pub fn issue_token(secret: &str, user_id: Uuid) -> anyhow::Result<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user_id,
        iat: now.timestamp(),
        exp: (now + Duration::days(30)).timestamp(),
    };
    Ok(encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))?)
}

pub fn verify_token(secret: &str, token: &str) -> Option<Uuid> {
    decode::<Claims>(token, &DecodingKey::from_secret(secret.as_bytes()), &Validation::default())
        .ok()
        .map(|d| d.claims.sub)
}

/// Extractor: authenticated user id from `Authorization: Bearer <jwt>`.
#[derive(Debug, Clone, Copy)]
pub struct AuthUser(pub Uuid);

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
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
        verify_token(&state.config.jwt_secret, token)
            .map(AuthUser)
            .ok_or(AppError::Unauthorized)
    }
}
