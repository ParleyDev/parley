//! Outgoing email. `MAIL_MODE` picks the transport: `smtp` (needs `SMTP_URL`, e.g.
//! smtp://user:pass@mail.example.com:587?tls=required), `log` (print to the server log; the default)
//! or `off`. Every mail is also recorded in `mail_log` with what happened to it, kept for the `mail_log_days` instance
//! setting (30 by default, 0 = forever) unless an admin deletes it; admins read it at `GET /admin/mail?to=`, which is
//! also how development and the e2e suites get at links.

use crate::{config::Config, error::{AppError, AppResult}, state::AppState};
use lettre::{message::header::ContentType, transport::smtp::AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SentMail {
    pub id: uuid::Uuid,
    #[sqlx(rename = "to_addr")]
    pub to: String,
    pub subject: String,
    pub body: String,
    pub sent_at: chrono::DateTime<chrono::Utc>,
    /// What happened: `sent` (the SMTP server accepted it), `failed` (see `error`), `logged` (MAIL_MODE=log) or `off`.
    pub status: String,
    pub error: Option<String>,
}

/// Newest first, optionally for one recipient; `limit` defaults to 50 and is capped at 500.
pub async fn outbox(db: &sqlx::PgPool, to: Option<&str>, limit: Option<i64>) -> AppResult<Vec<SentMail>> {
    Ok(sqlx::query_as("SELECT id, to_addr, subject, body, sent_at, status, error FROM mail_log WHERE $1::text IS NULL OR lower(to_addr) = lower($1) ORDER BY sent_at DESC, id DESC LIMIT $2")
        .bind(to).bind(limit.unwrap_or(50).clamp(1, 500)).fetch_all(db).await?)
}

/// Days the mail log keeps entries (0 = forever).
pub async fn retention_days(db: &sqlx::PgPool) -> i64 {
    sqlx::query_as::<_, (serde_json::Value,)>("SELECT value FROM instance_settings WHERE key = 'mail_log_days'")
        .fetch_optional(db).await.ok().flatten().and_then(|(v,)| v.as_i64()).unwrap_or(30).max(0)
}

/// Record a mail and drop entries past the retention period. Never fails the caller: a logging error is traced.
async fn record(state: &AppState, to: &str, subject: &str, body: &str, status: &str, error: Option<String>) {
    let days = retention_days(&state.db).await;
    let res = async {
        sqlx::query("INSERT INTO mail_log (id, to_addr, subject, body, status, error) VALUES ($1, $2, $3, $4, $5, $6)")
            .bind(uuid::Uuid::now_v7()).bind(to).bind(subject).bind(body).bind(status).bind(&error).execute(&state.db).await?;
        if days > 0 {
            sqlx::query("DELETE FROM mail_log WHERE sent_at < now() - make_interval(days => $1)").bind(days as i32).execute(&state.db).await?;
        }
        Ok::<_, sqlx::Error>(())
    }.await;
    if let Err(e) = res { tracing::error!(error = ?e, to, "could not record mail in mail_log"); }
}

pub fn enabled(config: &Config) -> bool {
    config.mail_mode != "off"
}

/// Send a plain-text mail and record the outcome in the outbox. Delivery failures are logged, never surfaced to
/// users; a misconfigured SMTP_URL / MAIL_FROM or an unusable recipient address is returned as an error.
pub async fn send(state: &AppState, to: &str, subject: &str, body: &str) -> AppResult<()> {
    let config = &state.config;
    match config.mail_mode.as_str() {
        "off" => { record(state, to, subject, body, "off", None).await; Ok(()) }
        "smtp" => match deliver(config, to, subject, body).await {
            Ok(Ok(())) => { record(state, to, subject, body, "sent", None).await; Ok(()) }
            Ok(Err(e)) => {
                tracing::error!(error = %e, to, "mail send failed");
                record(state, to, subject, body, "failed", Some(e)).await;
                Ok(())
            }
            Err(e) => { record(state, to, subject, body, "failed", Some(e.to_string())).await; Err(e) }
        },
        _ => {
            tracing::info!(to, subject, "mail (MAIL_MODE=log):\n{body}");
            record(state, to, subject, body, "logged", None).await;
            Ok(())
        }
    }
}

/// Outer error: the mail could not be built (configuration or recipient). Inner error: the SMTP server refused it.
async fn deliver(config: &Config, to: &str, subject: &str, body: &str) -> AppResult<Result<(), String>> {
    let url = config.smtp_url.as_deref().ok_or_else(|| AppError::Other(anyhow::anyhow!("MAIL_MODE=smtp but SMTP_URL is not set")))?;
    let mailer = AsyncSmtpTransport::<Tokio1Executor>::from_url(url).map_err(|e| AppError::Other(anyhow::anyhow!("bad SMTP_URL: {e}")))?.build();
    let msg = Message::builder()
        .from(config.mail_from.parse().map_err(|e| AppError::Other(anyhow::anyhow!("bad MAIL_FROM: {e}")))?)
        .to(to.parse().map_err(|e| AppError::BadRequest(format!("bad recipient: {e}")))?)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_string())
        .map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
    Ok(mailer.send(msg).await.map(|_| ()).map_err(|e| e.to_string()))
}

/// 32 random bytes as hex: the shape of verification and reset tokens.
pub fn new_token() -> String {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}
