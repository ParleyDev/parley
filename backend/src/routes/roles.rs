use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Member, Role},
    perms::{self, GuildCtx, ROLE_COLS},
    routes::guilds::fetch_member,
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/roles", get(list_roles).post(create_role))
        .route("/guilds/:id/roles/:rid", patch(update_role).delete(delete_role))
        .route("/guilds/:id/members/:uid", patch(update_member))
        .route("/permissions", get(catalogue))
}

async fn catalogue() -> Json<serde_json::Value> {
    Json(json!(perms::catalogue().into_iter().map(|(n, b)| json!({ "name": n, "bit": b })).collect::<Vec<_>>()))
}

async fn list_roles(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Role>>> {
    perms::guild_perms(&state.db, id, uid).await?;
    Ok(Json(perms::list_roles(&state.db, id).await?))
}

fn validate_color(c: &Option<String>) -> AppResult<()> {
    if let Some(c) = c {
        let ok = c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
        if !ok {
            return Err(AppError::BadRequest("Color must be #rrggbb".into()));
        }
    }
    Ok(())
}

fn validate_name(n: &str) -> AppResult<String> {
    let n = n.trim().to_string();
    if n.is_empty() || n.chars().count() > 100 {
        return Err(AppError::BadRequest("Role name must be 1-100 characters".into()));
    }
    Ok(n)
}

/// A manager may only grant or revoke bits they themselves hold (admins/owner hold all).
fn check_bits_delta(actor_perms: u64, old: u64, new: u64) -> AppResult<()> {
    if (old ^ new) & !actor_perms != 0 {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

#[derive(Deserialize)]
struct CreateRole {
    name: String,
    color: Option<String>,
    color_accent: Option<String>,
    /// {font, effect, colors}; when given, color / color_accent are derived from it.
    name_style: Option<serde_json::Value>,
    permissions: Option<i64>,
    hoist: Option<bool>,
}

async fn create_role(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateRole>,
) -> AppResult<(StatusCode, Json<Role>)> {
    let (_ctx, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_ROLES)?;
    let name = validate_name(&req.name)?;
    validate_color(&req.color)?;
    validate_color(&req.color_accent)?;
    let (name_style, color, color_accent) = match &req.name_style {
        Some(v) => { let (st, p, a) = crate::routes::users::validate_name_style(v)?; (st, p, a) }
        None => (serde_json::json!({}), req.color.clone(), req.color_accent.clone()),
    };
    let permissions = (req.permissions.unwrap_or(0) as u64) & perms::ALL;
    check_bits_delta(p, 0, permissions)?;

    let mut tx = state.db.begin().await?;
    // New roles start at the bottom (just above @everyone); shift the rest up.
    sqlx::query("UPDATE roles SET position = position + 1 WHERE guild_id = $1 AND position >= 1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let role = sqlx::query_as::<_, Role>(&format!(
        "INSERT INTO roles (id, guild_id, name, color, color_accent, position, permissions, hoist, name_style) VALUES ($1, $2, $3, $4, $7, 1, $5, $6, $8) RETURNING {ROLE_COLS}"
    ))
    .bind(Uuid::now_v7())
    .bind(id)
    .bind(&name)
    .bind(&color)
    .bind(permissions as i64)
    .bind(req.hoist.unwrap_or(false))
    .bind(&color_accent)
    .bind(&name_style)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    // Positions of other roles shifted; send the whole list so clients stay consistent.
    emit_roles(&state, id).await?;
    crate::audit::guild(&state, id, uid, "role.create", "role", Some(role.id), &role.name, json!({ "permissions": role.permissions })).await;
    Ok((StatusCode::CREATED, Json(role)))
}

#[derive(Deserialize)]
struct UpdateRole {
    name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    color: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    color_accent: Option<Option<String>>,
    /// {font, effect, colors}; when given, color / color_accent follow it.
    name_style: Option<serde_json::Value>,
    permissions: Option<i64>,
    hoist: Option<bool>,
    position: Option<i32>,
}

/// Distinguish "field absent" (None) from "field: null" (Some(None)).
fn deserialize_nullable<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Ok(Some(Option::<String>::deserialize(d)?))
}

pub fn deserialize_nullable_uuid<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<Uuid>>, D::Error> {
    Ok(Some(Option::<Uuid>::deserialize(d)?))
}

async fn update_role(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, rid)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateRole>,
) -> AppResult<Json<Role>> {
    let (ctx, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_ROLES)?;
    let role = ctx.roles.get(&rid).filter(|r| r.guild_id == id).cloned().ok_or_else(|| AppError::NotFound("Role not found".into()))?;
    if !ctx.outranks_role(uid, &role) {
        return Err(AppError::Forbidden);
    }
    let is_everyone = rid == id;
    let name = match &req.name {
        Some(n) if !is_everyone => Some(validate_name(n)?),
        Some(_) => return Err(AppError::BadRequest("@everyone cannot be renamed".into())),
        None => None,
    };
    if let Some(c) = &req.color {
        validate_color(c)?;
    }
    if let Some(c) = &req.color_accent {
        validate_color(c)?;
    }
    let (set_style, name_style, color_req, accent_req) = match &req.name_style {
        Some(v) => { let (st, p, a) = crate::routes::users::validate_name_style(v)?; (true, st, Some(p), Some(a)) }
        None => (false, serde_json::json!({}), req.color.clone(), req.color_accent.clone()),
    };
    let permissions = match req.permissions {
        Some(np) => {
            let np = (np as u64) & perms::ALL;
            check_bits_delta(p, role.permissions as u64, np)?;
            Some(np as i64)
        }
        None => None,
    };

    let before = perms::visibility(&state.db, id).await?;
    let mut tx = state.db.begin().await?;
    if let Some(pos) = req.position {
        if is_everyone {
            return Err(AppError::BadRequest("@everyone is always lowest".into()));
        }
        reorder(&mut tx, &ctx, uid, rid, pos).await?;
    }
    let role = sqlx::query_as::<_, Role>(&format!(
        "UPDATE roles SET name = COALESCE($2, name), color = CASE WHEN $3 THEN $4 ELSE color END,
            permissions = COALESCE($5, permissions), hoist = COALESCE($6, hoist),
            color_accent = CASE WHEN $7 THEN $8 ELSE color_accent END,
            name_style = CASE WHEN $9 THEN $10 ELSE name_style END
         WHERE id = $1 RETURNING {ROLE_COLS}"
    ))
    .bind(rid)
    .bind(name)
    .bind(color_req.is_some())
    .bind(color_req.clone().flatten())
    .bind(permissions)
    .bind(req.hoist)
    .bind(accent_req.is_some())
    .bind(accent_req.clone().flatten())
    .bind(set_style)
    .bind(name_style)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    if req.position.is_some() {
        emit_roles(&state, id).await?;
    } else {
        state.hub.emit_guild(id, "ROLE_UPDATE", json!({ "guild_id": id, "role": role }));
    }
    if permissions.is_some() {
        perms::resync_visibility(&state, id, &before).await?;
    }
    let mut changed = serde_json::Map::new();
    if req.name.is_some() { changed.insert("name".into(), json!(role.name)); }
    if let Some(p) = permissions { changed.insert("permissions".into(), json!(p)); }
    if req.color.is_some() { changed.insert("color".into(), json!(role.color)); }
    if req.hoist.is_some() { changed.insert("hoist".into(), json!(role.hoist)); }
    if req.position.is_some() { changed.insert("position".into(), json!(role.position)); }
    crate::audit::guild(&state, id, uid, "role.update", "role", Some(rid), &role.name, serde_json::Value::Object(changed)).await;
    Ok(Json(role))
}

/// Move a role to `pos` within the stack. Non-owners can only place roles below their own highest.
async fn reorder(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, ctx: &GuildCtx, actor: Uuid, rid: Uuid, pos: i32) -> AppResult<()> {
    let mut stack: Vec<Uuid> = {
        let mut rs: Vec<&Role> = ctx.roles.values().filter(|r| r.id != ctx.guild.id).collect();
        rs.sort_by_key(|r| (r.position, r.created_at));
        rs.into_iter().map(|r| r.id).collect()
    };
    let max = stack.len() as i32;
    let pos = pos.clamp(1, max);
    if !ctx.is_owner(actor) && pos >= ctx.highest(actor) {
        return Err(AppError::Forbidden);
    }
    stack.retain(|r| *r != rid);
    stack.insert((pos - 1) as usize, rid);
    for (i, r) in stack.iter().enumerate() {
        sqlx::query("UPDATE roles SET position = $2 WHERE id = $1").bind(r).bind(i as i32 + 1).execute(&mut **tx).await?;
    }
    Ok(())
}

async fn emit_roles(state: &AppState, guild_id: Uuid) -> AppResult<()> {
    let roles = perms::list_roles(&state.db, guild_id).await?;
    state.hub.emit_guild(guild_id, "ROLES_SYNC", json!({ "guild_id": guild_id, "roles": roles }));
    Ok(())
}

async fn delete_role(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, rid)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let (ctx, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_ROLES)?;
    if rid == id {
        return Err(AppError::BadRequest("@everyone cannot be deleted".into()));
    }
    let role = ctx.roles.get(&rid).filter(|r| r.guild_id == id).ok_or_else(|| AppError::NotFound("Role not found".into()))?;
    if !ctx.outranks_role(uid, role) {
        return Err(AppError::Forbidden);
    }
    let before = perms::visibility(&state.db, id).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM channel_overwrites WHERE target_id = $1").bind(rid).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM roles WHERE id = $1").bind(rid).execute(&mut *tx).await?;
    sqlx::query("UPDATE roles SET position = position - 1 WHERE guild_id = $1 AND position > $2")
        .bind(id)
        .bind(role.position)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    state.hub.emit_guild(id, "ROLE_DELETE", json!({ "guild_id": id, "id": rid }));
    emit_roles(&state, id).await?;
    perms::resync_visibility(&state, id, &before).await?;
    crate::audit::guild(&state, id, uid, "role.delete", "role", Some(rid), &role.name, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct UpdateMember {
    #[serde(default, deserialize_with = "deserialize_nullable")]
    nickname: Option<Option<String>>,
    roles: Option<Vec<Uuid>>,
}

async fn update_member(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateMember>,
) -> AppResult<Json<Member>> {
    let (ctx, p) = perms::guild_perms(&state.db, id, uid).await?;
    if !ctx.is_member(target) {
        return Err(AppError::NotFound("Member not found".into()));
    }
    let before = perms::visibility(&state.db, id).await?;
    let mut tx = state.db.begin().await?;

    if let Some(nick) = &req.nickname {
        let needed = if target == uid { perms::CHANGE_NICKNAME } else { perms::MANAGE_NICKNAMES };
        perms::check(p, needed)?;
        if target != uid && !ctx.outranks_member(uid, target) {
            return Err(AppError::Forbidden);
        }
        let nick = nick.as_ref().map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
        if nick.as_ref().map(|n| n.chars().count() > 32).unwrap_or(false) {
            return Err(AppError::BadRequest("Nickname must be at most 32 characters".into()));
        }
        sqlx::query("UPDATE guild_members SET nickname = $3 WHERE guild_id = $1 AND user_id = $2")
            .bind(id)
            .bind(target)
            .bind(nick)
            .execute(&mut *tx)
            .await?;
    }

    if let Some(wanted) = &req.roles {
        perms::check(p, perms::MANAGE_ROLES)?;
        if target != uid && !ctx.outranks_member(uid, target) {
            return Err(AppError::Forbidden);
        }
        let current: Vec<Uuid> = ctx.member_roles.get(&target).cloned().unwrap_or_default();
        let wanted: Vec<Uuid> = wanted.iter().copied().filter(|r| *r != id).collect();
        for r in wanted.iter() {
            if !ctx.roles.contains_key(r) {
                return Err(AppError::BadRequest("Unknown role".into()));
            }
        }
        let changed: Vec<Uuid> = current.iter().filter(|r| !wanted.contains(r)).chain(wanted.iter().filter(|r| !current.contains(r))).copied().collect();
        for r in &changed {
            let role = &ctx.roles[r];
            if !ctx.outranks_role(uid, role) || role.id == id {
                return Err(AppError::Forbidden);
            }
        }
        sqlx::query("DELETE FROM member_roles WHERE guild_id = $1 AND user_id = $2").bind(id).bind(target).execute(&mut *tx).await?;
        for r in &wanted {
            sqlx::query("INSERT INTO member_roles (guild_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
                .bind(id)
                .bind(target)
                .bind(r)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;

    let member = fetch_member(&state.db, id, target).await?;
    state.hub.emit_guild(id, "GUILD_MEMBER_UPDATE", json!(member));
    if req.roles.is_some() {
        perms::resync_visibility(&state, id, &before).await?;
    }
    if target != uid || req.roles.is_some() {
        let mut d = serde_json::Map::new();
        if req.nickname.is_some() { d.insert("nickname".into(), json!(member.nickname)); }
        if req.roles.is_some() { d.insert("roles".into(), json!(member.roles.iter().filter_map(|r| ctx.roles.get(r)).map(|r| r.name.clone()).collect::<Vec<_>>())); }
        crate::audit::guild(&state, id, uid, "member.update", "user", Some(target), &member.username, serde_json::Value::Object(d)).await;
    }
    Ok(Json(member))
}

/// Insert the @everyone role for a brand-new guild.
pub async fn create_everyone(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, guild_id: Uuid) -> AppResult<()> {
    sqlx::query("INSERT INTO roles (id, guild_id, name, position, permissions) VALUES ($1, $1, '@everyone', 0, $2)")
        .bind(guild_id)
        .bind(perms::DEFAULT_EVERYONE as i64)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Attach role ids to a batch of members.
pub async fn attach_roles(db: &PgPool, members: &mut [Member]) -> AppResult<()> {
    if members.is_empty() {
        return Ok(());
    }
    let gid = members[0].guild_id;
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as("SELECT user_id, role_id FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.guild_id = $1 ORDER BY r.position DESC")
        .bind(gid)
        .fetch_all(db)
        .await?;
    let mut map: std::collections::HashMap<Uuid, Vec<Uuid>> = std::collections::HashMap::new();
    for (u, r) in rows {
        map.entry(u).or_default().push(r);
    }
    for m in members.iter_mut() {
        m.roles = map.remove(&m.user_id).unwrap_or_default();
    }
    Ok(())
}
