//! Activities in calls: embedded pages everyone in a call can open together. Built-ins (Watch Together,
//! Tic-Tac-Toe) ship with the web client under /activities/; apps add their own by setting an activity URL. A
//! session is one activity in one call; people in the call join and leave it, and it ends when the last one leaves
//! (leaving the call leaves its activities). CALL_ACTIVITY_UPDATE tells the server (or the DM call's members).
//!
//! The page talks to the client through the activity SDK (public/activities/sdk.js), which relays to these routes:
//! shared state (last write wins, handed to whoever joins), messages to the others in the session, and, for apps,
//! an OAuth code so the app's own server can learn who is playing.

use crate::{auth::AuthUser, error::{AppError, AppResult}, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::{get, post, put}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/activities", get(list).post(join))
        .route("/channels/:id/activities/catalog", get(catalog))
        .route("/activities/:id", get(get_one))
        .route("/activities/:id/participants/@me", axum::routing::delete(leave_route))
        .route("/activities/:id/state", put(set_state))
        .route("/activities/:id/messages", post(message))
        .route("/activities/:id/authorize", post(authorize))
}

struct Builtin { key: &'static str, name: &'static str, description: &'static str, url: &'static str }
const BUILTINS: [Builtin; 2] = [
    Builtin { key: "watch", name: "Watch Together", description: "Watch YouTube together, in sync.", url: "/activities/watch.html" },
    Builtin { key: "tictactoe", name: "Tic-Tac-Toe", description: "Two players take X and O; everyone else watches.", url: "/activities/tictactoe.html" },
];
const MAX_STATE: usize = 32 * 1024;
const MAX_MESSAGE: usize = 8 * 1024;
const MAX_PER_CALL: i64 = 5;

/// Apps whose activities this user may start here: their own, ones installed to their account, and ones whose bot
/// is in this server.
async fn apps_for(db: &sqlx::PgPool, uid: Uuid, guild: Option<Uuid>) -> AppResult<Vec<(Uuid, String, String, String, Option<String>)>> {
    Ok(sqlx::query_as(
        "SELECT a.id, a.name, a.description, a.activity_url, a.icon_url FROM applications a
         WHERE a.activity_url IS NOT NULL AND (a.owner_id = $1 OR EXISTS (SELECT 1 FROM user_app_installs i WHERE i.user_id = $1 AND i.app_id = a.id)
           OR ($2::uuid IS NOT NULL AND a.bot_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM guild_members m WHERE m.guild_id = $2 AND m.user_id = a.bot_user_id)))
         ORDER BY a.name LIMIT 50",
    ).bind(uid).bind(guild).fetch_all(db).await?)
}

async fn catalog(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    let (c, _) = crate::routes::channels::require_channel_perms(&state.db, id, uid).await?;
    let mut out: Vec<Value> = BUILTINS.iter().map(|b| json!({ "key": b.key, "name": b.name, "description": b.description, "url": b.url, "builtin": true })).collect();
    for (aid, name, desc, url, icon) in apps_for(&state.db, uid, c.guild_id).await? {
        out.push(json!({ "key": format!("app:{aid}"), "name": name, "description": desc, "url": url, "app_id": aid, "icon_url": icon, "builtin": false }));
    }
    Ok(Json(out))
}

/// A session as clients see it: what it is, where it runs, and who is in it.
async fn session(db: &sqlx::PgPool, id: Uuid) -> AppResult<Option<Value>> {
    let row: Option<(Uuid, Uuid, String, Option<Uuid>, Uuid, chrono::DateTime<chrono::Utc>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT s.id, s.channel_id, s.key, s.app_id, s.started_by, s.created_at, a.name, a.activity_url, a.icon_url FROM call_activities s LEFT JOIN applications a ON a.id = s.app_id WHERE s.id = $1",
    ).bind(id).fetch_optional(db).await?;
    let Some((id, channel, key, app, by, at, app_name, app_url, icon)) = row else { return Ok(None) };
    let (name, url) = match BUILTINS.iter().find(|b| b.key == key) {
        Some(b) => (b.name.to_string(), b.url.to_string()),
        None => (app_name.unwrap_or_default(), app_url.unwrap_or_default()),
    };
    let people: Vec<(Uuid,)> = sqlx::query_as("SELECT user_id FROM call_activity_members WHERE activity_id = $1 ORDER BY joined_at").bind(id).fetch_all(db).await?;
    Ok(Some(json!({ "id": id, "channel_id": channel, "key": key, "name": name, "url": url, "app_id": app, "icon_url": icon, "started_by": by, "created_at": at,
        "participants": people.into_iter().map(|p| p.0).collect::<Vec<_>>() })))
}

/// Tell whoever can see the call: the server, or the DM call's members.
async fn announce(state: &AppState, id: Uuid, ended: Option<(Uuid, Option<Uuid>, Vec<Uuid>)>) {
    if let Some((channel, guild, peers)) = ended {
        let d = json!({ "id": id, "channel_id": channel, "ended": true });
        match guild { Some(g) => state.hub.emit_guild(g, "CALL_ACTIVITY_UPDATE", d), None => state.hub.emit_users(peers, "CALL_ACTIVITY_UPDATE", d) }
        return
    }
    let Ok(Some(s)) = session(&state.db, id).await else { return };
    let aud: Option<(Option<Uuid>, Vec<Uuid>)> = sqlx::query_as("SELECT guild_id, peers FROM call_activities WHERE id = $1").bind(id).fetch_optional(&state.db).await.ok().flatten();
    match aud { Some((Some(g), _)) => state.hub.emit_guild(g, "CALL_ACTIVITY_UPDATE", s), Some((None, peers)) => state.hub.emit_users(peers, "CALL_ACTIVITY_UPDATE", s), None => {} }
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    crate::routes::channels::require_channel_perms(&state.db, id, uid).await?;
    let ids: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM call_activities WHERE channel_id = $1 ORDER BY created_at").bind(id).fetch_all(&state.db).await?;
    let mut out = Vec::new();
    for (i,) in ids { if let Some(s) = session(&state.db, i).await? { out.push(s) } }
    Ok(Json(out))
}

#[derive(Deserialize)]
struct JoinReq { key: String }

/// Start an activity in your call, or join it if it's running. You're in one activity at a time.
async fn join(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<JoinReq>) -> AppResult<Json<Value>> {
    let vs = state.hub.voice_state(uid).filter(|v| v.channel_id == id).ok_or_else(|| AppError::BadRequest("Join the call first".into()))?;
    let (c, _) = crate::routes::channels::require_channel_perms(&state.db, id, uid).await?;
    let app = match req.key.strip_prefix("app:") {
        Some(a) => {
            let a = Uuid::parse_str(a).map_err(|_| AppError::BadRequest("Unknown activity".into()))?;
            if !apps_for(&state.db, uid, c.guild_id).await?.iter().any(|x| x.0 == a) {
                // Joining someone else's app session is fine; starting one needs the app.
                let running = sqlx::query_as::<_, (bool,)>("SELECT EXISTS (SELECT 1 FROM call_activities WHERE channel_id = $1 AND key = $2)").bind(id).bind(&req.key).fetch_one(&state.db).await?.0;
                if !running { return Err(AppError::BadRequest("Unknown activity".into())) }
            }
            Some(a)
        }
        None if BUILTINS.iter().any(|b| b.key == req.key) => None,
        None => return Err(AppError::BadRequest("Unknown activity".into())),
    };
    let existing: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM call_activities WHERE channel_id = $1 AND key = $2").bind(id).bind(&req.key).fetch_optional(&state.db).await?;
    if existing.is_none() {
        let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM call_activities WHERE channel_id = $1").bind(id).fetch_one(&state.db).await?;
        if n >= MAX_PER_CALL { return Err(AppError::BadRequest("This call already has 5 activities running".into())) }
    }
    // One at a time: leave whatever else you were in.
    let others: Vec<(Uuid,)> = sqlx::query_as("SELECT activity_id FROM call_activity_members m JOIN call_activities s ON s.id = m.activity_id WHERE m.user_id = $1 AND s.key <> $2")
        .bind(uid).bind(&req.key).fetch_all(&state.db).await?;
    for (o,) in others { leave(&state, o, uid).await?; }
    let peers = if vs.guild_id.is_some() { Vec::new() } else { vs.peers.clone() };
    let (sid,): (Uuid,) = sqlx::query_as(
        "INSERT INTO call_activities (id, channel_id, key, app_id, guild_id, peers, started_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (channel_id, key) DO UPDATE SET key = EXCLUDED.key RETURNING id",
    ).bind(Uuid::now_v7()).bind(id).bind(&req.key).bind(app).bind(vs.guild_id).bind(&peers).bind(uid).fetch_one(&state.db).await?;
    sqlx::query("INSERT INTO call_activity_members (activity_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(sid).bind(uid).execute(&state.db).await?;
    announce(&state, sid, None).await;
    get_one(State(state), AuthUser(uid), Path(sid)).await
}

/// The session and its state, for someone in it (the SDK's READY).
async fn get_one(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    member(&state, id, uid).await?;
    let mut s = session(&state.db, id).await?.ok_or_else(|| AppError::NotFound("Activity not found".into()))?;
    let (st,): (Value,) = sqlx::query_as("SELECT state FROM call_activities WHERE id = $1").bind(id).fetch_one(&state.db).await?;
    s["state"] = st;
    Ok(Json(s))
}

async fn member(state: &AppState, id: Uuid, uid: Uuid) -> AppResult<()> {
    let ok = sqlx::query_as::<_, (bool,)>("SELECT EXISTS (SELECT 1 FROM call_activity_members WHERE activity_id = $1 AND user_id = $2)").bind(id).bind(uid).fetch_one(&state.db).await?.0;
    if ok { Ok(()) } else { Err(AppError::NotFound("You aren't in this activity".into())) }
}

async fn participants(db: &sqlx::PgPool, id: Uuid) -> Vec<Uuid> {
    sqlx::query_as::<_, (Uuid,)>("SELECT user_id FROM call_activity_members WHERE activity_id = $1").bind(id).fetch_all(db).await.map(|r| r.into_iter().map(|x| x.0).collect()).unwrap_or_default()
}

/// Leave a session; the last one out ends it.
async fn leave(state: &AppState, id: Uuid, uid: Uuid) -> AppResult<()> {
    let n = sqlx::query("DELETE FROM call_activity_members WHERE activity_id = $1 AND user_id = $2").bind(id).bind(uid).execute(&state.db).await?.rows_affected();
    if n == 0 { return Ok(()) }
    let ended: Option<(Uuid, Option<Uuid>, Vec<Uuid>)> = sqlx::query_as(
        "DELETE FROM call_activities s WHERE s.id = $1 AND NOT EXISTS (SELECT 1 FROM call_activity_members m WHERE m.activity_id = s.id) RETURNING channel_id, guild_id, peers",
    ).bind(id).fetch_optional(&state.db).await?;
    announce(state, id, ended).await;
    Ok(())
}

async fn leave_route(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    leave(&state, id, uid).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Someone left a call: they leave its activities too.
pub fn on_voice_leave(state: &AppState, uid: Uuid, channel: Uuid) {
    let st = state.clone();
    tokio::spawn(async move {
        let ids: Vec<(Uuid,)> = sqlx::query_as("SELECT m.activity_id FROM call_activity_members m JOIN call_activities s ON s.id = m.activity_id WHERE m.user_id = $1 AND s.channel_id = $2")
            .bind(uid).bind(channel).fetch_all(&st.db).await.unwrap_or_default();
        for (id,) in ids { let _ = leave(&st, id, uid).await; }
    });
}

#[derive(Deserialize)]
struct StateReq { state: Value }
async fn set_state(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<StateReq>) -> AppResult<StatusCode> {
    member(&state, id, uid).await?;
    if !req.state.is_object() { return Err(AppError::BadRequest("State is an object".into())) }
    if serde_json::to_string(&req.state).map(|s| s.len()).unwrap_or(usize::MAX) > MAX_STATE { return Err(AppError::BadRequest("State is limited to 32 KB".into())) }
    sqlx::query("UPDATE call_activities SET state = $2 WHERE id = $1").bind(id).bind(&req.state).execute(&state.db).await?;
    state.hub.emit_users(participants(&state.db, id).await, "CALL_ACTIVITY_STATE", json!({ "id": id, "state": req.state, "user_id": uid }));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct MessageReq { data: Value }
async fn message(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<MessageReq>) -> AppResult<StatusCode> {
    member(&state, id, uid).await?;
    if serde_json::to_string(&req.data).map(|s| s.len()).unwrap_or(usize::MAX) > MAX_MESSAGE { return Err(AppError::BadRequest("Messages are limited to 8 KB".into())) }
    let to: Vec<Uuid> = participants(&state.db, id).await.into_iter().filter(|u| *u != uid).collect();
    state.hub.emit_users(to, "CALL_ACTIVITY_MESSAGE", json!({ "id": id, "data": req.data, "user_id": uid }));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct AuthorizeReq { scope: Option<String> }

/// An app activity asks who is playing: after the user agrees in the client, a one-minute OAuth code the app's
/// server swaps (with its secret) for a token. Redirect URI: the activity URL.
async fn authorize(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<AuthorizeReq>) -> AppResult<Json<Value>> {
    member(&state, id, uid).await?;
    let row: Option<(Uuid, String)> = sqlx::query_as("SELECT a.id, a.activity_url FROM call_activities s JOIN applications a ON a.id = s.app_id WHERE s.id = $1 AND a.activity_url IS NOT NULL")
        .bind(id).fetch_optional(&state.db).await?;
    let (app, url) = row.ok_or_else(|| AppError::BadRequest("Only app activities can ask for authorization".into()))?;
    let scopes: Vec<String> = req.scope.as_deref().unwrap_or("identify").split_whitespace().map(str::to_string).collect();
    if scopes.is_empty() || scopes.iter().any(|s| !["identify", "guilds"].contains(&s.as_str())) { return Err(AppError::BadRequest("Activities can ask for identify and guilds".into())) }
    let code = crate::mail::new_token();
    sqlx::query("INSERT INTO oauth_codes (code, app_id, user_id, scopes, redirect_uri, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval '1 minute')")
        .bind(&code).bind(app).bind(uid).bind(&scopes).bind(&url).execute(&state.db).await?;
    Ok(Json(json!({ "code": code, "scopes": scopes })))
}
