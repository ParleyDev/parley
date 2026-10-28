//! Audit trails. Console actions go to the append-only `admin_access_log` with IDs only (names are resolved when it
//! is read, so deleting an account never rewrites it). Server audit entries (`guild_audit`) keep their own table.

use crate::state::AppState;
use axum::{extract::Request, middleware::Next, response::Response};
use serde_json::Value;
use uuid::Uuid;

tokio::task_local! {
    /// The request's `X-Audit-Log-Reason` (URL-encoded, as in Discord's API), for the server audit entries it makes.
    static REASON: Option<String>;
    /// The request's client IP and user agent, for console audit entries.
    static CLIENT: (String, String);
}

/// API middleware: makes the request's audit reason, IP and user agent available to the audit writers.
pub async fn reason_scope(req: Request, next: Next) -> Response {
    let client = (crate::ratelimit::client_ip(req.headers()), req.headers().get(axum::http::header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or_default().chars().take(400).collect::<String>());
    let reason = req.headers().get("x-audit-log-reason").and_then(|v| v.to_str().ok()).map(|raw| {
        url::form_urlencoded::parse(format!("r={}", raw.replace('+', "%2B")).as_bytes()).next().map(|(_, v)| v.into_owned()).unwrap_or_default()
    }).map(|r| r.trim().chars().take(512).collect::<String>()).filter(|r| !r.is_empty());
    CLIENT.scope(client, REASON.scope(reason, next.run(req))).await
}

/// The reason sent with the current request, if any.
pub fn request_reason() -> Option<String> {
    REASON.try_with(|r| r.clone()).ok().flatten()
}

/// Record a console `action` by `actor` on an optional target, in the append-only access log with the actor's roles,
/// IP and user agent. `_target_name` is not stored: names are resolved when the log is read. Never fails the calling
/// request: a logging error is traced.
pub async fn record(state: &AppState, actor: Uuid, action: &str, target_kind: &str, target_id: Option<Uuid>, _target_name: &str, details: Value) {
    let roles = crate::routes::admin_access::access(state, actor).await.map(|a| a.roles).unwrap_or_default();
    let (ip, ua) = CLIENT.try_with(|c| c.clone()).unwrap_or_default();
    let justification = details.get("note").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    if let Err(e) = sqlx::query(
        "INSERT INTO admin_access_log (id, actor_id, actor_roles, action, filters, justification, target_kind, target_ids, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(Uuid::now_v7()).bind(actor).bind(&roles).bind(action).bind(details).bind(justification).bind(target_kind)
    .bind(target_id.map(|t| vec![t]).unwrap_or_default()).bind(ip).bind(ua)
    .execute(&state.db)
    .await
    {
        tracing::error!(error = %e, action, "failed to write admin audit row");
    }
}

/// Daily: drop console audit entries older than `AUDIT_RETENTION_DAYS` through the database's prune function (which
/// never removes anything younger than a year).
pub async fn prune_loop(state: AppState) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(24 * 3600));
    loop {
        tick.tick().await;
        match sqlx::query_as::<_, (i64,)>("SELECT admin_access_log_prune($1)").bind(state.config.audit_retention_days as i32).fetch_one(&state.db).await {
            Ok((n,)) if n > 0 => tracing::info!(removed = n, "pruned old admin audit entries"),
            Ok(_) => {}
            Err(e) => tracing::error!(error = %e, "admin audit prune failed"),
        }
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
