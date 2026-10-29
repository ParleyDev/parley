//! Cross-instance event bus and shared presence on plain Postgres (LISTEN/NOTIFY), so several backends
//! behind one load balancer see each other's events and who is online. Voice state stays per instance.

use crate::{state::AppState, ws::hub::Target};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{postgres::PgListener, PgPool};
use std::sync::Arc;
use uuid::Uuid;

const CHANNEL: &str = "parley_events";
/// NOTIFY payloads are capped at 8000 bytes; larger ones go through bus_outbox by id.
const INLINE_MAX: usize = 7000;
/// A presence row older than this (no heartbeat) belongs to a dead instance.
pub const STALE_SECS: i64 = 90;

#[derive(Serialize, Deserialize)]
struct Frame {
    origin: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<Target>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    r#ref: Option<Uuid>,
}

/// Publisher: drains the hub's outgoing queue into NOTIFY (or the outbox + NOTIFY for big payloads).
pub async fn publisher(state: AppState, mut rx: tokio::sync::mpsc::UnboundedReceiver<(Target, Arc<Value>)>) {
    let origin = state.hub.instance_id;
    while let Some((target, payload)) = rx.recv().await {
        let frame = serde_json::to_string(&Frame { origin, target: Some(target.clone()), payload: Some((*payload).clone()), r#ref: None }).unwrap_or_default();
        let res = if frame.len() <= INLINE_MAX {
            sqlx::query("SELECT pg_notify($1, $2)").bind(CHANNEL).bind(&frame).execute(&state.db).await.map(|_| ())
        } else {
            let id = Uuid::now_v7();
            let stored = serde_json::json!({ "target": target, "payload": &*payload });
            match sqlx::query("INSERT INTO bus_outbox (id, payload) VALUES ($1, $2)").bind(id).bind(stored).execute(&state.db).await {
                Ok(_) => {
                    let small = serde_json::to_string(&Frame { origin, target: None, payload: None, r#ref: Some(id) }).unwrap_or_default();
                    sqlx::query("SELECT pg_notify($1, $2)").bind(CHANNEL).bind(&small).execute(&state.db).await.map(|_| ())
                }
                Err(e) => Err(e),
            }
        };
        if let Err(e) = res {
            tracing::warn!(error = %e, "bus publish failed");
        }
    }
}

/// Listener: injects other instances' events into the local hub. Reconnects forever.
pub async fn listener(state: AppState) {
    loop {
        match run_listener(&state).await {
            Ok(()) => {}
            Err(e) => tracing::warn!(error = %e, "bus listener dropped; reconnecting"),
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

async fn run_listener(state: &AppState) -> anyhow::Result<()> {
    let mut l = PgListener::connect_with(&state.db).await?;
    l.listen(CHANNEL).await?;
    tracing::info!(instance = %state.hub.instance_id, "event bus connected");
    loop {
        let n = l.recv().await?;
        let Ok(frame) = serde_json::from_str::<Frame>(n.payload()) else { continue };
        if frame.origin == state.hub.instance_id {
            continue;
        }
        let (target, payload) = match (frame.target, frame.payload, frame.r#ref) {
            (Some(t), Some(p), _) => (t, p),
            (_, _, Some(id)) => {
                let row: Option<(Value,)> = sqlx::query_as("SELECT payload FROM bus_outbox WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
                let Some((v,)) = row else { continue };
                let Ok(target) = serde_json::from_value::<Target>(v.get("target").cloned().unwrap_or(Value::Null)) else { continue };
                (target, v.get("payload").cloned().unwrap_or(Value::Null))
            }
            _ => continue,
        };
        state.hub.inject(target, payload);
    }
}

/// Keep this instance's presence rows fresh and tidy up after dead instances / old outbox rows.
pub async fn heartbeat(state: AppState) {
    let me = state.hub.instance_id;
    // A restarted instance has no sockets yet: forget whatever its previous life left behind.
    let _ = sqlx::query("DELETE FROM presence WHERE instance_id = $1").bind(me).execute(&state.db).await;
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let _ = sqlx::query("UPDATE presence SET updated_at = now() WHERE instance_id = $1").bind(me).execute(&state.db).await;
        let _ = sqlx::query("DELETE FROM presence WHERE updated_at < now() - make_interval(secs => $1)").bind(STALE_SECS as f64 * 2.0).execute(&state.db).await;
        let _ = sqlx::query("DELETE FROM bus_outbox WHERE created_at < now() - interval '5 minutes'").execute(&state.db).await;
    }
}

/// Register a socket; true when the user was offline everywhere before (announce PRESENCE_UPDATE online).
pub const PLATFORMS: [&str; 4] = ["web", "desktop", "mobile", "vr"];

/// `idle`: the socket starts out away (a client connecting from the background).
pub async fn connect(state: &AppState, user: Uuid, platform: &str, idle: bool) -> bool {
    state.hub.connect(user);
    let before = global_sockets(&state.db, user).await.unwrap_or(0);
    let _ = sqlx::query(
        "INSERT INTO presence (user_id, instance_id, sockets, platforms, idle) VALUES ($1, $2, 1, jsonb_build_object($3::text, 1), $4)
         ON CONFLICT (user_id, instance_id) DO UPDATE SET sockets = presence.sockets + 1, updated_at = now(), idle = presence.idle + $4,
           platforms = jsonb_set(presence.platforms, ARRAY[$3::text], to_jsonb(COALESCE((presence.platforms->>$3)::int, 0) + 1))")
        .bind(user).bind(state.hub.instance_id).bind(platform).bind(idle as i32).execute(&state.db).await;
    before == 0
}

/// Drop a socket (`idle`: it was reporting away); true when the user is now offline everywhere.
pub async fn disconnect(state: &AppState, user: Uuid, platform: &str, idle: bool) -> bool {
    state.hub.disconnect(user);
    let _ = sqlx::query(
        "UPDATE presence SET sockets = GREATEST(sockets - 1, 0), updated_at = now(), idle = GREATEST(idle - $4, 0),
           platforms = jsonb_set(platforms, ARRAY[$3::text], to_jsonb(GREATEST(COALESCE((platforms->>$3)::int, 0) - 1, 0)))
         WHERE user_id = $1 AND instance_id = $2")
        .bind(user).bind(state.hub.instance_id).bind(platform).bind(idle as i32).execute(&state.db).await;
    let _ = sqlx::query("DELETE FROM presence WHERE user_id = $1 AND instance_id = $2 AND sockets <= 0").bind(user).bind(state.hub.instance_id).execute(&state.db).await;
    global_sockets(&state.db, user).await.unwrap_or(0) == 0
}

/// A socket went away from the keyboard (`idle`) or came back.
pub async fn set_idle(state: &AppState, user: Uuid, idle: bool) {
    let _ = sqlx::query("UPDATE presence SET idle = GREATEST(idle + $3, 0) WHERE user_id = $1 AND instance_id = $2")
        .bind(user).bind(state.hub.instance_id).bind(if idle { 1 } else { -1 }).execute(&state.db).await;
}

/// Online, but every socket is away: shown as Idle unless the user picked a status.
pub async fn is_idle(db: &PgPool, user: Uuid) -> bool {
    sqlx::query_as::<_, (bool,)>(
        "SELECT COALESCE(SUM(sockets), 0) > 0 AND COALESCE(SUM(idle), 0) >= COALESCE(SUM(sockets), 0) FROM presence
         WHERE user_id = $1 AND updated_at > now() - make_interval(secs => $2)")
        .bind(user).bind(STALE_SECS as f64).fetch_one(db).await.map(|r| r.0).unwrap_or(false)
}

/// Everyone online whose every socket is away, for READY.
pub async fn idle_users(db: &PgPool) -> Vec<Uuid> {
    sqlx::query_as::<_, (Uuid,)>(
        "SELECT user_id FROM presence WHERE updated_at > now() - make_interval(secs => $1)
           AND user_id NOT IN (SELECT id FROM users WHERE status = 'invisible')
         GROUP BY user_id HAVING SUM(sockets) > 0 AND SUM(idle) >= SUM(sockets)")
        .bind(STALE_SECS as f64).fetch_all(db).await.map(|r| r.into_iter().map(|x| x.0).collect()).unwrap_or_default()
}

/// Tell everyone where `user` stands now: online or not, on which platforms, and whether they are away.
/// Someone set to Invisible is announced as offline, with no devices and not idle: their status, the device icons and
/// the away state would all give them away.
pub async fn announce(state: &AppState, user: Uuid) {
    let platforms = platforms_for(&state.db, user).await;
    let online = global_sockets(&state.db, user).await.unwrap_or(0) > 0 && !invisible(&state.db, user).await;
    let idle = online && is_idle(&state.db, user).await;
    state.hub.emit_all("PRESENCE_UPDATE", serde_json::json!({ "user_id": user, "online": online, "platforms": if online { platforms } else { Vec::new() }, "idle": idle }));
}

async fn invisible(db: &PgPool, user: Uuid) -> bool {
    sqlx::query_as::<_, (bool,)>("SELECT status = 'invisible' FROM users WHERE id = $1").bind(user).fetch_optional(db).await.ok().flatten().map(|r| r.0).unwrap_or(false)
}

/// Platforms a user currently has sockets on, across instances (web / desktop / mobile / vr).
pub async fn platforms_for(db: &PgPool, user: Uuid) -> Vec<String> {
    sqlx::query_as::<_, (String,)>(
        "SELECT e.key FROM presence p, jsonb_each_text(p.platforms) e
         WHERE p.user_id = $1 AND p.sockets > 0 AND p.updated_at > now() - make_interval(secs => $2) AND e.value::int > 0 GROUP BY e.key ORDER BY e.key")
        .bind(user).bind(STALE_SECS as f64).fetch_all(db).await.map(|r| r.into_iter().map(|x| x.0).collect()).unwrap_or_default()
}

/// Everyone online with their platforms, for READY.
pub async fn online_platforms(db: &PgPool) -> Vec<(Uuid, Vec<String>)> {
    sqlx::query_as::<_, (Uuid, Vec<String>)>(
        "SELECT p.user_id, array_agg(DISTINCT e.key ORDER BY e.key) FROM presence p, jsonb_each_text(p.platforms) e
         WHERE p.sockets > 0 AND p.updated_at > now() - make_interval(secs => $1) AND e.value::int > 0
           AND p.user_id NOT IN (SELECT id FROM users WHERE status = 'invisible') GROUP BY p.user_id")
        .bind(STALE_SECS as f64).fetch_all(db).await.unwrap_or_default()
}

async fn global_sockets(db: &PgPool, user: Uuid) -> sqlx::Result<i64> {
    let (n,): (i64,) = sqlx::query_as("SELECT COALESCE(SUM(sockets), 0)::bigint FROM presence WHERE user_id = $1 AND updated_at > now() - make_interval(secs => $2)")
        .bind(user).bind(STALE_SECS as f64).fetch_one(db).await?;
    Ok(n)
}

/// Everyone others may see as online: connected and not set to Invisible. What READY, widgets, invite previews and
/// online counts show; `online_users` (the truth) is only for deciding whether to push or mail someone.
pub async fn visible_online_users(db: &PgPool) -> Vec<Uuid> {
    sqlx::query_as::<_, (Uuid,)>("SELECT DISTINCT user_id FROM presence WHERE sockets > 0 AND updated_at > now() - make_interval(secs => $1)
         AND user_id NOT IN (SELECT id FROM users WHERE status = 'invisible')")
        .bind(STALE_SECS as f64)
        .fetch_all(db)
        .await
        .map(|r| r.into_iter().map(|x| x.0).collect())
        .unwrap_or_default()
}

/// Everyone with a live socket on any instance.
pub async fn online_users(db: &PgPool) -> Vec<Uuid> {
    sqlx::query_as::<_, (Uuid,)>("SELECT DISTINCT user_id FROM presence WHERE sockets > 0 AND updated_at > now() - make_interval(secs => $1)")
        .bind(STALE_SECS as f64)
        .fetch_all(db)
        .await
        .map(|r| r.into_iter().map(|x| x.0).collect())
        .unwrap_or_default()
}
