use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::Guild,
    routes::guilds::{fetch_member, GUILD_COLS},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/invites/:code", get(preview).post(accept))
}

async fn preview(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    let row: Option<(Uuid, String, Option<String>, i64, i32, Option<i32>)> = sqlx::query_as(
        "SELECT g.id, g.name, g.icon_url, (SELECT COUNT(*) FROM guild_members WHERE guild_id = g.id), i.uses, i.max_uses
         FROM invites i JOIN guilds g ON g.id = i.guild_id WHERE i.code = $1",
    )
    .bind(&code)
    .fetch_optional(&state.db)
    .await?;
    let (gid, name, icon, count, uses, max) = row.ok_or_else(|| AppError::NotFound("Invite not found or expired".into()))?;
    let already: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2")
        .bind(gid)
        .bind(uid)
        .fetch_optional(&state.db)
        .await?;
    Ok(Json(json!({
        "code": code,
        "guild": { "id": gid, "name": name, "icon_url": icon, "member_count": count },
        "expired": max.map(|m| uses >= m).unwrap_or(false),
        "already_member": already.is_some(),
    })))
}

async fn accept(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    let mut tx = state.db.begin().await?;
    let row: Option<(Uuid, i32, Option<i32>)> =
        sqlx::query_as("SELECT guild_id, uses, max_uses FROM invites WHERE code = $1 FOR UPDATE")
            .bind(&code)
            .fetch_optional(&mut *tx)
            .await?;
    let (gid, uses, max) = row.ok_or_else(|| AppError::NotFound("Invite not found or expired".into()))?;
    if max.map(|m| uses >= m).unwrap_or(false) {
        return Err(AppError::BadRequest("Invite has reached its maximum uses".into()));
    }
    let inserted = sqlx::query("INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(gid)
        .bind(uid)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if inserted > 0 {
        sqlx::query("UPDATE invites SET uses = uses + 1 WHERE code = $1").bind(&code).execute(&mut *tx).await?;
    }
    let guild = sqlx::query_as::<_, Guild>(&format!("SELECT {GUILD_COLS} FROM guilds WHERE id = $1"))
        .bind(gid)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    let channels = crate::perms::visible_channels(&state.db, gid, uid).await?;

    let roles = crate::perms::list_roles(&state.db, gid).await?;
    let payload = json!({ "id": guild.id, "name": guild.name, "icon_url": guild.icon_url, "owner_id": guild.owner_id,
        "created_at": guild.created_at, "channels": channels, "roles": roles });
    if inserted > 0 {
        state.hub.emit_users(vec![uid], "GUILD_CREATE", payload.clone());
        if let Ok(member) = fetch_member(&state.db, gid, uid).await {
            state.hub.emit_guild(gid, "GUILD_MEMBER_ADD", json!(member));
        }
    }
    Ok(Json(payload))
}
