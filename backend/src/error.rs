use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    /// A DM that cannot reach its recipient (blocked either way). 403 with `code: "undeliverable"` so the client can
    /// keep the message as "not delivered" instead of showing a bare error.
    #[error("undeliverable")]
    Undeliverable,
    /// Membership screening: the member has not accepted the server rules yet (403, code "rules_required").
    #[error("rules_required")]
    RulesRequired,
    /// AutoMod stopped it (403, code "automod", with the server's message).
    #[error("{0}")]
    Blocked(String),
    /// 18+ channel: no birth date on file yet (403, code "age_required") or under 18 (403, code "age_restricted").
    #[error("age gate")]
    AgeGate(bool),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    /// 429 with a message: a per-feature cooldown (username changes, ...).
    #[error("{0}")]
    TooMany(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, msg) = match &self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized".into()),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "Forbidden".into()),
            AppError::RulesRequired => {
                return (StatusCode::FORBIDDEN, Json(json!({ "error": "Accept the server rules before chatting.", "code": "rules_required" }))).into_response();
            }
            AppError::Undeliverable => {
                return (StatusCode::FORBIDDEN, Json(json!({ "error": "Your message could not be delivered.", "code": "undeliverable" }))).into_response();
            }
            AppError::Blocked(m) => {
                return (StatusCode::FORBIDDEN, Json(json!({ "error": m, "code": "automod" }))).into_response();
            }
            AppError::AgeGate(known) => {
                return if *known { (StatusCode::FORBIDDEN, Json(json!({ "error": "You must be 18 or older to view this channel.", "code": "age_restricted" }))).into_response() }
                else { (StatusCode::FORBIDDEN, Json(json!({ "error": "Confirm your birth date to view age-restricted channels.", "code": "age_required" }))).into_response() };
            }
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m.clone()),
            AppError::Conflict(m) => (StatusCode::CONFLICT, m.clone()),
            AppError::TooMany(m) => (StatusCode::TOO_MANY_REQUESTS, m.clone()),
            AppError::Db(sqlx::Error::RowNotFound) => (StatusCode::NOT_FOUND, "Not found".into()),
            AppError::Db(e) => {
                tracing::error!(error = ?e, "database error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal error".into())
            }
            AppError::Other(e) => {
                tracing::error!(error = ?e, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal error".into())
            }
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
