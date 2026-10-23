//! Outgoing email. `MAIL_MODE` picks the transport: `smtp` (needs `SMTP_URL`, e.g.
//! smtp://user:pass@mail.example.com:587?tls=required), `log` (print to the server log; the default)
//! or `off`. Every sent mail is also kept in a small in-memory outbox that admins can read
//! (`GET /admin/mail?to=`), which is how development and the e2e suites get at links.

use crate::{config::Config, error::{AppError, AppResult}};
use lettre::{message::header::ContentType, transport::smtp::AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde::Serialize;
use std::{collections::VecDeque, sync::Mutex};

#[derive(Debug, Clone, Serialize)]
pub struct SentMail {
    pub to: String,
    pub subject: String,
    pub body: String,
    pub sent_at: chrono::DateTime<chrono::Utc>,
    /// What happened: `sent` (the SMTP server accepted it), `failed` (see `error`), `logged` (MAIL_MODE=log) or `off`.
    pub status: &'static str,
    pub error: Option<String>,
}

static OUTBOX: Mutex<VecDeque<SentMail>> = Mutex::new(VecDeque::new());

/// Newest first, optionally for one recipient; `limit` defaults to 50 and is capped at the 200 kept.
pub fn outbox(to: Option<&str>, limit: Option<usize>) -> Vec<SentMail> {
    let box_ = OUTBOX.lock().unwrap();
    box_.iter().rev().filter(|m| to.map(|t| m.to.eq_ignore_ascii_case(t)).unwrap_or(true)).take(limit.unwrap_or(50).min(200)).cloned().collect()
}

fn record(to: &str, subject: &str, body: &str, status: &'static str, error: Option<String>) {
    let mut box_ = OUTBOX.lock().unwrap();
    box_.push_back(SentMail { to: to.to_string(), subject: subject.to_string(), body: body.to_string(), sent_at: chrono::Utc::now(), status, error });
    while box_.len() > 200 { box_.pop_front(); }
}

pub fn enabled(config: &Config) -> bool {
    config.mail_mode != "off"
}

/// Send a plain-text mail and record the outcome in the outbox. Delivery failures are logged, never surfaced to
/// users; a misconfigured SMTP_URL / MAIL_FROM or an unusable recipient address is returned as an error.
pub async fn send(config: &Config, to: &str, subject: &str, body: &str) -> AppResult<()> {
    match config.mail_mode.as_str() {
        "off" => { record(to, subject, body, "off", None); Ok(()) }
        "smtp" => match deliver(config, to, subject, body).await {
            Ok(Ok(())) => { record(to, subject, body, "sent", None); Ok(()) }
            Ok(Err(e)) => {
                tracing::error!(error = %e, to, "mail send failed");
                record(to, subject, body, "failed", Some(e));
                Ok(())
            }
            Err(e) => { record(to, subject, body, "failed", Some(e.to_string())); Err(e) }
        },
        _ => {
            tracing::info!(to, subject, "mail (MAIL_MODE=log):\n{body}");
            record(to, subject, body, "logged", None);
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
