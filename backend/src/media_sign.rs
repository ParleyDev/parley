//! Signed, expiring links to attachments.
//!
//! An attachment's address used to be enough to fetch it, for ever, by anyone who had the address. Now the address
//! handed out with a message carries an expiry and a signature (`?ex=…&sig=…`), and the file is served only to a
//! link that is still valid or to a signed-in member who can see the channel (`routes::attachments`). A copied link
//! stops working within two days; `<img>`, `<video>` and downloads, which cannot send a login, keep working.
//!
//! Attachments uploaded before an instance started signing (`SINCE`) are exempt: their plain addresses still work.
//!
//! Files in a channel with a minimum age get a different, shorter kind of link (four to eight hours), and only that
//! kind or the login of someone who meets the age opens them: a link made before the channel was restricted, or
//! one a day old, does not.
//!
//! The expiry is rounded to a day so a file's address is stable for that day (browser caches stay useful): a link
//! is good for between one and two days from when it was made.

use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::sync::OnceLock;
use uuid::Uuid;

static KEY: OnceLock<Vec<u8>> = OnceLock::new();
/// When this instance began signing links (migration 0172). Older attachments are still served at their plain address.
static SINCE: OnceLock<chrono::DateTime<chrono::Utc>> = OnceLock::new();

/// Read the cutover moment once the migrations have run.
pub async fn load(db: &sqlx::PgPool) {
    let v: Option<(chrono::DateTime<chrono::Utc>,)> = sqlx::query_as("SELECT (value #>> '{}')::timestamptz FROM instance_settings WHERE key = 'attachment_links_signed_since'").fetch_optional(db).await.ok().flatten();
    if let Some((t,)) = v { let _ = SINCE.set(t); }
}

/// Whether an attachment uploaded at `created_at` needs a signed link or a login. Ones from before the cutover do
/// not: their plain addresses were handed out as permanent and keep working. With no cutover on record, all do.
pub fn required(created_at: chrono::DateTime<chrono::Utc>) -> bool { SINCE.get().map(|s| created_at >= *s).unwrap_or(true) }
const DAY: i64 = 86_400;
/// Links to files in age-restricted channels are rounded to this, so they last between one and two of them.
const SHORT: i64 = 4 * 3600;

/// Derive the signing key from the instance secret. Every backend of an instance shares the secret, so any of them
/// can check a link another made.
pub fn init(secret: &str) {
    let mut m = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("hmac takes any key length");
    m.update(b"parley attachment links v1");
    let _ = KEY.set(m.finalize().into_bytes().to_vec());
}

fn sig(id: Uuid, ex: i64, short: bool) -> String {
    let key = KEY.get().map(Vec::as_slice).unwrap_or(b"parley-unset-key");
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("hmac takes any key length");
    // A different message for the short kind, so a day link can never pass as one.
    if short { m.update(b"restricted"); }
    m.update(id.as_bytes());
    m.update(&ex.to_be_bytes());
    m.finalize().into_bytes()[..16].iter().map(|b| format!("{b:02x}")).collect()
}

fn expiry(now: i64, short: bool) -> i64 { let step = if short { SHORT } else { DAY }; (now.div_euclid(step) + 2) * step }

/// `ex=…&sig=…` for an attachment, valid from now. `short`: the file is in an age-restricted channel.
pub fn query(id: Uuid, short: bool) -> String {
    let ex = expiry(chrono::Utc::now().timestamp(), short);
    format!("ex={ex:x}&sig={}", sig(id, ex, short))
}

/// Whether `ex` and `sig` from a link are a signature of ours for this attachment that has not run out.
/// `short`: only the short kind will do.
pub fn valid(id: Uuid, ex: &str, given: &str, short: bool) -> bool { valid_at(id, ex, given, chrono::Utc::now().timestamp(), short) }

fn valid_at(id: Uuid, ex: &str, given: &str, now: i64, short: bool) -> bool {
    let Ok(ex) = i64::from_str_radix(ex, 16) else { return false };
    if ex <= now || ex > now + 3 * if short { SHORT } else { DAY } { return false }
    let want = sig(id, ex, short);
    // Constant time: the comparison must not tell a guesser how many leading characters were right.
    want.len() == given.len() && want.bytes().zip(given.bytes()).fold(0u8, |d, (a, b)| d | (a ^ b)) == 0
}

/// Sign an attachment address (`/api/attachments/<id>/…`, with or without a query). Anything else is returned as is.
/// A leading `!` (put there by the query that built the address) marks a file in an age-restricted channel.
pub fn sign_path(path: &str) -> String {
    match path.strip_prefix('!') { Some(p) => sign(p, true), None => sign(path, false) }
}

/// Sign an attachment address, with the short kind of link when the file is in an age-restricted channel.
pub fn sign(path: &str, short: bool) -> String {
    let Some(rest) = path.strip_prefix("/api/attachments/") else { return path.to_string() };
    let Some(id) = rest.get(..36).and_then(|s| Uuid::parse_str(s).ok()) else { return path.to_string() };
    format!("{path}{}{}", if path.contains('?') { '&' } else { '?' }, query(id, short))
}

/// For `#[serde(serialize_with)]` on a field holding an attachment address.
pub fn serialize_signed<S: serde::Serializer>(v: &Option<String>, s: S) -> Result<S::Ok, S::Error> {
    match v { Some(p) => s.serialize_some(&sign_path(p)), None => s.serialize_none() }
}

// ---- the media login cookie ----
//
// `<img>` and `<video>` cannot send a login header, which is why links are signed. A signed link works for whoever
// holds it, though, and for files in an age-restricted channel that is not good enough. So the app also asks for a
// cookie that says which signed-in session is fetching (`POST /attachments/session`); the browser sends it with
// every file request to this instance, and files in a restricted channel are served only to a session whose
// account meets the age. The cookie is tied to the session: signing out, or the session being revoked, ends it.

pub const COOKIE: &str = "parley_media";

fn cookie_sig(uid: Uuid, sid: Uuid) -> String {
    let key = KEY.get().map(Vec::as_slice).unwrap_or(b"parley-unset-key");
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("hmac takes any key length");
    m.update(b"media cookie");
    m.update(uid.as_bytes());
    m.update(sid.as_bytes());
    m.finalize().into_bytes()[..16].iter().map(|b| format!("{b:02x}")).collect()
}

/// The `Set-Cookie` value for a session. Only sent with requests for attachments, never readable by scripts.
pub fn cookie_for(uid: Uuid, sid: Uuid, secure: bool) -> String {
    format!("{COOKIE}={uid}.{sid}.{}; Path=/api/attachments; HttpOnly; SameSite=Lax; Max-Age=2592000{}", cookie_sig(uid, sid), if secure { "; Secure" } else { "" })
}

/// The (user, session) a request's media cookie names, if it carries a genuine one. The caller still has to check
/// that the session is alive.
pub fn cookie_claim(cookie_header: &str) -> Option<(Uuid, Uuid)> {
    let value = cookie_header.split(';').map(str::trim).find_map(|c| c.strip_prefix(COOKIE).and_then(|r| r.strip_prefix('=')))?;
    let mut parts = value.split('.');
    let (uid, sid, sig) = (Uuid::parse_str(parts.next()?).ok()?, Uuid::parse_str(parts.next()?).ok()?, parts.next()?);
    let want = cookie_sig(uid, sid);
    (want.len() == sig.len() && want.bytes().zip(sig.bytes()).fold(0u8, |d, (a, b)| d | (a ^ b)) == 0).then_some((uid, sid))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_is_good_for_one_to_two_days_and_only_for_its_file() {
        init("test secret");
        let id = Uuid::from_u128(7);
        let now = 1_800_000_000;
        let ex = expiry(now, false);
        assert!((DAY..=2 * DAY).contains(&(ex - now)));
        let (e, s) = (format!("{ex:x}"), sig(id, ex, false));
        assert!(valid_at(id, &e, &s, now, false));
        assert!(valid_at(id, &e, &s, ex - 1, false));
        assert!(!valid_at(id, &e, &s, ex, false), "expired");
        assert!(!valid_at(Uuid::from_u128(8), &e, &s, now, false), "another file");
        assert!(!valid_at(id, &format!("{:x}", ex + DAY), &s, now, false), "a later expiry needs its own signature");
        assert!(!valid_at(id, &e, "", now, false) && !valid_at(id, "zz", &s, now, false) && !valid_at(id, &e, &s[..31], now, false));
        // A signature for a date far ahead is refused even if it were genuine.
        let far = ex + 30 * DAY;
        assert!(!valid_at(id, &format!("{far:x}"), &sig(id, far, false), now, false));
    }

    #[test]
    fn a_restricted_link_is_short_and_a_day_link_does_not_pass_as_one() {
        init("test secret");
        let id = Uuid::from_u128(7);
        let now = 1_800_000_000;
        let ex = expiry(now, true);
        assert!((SHORT..=2 * SHORT).contains(&(ex - now)));
        let (e, s) = (format!("{ex:x}"), sig(id, ex, true));
        assert!(valid_at(id, &e, &s, now, true));
        assert!(!valid_at(id, &e, &s, ex, true), "expired");
        assert!(!valid_at(id, &e, &sig(id, ex, false), now, true), "an ordinary signature for the same moment");
        let day = expiry(now, false);
        assert!(!valid_at(id, &format!("{day:x}"), &sig(id, day, false), now, true), "a day link");
        assert!(!valid_at(id, &format!("{day:x}"), &sig(id, day, true), now, true), "a short signature dated a day ahead");
        assert!(sign_path(&format!("!/api/attachments/{id}/cover")).starts_with(&format!("/api/attachments/{id}/cover?ex=")));
    }

    #[test]
    fn the_media_cookie_names_its_session_and_cannot_be_made_up() {
        init("test secret");
        let (u, s) = (Uuid::from_u128(1), Uuid::from_u128(2));
        let set = cookie_for(u, s, true);
        assert!(set.contains("HttpOnly") && set.contains("Secure") && set.contains("Path=/api/attachments") && set.contains("SameSite=Lax"));
        assert!(!cookie_for(u, s, false).contains("Secure"));
        let value = set.split(';').next().unwrap();
        assert_eq!(cookie_claim(&format!("theme=dark; {value}; other=1")), Some((u, s)));
        assert_eq!(cookie_claim("theme=dark"), None);
        // Another account's id with this signature, and a signature cut short.
        let forged = value.replace(&u.to_string(), &Uuid::from_u128(9).to_string());
        assert_eq!(cookie_claim(&forged), None);
        assert_eq!(cookie_claim(&value[..value.len() - 1]), None);
    }

    #[test]
    fn signing_an_address() {
        init("test secret");
        let id = Uuid::from_u128(7);
        let p = format!("/api/attachments/{id}/a.png");
        assert!(sign_path(&p).starts_with(&format!("{p}?ex=")));
        assert!(sign_path(&format!("/api/attachments/{id}/thumb?v=2")).contains("thumb?v=2&ex="));
        assert_eq!(sign_path("/api/images/x"), "/api/images/x");
        assert_eq!(sign_path("/api/attachments/nope/a.png"), "/api/attachments/nope/a.png");
    }
}
