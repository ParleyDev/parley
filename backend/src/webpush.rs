//! Browser push (RFC 8030 Web Push, RFC 8291 message encryption, RFC 8292 VAPID). Works without any third-party
//! account: the server makes its own VAPID key pair on first use and POSTs encrypted payloads straight to each
//! browser's push service. Subscriptions belong to a session, so signing out or revoking it stops the pushes.
//! Each payload carries a short-lived action token so the service worker can Mark as Read or Reply without the
//! session token, which a service worker cannot read.

use crate::state::AppState;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use hmac::{Hmac, Mac};
use openssl::bn::BigNumContext;
use openssl::derive::Deriver;
use openssl::ec::{EcGroup, EcKey, EcPoint, PointConversionForm};
use openssl::nid::Nid;
use openssl::pkey::PKey;
use openssl::symm::{encrypt_aead, Cipher};
use serde_json::{json, Value};
use sha2::Sha256;
use tokio::sync::OnceCell;
use uuid::Uuid;

struct Vapid { key: jsonwebtoken::EncodingKey, public: String }
static VAPID: OnceCell<Vapid> = OnceCell::const_new();

fn group() -> EcGroup { EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).expect("P-256") }

fn public_bytes(k: &EcKey<openssl::pkey::Private>) -> Vec<u8> {
    let mut ctx = BigNumContext::new().expect("bn ctx");
    k.public_key().to_bytes(&group(), PointConversionForm::UNCOMPRESSED, &mut ctx).expect("point")
}

/// The server's VAPID key, loaded from (or saved to) the database on first use.
async fn vapid(state: &AppState) -> Option<&'static Vapid> {
    VAPID.get_or_try_init(|| async {
        let row: Option<(String, String)> = sqlx::query_as("SELECT private_pem, public_key FROM vapid_keys").fetch_optional(&state.db).await.map_err(|_| ())?;
        let (pem, public) = match row {
            Some(r) => r,
            None => {
                let k = EcKey::generate(&group()).map_err(|_| ())?;
                let public = B64.encode(public_bytes(&k));
                let pem = String::from_utf8(PKey::from_ec_key(k).map_err(|_| ())?.private_key_to_pem_pkcs8().map_err(|_| ())?).map_err(|_| ())?;
                // Two instances racing: keep whichever landed first.
                sqlx::query("INSERT INTO vapid_keys (private_pem, public_key) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING").bind(&pem).bind(&public).execute(&state.db).await.map_err(|_| ())?;
                sqlx::query_as("SELECT private_pem, public_key FROM vapid_keys").fetch_one(&state.db).await.map_err(|_| ())?
            }
        };
        let key = jsonwebtoken::EncodingKey::from_ec_pem(pem.as_bytes()).map_err(|_| ())?;
        Ok::<_, ()>(Vapid { key, public })
    }).await.ok()
}

/// The application server key browsers subscribe with (base64url, uncompressed P-256 point).
pub async fn public_key(state: &AppState) -> Option<String> { vapid(state).await.map(|v| v.public.clone()) }

fn hkdf(salt: &[u8], ikm: &[u8], info: &[u8], len: usize) -> Vec<u8> {
    let h = hkdf::Hkdf::<Sha256>::new(Some(salt), ikm);
    let mut out = vec![0u8; len];
    h.expand(info, &mut out).expect("hkdf length");
    out
}

/// Encrypt `plain` for one subscription (RFC 8291, aes128gcm content coding, a single record).
pub fn encrypt(p256dh: &[u8], auth: &[u8], plain: &[u8]) -> Result<Vec<u8>, String> {
    let g = group();
    let mut ctx = BigNumContext::new().map_err(|e| e.to_string())?;
    let ua_point = EcPoint::from_bytes(&g, p256dh, &mut ctx).map_err(|_| "bad p256dh".to_string())?;
    let ua = PKey::from_ec_key(EcKey::from_public_key(&g, &ua_point).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let eph = EcKey::generate(&g).map_err(|e| e.to_string())?;
    let as_public = public_bytes(&eph);
    let eph = PKey::from_ec_key(eph).map_err(|e| e.to_string())?;
    let mut d = Deriver::new(&eph).map_err(|e| e.to_string())?;
    d.set_peer(&ua).map_err(|e| e.to_string())?;
    let secret = d.derive_to_vec().map_err(|e| e.to_string())?;
    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend_from_slice(p256dh);
    key_info.extend_from_slice(&as_public);
    let ikm = hkdf(auth, &secret, &key_info, 32);
    let salt: [u8; 16] = rand::random();
    let cek = hkdf(&salt, &ikm, b"Content-Encoding: aes128gcm\0", 16);
    let nonce = hkdf(&salt, &ikm, b"Content-Encoding: nonce\0", 12);
    let mut record = plain.to_vec();
    record.push(2); // last-record delimiter
    let mut tag = [0u8; 16];
    let ct = encrypt_aead(Cipher::aes_128_gcm(), &cek, Some(&nonce), &[], &record, &mut tag).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(86 + ct.len() + 16);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&4096u32.to_be_bytes());
    out.push(as_public.len() as u8);
    out.extend_from_slice(&as_public);
    out.extend_from_slice(&ct);
    out.extend_from_slice(&tag);
    Ok(out)
}

#[derive(serde::Serialize)]
struct VapidClaims<'a> { aud: &'a str, exp: i64, sub: &'a str }

fn action_key(state: &AppState) -> Vec<u8> { format!("{}|push-action", state.config.jwt_secret).into_bytes() }

/// A token letting this session Mark as Read / Reply on one channel for three days: uid.sid.cid.exp.mac
pub fn action_token(state: &AppState, uid: Uuid, sid: Uuid, cid: Uuid) -> String {
    let exp = chrono::Utc::now().timestamp() + 3 * 86400;
    let body = format!("{uid}.{sid}.{cid}.{exp}");
    let mut m = Hmac::<Sha256>::new_from_slice(&action_key(state)).expect("hmac");
    m.update(body.as_bytes());
    format!("{body}.{}", B64.encode(m.finalize().into_bytes()))
}

/// (user, session, channel) when the token is genuine and unexpired; the caller still checks the session.
pub fn verify_action(state: &AppState, token: &str) -> Option<(Uuid, Uuid, Uuid)> {
    let (body, mac) = token.rsplit_once('.')?;
    let mut m = Hmac::<Sha256>::new_from_slice(&action_key(state)).ok()?;
    m.update(body.as_bytes());
    m.verify_slice(&B64.decode(mac).ok()?).ok()?;
    let p: Vec<&str> = body.split('.').collect();
    if p.len() != 4 || p[3].parse::<i64>().ok()? < chrono::Utc::now().timestamp() { return None; }
    Some((p[0].parse().ok()?, p[1].parse().ok()?, p[2].parse().ok()?))
}

/// Does anyone have a browser subscription (so message pushes are worth working out)?
pub async fn any(state: &AppState) -> bool {
    sqlx::query_as::<_, (bool,)>("SELECT EXISTS (SELECT 1 FROM web_push_subs)").fetch_one(&state.db).await.map(|r| r.0).unwrap_or(false)
}

/// Push to every live browser subscription of `users`. `data.channel_id` (when present) groups notifications
/// per channel and lets newer ones replace undelivered older ones.
pub async fn notify(state: &AppState, users: &[Uuid], title: &str, body: &str, data: &Value) {
    if users.is_empty() { return; }
    let Some(v) = vapid(state).await else { return };
    let rows: Vec<(String, Uuid, Uuid, String, String)> = match sqlx::query_as(
        "SELECT w.endpoint, w.user_id, w.session_id, w.p256dh, w.auth FROM web_push_subs w JOIN sessions s ON s.id = w.session_id
         WHERE w.user_id = ANY($1) AND s.revoked_at IS NULL",
    ).bind(users).fetch_all(&state.db).await { Ok(r) => r, Err(_) => return };
    let cid = data.get("channel_id").and_then(|c| c.as_str()).and_then(|c| c.parse::<Uuid>().ok());
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none()).build().unwrap_or_default();
    for (endpoint, uid, sid, p256dh, auth) in rows {
        let Ok(url) = url::Url::parse(&endpoint) else { continue };
        let aud = url.origin().ascii_serialization();
        let sub = if state.config.app_url.starts_with("https://") { state.config.app_url.clone() } else { "mailto:admin@localhost".to_string() };
        let Ok(jwt) = jsonwebtoken::encode(&jsonwebtoken::Header::new(jsonwebtoken::Algorithm::ES256), &VapidClaims { aud: &aud, exp: chrono::Utc::now().timestamp() + 12 * 3600, sub: &sub }, &v.key) else { continue };
        let mut payload = json!({ "title": title, "body": body, "data": data });
        if let Some(c) = cid { payload["action_token"] = json!(action_token(state, uid, sid, c)); payload["tag"] = json!(c); }
        let (Ok(k), Ok(a)) = (B64.decode(p256dh.trim_end_matches('=')), B64.decode(auth.trim_end_matches('='))) else { continue };
        let Ok(enc) = encrypt(&k, &a, payload.to_string().as_bytes()) else { continue };
        let mut req = client.post(url).header("Content-Encoding", "aes128gcm").header("Content-Type", "application/octet-stream")
            .header("TTL", "86400").header("Urgency", "high").header("Authorization", format!("vapid t={jwt}, k={}", v.public));
        if let Some(c) = cid { req = req.header("Topic", c.simple().to_string()); }
        match req.body(enc).send().await {
            Ok(r) if r.status().is_success() => { crate::metrics::METRICS.push_sent.fetch_add(1, std::sync::atomic::Ordering::Relaxed); }
            Ok(r) if matches!(r.status().as_u16(), 404 | 410) => { let _ = sqlx::query("DELETE FROM web_push_subs WHERE endpoint = $1").bind(&endpoint).execute(&state.db).await; }
            Ok(r) => tracing::warn!(status = %r.status(), "web push failed"),
            Err(e) => tracing::warn!("web push failed: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_layout() {
        let k = EcKey::generate(&group()).unwrap();
        let out = encrypt(&public_bytes(&k), &[7u8; 16], b"hello").unwrap();
        // salt(16) rs(4) idlen(1) keyid(65) then ciphertext: 5 bytes + delimiter + 16 byte tag
        assert_eq!(out.len(), 16 + 4 + 1 + 65 + 6 + 16);
        assert_eq!(&out[16..20], &4096u32.to_be_bytes());
        assert_eq!(out[20], 65);
    }
}
