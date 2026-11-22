//! Abuse across the instance: sanctions on accounts, the detectors that watch for spam, and the rate limits on
//! starting things. Per-server tools (AutoMod, raid protection, verification levels) live elsewhere; this is what
//! sees one account's behaviour across every server and DM.
//!
//! Sanctions (`account_sanctions`): `limit` (a soft ban: nothing new can be started), `quiet` (first messages and
//! friend requests look sent and reach nobody), `suspend` (cannot sign in; temporary with an expiry, "hard" when
//! it also remembers the email and network addresses). Every one is reversible and audited.
//!
//! Detectors never act on staff, bots or the system account. What they notice goes to the review queue
//! (`abuse_flags`); the automatic action is at most a three-day `limit`, and only while the operator leaves
//! automatic actions on. Suspending is always a person's decision.

use crate::{error::{AppError, AppResult}, state::AppState};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

pub const KINDS: &[&str] = &["limit", "quiet", "suspend"];
pub const REASONS: &[&str] = &["spam", "underage", "evasion", "abuse", "other"];

/// The automatic limit lasts this long unless a person changes it.
const AUTO_LIMIT_DAYS: i64 = 3;

// ---- rate limits on starting things ---------------------------------------------------------------------------

/// Take one token from a per-account bucket, or answer 429 with how long to wait.
pub fn rate(bucket: &'static str, uid: Uuid, count: f64, secs: f64) -> AppResult<()> {
    match crate::ratelimit::LIMITER.take(bucket, &uid.to_string(), crate::ratelimit::Limit { count, secs }) {
        Ok(_) => Ok(()),
        Err(wait) => Err(AppError::TooMany(format!("You're doing that too quickly. Try again in {} seconds.", wait.max(1)))),
    }
}
pub fn rate_friend_request(uid: Uuid) -> AppResult<()> { rate("friend_requests", uid, 30.0, 3600.0) }
pub fn rate_dm_open(uid: Uuid) -> AppResult<()> { rate("dm_open", uid, 30.0, 600.0) }
pub fn rate_invite_create(uid: Uuid) -> AppResult<()> { rate("invite_create", uid, 30.0, 3600.0) }
pub fn rate_invite_accept(uid: Uuid) -> AppResult<()> { rate("invite_accept", uid, 30.0, 3600.0) }
pub fn rate_reaction(uid: Uuid) -> AppResult<()> { rate("reactions", uid, 60.0, 30.0) }

// ---- sanctions ------------------------------------------------------------------------------------------------

/// Sanctions in force on an account: (id, kind, reason, expires_at).
pub async fn active(db: &PgPool, uid: Uuid) -> AppResult<Vec<(Uuid, String, String, Option<DateTime<Utc>>)>> {
    Ok(sqlx::query_as("SELECT id, kind, reason, expires_at FROM account_sanctions WHERE user_id = $1 AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at")
        .bind(uid).fetch_all(db).await?)
}

/// Refuse something new (a first message, a friend request, joining or creating a server, an invite) to a limited
/// account, saying until when.
pub async fn deny_new(db: &PgPool, uid: Uuid) -> AppResult<()> {
    let row: Option<(Option<DateTime<Utc>>,)> = sqlx::query_as("SELECT expires_at FROM account_sanctions WHERE user_id = $1 AND kind = 'limit' AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY expires_at DESC NULLS FIRST LIMIT 1")
        .bind(uid).fetch_optional(db).await?;
    match row {
        None => Ok(()),
        Some((Some(until),)) => Err(AppError::ForbiddenWith(format!("Your account is limited until {}: you can carry on where you already are, but not start new conversations, add friends, or join or create servers. See My Account in Settings.", until.format("%-d %B %Y, %H:%M UTC")))),
        Some((None,)) => Err(AppError::ForbiddenWith("Your account is limited: you can carry on where you already are, but not start new conversations, add friends, or join or create servers. See My Account in Settings.".into())),
    }
}

/// A confirmed spammer: what they start looks sent and reaches nobody.
pub async fn is_quiet(db: &PgPool, uid: Uuid) -> bool {
    sqlx::query_as::<_, (bool,)>("SELECT true FROM account_sanctions WHERE user_id = $1 AND kind = 'quiet' AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now()) LIMIT 1")
        .bind(uid).fetch_optional(db).await.ok().flatten().is_some()
}

/// In a DM whose other side has not accepted the sender: a quiet sender's message is kept for them and shown to
/// nobody else (the other side's request is set aside as if they had ignored it). True when that happened.
pub async fn quiet_dm(db: &PgPool, sender: Uuid, channel_id: Uuid) -> bool {
    if !is_quiet(db, sender).await { return false }
    let pending: Option<(bool,)> = sqlx::query_as("SELECT true FROM channel_members WHERE channel_id = $1 AND user_id <> $2 AND request_state <> 'accepted' LIMIT 1").bind(channel_id).bind(sender).fetch_optional(db).await.ok().flatten();
    if pending.is_none() { return false }
    let _ = sqlx::query("UPDATE channel_members SET request_state = 'ignored' WHERE channel_id = $1 AND user_id <> $2 AND request_state <> 'accepted'").bind(channel_id).bind(sender).execute(db).await;
    true
}

fn marker(secret: &str, kind: &str, value: &str) -> String {
    use hmac::{Hmac, Mac};
    let mut mac = <Hmac<sha2::Sha256> as Mac>::new_from_slice(format!("parley-ban-marker:{secret}").as_bytes()).expect("any key length");
    mac.update(kind.as_bytes()); mac.update(b"|"); mac.update(value.as_bytes());
    mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

/// An email address as one person's: lower case, and for the big providers that ignore them, no dots and no
/// `+tag` in the name. `Jo.Smith+spam@Gmail.com` and `josmith@gmail.com` are the same mailbox.
pub fn canonical_email(email: &str) -> String {
    let e = email.trim().to_lowercase();
    let Some((name, domain)) = e.rsplit_once('@') else { return e };
    let domain = if domain == "googlemail.com" { "gmail.com" } else { domain };
    let name = name.split('+').next().unwrap_or(name);
    let name = if domain == "gmail.com" { name.replace('.', "") } else { name.to_string() };
    format!("{name}@{domain}")
}

/// Whether a hard ban in force remembers this email address.
pub async fn email_banned(state: &AppState, email: &str) -> bool {
    let h = marker(&state.config.jwt_secret, "email", &canonical_email(email));
    sqlx::query_as::<_, (bool,)>("SELECT true FROM ban_markers m JOIN account_sanctions s ON s.id = m.sanction_id WHERE m.kind = 'email' AND m.value_hash = $1 AND s.lifted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now()) LIMIT 1")
        .bind(h).fetch_optional(&state.db).await.ok().flatten().is_some()
}

/// A new account from a network address a hard ban remembers: put it in front of a person. Addresses are shared
/// (homes, schools, mobile carriers), so this never blocks by itself.
pub async fn check_new_account(state: &AppState, uid: Uuid, ip: &str) {
    if ip.is_empty() || ip == "unknown" { return }
    let h = marker(&state.config.jwt_secret, "ip", ip);
    let hit: Option<(Uuid, Option<String>)> = sqlx::query_as(
        "SELECT s.id, (SELECT username FROM users WHERE id = s.user_id) FROM ban_markers m JOIN account_sanctions s ON s.id = m.sanction_id
          WHERE m.kind = 'ip' AND m.value_hash = $1 AND s.lifted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now()) ORDER BY s.created_at DESC LIMIT 1",
    ).bind(h).fetch_optional(&state.db).await.ok().flatten();
    if let Some((sid, name)) = hit {
        flag(state, uid, "evasion", json!({ "same_network_as_banned": name, "ban": sid }), None).await;
    }
}

pub struct NewSanction<'a> { pub user: Uuid, pub kind: &'a str, pub reason: &'a str, pub note: &'a str, pub source: &'a str, pub hard: bool, pub days: Option<i64>, pub by: Option<Uuid> }

/// Put a sanction on an account and make it take effect: a suspension signs the account out everywhere, and a
/// hard one records its markers.
pub async fn impose(state: &AppState, s: NewSanction<'_>) -> AppResult<Uuid> {
    let id = Uuid::now_v7();
    let expires = s.days.filter(|d| *d > 0).map(|d| Utc::now() + chrono::Duration::days(d));
    sqlx::query("INSERT INTO account_sanctions (id, user_id, kind, reason, note, source, hard, expires_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
        .bind(id).bind(s.user).bind(s.kind).bind(s.reason).bind(s.note).bind(s.source).bind(s.hard && s.kind == "suspend").bind(expires).bind(s.by).execute(&state.db).await?;
    if s.kind == "suspend" {
        sqlx::query("UPDATE users SET suspended_at = COALESCE(suspended_at, now()) WHERE id = $1").bind(s.user).execute(&state.db).await?;
        sqlx::query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL").bind(s.user).execute(&state.db).await?;
        state.hub.emit_users(vec![s.user], "SESSION_REVOKED", json!({ "reason": suspended_message(s.reason) }));
        if s.hard {
            if let Ok(Some((email,))) = sqlx::query_as::<_, (Option<String>,)>("SELECT email FROM users WHERE id = $1").bind(s.user).fetch_optional(&state.db).await {
                if let Some(e) = email.filter(|e| e.contains('@')) {
                    let _ = sqlx::query("INSERT INTO ban_markers (sanction_id, kind, value_hash) VALUES ($1, 'email', $2) ON CONFLICT DO NOTHING").bind(id).bind(marker(&state.config.jwt_secret, "email", &canonical_email(&e))).execute(&state.db).await;
                }
            }
            let ips: Vec<(String,)> = sqlx::query_as("SELECT DISTINCT ip FROM user_network_log WHERE user_id = $1 AND last_seen > now() - interval '30 days' LIMIT 50").bind(s.user).fetch_all(&state.db).await.unwrap_or_default();
            for (ip,) in ips {
                let _ = sqlx::query("INSERT INTO ban_markers (sanction_id, kind, value_hash) VALUES ($1, 'ip', $2) ON CONFLICT DO NOTHING").bind(id).bind(marker(&state.config.jwt_secret, "ip", &ip)).execute(&state.db).await;
            }
        }
    } else {
        state.hub.emit_users(vec![s.user], "STANDING_UPDATE", json!({}));
    }
    Ok(id)
}

/// What a suspended person is told when they try to sign in.
pub fn suspended_message(reason: &str) -> &'static str {
    match reason {
        "underage" => "This account is suspended because it appears to belong to someone under 13. Contact the people who run this Parley instance to have it reviewed.",
        _ => "This account has been suspended.",
    }
}

/// Why a suspended account is suspended, when a sanction says so.
pub async fn suspension_reason(db: &PgPool, uid: Uuid) -> String {
    sqlx::query_as::<_, (String,)>("SELECT reason FROM account_sanctions WHERE user_id = $1 AND kind = 'suspend' AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1")
        .bind(uid).fetch_optional(db).await.ok().flatten().map(|r| r.0).unwrap_or_default()
}

/// End a sanction. A suspension that was the account's last one gives the account back.
pub async fn lift(state: &AppState, id: Uuid, by: Option<Uuid>, note: &str) -> AppResult<Option<(Uuid, String, String)>> {
    let Some((user, kind, reason)): Option<(Option<Uuid>, String, String)> = sqlx::query_as("UPDATE account_sanctions SET lifted_at = now(), lifted_by = $2, lift_note = $3 WHERE id = $1 AND lifted_at IS NULL RETURNING user_id, kind, reason")
        .bind(id).bind(by).bind(note).fetch_optional(&state.db).await? else { return Ok(None) };
    let Some(user) = user else { return Ok(None) };
    if kind == "suspend" {
        sqlx::query("UPDATE users SET suspended_at = NULL WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM account_sanctions WHERE user_id = $1 AND kind = 'suspend' AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now()))")
            .bind(user).execute(&state.db).await?;
    } else {
        state.hub.emit_users(vec![user], "STANDING_UPDATE", json!({}));
    }
    Ok(Some((user, kind, reason)))
}

/// A temporary suspension that has just run out should not wait for the next sweep when its owner signs in.
pub async fn settle_user(state: &AppState, uid: Uuid) {
    let due: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM account_sanctions WHERE user_id = $1 AND lifted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now()").bind(uid).fetch_all(&state.db).await.unwrap_or_default();
    for (id,) in due { let _ = lift(state, id, None, "Ran out").await; }
}

/// Every minute: temporary suspensions that have run out give the account back. Hourly: old counters go.
pub async fn sweep_loop(state: AppState) {
    let mut n = 0u32;
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        let due: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM account_sanctions WHERE lifted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now() LIMIT 200").fetch_all(&state.db).await.unwrap_or_default();
        for (id,) in due { let _ = lift(&state, id, None, "Ran out").await; }
        n += 1;
        if n % 60 == 0 { let _ = sqlx::query("DELETE FROM abuse_events WHERE at < now() - interval '1 day'").execute(&state.db).await; }
    }
}

// ---- detection ------------------------------------------------------------------------------------------------

/// Staff, bots, webhooks, the system account and guests (who have their own limits) are not watched.
async fn exempt(db: &PgPool, uid: Uuid) -> bool {
    sqlx::query_as::<_, (bool,)>("SELECT bot OR webhook OR system OR guest OR is_admin OR EXISTS (SELECT 1 FROM admin_roles r WHERE r.user_id = users.id) FROM users WHERE id = $1")
        .bind(uid).fetch_optional(db).await.ok().flatten().map(|r| r.0).unwrap_or(true)
}

async fn auto_actions(db: &PgPool) -> bool {
    sqlx::query_as::<_, (Value,)>("SELECT value FROM instance_settings WHERE key = 'abuse_auto_actions'").fetch_optional(db).await.ok().flatten().and_then(|r| r.0.as_bool()).unwrap_or(true)
}

/// Add to the review queue (once per account, kind and hour).
pub async fn flag(state: &AppState, uid: Uuid, kind: &str, details: Value, sanction: Option<Uuid>) {
    let recent: Option<(bool,)> = sqlx::query_as("SELECT true FROM abuse_flags WHERE user_id = $1 AND kind = $2 AND created_at > now() - interval '1 hour' LIMIT 1").bind(uid).bind(kind).fetch_optional(&state.db).await.ok().flatten();
    if recent.is_some() { return }
    let _ = sqlx::query("INSERT INTO abuse_flags (id, user_id, kind, details, sanction_id) VALUES ($1, $2, $3, $4, $5)").bind(Uuid::now_v7()).bind(uid).bind(kind).bind(details).bind(sanction).execute(&state.db).await;
}

/// A detector fired: limit the account for a few days (unless it already is, or automatic actions are off) and
/// queue it for a person either way.
async fn caught(state: &AppState, uid: Uuid, kind: &str, details: Value) {
    let recent: Option<(bool,)> = sqlx::query_as("SELECT true FROM abuse_flags WHERE user_id = $1 AND kind = $2 AND created_at > now() - interval '1 hour' LIMIT 1").bind(uid).bind(kind).fetch_optional(&state.db).await.ok().flatten();
    if recent.is_some() { return }
    let already = active(&state.db, uid).await.map(|a| !a.is_empty()).unwrap_or(false);
    let sanction = if !already && auto_actions(&state.db).await {
        impose(state, NewSanction { user: uid, kind: "limit", reason: "spam", note: "Automatic: waiting for review", source: "auto", hard: false, days: Some(AUTO_LIMIT_DAYS), by: None }).await.ok()
    } else { None };
    if sanction.is_some() {
        crate::audit::record(state, uid, "sanction.auto", "user", Some(uid), &crate::audit::username(state, uid).await, json!({ "kind": "limit", "detector": kind, "days": AUTO_LIMIT_DAYS })).await;
    }
    flag(state, uid, kind, details, sanction).await;
}

/// A digest of what a message says with the noise taken out, so the same text with different spacing, case or
/// trailing numbers counts as the same.
pub fn text_digest(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let norm: String = content.to_lowercase().chars().filter(|c| c.is_alphabetic() || *c == '/' || *c == '.').collect();
    Sha256::digest(norm.as_bytes())[..8].iter().map(|b| format!("{b:02x}")).collect()
}

fn has_link(content: &str) -> bool {
    let c = content.to_lowercase();
    c.contains("http://") || c.contains("https://") || c.contains("www.") || c.contains("/invite/") || c.contains("discord.gg/")
}

/// After a message is sent (in the background): the same text to many places, links from a new account to many
/// places, and mass mentions.
pub fn after_message(state: AppState, uid: Uuid, channel_id: Uuid, content: String, mentions: usize) {
    if content.chars().count() < 12 && mentions == 0 { return }
    tokio::spawn(async move {
        if exempt(&state.db, uid).await { return }
        let age_days: i64 = sqlx::query_as::<_, (i64,)>("SELECT EXTRACT(EPOCH FROM now() - created_at)::bigint / 86400 FROM users WHERE id = $1").bind(uid).fetch_optional(&state.db).await.ok().flatten().map(|r| r.0).unwrap_or(9999);
        if content.chars().count() >= 12 {
            let h = text_digest(&content);
            let _ = sqlx::query("INSERT INTO abuse_events (user_id, kind, target, hash) VALUES ($1, 'msg', $2, $3)").bind(uid).bind(channel_id).bind(&h).execute(&state.db).await;
            let (places,): (i64,) = sqlx::query_as("SELECT count(DISTINCT target) FROM abuse_events WHERE user_id = $1 AND kind = 'msg' AND hash = $2 AND at > now() - interval '10 minutes'").bind(uid).bind(&h).fetch_one(&state.db).await.unwrap_or((0,));
            if places >= 5 { caught(&state, uid, "duplicate_text", json!({ "places": places, "minutes": 10 })).await; }
            if age_days < 7 && has_link(&content) {
                let _ = sqlx::query("INSERT INTO abuse_events (user_id, kind, target) VALUES ($1, 'link', $2)").bind(uid).bind(channel_id).execute(&state.db).await;
                let (n,): (i64,) = sqlx::query_as("SELECT count(DISTINCT target) FROM abuse_events WHERE user_id = $1 AND kind = 'link' AND at > now() - interval '10 minutes'").bind(uid).fetch_one(&state.db).await.unwrap_or((0,));
                if n >= 4 { caught(&state, uid, "link_spam", json!({ "places": n, "minutes": 10, "account_age_days": age_days })).await; }
            }
        }
        if mentions > 0 && age_days < 30 {
            let _ = sqlx::query("INSERT INTO abuse_events (user_id, kind, target, n) VALUES ($1, 'mention', $2, $3)").bind(uid).bind(channel_id).bind(mentions as i32).execute(&state.db).await;
            let (n,): (Option<i64>,) = sqlx::query_as("SELECT sum(n) FROM abuse_events WHERE user_id = $1 AND kind = 'mention' AND at > now() - interval '1 minute'").bind(uid).fetch_one(&state.db).await.unwrap_or((None,));
            if n.unwrap_or(0) >= 30 { caught(&state, uid, "mention_spam", json!({ "mentions": n, "seconds": 60 })).await; }
        }
    });
}

/// After a new DM is opened or a friend request sent: a new account reaching out to many people at once.
pub fn after_reach(state: AppState, uid: Uuid, kind: &'static str, target: Uuid) {
    tokio::spawn(async move {
        if exempt(&state.db, uid).await { return }
        let fresh: bool = sqlx::query_as::<_, (bool,)>("SELECT created_at > now() - interval '7 days' FROM users WHERE id = $1").bind(uid).fetch_optional(&state.db).await.ok().flatten().map(|r| r.0).unwrap_or(false);
        if !fresh { return }
        let _ = sqlx::query("INSERT INTO abuse_events (user_id, kind, target) VALUES ($1, $2, $3)").bind(uid).bind(kind).bind(target).execute(&state.db).await;
        let (n,): (i64,) = sqlx::query_as("SELECT count(DISTINCT target) FROM abuse_events WHERE user_id = $1 AND kind = $2 AND at > now() - interval '10 minutes'").bind(uid).bind(kind).fetch_one(&state.db).await.unwrap_or((0,));
        let (limit, name) = if kind == "dm_open" { (20, "dm_burst") } else { (15, "friend_burst") };
        if n >= limit { caught(&state, uid, name, json!({ "people": n, "minutes": 10 })).await; }
    });
}

/// After a report is filed: several different people reporting one account in a day goes to the queue. Nothing is
/// done automatically, because reports can be organised.
pub fn after_report(state: AppState, target: Uuid) {
    tokio::spawn(async move {
        if exempt(&state.db, target).await { return }
        let (n,): (i64,) = sqlx::query_as("SELECT count(DISTINCT reporter_id) FROM reports WHERE target_user_id = $1 AND created_at > now() - interval '1 day'").bind(target).fetch_one(&state.db).await.unwrap_or((0,));
        if n >= 5 {
            let recent: Option<(bool,)> = sqlx::query_as("SELECT true FROM abuse_flags WHERE user_id = $1 AND kind = 'reports' AND created_at > now() - interval '1 day' LIMIT 1").bind(target).fetch_optional(&state.db).await.ok().flatten();
            if recent.is_none() { flag(&state, target, "reports", json!({ "reporters": n, "hours": 24 }), None).await; }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_mailbox_one_address() {
        assert_eq!(canonical_email(" Jo.Smith+spam@Gmail.com "), "josmith@gmail.com");
        assert_eq!(canonical_email("jo.smith@googlemail.com"), "josmith@gmail.com");
        assert_eq!(canonical_email("Jo.Smith+x@Example.org"), "jo.smith@example.org");
        assert_eq!(canonical_email("not-an-address"), "not-an-address");
    }

    #[test]
    fn the_same_text_dressed_differently_is_the_same() {
        let a = text_digest("FREE nitro at https://scam.example/claim 123");
        assert_eq!(a, text_digest("free   Nitro  at https://scam.example/claim   987!!"));
        assert_ne!(a, text_digest("free nitro at https://other.example/claim"));
    }

    #[test]
    fn markers_are_keyed_and_per_kind() {
        let m = marker("secret", "email", "a@b.c");
        assert_eq!(m.len(), 64);
        assert_ne!(m, marker("other", "email", "a@b.c"));
        assert_ne!(m, marker("secret", "ip", "a@b.c"));
        assert!(!m.contains("a@b.c"));
    }
}
