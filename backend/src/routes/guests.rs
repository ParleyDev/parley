//! Guest accounts: "Try Parley" with no sign-up. `POST /auth/guest` makes a throwaway account (no email, no password)
//! and drops it into the demo server an admin picked in Instance Settings. Guests stay in that server: no other
//! servers, DMs, friends or apps, and a tighter message rate. One is removed an hour after it was last active (its
//! messages go with it) unless `POST /auth/claim` turns it into a normal account first.

use crate::{
    auth::{hash_password, start_session, AuthSession, AuthUser},
    error::{AppError, AppResult},
    models::PrivateUser,
    ratelimit::{client_ip, Limit, LIMITER},
    routes::users::PRIVATE_USER_COLS,
    state::AppState,
};
use axum::{extract::State, http::HeaderMap, routing::post, Json, Router};
use rand::Rng;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

/// Usernames guests get (`guest_ab12cd`); nobody can register or rename into one.
pub const PREFIX: &str = "guest_";
/// How long after its last activity an unclaimed guest is removed.
pub const IDLE_MINUTES: i32 = 60;
/// New guests per IP.
const PER_IP: Limit = Limit { count: 5.0, secs: 3600.0 };
/// Guest messages: 5 every 10 seconds.
const MESSAGES: Limit = Limit { count: 5.0, secs: 10.0 };

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/guest", post(create))
        .route("/auth/claim", post(claim))
}

/// The demo server guests land in, when guests are on and it still exists.
pub async fn demo_guild(state: &AppState) -> AppResult<Option<Uuid>> {
    let s = crate::routes::admin::load_settings(&state.db).await?;
    let Ok(gid) = s.demo_guild_id.trim().parse::<Uuid>() else { return Ok(None) };
    let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM guilds WHERE id = $1 AND state = 'active'").bind(gid).fetch_optional(&state.db).await?;
    Ok(ok.map(|_| gid))
}

pub async fn is_guest(state: &AppState, uid: Uuid) -> AppResult<bool> {
    let row: Option<(bool,)> = sqlx::query_as("SELECT guest FROM users WHERE id = $1").bind(uid).fetch_optional(&state.db).await?;
    Ok(row.map(|r| r.0).unwrap_or(false))
}

/// Refuse something guests can't do until they claim the account.
pub async fn deny(state: &AppState, uid: Uuid, why: &'static str) -> AppResult<()> {
    if is_guest(state, uid).await? { Err(AppError::Guest(why)) } else { Ok(()) }
}

/// Refuse opening a conversation with a guest, from either side.
pub async fn deny_dm(state: &AppState, uid: Uuid, others: &[Uuid]) -> AppResult<()> {
    deny(state, uid, "Guests can't send direct messages. Claim your account to start one.").await?;
    let any: Option<(bool,)> = sqlx::query_as("SELECT true FROM users WHERE id = ANY($1) AND guest LIMIT 1").bind(others).fetch_optional(&state.db).await?;
    if any.is_some() { return Err(AppError::BadRequest("Guests can't receive direct messages".into())) }
    Ok(())
}

/// Before a guest's message: none in DMs, and a tighter rate than normal accounts.
pub async fn check_post(state: &AppState, uid: Uuid, guild_id: Option<Uuid>) -> AppResult<()> {
    if !is_guest(state, uid).await? { return Ok(()) }
    if guild_id.is_none() { return Err(AppError::Guest("Guests can't send direct messages. Claim your account to start one.")) }
    LIMITER.take("guest_messages", &uid.to_string(), MESSAGES).map_err(|retry| AppError::TooMany(format!("Slow down a little: try again in {retry} seconds")))
}

#[derive(Deserialize, Default)]
struct CreateReq {
    #[serde(default)]
    display_name: Option<String>,
}

fn random_tag(len: usize) -> String {
    const ABC: &[u8] = b"abcdefghijkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..len).map(|_| ABC[rng.gen_range(0..ABC.len())] as char).collect()
}

/// `POST /auth/guest {display_name?}`: a fresh guest, signed in and already in the demo server.
async fn create(State(state): State<AppState>, headers: HeaderMap, body: Option<Json<CreateReq>>) -> AppResult<Json<Value>> {
    let Some(gid) = demo_guild(&state).await? else { return Err(AppError::NotFound("Trying Parley without an account isn't available here".into())) };
    if let Err(retry) = LIMITER.take("guests", &client_ip(&headers), PER_IP) {
        return Err(AppError::TooMany(format!("Too many guest accounts from your network. Try again in {} minutes", retry.div_ceil(60))));
    }
    let req = body.map(|b| b.0).unwrap_or_default();
    let id = Uuid::now_v7();
    let tag = random_tag(6);
    let username = format!("{PREFIX}{tag}");
    let display_name = req.display_name.map(|d| d.trim().chars().take(32).collect::<String>()).filter(|d| !d.is_empty())
        .unwrap_or_else(|| format!("Guest {}", tag[..4].to_uppercase()));
    // No way to sign in with these: the email can't receive mail and the hash matches no password.
    sqlx::query("INSERT INTO users (id, username, display_name, email, password_hash, guest, guest_seen_at) VALUES ($1, $2, $3, $4, '!', true, now())")
        .bind(id).bind(&username).bind(&display_name).bind(format!("{id}@guest.invalid"))
        .execute(&state.db).await?;
    sqlx::query("INSERT INTO guild_members (guild_id, user_id, joined_via) VALUES ($1, $2, 'guest') ON CONFLICT DO NOTHING").bind(gid).bind(id).execute(&state.db).await?;
    crate::routes::users::apply_join_defaults(&state.db, id, gid).await;
    if let Ok(member) = crate::routes::guilds::fetch_member(&state.db, gid, id).await {
        state.hub.emit_guild(gid, "GUILD_MEMBER_ADD", json!(member));
    }
    if let Err(e) = crate::routes::channels::guild_system_message(&state, gid, id, "member_join", "joined the server.").await {
        tracing::warn!(error = ?e, "guest join notice failed");
    }
    let user = sqlx::query_as::<_, PrivateUser>(&format!("SELECT {PRIVATE_USER_COLS} FROM users WHERE id = $1")).bind(id).fetch_one(&state.db).await?;
    let token = start_session(&state, id, &headers).await?;
    Ok(Json(json!({ "token": token, "user": user, "guild_id": gid })))
}

#[derive(Deserialize)]
struct ClaimReq {
    username: String,
    email: String,
    password: String,
}

/// `POST /auth/claim {username, email, password}`: keep the guest as a normal account, with everything it did.
async fn claim(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<ClaimReq>) -> AppResult<Json<PrivateUser>> {
    if !is_guest(&state, uid).await? { return Err(AppError::BadRequest("This account isn't a guest".into())) }
    let settings = crate::routes::admin::load_settings(&state.db).await?;
    if !settings.registration_enabled { return Err(AppError::BadRequest("Sign-ups are closed on this instance".into())) }
    let username = req.username.trim().to_lowercase();
    let email = req.email.trim().to_lowercase();
    if !crate::routes::auth::valid_username(&username) {
        return Err(AppError::BadRequest("Username must be 2-32 chars: letters, numbers, _ or .".into()));
    }
    if crate::routes::deletion::reserved_username(&username) { return Err(AppError::BadRequest("That username is reserved".into())) }
    if !email.contains('@') || email.len() > 254 { return Err(AppError::BadRequest("Invalid email".into())) }
    if crate::routes::deletion::email_blocked(&state, &email).await? {
        return Err(AppError::BadRequest("This email can't be used to sign up right now".into()));
    }
    if req.password.len() < 8 { return Err(AppError::BadRequest("Password must be at least 8 characters".into())) }
    crate::signup_guard::check_email(&settings, &email).await?;
    let taken: Option<(bool,)> = sqlx::query_as("SELECT true FROM users WHERE (username = $1 OR email = $2) AND id <> $3 LIMIT 1")
        .bind(&username).bind(&email).bind(uid).fetch_optional(&state.db).await?;
    if taken.is_some() { return Err(AppError::Conflict("Username or email already taken".into())) }
    let hash = hash_password(&req.password)?;
    sqlx::query("UPDATE users SET username = $2, email = $3, password_hash = $4, guest = false, guest_seen_at = NULL WHERE id = $1 AND guest")
        .bind(uid).bind(&username).bind(&email).bind(&hash).execute(&state.db).await?;
    crate::routes::auth::send_verification(&state, uid, &email).await;
    let user = sqlx::query_as::<_, PrivateUser>(&format!("SELECT {PRIVATE_USER_COLS} FROM users WHERE id = $1")).bind(uid).fetch_one(&state.db).await?;
    state.hub.emit_users(vec![uid], "USER_UPDATE", json!(user));
    Ok(Json(user))
}

/// Logging out of a guest ends it: there is no way back in.
pub async fn on_logout(state: &AppState, AuthSession(uid, _): &AuthSession) -> AppResult<bool> {
    if !is_guest(state, *uid).await? { return Ok(false) }
    crate::routes::admin::purge_account(state, *uid).await?;
    Ok(true)
}

/// Every minute: mark connected guests as active, then remove those idle for an hour.
pub async fn sweep_loop(state: AppState) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
    loop {
        tick.tick().await;
        if let Err(e) = sweep(&state).await { tracing::warn!(error = ?e, "guest sweep failed") }
    }
}

pub async fn sweep(state: &AppState) -> AppResult<usize> {
    let online = crate::ws::bus::online_users(&state.db).await;
    sqlx::query("UPDATE users SET guest_seen_at = now() WHERE guest AND id = ANY($1)").bind(&online).execute(&state.db).await?;
    let due: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT u.id FROM users u WHERE u.guest AND NOT (u.id = ANY($1))
           AND GREATEST(u.guest_seen_at, (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id)) < now() - make_interval(mins => $2)
         LIMIT 200",
    )
    .bind(&online).bind(IDLE_MINUTES).fetch_all(&state.db).await?;
    let mut n = 0;
    for (uid,) in due {
        match crate::routes::admin::purge_account(state, uid).await {
            Ok(()) => n += 1,
            Err(e) => tracing::warn!(error = ?e, %uid, "removing a guest failed"),
        }
    }
    Ok(n)
}
