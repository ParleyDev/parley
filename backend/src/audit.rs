//! Admin audit trail: one row per console action, with the actor and target names copied in so the
//! log still reads after either is deleted.

use crate::state::AppState;
use axum::{extract::Request, middleware::Next, response::Response};
use serde_json::Value;
use uuid::Uuid;

tokio::task_local! {
    /// The request's `X-Audit-Log-Reason` (URL-encoded, as in Discord's API), for the server audit entries it makes.
    static REASON: Option<String>;
}

/// API middleware: makes the request's audit reason available to `guild()` while the handler runs.
pub async fn reason_scope(req: Request, next: Next) -> Response {
    let reason = req.headers().get("x-audit-log-reason").and_then(|v| v.to_str().ok()).map(|raw| {
        url::form_urlencoded::parse(format!("r={}", raw.replace('+', "%2B")).as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_default()
    }).map(|r| r.trim().chars().take(512).collect::<String>()).filter(|r| !r.is_empty());
    REASON.scope(reason, next.run(req)).await
}

/// The reason sent with the current request, if any.
pub fn request_reason() -> Option<String> {
    REASON.try_with(|r| r.clone()).ok().flatten()
}

/// Record `action` by `actor` on an optional target. Never fails the calling request: a logging error is traced.
pub async fn record(state: &AppState, actor: Uuid, action: &str, target_kind: &str, target_id: Option<Uuid>, target_name: &str, details: Value) {
    let actor_name: String = sqlx::query_as::<_, (String,)>("SELECT username FROM users WHERE id = $1")
        .bind(actor)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .map(|r| r.0)
        .unwrap_or_default();
    if let Err(e) = sqlx::query(
        "INSERT INTO admin_audit (id, actor_id, actor_name, action, target_kind, target_id, target_name, details) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(Uuid::now_v7())
    .bind(actor)
    .bind(actor_name)
    .bind(action)
    .bind(target_kind)
    .bind(target_id)
    .bind(target_name)
    .bind(details)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, action, "failed to write admin audit row");
    }
}

/// Server audit log entry (Server Settings -> Audit Log). Same never-fails contract as `record`.
pub async fn guild(state: &AppState, guild_id: Uuid, actor: Uuid, action: &str, target_kind: &str, target_id: Option<Uuid>, target_name: &str, mut details: Value) {
    // A reason in the request header fills in for actions that don't take one in their body.
    if let (Some(reason), Some(obj)) = (request_reason(), details.as_object_mut()) {
        let empty = obj.get("reason").and_then(|v| v.as_str()).map(|s| s.is_empty()).unwrap_or(true);
        if empty { obj.insert("reason".into(), Value::String(reason)); }
    }
    let actor_name = username(state, actor).await;
    if let Err(e) = sqlx::query(
        "INSERT INTO guild_audit (id, guild_id, actor_id, actor_name, action, target_kind, target_id, target_name, details) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(Uuid::now_v7())
    .bind(guild_id)
    .bind(actor)
    .bind(actor_name)
    .bind(action)
    .bind(target_kind)
    .bind(target_id)
    .bind(target_name)
    .bind(details)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, action, "failed to write guild audit row");
    }
}

pub async fn username(state: &AppState, id: Uuid) -> String {
    sqlx::query_as::<_, (String,)>("SELECT username FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await.ok().flatten().map(|r| r.0).unwrap_or_default()
}

pub async fn guild_name(state: &AppState, id: Uuid) -> String {
    sqlx::query_as::<_, (String,)>("SELECT name FROM guilds WHERE id = $1").bind(id).fetch_optional(&state.db).await.ok().flatten().map(|r| r.0).unwrap_or_default()
}
