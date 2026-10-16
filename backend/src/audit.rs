//! Admin audit trail: one row per console action, with the actor and target names copied in so the
//! log still reads after either is deleted.

use crate::state::AppState;
use serde_json::Value;
use uuid::Uuid;

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

pub async fn username(state: &AppState, id: Uuid) -> String {
    sqlx::query_as::<_, (String,)>("SELECT username FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await.ok().flatten().map(|r| r.0).unwrap_or_default()
}

pub async fn guild_name(state: &AppState, id: Uuid) -> String {
    sqlx::query_as::<_, (String,)>("SELECT name FROM guilds WHERE id = $1").bind(id).fetch_optional(&state.db).await.ok().flatten().map(|r| r.0).unwrap_or_default()
}
