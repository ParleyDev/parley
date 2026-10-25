use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::Guild,
    routes::guilds::{fetch_member, is_banned, GUILD_COLS},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use uuid::Uuid;

/// Finds the invite a code names: an exact (case-sensitive) random code, or a vanity code in any case, which only
/// resolves while its server is approved for Discovery. A random code wins if both match.
const MATCH: &str = "((NOT i.vanity AND i.code = $1) OR (i.vanity AND i.code = lower($1)
    AND EXISTS (SELECT 1 FROM guild_discovery d WHERE d.guild_id = i.guild_id AND d.status = 'approved')))";
/// Whether the invite can still be used (not expired, not used up).
const LIVE: &str = "((i.expires_at IS NULL OR i.expires_at > now()) AND (i.max_uses IS NULL OR i.uses < i.max_uses))";

/// guild id, name, icon, member count, live, rules, rules required, invite code.
type PreviewRow = (Uuid, String, Option<String>, i64, bool, String, bool, String);
/// guild id, uses, max uses, expiry, invite code.
type AcceptRow = (Uuid, i32, Option<i32>, Option<chrono::DateTime<chrono::Utc>>, String);

pub fn router() -> Router<AppState> {
    Router::new().route("/invites/:code", get(preview).post(accept))
}

async fn preview(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    let row: Option<PreviewRow> = sqlx::query_as(&format!(
        "SELECT g.id, g.name, g.icon_url, (SELECT COUNT(*) FROM guild_members WHERE guild_id = g.id), {LIVE}, g.rules, g.rules_required, i.code
         FROM invites i JOIN guilds g ON g.id = i.guild_id WHERE {MATCH} ORDER BY i.vanity LIMIT 1"
    ))
    .bind(&code)
    .fetch_optional(&state.db)
    .await?;
    let (gid, name, icon, count, live, rules, rules_required, code) = row.ok_or_else(|| AppError::NotFound("Invite not found or expired".into()))?;
    let already: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2")
        .bind(gid)
        .bind(uid)
        .fetch_optional(&state.db)
        .await?;
    let online = crate::ws::bus::online_users(&state.db).await;
    let (online_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM guild_members WHERE guild_id = $1 AND user_id = ANY($2)").bind(gid).bind(&online).fetch_one(&state.db).await?;
    Ok(Json(json!({
        "code": code,
        "guild": { "id": gid, "name": name, "icon_url": icon, "member_count": count, "online_count": online_count, "rules": rules, "rules_required": rules_required },
        "expired": !live,
        "already_member": already.is_some(),
        "banned": is_banned(&state.db, gid, uid).await?,
    })))
}

async fn accept(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    let mut tx = state.db.begin().await?;
    let row: Option<AcceptRow> = sqlx::query_as(&format!(
        "SELECT i.guild_id, i.uses, i.max_uses, i.expires_at, i.code FROM invites i WHERE {MATCH} ORDER BY i.vanity LIMIT 1 FOR UPDATE"
    ))
    .bind(&code)
    .fetch_optional(&mut *tx)
    .await?;
    let (gid, uses, max, expires, code) = row.ok_or_else(|| AppError::NotFound("Invite not found or expired".into()))?;
    if expires.is_some_and(|t| t <= chrono::Utc::now()) {
        return Err(AppError::BadRequest("This invite has expired".into()));
    }
    if max.map(|m| uses >= m).unwrap_or(false) {
        return Err(AppError::BadRequest("Invite has reached its maximum uses".into()));
    }
    if is_banned(&state.db, gid, uid).await? {
        return Err(AppError::BadRequest("You are banned from this server".into()));
    }
    let inserted = sqlx::query("INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(gid)
        .bind(uid)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if inserted > 0 {
        sqlx::query("UPDATE invites SET uses = uses + 1 WHERE code = $1").bind(&code).execute(&mut *tx).await?;
        crate::routes::users::apply_join_defaults(&state.db, uid, gid).await;
    }
    let guild = sqlx::query_as::<_, Guild>(&format!("SELECT {GUILD_COLS} FROM guilds WHERE id = $1"))
        .bind(gid)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    let channels = crate::perms::visible_channels(&state.db, gid, uid).await?;

    let roles = crate::perms::list_roles(&state.db, gid).await?;
    let emojis = crate::routes::expressions::emojis_for_guilds(&state.db, &[gid]).await?;
    let stickers = crate::routes::expressions::stickers_for_guilds(&state.db, &[gid]).await?;
    let payload = json!({ "id": guild.id, "name": guild.name, "icon_url": guild.icon_url, "banner_url": guild.banner_url, "owner_id": guild.owner_id, "rules": guild.rules, "rules_required": guild.rules_required,
        "created_at": guild.created_at, "channels": channels, "roles": roles, "emojis": emojis, "stickers": stickers });
    if inserted > 0 {
        state.hub.emit_users(vec![uid], "GUILD_CREATE", payload.clone());
        if let Ok(member) = fetch_member(&state.db, gid, uid).await {
            state.hub.emit_guild(gid, "GUILD_MEMBER_ADD", json!(member));
        }
        if let Err(e) = crate::routes::channels::guild_system_message(&state, gid, uid, "member_join", "joined the server.").await {
            tracing::warn!(error = ?e, "join notice failed");
        }
    }
    Ok(Json(payload))
}
