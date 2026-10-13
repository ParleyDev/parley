use crate::{
    auth::{hash_password, issue_token, verify_password},
    error::{AppError, AppResult},
    models::PrivateUser,
    state::AppState,
};
use axum::{extract::State, routing::post, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
}

#[derive(Deserialize)]
struct RegisterReq {
    username: String,
    email: String,
    password: String,
    display_name: Option<String>,
}

fn valid_username(u: &str) -> bool {
    (2..=32).contains(&u.len())
        && u.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
}

async fn register(State(state): State<AppState>, Json(req): Json<RegisterReq>) -> AppResult<Json<Value>> {
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
         RETURNING id, username, display_name, email, avatar_url, bio, status, created_at",
    )
    .bind(id)
    .bind(&username)
    .bind(&display_name)
    .bind(&email)
    .bind(&hash)
    .fetch_one(&state.db)
    .await?;

    let token = issue_token(&state.config.jwt_secret, user.id)?;
    Ok(Json(json!({ "token": token, "user": user })))
}

#[derive(Deserialize)]
struct LoginReq {
    login: String,
    password: String,
}

async fn login(State(state): State<AppState>, Json(req): Json<LoginReq>) -> AppResult<Json<Value>> {
    let login = req.login.trim().to_lowercase();
    let row: Option<(Uuid, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE username = $1 OR email = $1")
            .bind(&login)
            .fetch_optional(&state.db)
            .await?;
    let (id, hash) = row.ok_or_else(|| AppError::BadRequest("Invalid credentials".into()))?;
    if !verify_password(&req.password, &hash) {
        return Err(AppError::BadRequest("Invalid credentials".into()));
    }
    let user = sqlx::query_as::<_, PrivateUser>(
        "SELECT id, username, display_name, email, avatar_url, bio, status, created_at FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    let token = issue_token(&state.config.jwt_secret, id)?;
    Ok(Json(json!({ "token": token, "user": user })))
}
