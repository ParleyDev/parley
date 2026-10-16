//! Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 s) and single-use backup codes.

use hmac::{Hmac, Mac};
use rand::{distributions::Uniform, Rng, RngCore};
use sha1::Sha1;
use sha2::{Digest, Sha256};

pub const STEP_SECS: i64 = 30;
pub const BACKUP_CODE_COUNT: usize = 10;
const ALPHABET: base32::Alphabet = base32::Alphabet::Rfc4648 { padding: false };

/// Fresh 160-bit secret, base32 (what authenticator apps expect).
pub fn new_secret() -> String {
    let mut raw = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut raw);
    base32::encode(ALPHABET, &raw)
}

pub fn current_step() -> i64 {
    chrono::Utc::now().timestamp() / STEP_SECS
}

/// The 6-digit code for a given 30 s step, or None if the secret is not valid base32.
pub fn code_at(secret_b32: &str, step: i64) -> Option<String> {
    let key = base32::decode(ALPHABET, &secret_b32.to_ascii_uppercase())?;
    let mut mac = Hmac::<Sha1>::new_from_slice(&key).ok()?;
    mac.update(&step.to_be_bytes());
    let h = mac.finalize().into_bytes();
    let off = (h[19] & 0x0f) as usize;
    let bin = ((h[off] as u32 & 0x7f) << 24) | ((h[off + 1] as u32) << 16) | ((h[off + 2] as u32) << 8) | h[off + 3] as u32;
    Some(format!("{:06}", bin % 1_000_000))
}

/// Accept `code` if it matches the current step or its neighbours (±1 step of clock drift)
/// and that step is newer than `last_step` (each code works once). Returns the accepted step.
pub fn verify(secret_b32: &str, code: &str, last_step: i64) -> Option<i64> {
    let code: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    if code.len() != 6 {
        return None;
    }
    let now = current_step();
    (now - 1..=now + 1)
        .filter(|s| *s > last_step)
        .find(|s| code_at(secret_b32, *s).as_deref() == Some(code.as_str()))
}

pub fn otpauth_url(issuer: &str, account: &str, secret_b32: &str) -> String {
    let enc = |s: &str| -> String {
        s.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'@' => (b as char).to_string(),
                _ => format!("%{b:02X}"),
            })
            .collect()
    };
    format!("otpauth://totp/{}:{}?secret={}&issuer={}&algorithm=SHA1&digits=6&period={STEP_SECS}", enc(issuer), enc(account), secret_b32, enc(issuer))
}

/// Backup codes look like `k7m3p-x9q2w`: 10 chars from an unambiguous lowercase alphabet (no 0/o/1/l/i).
pub fn new_backup_codes() -> Vec<String> {
    const CHARS: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    let dist = Uniform::from(0..CHARS.len());
    (0..BACKUP_CODE_COUNT)
        .map(|_| {
            let s: String = (0..10).map(|_| CHARS[rng.sample(dist)] as char).collect();
            format!("{}-{}", &s[..5], &s[5..])
        })
        .collect()
}

/// Codes are high-entropy, so a plain SHA-256 of the normalised form is enough (and cheap to check on login).
pub fn hash_backup_code(code: &str) -> String {
    let norm: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect();
    let mut h = Sha256::new();
    h.update(b"parley-backup:");
    h.update(norm.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    // RFC 6238 appendix B, SHA-1, secret "12345678901234567890".
    const SECRET: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    #[test]
    fn rfc6238_vectors() {
        assert_eq!(code_at(SECRET, 59 / 30).as_deref(), Some("287082"));
        assert_eq!(code_at(SECRET, 1111111109 / 30).as_deref(), Some("081804"));
        assert_eq!(code_at(SECRET, 1234567890 / 30).as_deref(), Some("005924"));
        assert_eq!(code_at(SECRET, 20000000000 / 30).as_deref(), Some("353130"));
        assert_eq!(code_at("not base32!!", 1), None);
    }

    #[test]
    fn verify_window_and_replay() {
        let now = current_step();
        let cur = code_at(SECRET, now).unwrap();
        assert_eq!(verify(SECRET, &cur, 0), Some(now));
        assert_eq!(verify(SECRET, &format!("{} {}", &cur[..3], &cur[3..]), 0), Some(now), "spaces are ignored");
        assert_eq!(verify(SECRET, &cur, now), None, "a code never works twice");
        assert_eq!(verify(SECRET, &code_at(SECRET, now - 1).unwrap(), 0), Some(now - 1));
        assert_eq!(verify(SECRET, &code_at(SECRET, now + 1).unwrap(), 0), Some(now + 1));
        assert_eq!(verify(SECRET, &code_at(SECRET, now - 2).unwrap(), 0), None, "outside the drift window");
        assert_eq!(verify(SECRET, "12345", 0), None);
        assert_eq!(verify(SECRET, "", 0), None);
    }

    #[test]
    fn secrets_and_backup_codes() {
        let s = new_secret();
        assert_eq!(s.len(), 32);
        assert!(code_at(&s, 1).is_some());
        assert_ne!(new_secret(), s);
        let codes = new_backup_codes();
        assert_eq!(codes.len(), BACKUP_CODE_COUNT);
        assert!(codes.iter().all(|c| c.len() == 11 && c.as_bytes()[5] == b'-'));
        assert_eq!(hash_backup_code("K7M3P-X9Q2W"), hash_backup_code("k7m3p x9q2w"));
        assert_ne!(hash_backup_code("k7m3p-x9q2w"), hash_backup_code("k7m3p-x9q2x"));
        assert!(otpauth_url("Parley", "a b@x.io", &s).starts_with("otpauth://totp/Parley:a%20b@x.io?secret="));
    }
}
