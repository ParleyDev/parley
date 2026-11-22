//! Age assurance: what a member can say and ask for, what staff can attest, and the outside providers an operator
//! can plug in. The decision itself lives in `crate::age` (and the SQL functions behind it); this file only writes
//! the records it reads.
//!
//! Three ways an account comes to meet an age, in rising order of trust (`level`):
//! - `declared`: the member said so. Opens restricted places only while the instance accepts declarations.
//! - `attested`: a member of staff recorded that they confirmed it (Admin Console → Age Checks). The built-in way
//!   for an instance with no provider. No document and no date is stored, only who, when and a note of how.
//! - `verified`: an outside provider said so, through OpenID Connect or a small HTTP adapter the operator runs.
//!
//! Nobody else can see any of this: it is not on any public user object.

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{require_perm, Perm},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Redirect,
    routing::{get, post, put},
    Json, Router,
};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/age", get(my_status))
        .route("/users/@me/birthday", put(set_birthday))
        .route("/users/@me/age/declare", post(declare))
        .route("/users/@me/age/request", post(ask).delete(withdraw))
        .route("/users/@me/age/verify", post(start_verify))
        .route("/age/callback", get(oidc_callback))
        .route("/age/adapter/callback", post(adapter_callback))
        .route("/admin/age/settings", get(get_settings).put(put_settings))
        .route("/admin/age/requests", get(list_requests))
        .route("/admin/age/requests/:id", post(decide_request))
        .route("/admin/age/users/:id", get(user_records))
        .route("/admin/age/users/:id/attest", post(attest))
        .route("/admin/age/users/:id/clear-minor", post(clear_minor))
        .route("/admin/age/assurances/:id/revoke", post(revoke))
}

// ---- settings -------------------------------------------------------------------------------------------------

/// What the operator has set (`age_*` keys in `instance_settings`).
#[derive(Debug, Clone)]
pub struct Config {
    /// The lowest level that opens restricted places: declared | attested | verified.
    pub accept_level: String,
    /// Staff may attest, and members may ask them to.
    pub attestation: bool,
    /// '' (none), 'oidc' or 'http'.
    pub provider: String,
    /// Shown to members ("Verify with …") and stored on the record.
    pub provider_name: String,
    pub oidc_authorize_url: String,
    pub oidc_token_url: String,
    pub oidc_client_id: String,
    pub oidc_client_secret: String,
    pub oidc_issuer: String,
    /// The claim that must be true; `{n}` is replaced by the age (default `age_over_{n}`).
    pub oidc_claim: String,
    pub oidc_scope: String,
    pub http_url: String,
    pub http_token: String,
    /// How long a provider's answer or an attestation stands; 0 = until revoked.
    pub valid_days: i64,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            accept_level: "attested".into(), attestation: true, provider: String::new(), provider_name: String::new(),
            oidc_authorize_url: String::new(), oidc_token_url: String::new(), oidc_client_id: String::new(), oidc_client_secret: String::new(),
            oidc_issuer: String::new(), oidc_claim: "age_over_{n}".into(), oidc_scope: "openid".into(),
            http_url: String::new(), http_token: String::new(), valid_days: 0,
        }
    }
}

impl Config {
    /// A provider is set up completely enough to send someone to.
    pub fn provider_ready(&self) -> bool {
        match self.provider.as_str() {
            "oidc" => !self.oidc_authorize_url.is_empty() && !self.oidc_token_url.is_empty() && !self.oidc_client_id.is_empty() && !self.oidc_issuer.is_empty(),
            "http" => !self.http_url.is_empty() && !self.http_token.is_empty(),
            _ => false,
        }
    }
    fn name(&self) -> String { if self.provider_name.trim().is_empty() { self.provider.clone() } else { self.provider_name.trim().to_string() } }
}

pub async fn load_config(db: &PgPool) -> Config {
    let rows: Vec<(String, Value)> = sqlx::query_as("SELECT key, value FROM instance_settings WHERE key LIKE 'age\\_%'").fetch_all(db).await.unwrap_or_default();
    let mut c = Config::default();
    for (k, v) in rows {
        let s = || v.as_str().unwrap_or("").to_string();
        match k.as_str() {
            "age_accept_level" => c.accept_level = s(),
            "age_attestation" => c.attestation = v.as_bool().unwrap_or(true),
            "age_provider" => c.provider = s(),
            "age_provider_name" => c.provider_name = s(),
            "age_oidc_authorize_url" => c.oidc_authorize_url = s(),
            "age_oidc_token_url" => c.oidc_token_url = s(),
            "age_oidc_client_id" => c.oidc_client_id = s(),
            "age_oidc_client_secret" => c.oidc_client_secret = s(),
            "age_oidc_issuer" => c.oidc_issuer = s(),
            "age_oidc_claim" => c.oidc_claim = s(),
            "age_oidc_scope" => c.oidc_scope = s(),
            "age_http_url" => c.http_url = s(),
            "age_http_token" => c.http_token = s(),
            "age_valid_days" => c.valid_days = v.as_i64().unwrap_or(0),
            _ => {}
        }
    }
    c
}

async fn settings_json(db: &PgPool) -> Value {
    let c = load_config(db).await;
    let (pending,): (i64,) = sqlx::query_as("SELECT count(*) FROM age_requests WHERE status = 'pending'").fetch_one(db).await.unwrap_or((0,));
    // Secrets are never sent back: only whether one is set.
    json!({
        "accept_level": c.accept_level, "attestation": c.attestation, "provider": c.provider, "provider_name": c.provider_name,
        "oidc_authorize_url": c.oidc_authorize_url, "oidc_token_url": c.oidc_token_url, "oidc_client_id": c.oidc_client_id,
        "oidc_client_secret_set": !c.oidc_client_secret.is_empty(), "oidc_issuer": c.oidc_issuer, "oidc_claim": c.oidc_claim, "oidc_scope": c.oidc_scope,
        "http_url": c.http_url, "http_token_set": !c.http_token.is_empty(), "valid_days": c.valid_days,
        "provider_ready": c.provider_ready(), "pending_requests": pending,
    })
}

async fn get_settings(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    Ok(Json(settings_json(&state.db).await))
}

#[derive(Deserialize)]
struct PutSettings {
    accept_level: String,
    attestation: bool,
    #[serde(default)] provider: String,
    #[serde(default)] provider_name: String,
    #[serde(default)] oidc_authorize_url: String,
    #[serde(default)] oidc_token_url: String,
    #[serde(default)] oidc_client_id: String,
    /// Absent = keep the stored secret; "" = remove it.
    oidc_client_secret: Option<String>,
    #[serde(default)] oidc_issuer: String,
    #[serde(default)] oidc_claim: String,
    #[serde(default)] oidc_scope: String,
    #[serde(default)] http_url: String,
    http_token: Option<String>,
    #[serde(default)] valid_days: i64,
}

fn web_address(what: &str, v: &str) -> AppResult<String> {
    let v = v.trim().to_string();
    if !v.is_empty() && !(v.starts_with("https://") || v.starts_with("http://")) {
        return Err(AppError::BadRequest(format!("{what} must start with https:// (or http:// for one on your own network)")));
    }
    Ok(v)
}

async fn put_settings(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<PutSettings>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    if !["declared", "attested", "verified"].contains(&req.accept_level.as_str()) { return Err(AppError::BadRequest("accept_level is declared, attested or verified".into())) }
    if !["", "oidc", "http"].contains(&req.provider.as_str()) { return Err(AppError::BadRequest("provider is empty, oidc or http".into())) }
    if !(0..=3650).contains(&req.valid_days) { return Err(AppError::BadRequest("valid_days is between 0 and 3650".into())) }
    let claim = if req.oidc_claim.trim().is_empty() { "age_over_{n}".to_string() } else { req.oidc_claim.trim().to_string() };
    let scope = if req.oidc_scope.trim().is_empty() { "openid".to_string() } else { req.oidc_scope.trim().to_string() };
    let before = load_config(&state.db).await;
    let mut set: Vec<(&str, Value)> = vec![
        ("age_accept_level", json!(req.accept_level)), ("age_attestation", json!(req.attestation)), ("age_provider", json!(req.provider)),
        ("age_provider_name", json!(req.provider_name.trim().chars().take(60).collect::<String>())),
        ("age_oidc_authorize_url", json!(web_address("The sign-in address", &req.oidc_authorize_url)?)),
        ("age_oidc_token_url", json!(web_address("The token address", &req.oidc_token_url)?)),
        ("age_oidc_client_id", json!(req.oidc_client_id.trim())), ("age_oidc_issuer", json!(req.oidc_issuer.trim())),
        ("age_oidc_claim", json!(claim)), ("age_oidc_scope", json!(scope)),
        ("age_http_url", json!(web_address("The adapter address", &req.http_url)?)), ("age_valid_days", json!(req.valid_days)),
    ];
    if let Some(s) = &req.oidc_client_secret { set.push(("age_oidc_client_secret", json!(s.trim()))); }
    if let Some(s) = &req.http_token { set.push(("age_http_token", json!(s.trim()))); }
    for (k, v) in set {
        sqlx::query("INSERT INTO instance_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(k).bind(v).execute(&state.db).await?;
    }
    let after = load_config(&state.db).await;
    let mut changed = serde_json::Map::new();
    if before.accept_level != after.accept_level { changed.insert("accept_level".into(), json!({ "from": before.accept_level, "to": after.accept_level })); }
    if before.attestation != after.attestation { changed.insert("attestation".into(), json!(after.attestation)); }
    if before.provider != after.provider { changed.insert("provider".into(), json!(after.provider)); }
    if before.valid_days != after.valid_days { changed.insert("valid_days".into(), json!(after.valid_days)); }
    if before.oidc_issuer != after.oidc_issuer || before.oidc_authorize_url != after.oidc_authorize_url || before.oidc_token_url != after.oidc_token_url || before.oidc_client_id != after.oidc_client_id || before.http_url != after.http_url {
        changed.insert("provider_addresses".into(), json!("changed"));
    }
    if before.oidc_client_secret != after.oidc_client_secret { changed.insert("oidc_client_secret".into(), json!(if after.oidc_client_secret.is_empty() { "cleared" } else { "set" })); }
    if before.http_token != after.http_token { changed.insert("http_token".into(), json!(if after.http_token.is_empty() { "cleared" } else { "set" })); }
    if !changed.is_empty() { audit::record(&state, uid, "age.settings.update", "instance", None, "", Value::Object(changed)).await; }
    Ok(Json(settings_json(&state.db).await))
}

// ---- the member's side ----------------------------------------------------------------------------------------

/// Everything the account settings show: where you stand, what is on record, and what you can do next.
pub async fn status(db: &PgPool, uid: Uuid) -> AppResult<Value> {
    let c = load_config(db).await;
    let (minor, month, day, guest, adult): (bool, Option<i16>, Option<i16>, bool, bool) =
        sqlx::query_as("SELECT declared_minor, birthday_month, birthday_day, guest, age_meets(id, 18) FROM users WHERE id = $1").bind(uid).fetch_one(db).await?;
    let records: Vec<(Uuid, i16, String, String, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>, bool)> = sqlx::query_as(
        "SELECT id, threshold, level, provider, verified_at, expires_at, age_level_rank(level) >= age_level_rank(age_accept_level())
           FROM age_assurances WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY verified_at DESC",
    ).bind(uid).fetch_all(db).await?;
    let request: Option<(Uuid, String, String, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as("SELECT id, status, reply, created_at FROM age_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1").bind(uid).fetch_optional(db).await?;
    let has_declared = records.iter().any(|r| r.2 == "declared");
    let open = !minor && !guest && !adult;
    Ok(json!({
        "age_group": if minor { "teen" } else if adult { "adult" } else { "unknown" },
        "declared_minor": minor,
        "birthday": match (month, day) { (Some(m), Some(d)) => json!({ "month": m, "day": d }), _ => Value::Null },
        "accept_level": c.accept_level,
        "records": records.iter().map(|r| json!({ "id": r.0, "threshold": r.1, "level": r.2, "provider": r.3, "verified_at": r.4, "expires_at": r.5, "counts": r.6 })).collect::<Vec<_>>(),
        "request": request.map(|r| json!({ "id": r.0, "status": r.1, "reply": r.2, "created_at": r.3 })),
        "provider_name": if c.provider_ready() { json!(c.name()) } else { Value::Null },
        "can": {
            // Saying you are an adult is offered while it opens something; saying you are under 18 always is.
            "declare_adult": open && !has_declared && c.accept_level == "declared",
            "declare_minor": !minor && !guest,
            "request": open && c.attestation,
            "verify": open && c.provider_ready(),
        },
    }))
}

async fn my_status(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    Ok(Json(status(&state.db, uid).await?))
}

/// Tell the member's own sessions that their standing changed (the account object carries `age_group`).
async fn changed(state: &AppState, uid: Uuid) {
    if let Ok(u) = crate::routes::account::private(state, uid).await {
        state.hub.emit_users(vec![uid], "USER_UPDATE", json!(u));
    }
    state.hub.emit_users(vec![uid], "AGE_UPDATE", json!({}));
}

#[derive(Deserialize)]
struct Birthday { month: Option<i16>, day: Option<i16> }

/// `PUT /users/@me/birthday {month, day}`: a birthday without a year, for reminders. Both null removes it.
async fn set_birthday(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<Birthday>) -> AppResult<Json<Value>> {
    match (req.month, req.day) {
        (None, None) => {}
        (Some(m), Some(d)) if chrono::NaiveDate::from_ymd_opt(2000, m as u32, d as u32).is_some() => {}
        _ => return Err(AppError::BadRequest("That is not a day of the year".into())),
    }
    sqlx::query("UPDATE users SET birthday_month = $2, birthday_day = $3 WHERE id = $1").bind(uid).bind(req.month).bind(req.day).execute(&state.db).await?;
    changed(&state, uid).await;
    Ok(Json(status(&state.db, uid).await?))
}

#[derive(Deserialize)]
struct Declare { adult: bool }

/// `POST /users/@me/age/declare {adult}`. `adult: false` marks the account as under 18: the strictest settings, and
/// only staff can undo it. `adult: true` records a self-declaration, which opens restricted places only on an
/// instance that accepts declarations.
async fn declare(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<Declare>) -> AppResult<Json<Value>> {
    let (minor, guest): (bool, bool) = sqlx::query_as("SELECT declared_minor, guest FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if guest { return Err(AppError::ForbiddenWith("Create an account first".into())) }
    if minor { return Err(AppError::Conflict("Your account is marked as under 18. Ask an administrator if that is wrong.".into())) }
    if req.adult {
        let have: Option<(bool,)> = sqlx::query_as("SELECT true FROM age_assurances WHERE user_id = $1 AND level = 'declared' AND revoked_at IS NULL").bind(uid).fetch_optional(&state.db).await?;
        if have.is_none() {
            sqlx::query("INSERT INTO age_assurances (id, user_id, threshold, level, provider) VALUES ($1, $2, 18, 'declared', 'self')").bind(Uuid::now_v7()).bind(uid).execute(&state.db).await?;
        }
    } else {
        // Saying you are under 18 withdraws anything you declared yourself, and turns on the teen settings.
        sqlx::query("UPDATE age_assurances SET revoked_at = now(), revoked_why = 'Said they are under 18' WHERE user_id = $1 AND level = 'declared' AND revoked_at IS NULL").bind(uid).execute(&state.db).await?;
        sqlx::query("UPDATE age_requests SET status = 'declined', reply = 'Withdrawn', decided_at = now() WHERE user_id = $1 AND status = 'pending'").bind(uid).execute(&state.db).await?;
        sqlx::query("UPDATE users SET declared_minor = true, dm_privacy = 'friends', spam_filter = 'all', sensitive_media = '{\"non_friend_dms\": \"block\", \"friend_dms\": \"blur\", \"servers\": \"blur\", \"restricted\": \"block\"}'::jsonb WHERE id = $1")
            .bind(uid).execute(&state.db).await?;
    }
    changed(&state, uid).await;
    Ok(Json(status(&state.db, uid).await?))
}

#[derive(Deserialize)]
struct Ask { #[serde(default)] note: String }

/// `POST /users/@me/age/request {note}`: ask this instance's staff to confirm you are an adult.
async fn ask(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<Ask>) -> AppResult<Json<Value>> {
    let c = load_config(&state.db).await;
    if !c.attestation { return Err(AppError::ForbiddenWith("This instance's staff do not confirm ages.".into())) }
    let (minor, guest): (bool, bool) = sqlx::query_as("SELECT declared_minor, guest FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if guest { return Err(AppError::ForbiddenWith("Create an account first".into())) }
    if minor { return Err(AppError::Conflict("Your account is marked as under 18. Ask an administrator if that is wrong.".into())) }
    let (recent,): (i64,) = sqlx::query_as("SELECT count(*) FROM age_requests WHERE user_id = $1 AND created_at > now() - interval '30 days'").bind(uid).fetch_one(&state.db).await?;
    if recent >= 3 { return Err(AppError::TooMany("Too many tries. Wait a while and try again.".into())) }
    let note: String = req.note.trim().chars().take(500).collect();
    let made = sqlx::query("INSERT INTO age_requests (id, user_id, note) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING").bind(Uuid::now_v7()).bind(uid).bind(&note).execute(&state.db).await?.rows_affected();
    if made == 0 { return Err(AppError::Conflict("You already have a request waiting.".into())) }
    Ok(Json(status(&state.db, uid).await?))
}

async fn withdraw(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    sqlx::query("DELETE FROM age_requests WHERE user_id = $1 AND status = 'pending'").bind(uid).execute(&state.db).await?;
    Ok(Json(status(&state.db, uid).await?))
}

// ---- outside providers ----------------------------------------------------------------------------------------

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder().user_agent("parley").timeout(std::time::Duration::from_secs(15)).build().map_err(|e| AppError::Other(e.into()))
}

/// `POST /users/@me/age/verify`: start a check with the configured provider. Returns the address to send the
/// member to. The check is tied to this account and this age, can be used once, and lapses in 15 minutes.
async fn start_verify(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    let c = load_config(&state.db).await;
    if !c.provider_ready() { return Err(AppError::ForbiddenWith("No age verification service is set up on this instance.".into())) }
    let (minor, guest): (bool, bool) = sqlx::query_as("SELECT declared_minor, guest FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if guest { return Err(AppError::ForbiddenWith("Create an account first".into())) }
    if minor { return Err(AppError::Conflict("Your account is marked as under 18. Ask an administrator if that is wrong.".into())) }
    let (recent,): (i64,) = sqlx::query_as("SELECT count(*) FROM age_verifications WHERE user_id = $1 AND created_at > now() - interval '1 hour'").bind(uid).fetch_one(&state.db).await?;
    if recent >= 5 { return Err(AppError::TooMany("Too many tries. Wait a while and try again.".into())) }
    let (id, nonce) = (Uuid::now_v7(), crate::mail::new_token());
    sqlx::query("INSERT INTO age_verifications (id, user_id, threshold, provider, nonce, expires_at) VALUES ($1, $2, 18, $3, $4, now() + interval '15 minutes')")
        .bind(id).bind(uid).bind(&c.provider).bind(&nonce).execute(&state.db).await?;
    let app = state.config.app_url.trim_end_matches('/');
    let url = if c.provider == "oidc" {
        let mut u = url::Url::parse(&c.oidc_authorize_url).map_err(|_| AppError::BadRequest("The provider's sign-in address is not valid".into()))?;
        u.query_pairs_mut().append_pair("response_type", "code").append_pair("client_id", &c.oidc_client_id)
            .append_pair("redirect_uri", &format!("{app}/api/age/callback")).append_pair("scope", &c.oidc_scope)
            .append_pair("state", &id.to_string()).append_pair("nonce", &nonce);
        u.to_string()
    } else {
        let resp = http_client()?.post(&c.http_url).bearer_auth(&c.http_token)
            .json(&json!({ "transaction": id, "threshold": 18, "return_url": format!("{app}/?age=back") }))
            .send().await.map_err(|_| AppError::ForbiddenWith("The age verification service could not be reached. Try again later.".into()))?;
        let body: Value = if resp.status().is_success() { resp.json().await.unwrap_or(Value::Null) } else { Value::Null };
        match body["url"].as_str().filter(|u| u.starts_with("https://") || u.starts_with("http://")) {
            Some(u) => u.to_string(),
            None => return Err(AppError::ForbiddenWith("The age verification service could not be reached. Try again later.".into())),
        }
    };
    Ok(Json(json!({ "url": url })))
}

/// Take a check that is still open, exactly once.
async fn take(db: &PgPool, id: Uuid, provider: &str) -> AppResult<Option<(Uuid, i16, String)>> {
    Ok(sqlx::query_as("UPDATE age_verifications SET used_at = now() WHERE id = $1 AND provider = $2 AND used_at IS NULL AND expires_at > now() RETURNING user_id, threshold, nonce")
        .bind(id).bind(provider).fetch_optional(db).await?)
}

/// Write the record a provider's answer earns. The provider's own id for the person is stored only as a hash, and
/// the same one cannot open a second account.
async fn record_verified(state: &AppState, c: &Config, uid: Uuid, threshold: i16, reference: &str, expires: Option<chrono::DateTime<chrono::Utc>>) -> Result<(), &'static str> {
    use sha2::{Digest, Sha256};
    let hashed: String = Sha256::digest(format!("{}|{}", c.name(), reference).as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
    let minor: bool = sqlx::query_as::<_, (bool,)>("SELECT declared_minor FROM users WHERE id = $1").bind(uid).fetch_optional(&state.db).await.ok().flatten().map(|r| r.0).unwrap_or(true);
    if minor { return Err("minor") }
    let mine: Option<(Uuid,)> = sqlx::query_as("SELECT user_id FROM age_assurances WHERE provider = $1 AND reference = $2 AND revoked_at IS NULL").bind(c.name()).bind(&hashed).fetch_optional(&state.db).await.ok().flatten();
    match mine {
        Some((owner,)) if owner != uid => return Err("used"),
        Some(_) => { let _ = sqlx::query("UPDATE age_assurances SET revoked_at = now(), revoked_why = 'Replaced by a newer check' WHERE provider = $1 AND reference = $2 AND revoked_at IS NULL").bind(c.name()).bind(&hashed).execute(&state.db).await; }
        None => {}
    }
    let expires = expires.or_else(|| (c.valid_days > 0).then(|| chrono::Utc::now() + chrono::Duration::days(c.valid_days)));
    let res = sqlx::query("INSERT INTO age_assurances (id, user_id, threshold, level, provider, reference, expires_at) VALUES ($1, $2, $3, 'verified', $4, $5, $6)")
        .bind(Uuid::now_v7()).bind(uid).bind(threshold).bind(c.name()).bind(&hashed).bind(expires).execute(&state.db).await;
    if res.is_err() { return Err("used") }
    audit::record(state, uid, "age.verified", "user", Some(uid), &audit::username(state, uid).await, json!({ "provider": c.name(), "threshold": threshold })).await;
    changed(state, uid).await;
    Ok(())
}

#[derive(Deserialize)]
struct OidcBack { code: Option<String>, state: Option<String> }

fn back(state: &AppState, result: &str) -> Redirect {
    Redirect::to(&format!("{}/?age={result}", state.config.app_url.trim_end_matches('/')))
}

/// `GET /age/callback?code&state`: the provider sends the member back here. The code is exchanged with the provider
/// directly, and the answer must name this instance, this check and the age asked for.
async fn oidc_callback(State(state): State<AppState>, Query(q): Query<OidcBack>) -> Redirect {
    let c = load_config(&state.db).await;
    let (Some(code), Some(id)) = (q.code, q.state.and_then(|s| Uuid::parse_str(&s).ok())) else { return back(&state, "failed") };
    if c.provider != "oidc" || !c.provider_ready() { return back(&state, "failed") }
    let Ok(Some((uid, threshold, nonce))) = take(&state.db, id, "oidc").await else { return back(&state, "expired") };
    let app = state.config.app_url.trim_end_matches('/');
    let Ok(client) = http_client() else { return back(&state, "failed") };
    let resp = client.post(&c.oidc_token_url).form(&[
        ("grant_type", "authorization_code"), ("code", code.as_str()), ("redirect_uri", &format!("{app}/api/age/callback")),
        ("client_id", c.oidc_client_id.as_str()), ("client_secret", c.oidc_client_secret.as_str()),
    ]).send().await;
    let body: Value = match resp { Ok(r) if r.status().is_success() => r.json().await.unwrap_or(Value::Null), _ => return back(&state, "unavailable") };
    // The token came straight from the provider over the connection we opened, so its claims are read as sent
    // (OpenID Connect Core 3.1.3.7); they are still checked against this instance, this check and the clock.
    let Some(claims) = body["id_token"].as_str().and_then(|t| t.split('.').nth(1)).and_then(|p| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p.trim_end_matches('=')).ok()).and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else { return back(&state, "failed") };
    let aud_ok = match &claims["aud"] { Value::String(a) => *a == c.oidc_client_id, Value::Array(v) => v.iter().any(|a| a.as_str() == Some(c.oidc_client_id.as_str())), _ => false };
    let fresh = claims["exp"].as_i64().map(|e| e > chrono::Utc::now().timestamp()).unwrap_or(false);
    if claims["iss"].as_str() != Some(c.oidc_issuer.as_str()) || !aud_ok || !fresh || claims["nonce"].as_str() != Some(nonce.as_str()) { return back(&state, "failed") }
    let claim = c.oidc_claim.replace("{n}", &threshold.to_string());
    if claims[&claim].as_bool() != Some(true) { return back(&state, "not_met") }
    let Some(sub) = claims["sub"].as_str().filter(|s| !s.is_empty()) else { return back(&state, "failed") };
    match record_verified(&state, &c, uid, threshold, &format!("{}|{sub}", c.oidc_issuer), None).await {
        Ok(()) => back(&state, "verified"),
        Err(why) => back(&state, why),
    }
}

#[derive(Deserialize)]
struct AdapterBack { transaction: Uuid, met: bool, #[serde(default)] reference: String, expires_at: Option<chrono::DateTime<chrono::Utc>> }

/// `POST /age/adapter/callback`: the operator's adapter reports the result of a check, with the shared token.
async fn adapter_callback(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<AdapterBack>) -> AppResult<Json<Value>> {
    let c = load_config(&state.db).await;
    let given = headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
    let want = c.http_token.as_bytes();
    // Constant time: the comparison must not tell a guesser how much of the token was right.
    let same = c.provider == "http" && !want.is_empty() && want.len() == given.len() && want.iter().zip(given.bytes()).fold(0u8, |d, (a, b)| d | (a ^ b)) == 0;
    if !same { return Err(AppError::Unauthorized) }
    let Some((uid, threshold, _)) = take(&state.db, req.transaction, "http").await? else { return Err(AppError::NotFound("No open check with that id".into())) };
    if !req.met { changed(&state, uid).await; return Ok(Json(json!({ "recorded": false }))) }
    if req.reference.trim().is_empty() { return Err(AppError::BadRequest("reference is needed: your service's own id for this result".into())) }
    match record_verified(&state, &c, uid, threshold, req.reference.trim(), req.expires_at).await {
        Ok(()) => Ok(Json(json!({ "recorded": true }))),
        Err("used") => Err(AppError::Conflict("That result has already been used for another account".into())),
        Err(_) => Err(AppError::Conflict("This account cannot be verified".into())),
    }
}

// ---- staff ----------------------------------------------------------------------------------------------------

#[derive(Deserialize)]
struct RequestsQuery { #[serde(default)] status: String }

async fn list_requests(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<RequestsQuery>) -> AppResult<Json<Vec<Value>>> {
    require_perm(&state, uid, Perm::AgeAttest).await?;
    let status = if ["approved", "declined"].contains(&q.status.as_str()) { q.status.as_str() } else { "pending" };
    let rows: Vec<(Uuid, Uuid, String, String, Option<String>, String, String, String, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "SELECT r.id, u.id, u.username, u.display_name, u.avatar_url, r.note, r.status, r.reply, r.created_at, u.created_at, r.decided_at
           FROM age_requests r JOIN users u ON u.id = r.user_id WHERE r.status = $1 ORDER BY r.created_at LIMIT 200",
    ).bind(status).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|r| json!({
        "id": r.0, "user": { "id": r.1, "username": r.2, "display_name": r.3, "avatar_url": r.4, "created_at": r.9 },
        "note": r.5, "status": r.6, "reply": r.7, "created_at": r.8, "decided_at": r.10,
    })).collect()))
}

/// The attestation itself: staff record that they confirmed the person meets the age. `actor == user` is allowed
/// (a one-person instance has nobody else) and is marked in the audit log.
async fn write_attestation(state: &AppState, actor: Uuid, user: Uuid, threshold: i16, note: &str, days: i64) -> AppResult<()> {
    if !(13..=21).contains(&threshold) { return Err(AppError::BadRequest("The age is between 13 and 21".into())) }
    if !(0..=3650).contains(&days) { return Err(AppError::BadRequest("expires_days is between 0 and 3650".into())) }
    let note: String = note.trim().chars().take(500).collect();
    if note.chars().count() < 3 { return Err(AppError::BadRequest("Say how you confirmed it (for example: known in person, video call).".into())) }
    let who: Option<(bool, bool, bool)> = sqlx::query_as("SELECT declared_minor, guest, bot FROM users WHERE id = $1 AND account_state = 'active'").bind(user).fetch_optional(&state.db).await?;
    let Some((minor, guest, bot)) = who else { return Err(AppError::NotFound("User not found".into())) };
    if guest || bot { return Err(AppError::BadRequest("Guests and bots cannot be attested. A bot follows its owner.".into())) }
    if minor { return Err(AppError::Conflict("This account is marked as under 18. Clear that first, if it is wrong.".into())) }
    let c = load_config(&state.db).await;
    let days = if days > 0 { days } else { c.valid_days };
    let expires = (days > 0).then(|| chrono::Utc::now() + chrono::Duration::days(days));
    sqlx::query("UPDATE age_assurances SET revoked_at = now(), revoked_by = $2, revoked_why = 'Replaced by a newer attestation' WHERE user_id = $1 AND level = 'attested' AND revoked_at IS NULL")
        .bind(user).bind(actor).execute(&state.db).await?;
    sqlx::query("INSERT INTO age_assurances (id, user_id, threshold, level, provider, note, created_by, expires_at) VALUES ($1, $2, $3, 'attested', 'operator', $4, $5, $6)")
        .bind(Uuid::now_v7()).bind(user).bind(threshold).bind(&note).bind(actor).bind(expires).execute(&state.db).await?;
    audit::record(state, actor, "age.attest", "user", Some(user), &audit::username(state, user).await, json!({ "threshold": threshold, "note": note, "expires_at": expires, "self": actor == user })).await;
    changed(state, user).await;
    Ok(())
}

#[derive(Deserialize)]
struct Decide { approve: bool, #[serde(default)] note: String, #[serde(default)] reply: String, #[serde(default)] expires_days: i64 }

/// `POST /admin/age/requests/:id {approve, note, reply, expires_days}`: approve (which attests) or decline.
async fn decide_request(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<Decide>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::AgeAttest).await?;
    if !load_config(&state.db).await.attestation { return Err(AppError::ForbiddenWith("Attestation by staff is turned off for this instance.".into())) }
    let Some((user, threshold)): Option<(Uuid, i16)> = sqlx::query_as("SELECT user_id, threshold FROM age_requests WHERE id = $1 AND status = 'pending'").bind(id).fetch_optional(&state.db).await? else {
        return Err(AppError::NotFound("That request is not waiting any more".into()));
    };
    if req.approve { write_attestation(&state, uid, user, threshold, &req.note, req.expires_days).await?; }
    let reply: String = req.reply.trim().chars().take(500).collect();
    sqlx::query("UPDATE age_requests SET status = $2, reply = $3, decided_by = $4, decided_at = now() WHERE id = $1")
        .bind(id).bind(if req.approve { "approved" } else { "declined" }).bind(&reply).bind(uid).execute(&state.db).await?;
    if !req.approve {
        audit::record(&state, uid, "age.request.decline", "user", Some(user), &audit::username(&state, user).await, json!({ "reply": reply })).await;
        changed(&state, user).await;
    }
    Ok(Json(json!({ "ok": true })))
}

/// `GET /admin/age/users/:id`: one account's standing and its records, current and past.
async fn user_records(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::AgeAttest).await?;
    let Some((minor, adult)): Option<(bool, bool)> = sqlx::query_as("SELECT declared_minor, age_meets(id, 18) FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await? else { return Err(AppError::NotFound("User not found".into())) };
    let rows: Vec<(Uuid, i16, String, String, String, Option<String>, chrono::DateTime<chrono::Utc>, Option<chrono::DateTime<chrono::Utc>>, Option<chrono::DateTime<chrono::Utc>>, String)> = sqlx::query_as(
        "SELECT a.id, a.threshold, a.level, a.provider, a.note, (SELECT username FROM users WHERE id = a.created_by), a.verified_at, a.expires_at, a.revoked_at, a.revoked_why
           FROM age_assurances a WHERE a.user_id = $1 ORDER BY a.verified_at DESC LIMIT 50",
    ).bind(id).fetch_all(&state.db).await?;
    audit::record(&state, uid, "age.view", "user", Some(id), &audit::username(&state, id).await, json!({})).await;
    Ok(Json(json!({
        "age_group": if minor { "teen" } else if adult { "adult" } else { "unknown" }, "declared_minor": minor,
        "attestation": load_config(&state.db).await.attestation,
        "records": rows.into_iter().map(|r| json!({ "id": r.0, "threshold": r.1, "level": r.2, "provider": r.3, "note": r.4, "by": r.5, "verified_at": r.6, "expires_at": r.7, "revoked_at": r.8, "revoked_why": r.9 })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
struct Attest { #[serde(default = "eighteen")] threshold: i16, note: String, #[serde(default)] expires_days: i64 }
fn eighteen() -> i16 { 18 }

async fn attest(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<Attest>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::AgeAttest).await?;
    if !load_config(&state.db).await.attestation { return Err(AppError::ForbiddenWith("Attestation by staff is turned off for this instance.".into())) }
    write_attestation(&state, uid, id, req.threshold, &req.note, req.expires_days).await?;
    sqlx::query("UPDATE age_requests SET status = 'approved', decided_by = $2, decided_at = now() WHERE user_id = $1 AND status = 'pending'").bind(id).bind(uid).execute(&state.db).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct Why { #[serde(default)] reason: String }

/// `POST /admin/age/assurances/:id/revoke {reason}`: withdraw a record. Access it opened ends at once.
async fn revoke(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<Why>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::AgeAttest).await?;
    let reason: String = req.reason.trim().chars().take(500).collect();
    let Some((user, level)): Option<(Uuid, String)> = sqlx::query_as("UPDATE age_assurances SET revoked_at = now(), revoked_by = $2, revoked_why = $3 WHERE id = $1 AND revoked_at IS NULL RETURNING user_id, level")
        .bind(id).bind(uid).bind(&reason).fetch_optional(&state.db).await? else { return Err(AppError::NotFound("That record is not current".into())) };
    audit::record(&state, uid, "age.revoke", "user", Some(user), &audit::username(&state, user).await, json!({ "level": level, "reason": reason })).await;
    changed(&state, user).await;
    Ok(Json(json!({ "ok": true })))
}

/// `POST /admin/age/users/:id/clear-minor {reason}`: undo "said they are under 18" when it was a mistake.
async fn clear_minor(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<Why>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::AgeAttest).await?;
    let reason: String = req.reason.trim().chars().take(500).collect();
    if reason.chars().count() < 3 { return Err(AppError::BadRequest("Say why (it is kept in the audit log).".into())) }
    let n = sqlx::query("UPDATE users SET declared_minor = false WHERE id = $1 AND declared_minor").bind(id).execute(&state.db).await?.rows_affected();
    if n == 0 { return Err(AppError::NotFound("That account is not marked as under 18".into())) }
    audit::record(&state, uid, "age.clear_minor", "user", Some(id), &audit::username(&state, id).await, json!({ "reason": reason })).await;
    changed(&state, id).await;
    Ok(Json(json!({ "ok": true })))
}
