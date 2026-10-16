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
}

static OUTBOX: Mutex<VecDeque<SentMail>> = Mutex::new(VecDeque::new());

pub fn outbox(to: Option<&str>) -> Vec<SentMail> {
    let box_ = OUTBOX.lock().unwrap();
    box_.iter().rev().filter(|m| to.map(|t| m.to.eq_ignore_ascii_case(t)).unwrap_or(true)).take(50).cloned().collect()
}

pub fn enabled(config: &Config) -> bool {
    config.mail_mode != "off"
}

/// Send a plain-text mail. Errors are logged, never surfaced to users, except a misconfigured SMTP URL.
pub async fn send(config: &Config, to: &str, subject: &str, body: &str) -> AppResult<()> {
    {
        let mut box_ = OUTBOX.lock().unwrap();
        box_.push_back(SentMail { to: to.to_string(), subject: subject.to_string(), body: body.to_string(), sent_at: chrono::Utc::now() });
        while box_.len() > 200 { box_.pop_front(); }
    }
    match config.mail_mode.as_str() {
        "off" => Ok(()),
        "smtp" => {
            let url = config.smtp_url.as_deref().ok_or_else(|| AppError::Other(anyhow::anyhow!("MAIL_MODE=smtp but SMTP_URL is not set")))?;
            let mailer = AsyncSmtpTransport::<Tokio1Executor>::from_url(url).map_err(|e| AppError::Other(anyhow::anyhow!("bad SMTP_URL: {e}")))?.build();
            let msg = Message::builder()
                .from(config.mail_from.parse().map_err(|e| AppError::Other(anyhow::anyhow!("bad MAIL_FROM: {e}")))?)
                .to(to.parse().map_err(|e| AppError::BadRequest(format!("bad recipient: {e}")))?)
                .subject(subject)
                .header(ContentType::TEXT_PLAIN)
                .body(body.to_string())
                .map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
            if let Err(e) = mailer.send(msg).await {
                tracing::error!(error = %e, to, "mail send failed");
            }
            Ok(())
        }
        _ => {
            tracing::info!(to, subject, "mail (MAIL_MODE=log):\n{body}");
            Ok(())
        }
    }
}

/// 32 random bytes as hex: the shape of verification and reset tokens.
pub fn new_token() -> String {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}
