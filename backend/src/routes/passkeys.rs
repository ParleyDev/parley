//! Passkeys (WebAuthn), an additional way to sign in; passwords stay as the fallback.
//!
//! Registration (`/users/@me/passkeys/begin` → `/finish`) needs the password, plus a two-factor code when 2FA is on.
//! Sign-in (`/auth/passkey/begin` → `/finish`) has two shapes: with a username, the challenge lists that account's
//! passkeys (so security keys without a stored credential work); without one, it is a discoverable challenge the
//! browser answers with any passkey it holds for this site (the button and autofill). An unknown or passkey-less
//! username gets a discoverable challenge too, so the response never says whether an account exists. A passkey
//! verifies the user, so it stands in for both the password and the second factor.
//!
//! The relying party is the host of `APP_URL`, so passkeys work only on that address; any port is accepted for it.
//! Ceremony state lives in `webauthn_challenges` (five minutes, single use) so every backend instance can finish it.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    ratelimit::{client_ip, rl_login, LIMITER},
    routes::{auth::session, mfa::check_password_and_factor},
    state::AppState,
};
use axum::{extract::{Path, State}, http::{HeaderMap, StatusCode}, middleware::from_fn, routing::{patch, post}, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::OnceLock;
use uuid::Uuid;
use webauthn_rs::prelude::{
    DiscoverableAuthentication, DiscoverableKey, Passkey, PasskeyAuthentication, PasskeyRegistration, PublicKeyCredential,
    RegisterPublicKeyCredential, Url, Webauthn, WebauthnBuilder,
};

const CHALLENGE_SECS: i64 = 300;
const MAX_PASSKEYS: i64 = 20;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/passkeys", axum::routing::get(list))
        .route("/users/@me/passkeys/begin", post(register_begin))
        .route("/users/@me/passkeys/finish", post(register_finish))
        .route("/users/@me/passkeys/:id", patch(rename).delete(remove))
        .route("/auth/passkey/begin", post(auth_begin).route_layer(from_fn(rl_login)))
        .route("/auth/passkey/finish", post(auth_finish).route_layer(from_fn(rl_login)))
}

/// The relying party for this instance, or None when `APP_URL` cannot be one (an IP address, a bad URL).
fn webauthn(state: &AppState) -> Option<&'static Webauthn> {
    static WA: OnceLock<Option<Webauthn>> = OnceLock::new();
    WA.get_or_init(|| {
        let origin = Url::parse(&state.config.app_url).ok()?;
        let host = origin.host_str()?.to_string();
        if host.parse::<std::net::IpAddr>().is_ok() {
            tracing::warn!("APP_URL is an IP address; passkeys need a domain name and are disabled");
            return None;
        }
        WebauthnBuilder::new(&host, &origin).ok()?.rp_name("Parley").allow_any_port(true).build()
            .map_err(|e| tracing::warn!(error = %e, "passkeys disabled: bad relying party from APP_URL"))
            .ok()
    })
    .as_ref()
}

fn relying_party(state: &AppState) -> AppResult<&'static Webauthn> {
    webauthn(state).ok_or_else(|| AppError::BadRequest("Passkeys are not available on this server (APP_URL must be a domain name)".into()))
}

fn wa_err(e: impl std::fmt::Display) -> AppError {
    tracing::debug!(error = %e, "webauthn ceremony failed");
    AppError::BadRequest("That passkey could not be verified. Try again.".into())
}

async fn save_challenge(state: &AppState, user_id: Option<Uuid>, kind: &str, st: Value) -> AppResult<Uuid> {
    sqlx::query("DELETE FROM webauthn_challenges WHERE expires_at < now()").execute(&state.db).await?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO webauthn_challenges (id, user_id, kind, state, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))")
        .bind(id).bind(user_id).bind(kind).bind(st).bind(CHALLENGE_SECS as f64).execute(&state.db).await?;
    Ok(id)
}

/// Take (and delete) an unexpired challenge: each one can be answered once.
async fn take_challenge(state: &AppState, id: Uuid) -> AppResult<(Option<Uuid>, String, Value)> {
    sqlx::query_as::<_, (Option<Uuid>, String, Value)>("DELETE FROM webauthn_challenges WHERE id = $1 AND expires_at > now() RETURNING user_id, kind, state")
        .bind(id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::BadRequest("This passkey request expired. Try again.".into()))
}

async fn passkeys_of(state: &AppState, uid: Uuid) -> AppResult<Vec<(Uuid, Passkey)>> {
    let rows: Vec<(Uuid, Value)> = sqlx::query_as("SELECT id, passkey FROM passkeys WHERE user_id = $1").bind(uid).fetch_all(&state.db).await?;
    Ok(rows.into_iter().filter_map(|(id, v)| serde_json::from_value::<Passkey>(v).ok().map(|p| (id, p))).collect())
}

// ---- managing your passkeys ----

#[derive(Serialize, sqlx::FromRow)]
struct PasskeyRow {
    id: Uuid,
    name: String,
    created_at: chrono::DateTime<chrono::Utc>,
    last_used_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    let rows: Vec<PasskeyRow> = sqlx::query_as("SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = $1 ORDER BY created_at").bind(uid).fetch_all(&state.db).await?;
    Ok(Json(json!({ "available": webauthn(&state).is_some(), "passkeys": rows })))
}

#[derive(Deserialize)]
struct BeginRegisterReq {
    password: String,
    code: Option<String>,
}

async fn register_begin(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<BeginRegisterReq>) -> AppResult<Json<Value>> {
    let wa = relying_party(&state)?;
    check_password_and_factor(&state, uid, &req.password, req.code.as_deref()).await?;
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM passkeys WHERE user_id = $1").bind(uid).fetch_one(&state.db).await?;
    if count >= MAX_PASSKEYS {
        return Err(AppError::BadRequest(format!("You can have up to {MAX_PASSKEYS} passkeys. Remove one first.")));
    }
    let (username, display): (String, String) = sqlx::query_as("SELECT username, display_name FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    let existing = passkeys_of(&state, uid).await?.into_iter().map(|(_, p)| p.cred_id().clone()).collect::<Vec<_>>();
    let (options, reg) = wa.start_passkey_registration(uid, &username, &display, Some(existing)).map_err(wa_err)?;
    let id = save_challenge(&state, Some(uid), "register", serde_json::to_value(&reg).map_err(|e| AppError::Other(e.into()))?).await?;
    Ok(Json(json!({ "id": id, "options": options })))
}

#[derive(Deserialize)]
struct FinishRegisterReq {
    id: Uuid,
    credential: RegisterPublicKeyCredential,
    name: Option<String>,
}

async fn register_finish(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<FinishRegisterReq>) -> AppResult<(StatusCode, Json<PasskeyRow>)> {
    let wa = relying_party(&state)?;
    let (owner, kind, st) = take_challenge(&state, req.id).await?;
    if kind != "register" || owner != Some(uid) {
        return Err(AppError::BadRequest("This passkey request expired. Try again.".into()));
    }
    let reg: PasskeyRegistration = serde_json::from_value(st).map_err(|e| AppError::Other(e.into()))?;
    let pk = wa.finish_passkey_registration(&req.credential, &reg).map_err(wa_err)?;
    let name = req.name.as_deref().map(str::trim).filter(|n| !n.is_empty()).unwrap_or("Passkey").chars().take(64).collect::<String>();
    let id = Uuid::now_v7();
    let row: PasskeyRow = sqlx::query_as("INSERT INTO passkeys (id, user_id, name, cred_id, passkey) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, created_at, last_used_at")
        .bind(id).bind(uid).bind(&name).bind(pk.cred_id().as_ref()).bind(serde_json::to_value(&pk).map_err(|e| AppError::Other(e.into()))?)
        .fetch_one(&state.db).await
        .map_err(|e| match e { sqlx::Error::Database(d) if d.is_unique_violation() => AppError::BadRequest("That passkey is already registered".into()), e => e.into() })?;
    let (email,): (String,) = sqlx::query_as("SELECT email FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    let _ = crate::mail::send(&state.config, &email, "A passkey was added to your Parley account", &format!("A passkey named \"{name}\" was just added to your Parley account. It can be used to sign in without a password.\n\nIf that wasn't you, remove it in Settings → My Account → Passkeys and change your password right away: {}", state.config.app_url)).await;
    Ok((StatusCode::CREATED, Json(row)))
}

#[derive(Deserialize)]
struct RenameReq {
    name: String,
}

async fn rename(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<RenameReq>) -> AppResult<Json<PasskeyRow>> {
    let name = req.name.trim().chars().take(64).collect::<String>();
    if name.is_empty() {
        return Err(AppError::BadRequest("Give the passkey a name".into()));
    }
    sqlx::query_as("UPDATE passkeys SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING id, name, created_at, last_used_at")
        .bind(id).bind(uid).bind(&name).fetch_optional(&state.db).await?
        .map(Json).ok_or_else(|| AppError::NotFound("Passkey not found".into()))
}

async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let r = sqlx::query("DELETE FROM passkeys WHERE id = $1 AND user_id = $2").bind(id).bind(uid).execute(&state.db).await?;
    if r.rows_affected() == 0 { return Err(AppError::NotFound("Passkey not found".into())); }
    Ok(StatusCode::NO_CONTENT)
}

// ---- signing in ----

#[derive(Deserialize)]
struct BeginAuthReq {
    /// Username or email when the user typed one; omit for the discoverable (usernameless) flow.
    login: Option<String>,
}

async fn auth_begin(State(state): State<AppState>, Json(req): Json<BeginAuthReq>) -> AppResult<Json<Value>> {
    let wa = relying_party(&state)?;
    if let Some(login) = req.login.as_deref().map(|l| l.trim().to_lowercase()).filter(|l| !l.is_empty()) {
        let uid: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE username = $1 OR email = $1").bind(&login).fetch_optional(&state.db).await?;
        if let Some((uid,)) = uid {
            let keys: Vec<Passkey> = passkeys_of(&state, uid).await?.into_iter().map(|(_, p)| p).collect();
            if !keys.is_empty() {
                let (options, auth) = wa.start_passkey_authentication(&keys).map_err(wa_err)?;
                let id = save_challenge(&state, Some(uid), "auth", serde_json::to_value(&auth).map_err(|e| AppError::Other(e.into()))?).await?;
                return Ok(Json(json!({ "id": id, "options": options })));
            }
        }
    }
    let (options, auth) = wa.start_discoverable_authentication().map_err(wa_err)?;
    let id = save_challenge(&state, None, "discoverable", serde_json::to_value(&auth).map_err(|e| AppError::Other(e.into()))?).await?;
    Ok(Json(json!({ "id": id, "options": options })))
}

#[derive(Deserialize)]
struct FinishAuthReq {
    id: Uuid,
    credential: PublicKeyCredential,
}

async fn auth_finish(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<FinishAuthReq>) -> AppResult<Json<Value>> {
    let wa = relying_party(&state)?;
    let fail = |headers: &HeaderMap| {
        let _ = LIMITER.take("login_fail", &client_ip(headers), LIMITER.limit("login_fail"));
        AppError::BadRequest("That passkey isn't registered on this server, or it could not be verified.".into())
    };
    let (owner, kind, st) = take_challenge(&state, req.id).await?;
    // Which account the answer claims: fixed by the challenge (username flow) or by the passkey's user handle.
    let uid = match kind.as_str() {
        "auth" => owner.ok_or_else(|| fail(&headers))?,
        "discoverable" => wa.identify_discoverable_authentication(&req.credential).map_err(|_| fail(&headers))?.0,
        _ => return Err(fail(&headers)),
    };
    let keys = passkeys_of(&state, uid).await?;
    let result = match kind.as_str() {
        "auth" => {
            let auth: PasskeyAuthentication = serde_json::from_value(st).map_err(|e| AppError::Other(e.into()))?;
            wa.finish_passkey_authentication(&req.credential, &auth).map_err(|_| fail(&headers))?
        }
        _ => {
            let auth: DiscoverableAuthentication = serde_json::from_value(st).map_err(|e| AppError::Other(e.into()))?;
            let creds: Vec<DiscoverableKey> = keys.iter().map(|(_, p)| p.into()).collect();
            if creds.is_empty() { return Err(fail(&headers)); }
            wa.finish_discoverable_authentication(&req.credential, auth, &creds).map_err(|_| fail(&headers))?
        }
    };
    // Keep the stored credential current (signature counter, backup state) and note when it was used.
    let Some((pid, mut pk)) = keys.into_iter().find(|(_, p)| p.cred_id() == result.cred_id()) else { return Err(fail(&headers)) };
    pk.update_credential(&result);
    sqlx::query("UPDATE passkeys SET passkey = $2, last_used_at = now() WHERE id = $1").bind(pid).bind(serde_json::to_value(&pk).map_err(|e| AppError::Other(e.into()))?).execute(&state.db).await?;
    let (suspended, bot): (bool, bool) = sqlx::query_as("SELECT suspended_at IS NOT NULL, bot FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if bot { return Err(fail(&headers)); }
    if suspended { return Err(AppError::BadRequest("This account has been suspended.".into())); }
    session(&state, uid, &headers).await
}
