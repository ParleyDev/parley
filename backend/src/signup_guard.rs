//! Keeping fake and throwaway sign-ups out (all optional, in Instance Settings):
//! - disposable email services (a built-in list plus the admin's own domains) are refused at sign-up and email change;
//! - a domain that can't receive mail (no MX record, or a null MX) is refused;
//! - a CAPTCHA (Cloudflare Turnstile or hCaptcha) on sign-up;
//! - unverified accounts can read but not post (messages, reactions, new DMs, friend requests);
//! - accounts that never confirm their email are removed after a number of days.
//! The last two only apply when this server can send mail, since nobody could verify otherwise.

use std::{sync::OnceLock, time::Duration};

use serde_json::Value;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    routes::admin::InstanceSettings,
    state::AppState,
};

static BUILTIN: OnceLock<Vec<String>> = OnceLock::new();

fn http() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().timeout(Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none()).build().unwrap_or_default())
}

fn builtin() -> &'static [String] {
    BUILTIN.get_or_init(|| {
        include_str!("disposable_domains.txt").lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).map(str::to_ascii_lowercase).collect()
    })
}

/// The admin's extra blocked domains: one per line or comma separated, `@` and `*.` prefixes ignored.
pub fn parse_domains(list: &str) -> Vec<String> {
    list.split([',', '\n', ' ', ';']).map(|d| d.trim().trim_start_matches('@').trim_start_matches("*.").trim_end_matches('.').to_ascii_lowercase()).filter(|d| d.contains('.')).collect()
}

fn domain_of(email: &str) -> Option<&str> { email.rsplit_once('@').map(|(_, d)| d.trim_end_matches('.')).filter(|d| !d.is_empty()) }

/// `domain` is `listed` or a subdomain of it.
fn covers(listed: &str, domain: &str) -> bool { domain == listed || domain.ends_with(&format!(".{listed}")) }

/// Is this a throwaway address under the instance's settings?
pub fn disposable(s: &InstanceSettings, email: &str) -> bool {
    let Some(d) = domain_of(email) else { return false };
    let d = d.to_ascii_lowercase();
    parse_domains(&s.blocked_email_domains).iter().any(|l| covers(l, &d)) || (s.block_disposable_emails && builtin().iter().any(|l| covers(l, &d)))
}

/// Can the domain receive mail? MX records (a single "." target is RFC 7505's "accepts no mail"), or, with no MX,
/// an address record (the implicit MX). A lookup that fails for other reasons (DNS down, timeout) lets it through.
async fn receives_mail(domain: &str) -> bool {
    use hickory_resolver::{error::ResolveErrorKind, TokioAsyncResolver};
    let resolver = match TokioAsyncResolver::tokio_from_system_conf() {
        Ok(r) => r,
        Err(e) => { tracing::warn!(error = %e, "no DNS resolver for the mail domain check"); return true }
    };
    let fqdn = format!("{domain}.");
    let no_records = |k: &ResolveErrorKind| matches!(k, ResolveErrorKind::NoRecordsFound { .. });
    match tokio::time::timeout(Duration::from_secs(4), resolver.mx_lookup(fqdn.as_str())).await {
        Ok(Ok(mx)) => {
            let hosts: Vec<String> = mx.iter().map(|r| r.exchange().to_utf8()).collect();
            !hosts.is_empty() && !hosts.iter().all(|h| h == "." || h.is_empty())
        }
        Ok(Err(e)) if no_records(e.kind()) => {
            // No MX at all (or the name doesn't exist): mail falls back to the domain's own address, if it has one.
            match tokio::time::timeout(Duration::from_secs(4), resolver.lookup_ip(fqdn.as_str())).await {
                Ok(Ok(ips)) => ips.iter().next().is_some(),
                Ok(Err(e)) if no_records(e.kind()) => false,
                _ => true,
            }
        }
        _ => true,
    }
}

/// Everything about an address used to sign up or change to: throwaway services and domains that take no mail.
pub async fn check_email(s: &InstanceSettings, email: &str) -> AppResult<()> {
    if disposable(s, email) {
        return Err(AppError::BadRequest("Disposable email addresses can't be used here. Please use your regular email.".into()));
    }
    if s.check_email_domain {
        if let Some(d) = domain_of(email) {
            if !receives_mail(d).await {
                return Err(AppError::BadRequest("That email domain can't receive mail. Check the address for typos.".into()));
            }
        }
    }
    Ok(())
}

/// The CAPTCHA on sign-up, when one is configured: the token from the widget, checked with the provider.
pub async fn check_captcha(s: &InstanceSettings, token: Option<&str>, ip: &str) -> AppResult<()> {
    let provider = s.captcha_provider.as_str();
    if provider.is_empty() || s.captcha_secret.trim().is_empty() || s.captcha_site_key.trim().is_empty() {
        return Ok(());
    }
    let token = token.map(str::trim).filter(|t| !t.is_empty()).ok_or_else(|| AppError::BadRequest("Please complete the CAPTCHA.".into()))?;
    let url = if !s.captcha_verify_url.trim().is_empty() {
        s.captcha_verify_url.trim().to_string()
    } else if provider == "hcaptcha" {
        "https://api.hcaptcha.com/siteverify".to_string()
    } else {
        "https://challenges.cloudflare.com/turnstile/v0/siteverify".to_string()
    };
    let mut form = vec![("secret", s.captcha_secret.trim().to_string()), ("response", token.to_string()), ("sitekey", s.captcha_site_key.trim().to_string())];
    if !ip.is_empty() { form.push(("remoteip", ip.to_string())) }
    let res = http().post(&url).form(&form).send().await;
    let ok = match res {
        Ok(r) => r.json::<Value>().await.ok().and_then(|v| v.get("success").and_then(Value::as_bool)).unwrap_or(false),
        Err(e) => { tracing::warn!(error = %e, provider, "CAPTCHA check failed to reach the provider"); false }
    };
    if ok { Ok(()) } else { Err(AppError::BadRequest("The CAPTCHA check failed. Please try again.".into())) }
}

/// Unverified accounts are read-only on this instance: refuse posting until the email is confirmed. Bots, the system
/// account and staff are never held back.
pub async fn require_can_post(state: &AppState, uid: Uuid) -> AppResult<()> {
    if !crate::mail::enabled(&state.config) || !crate::routes::admin::load_settings(&state.db).await?.unverified_read_only {
        return Ok(());
    }
    let ok: Option<(bool,)> = sqlx::query_as(
        "SELECT email_verified_at IS NOT NULL OR bot OR system OR is_admin OR EXISTS (SELECT 1 FROM admin_roles r WHERE r.user_id = users.id) FROM users WHERE id = $1",
    )
    .bind(uid)
    .fetch_optional(&state.db)
    .await?;
    if ok.map(|r| r.0).unwrap_or(true) { Ok(()) } else { Err(AppError::EmailUnverified) }
}

/// Remove accounts that never confirmed their email within the configured number of days (the normal account
/// deletion: anonymized, nothing left that points back to them). Bots, the system account and staff are kept.
pub async fn purge_unverified(state: &AppState) -> AppResult<usize> {
    if !crate::mail::enabled(&state.config) {
        return Ok(0);
    }
    let days = crate::routes::admin::load_settings(&state.db).await?.unverified_delete_days;
    if days <= 0 {
        return Ok(0);
    }
    let due: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM users WHERE email_verified_at IS NULL AND account_state = 'active' AND NOT bot AND NOT system AND NOT is_admin
           AND NOT EXISTS (SELECT 1 FROM admin_roles r WHERE r.user_id = users.id)
           AND created_at < now() - make_interval(days => $1) ORDER BY created_at LIMIT 200",
    )
    .bind(days as i32)
    .fetch_all(&state.db)
    .await?;
    let mut n = 0;
    for (uid,) in due {
        match crate::routes::deletion::finalize_now(state, uid).await {
            Ok(true) => n += 1,
            Ok(false) => {}
            Err(e) => tracing::warn!(error = ?e, %uid, "removing an unverified account failed"),
        }
    }
    Ok(n)
}
