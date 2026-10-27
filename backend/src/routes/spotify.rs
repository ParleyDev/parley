//! "Listening to Spotify" and Listen Along. A Spotify link keeps its tokens; while the user is online (and not
//! invisible, and hasn't turned it off in Settings → Connections) a background loop asks Spotify what they're
//! playing and shares it as their activity (`activities`, ACTIVITY_UPDATE to everyone, `activities` in READY).
//!
//! Listen Along: someone else with Spotify (Premium, with Spotify open on a device) asks to follow the host; the
//! server starts the host's track at the host's position on the listener's account, and moves them along whenever
//! the host changes track or seeks. The host's activity lists the listeners (`party`). It ends when either stops.

use crate::{auth::AuthUser, error::{AppError, AppResult}, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::post, Json, Router};
use serde_json::{json, Value};
use std::time::Duration;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/listen-along", axum::routing::delete(stop))
        .route("/users/:id/listen-along", post(listen))
}

const NOW_PLAYING: &str = "https://api.spotify.com/v1/me/player/currently-playing";
const PLAY: &str = "https://api.spotify.com/v1/me/player/play";
/// Each listening account is asked at most this often.
const POLL_SECS: i64 = 8;
/// A position this far from where the track should be by now counts as a seek.
const DRIFT_MS: i64 = 4000;

fn client() -> reqwest::Client {
    reqwest::Client::builder().user_agent("parley").timeout(Duration::from_secs(10)).build().unwrap_or_default()
}
fn now_ms() -> i64 { chrono::Utc::now().timestamp_millis() }

/// The connection behind someone's Spotify, if it keeps tokens.
async fn account(db: &sqlx::PgPool, uid: Uuid) -> AppResult<Option<Uuid>> {
    Ok(sqlx::query_as::<_, (Uuid,)>("SELECT id FROM connections WHERE user_id = $1 AND provider = 'spotify' AND access_token IS NOT NULL ORDER BY created_at DESC LIMIT 1")
        .bind(uid).fetch_optional(db).await?.map(|r| r.0))
}

/// What the account is playing right now, as an activity (None: nothing, paused, or not a song).
async fn now_playing(state: &AppState, cid: Uuid) -> Result<Option<Value>, String> {
    let (tok, c) = crate::routes::integrations::token(state, "spotify", cid).await?;
    let res = client().get(crate::routes::connections::with_override(NOW_PLAYING, &c.over)).bearer_auth(tok).send().await.map_err(|e| e.to_string())?;
    if res.status() == reqwest::StatusCode::NO_CONTENT { return Ok(None) }
    if !res.status().is_success() { return Err(format!("Spotify said {}", res.status())) }
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    let item = &v["item"];
    if v["is_playing"] != json!(true) || v["currently_playing_type"].as_str().unwrap_or("track") != "track" { return Ok(None) }
    let Some(id) = item["id"].as_str().filter(|s| !s.is_empty() && s.len() <= 64) else { return Ok(None) };
    let s = |x: &Value, n: usize| x.as_str().unwrap_or("").chars().take(n).collect::<String>();
    let artists: Vec<String> = item["artists"].as_array().map(|a| a.iter().take(8).map(|x| s(&x["name"], 100)).collect()).unwrap_or_default();
    let duration = item["duration_ms"].as_i64().unwrap_or(0).max(0);
    let started = now_ms() - v["progress_ms"].as_i64().unwrap_or(0).clamp(0, duration.max(1));
    let art = item["album"]["images"].as_array().and_then(|a| a.first()).map(|i| s(&i["url"], 500)).unwrap_or_default();
    let url = s(&item["external_urls"]["spotify"], 300);
    Ok(Some(json!({
        "type": "listening", "name": "Spotify", "track_id": id, "title": s(&item["name"], 200), "artists": artists,
        "album": s(&item["album"]["name"], 200),
        "art": if art.starts_with("https://") || art.starts_with("http://") { art } else { String::new() },
        "url": if url.starts_with("https://open.spotify.com/") { url } else { format!("https://open.spotify.com/track/{id}") },
        "started_at": started, "duration_ms": duration,
    })))
}

/// Start `track` at `position_ms` on the listener's Spotify. The error is what to tell them.
async fn play(state: &AppState, cid: Uuid, track: &str, position_ms: i64) -> Result<(), String> {
    let (tok, c) = crate::routes::integrations::token(state, "spotify", cid).await?;
    let res = client().put(crate::routes::connections::with_override(PLAY, &c.over)).bearer_auth(tok)
        .json(&json!({ "uris": [format!("spotify:track:{track}")], "position_ms": position_ms.max(0) })).send().await.map_err(|e| e.to_string())?;
    match res.status().as_u16() {
        200..=299 => Ok(()),
        404 => Err("Open Spotify on one of your devices first, then try again.".into()),
        403 => Err("Listening along needs Spotify Premium.".into()),
        401 => Err("Spotify needs you to link your account again (Settings → Connections).".into()),
        s => Err(format!("Spotify couldn't start playback ({s}).")),
    }
}

async fn current(db: &sqlx::PgPool, uid: Uuid) -> Option<Value> {
    sqlx::query_as::<_, (Value,)>("SELECT activity FROM activities WHERE user_id = $1").bind(uid).fetch_optional(db).await.ok().flatten().map(|r| r.0)
}
async fn party(db: &sqlx::PgPool, host: Uuid) -> Vec<Uuid> {
    sqlx::query_as::<_, (Uuid,)>("SELECT listener_id FROM listen_along WHERE host_id = $1 ORDER BY created_at LIMIT 50").bind(host).fetch_all(db).await.map(|r| r.into_iter().map(|x| x.0).collect()).unwrap_or_default()
}

/// Save (or clear) someone's activity and tell everyone.
async fn publish(state: &AppState, uid: Uuid, activity: Option<Value>) {
    match &activity {
        Some(a) => { let _ = sqlx::query("INSERT INTO activities (user_id, activity) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET activity = $2, updated_at = now()").bind(uid).bind(a).execute(&state.db).await; }
        None => { let _ = sqlx::query("DELETE FROM activities WHERE user_id = $1").bind(uid).execute(&state.db).await; }
    }
    state.hub.emit_all("ACTIVITY_UPDATE", json!({ "user_id": uid, "activity": activity }));
}

/// The host's activity again, with its listeners as they are now.
async fn republish_party(state: &AppState, host: Uuid) {
    if let Some(mut a) = current(&state.db, host).await {
        a["party"] = json!(party(&state.db, host).await);
        publish(state, host, Some(a)).await;
    }
}

/// One poll of one account: share what changed, and move listeners along to a new track or position.
async fn poll_one(state: &AppState, uid: Uuid, cid: Uuid) {
    let next = match now_playing(state, cid).await {
        Ok(n) => n,
        Err(e) => { tracing::debug!(error = %e, "spotify poll failed"); return }
    };
    let prev = current(&state.db, uid).await;
    let Some(mut next) = next else {
        if prev.is_some() { end_party(state, uid).await; publish(state, uid, None).await; }
        return
    };
    let same_track = prev.as_ref().map(|p| p["track_id"] == next["track_id"]).unwrap_or(false);
    let drift = prev.as_ref().map(|p| (p["started_at"].as_i64().unwrap_or(0) - next["started_at"].as_i64().unwrap_or(0)).abs()).unwrap_or(i64::MAX);
    if same_track && drift < DRIFT_MS { return }
    let listeners = party(&state.db, uid).await;
    next["party"] = json!(listeners);
    publish(state, uid, Some(next.clone())).await;
    let track = next["track_id"].as_str().unwrap_or("").to_string();
    let pos = now_ms() - next["started_at"].as_i64().unwrap_or(0);
    for l in listeners {
        let ok = match account(&state.db, l).await { Ok(Some(lc)) => play(state, lc, &track, pos).await.is_ok(), _ => false };
        if !ok { leave(state, l).await; }
    }
}

/// The host stopped: everyone listening along stops with them.
async fn end_party(state: &AppState, host: Uuid) {
    let _ = sqlx::query("DELETE FROM listen_along WHERE host_id = $1").bind(host).execute(&state.db).await;
}

/// Stop listening along (whoever with); the host's party updates.
async fn leave(state: &AppState, listener: Uuid) {
    let host = sqlx::query_as::<_, (Uuid,)>("DELETE FROM listen_along WHERE listener_id = $1 RETURNING host_id").bind(listener).fetch_optional(&state.db).await.ok().flatten();
    if let Some((h,)) = host { republish_party(state, h).await; }
}

/// Background: poll the Spotify accounts that are due, and clear activities whose owner no longer qualifies
/// (went offline or invisible, unlinked, turned it off). Claiming by `polled_at` keeps instances from doubling up.
pub async fn poll_loop(state: AppState) {
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let stale: Vec<(Uuid,)> = sqlx::query_as(
            "DELETE FROM activities a WHERE a.activity->>'name' = 'Spotify' AND NOT EXISTS (
               SELECT 1 FROM connections c JOIN users u ON u.id = c.user_id
               WHERE c.user_id = a.user_id AND c.provider = 'spotify' AND c.show_activity AND c.access_token IS NOT NULL AND u.status <> 'invisible'
                 AND EXISTS (SELECT 1 FROM presence p WHERE p.user_id = a.user_id AND p.sockets > 0 AND p.updated_at > now() - make_interval(secs => $1)))
             RETURNING a.user_id",
        ).bind(crate::ws::bus::STALE_SECS as f64).fetch_all(&state.db).await.unwrap_or_default();
        for (uid,) in stale {
            end_party(&state, uid).await;
            state.hub.emit_all("ACTIVITY_UPDATE", json!({ "user_id": uid, "activity": null }));
        }
        let due: Vec<(Uuid, Uuid)> = sqlx::query_as(
            "UPDATE connections SET polled_at = now() WHERE id IN (
               SELECT c.id FROM connections c JOIN users u ON u.id = c.user_id
               WHERE c.provider = 'spotify' AND c.show_activity AND c.access_token IS NOT NULL AND u.status <> 'invisible'
                 AND (c.polled_at IS NULL OR c.polled_at < now() - make_interval(secs => $2))
                 AND EXISTS (SELECT 1 FROM presence p WHERE p.user_id = c.user_id AND p.sockets > 0 AND p.updated_at > now() - make_interval(secs => $1))
               ORDER BY c.polled_at NULLS FIRST LIMIT 100 FOR UPDATE OF c SKIP LOCKED)
             RETURNING user_id, id",
        ).bind(crate::ws::bus::STALE_SECS as f64).bind(POLL_SECS as f64).fetch_all(&state.db).await.unwrap_or_default();
        for (uid, cid) in due {
            let st = state.clone();
            tokio::spawn(async move { poll_one(&st, uid, cid).await });
        }
    }
}

/// Activities of everyone online and visible, for READY.
pub async fn ready_activities(db: &sqlx::PgPool) -> serde_json::Map<String, Value> {
    sqlx::query_as::<_, (Uuid, Value)>("SELECT a.user_id, a.activity FROM activities a JOIN users u ON u.id = a.user_id WHERE u.status <> 'invisible'")
        .fetch_all(db).await.unwrap_or_default().into_iter().map(|(u, a)| (u.to_string(), a)).collect()
}

/// Listen along with `host`: their track starts on your Spotify where they are in it.
async fn listen(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(host): Path<Uuid>) -> AppResult<Json<Value>> {
    if host == uid { return Err(AppError::BadRequest("You can't listen along with yourself".into())) }
    let Some(a) = current(&state.db, host).await.filter(|a| a["name"] == "Spotify") else { return Err(AppError::BadRequest("They aren't listening to Spotify right now".into())) };
    if crate::routes::relationships::blocked_either_way(&state.db, uid, host).await? { return Err(AppError::BadRequest("They aren't listening to Spotify right now".into())) }
    let Some(cid) = account(&state.db, uid).await? else {
        let linked = sqlx::query_as::<_, (bool,)>("SELECT EXISTS (SELECT 1 FROM connections WHERE user_id = $1 AND provider = 'spotify')").bind(uid).fetch_one(&state.db).await?.0;
        return Err(AppError::BadRequest(if linked { "Link Spotify again (Settings → Connections) to listen along".into() } else { "Link your Spotify account in Settings → Connections to listen along".into() }));
    };
    let track = a["track_id"].as_str().unwrap_or("").to_string();
    play(&state, cid, &track, now_ms() - a["started_at"].as_i64().unwrap_or(0)).await.map_err(AppError::BadRequest)?;
    // One host at a time: switching leaves the old party.
    leave(&state, uid).await;
    sqlx::query("INSERT INTO listen_along (listener_id, host_id) VALUES ($1, $2) ON CONFLICT (listener_id) DO UPDATE SET host_id = $2, created_at = now()").bind(uid).bind(host).execute(&state.db).await?;
    republish_party(&state, host).await;
    Ok(Json(json!({ "host_id": host, "track_id": track })))
}

async fn stop(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<StatusCode> {
    leave(&state, uid).await;
    Ok(StatusCode::NO_CONTENT)
}
