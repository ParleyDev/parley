//! Signed, expiring links to attachments.
//!
//! An attachment's address used to be enough to fetch it, for ever, by anyone who had the address. Now the address
//! handed out with a message carries an expiry and a signature (`?ex=…&sig=…`), and the file is served only to a
//! link that is still valid or to a signed-in member who can see the channel (`routes::attachments`). A copied link
//! stops working within two days; `<img>`, `<video>` and downloads, which cannot send a login, keep working.
//!
//! Attachments uploaded before an instance started signing (`SINCE`) are exempt: their plain addresses still work.
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

/// Derive the signing key from the instance secret. Every backend of an instance shares the secret, so any of them
/// can check a link another made.
pub fn init(secret: &str) {
    let mut m = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("hmac takes any key length");
    m.update(b"parley attachment links v1");
    let _ = KEY.set(m.finalize().into_bytes().to_vec());
}

fn sig(id: Uuid, ex: i64) -> String {
    let key = KEY.get().map(Vec::as_slice).unwrap_or(b"parley-unset-key");
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("hmac takes any key length");
    m.update(id.as_bytes());
    m.update(&ex.to_be_bytes());
    m.finalize().into_bytes()[..16].iter().map(|b| format!("{b:02x}")).collect()
}

fn expiry(now: i64) -> i64 { (now.div_euclid(DAY) + 2) * DAY }

/// `ex=…&sig=…` for an attachment, valid from now.
pub fn query(id: Uuid) -> String {
    let ex = expiry(chrono::Utc::now().timestamp());
    format!("ex={ex:x}&sig={}", sig(id, ex))
}

/// Whether `ex` and `sig` from a link are a signature of ours for this attachment that has not run out.
pub fn valid(id: Uuid, ex: &str, given: &str) -> bool { valid_at(id, ex, given, chrono::Utc::now().timestamp()) }

fn valid_at(id: Uuid, ex: &str, given: &str, now: i64) -> bool {
    let Ok(ex) = i64::from_str_radix(ex, 16) else { return false };
    if ex <= now || ex > now + 3 * DAY { return false }
    let want = sig(id, ex);
    // Constant time: the comparison must not tell a guesser how many leading characters were right.
    want.len() == given.len() && want.bytes().zip(given.bytes()).fold(0u8, |d, (a, b)| d | (a ^ b)) == 0
}

/// Sign an attachment address (`/api/attachments/<id>/…`, with or without a query). Anything else is returned as is.
pub fn sign_path(path: &str) -> String {
    let Some(rest) = path.strip_prefix("/api/attachments/") else { return path.to_string() };
    let Some(id) = rest.get(..36).and_then(|s| Uuid::parse_str(s).ok()) else { return path.to_string() };
    format!("{path}{}{}", if path.contains('?') { '&' } else { '?' }, query(id))
}

/// For `#[serde(serialize_with)]` on a field holding an attachment address.
pub fn serialize_signed<S: serde::Serializer>(v: &Option<String>, s: S) -> Result<S::Ok, S::Error> {
    match v { Some(p) => s.serialize_some(&sign_path(p)), None => s.serialize_none() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_is_good_for_one_to_two_days_and_only_for_its_file() {
        init("test secret");
        let id = Uuid::from_u128(7);
        let now = 1_800_000_000;
        let ex = expiry(now);
        assert!((DAY..=2 * DAY).contains(&(ex - now)));
        let (e, s) = (format!("{ex:x}"), sig(id, ex));
        assert!(valid_at(id, &e, &s, now));
        assert!(valid_at(id, &e, &s, ex - 1));
        assert!(!valid_at(id, &e, &s, ex), "expired");
        assert!(!valid_at(Uuid::from_u128(8), &e, &s, now), "another file");
        assert!(!valid_at(id, &format!("{:x}", ex + DAY), &s, now), "a later expiry needs its own signature");
        assert!(!valid_at(id, &e, "", now) && !valid_at(id, "zz", &s, now) && !valid_at(id, &e, &s[..31], now));
        // A signature for a date far ahead is refused even if it were genuine.
        let far = ex + 30 * DAY;
        assert!(!valid_at(id, &format!("{far:x}"), &sig(id, far), now));
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
