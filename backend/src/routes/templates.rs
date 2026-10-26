//! Server templates: snapshot a server's roles, channels, permission overwrites and a few settings, share the link,
//! and create new servers from it. Messages, members, emoji and member overwrites are never copied.

use crate::{auth::AuthUser, error::{AppError, AppResult}, models::{Channel, Guild}, perms, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::{get, put}, Json, Router};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use super::guilds::{CHANNEL_COLS, GUILD_COLS};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/template", get(mine).post(create).put(sync).patch(edit).delete(remove))
        .route("/templates/:code", get(preview).post(use_template))
        .route("/templates/:code/guild", put(use_template))
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct TRole { name: String, color: Option<String>, color_accent: Option<String>, permissions: i64, hoist: bool, mentionable: bool, self_assignable: bool, icon: Option<String> }
/// `target`: the role's index in `roles`, or -1 for @everyone.
#[derive(Serialize, Deserialize, Clone)]
struct TOverwrite { target: i32, allow: i64, deny: i64 }
#[derive(Serialize, Deserialize, Clone)]
struct TChannel { name: String, kind: String, topic: String, parent: Option<usize>, nsfw: bool, rate_limit_per_user: i32, user_limit: i32, audio_mode: String, forum_layout: String, forum_sort: String, forum_require_tag: bool, #[serde(default)] news: bool, #[serde(default)] media: bool, overwrites: Vec<TOverwrite> }
#[derive(Serialize, Deserialize, Clone, Default)]
struct Snapshot {
    everyone_permissions: i64,
    /// Lowest first (index 0 sits just above @everyone).
    roles: Vec<TRole>,
    /// Categories first, each list in position order.
    channels: Vec<TChannel>,
    default_notifications: String,
    verification_level: i16,
    afk_timeout: i32,
    afk_channel: Option<usize>,
    system_channel: Option<usize>,
}

const TEMPLATE_COLS: &str = "code, guild_id, name, description, creator_id, snapshot, usage_count, created_at, updated_at";

#[derive(Serialize, sqlx::FromRow)]
struct Template { code: String, guild_id: Uuid, name: String, description: String, creator_id: Option<Uuid>, snapshot: Value, usage_count: i32, created_at: chrono::DateTime<chrono::Utc>, updated_at: chrono::DateTime<chrono::Utc> }

async fn snapshot(state: &AppState, gid: Uuid) -> AppResult<Snapshot> {
    let g = sqlx::query_as::<_, Guild>(&format!("SELECT {GUILD_COLS} FROM guilds WHERE id = $1")).bind(gid).fetch_one(&state.db).await?;
    let mut roles = perms::list_roles(&state.db, gid).await?;
    roles.sort_by_key(|r| r.position);
    let everyone = roles.iter().find(|r| r.id == gid).map(|r| r.permissions).unwrap_or(0);
    let roles: Vec<_> = roles.into_iter().filter(|r| r.id != gid).collect();
    let role_idx: HashMap<Uuid, i32> = roles.iter().enumerate().map(|(i, r)| (r.id, i as i32)).collect();
    let mut chans = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE guild_id = $1 AND kind <> 'thread' ORDER BY (kind <> 'category'), position, created_at")).bind(gid).fetch_all(&state.db).await?;
    perms::attach_overwrites(&state.db, &mut chans).await?;
    let chan_idx: HashMap<Uuid, usize> = chans.iter().enumerate().map(|(i, c)| (c.id, i)).collect();
    let channels = chans.iter().map(|c| TChannel {
        name: c.name.clone(), kind: c.kind.clone(), topic: c.topic.clone(), parent: c.parent_id.and_then(|p| chan_idx.get(&p).copied()), nsfw: c.nsfw,
        rate_limit_per_user: c.rate_limit_per_user, user_limit: c.user_limit, audio_mode: c.audio_mode.clone(), forum_layout: c.forum_layout.clone(), forum_sort: c.forum_sort.clone(), forum_require_tag: c.forum_require_tag, news: c.news, media: c.media,
        overwrites: c.overwrites.iter().filter(|o| o.target_kind == "role").filter_map(|o| if o.target_id == gid { Some(-1) } else { role_idx.get(&o.target_id).copied() }.map(|t| TOverwrite { target: t, allow: o.allow, deny: o.deny })).collect(),
    }).collect();
    Ok(Snapshot {
        everyone_permissions: everyone,
        roles: roles.iter().map(|r| TRole { name: r.name.clone(), color: r.color.clone(), color_accent: r.color_accent.clone(), permissions: r.permissions, hoist: r.hoist, mentionable: r.mentionable, self_assignable: r.self_assignable,
            // Uploaded role icons belong to the source server; keep only emoji.
            icon: r.icon.clone().filter(|i| !i.starts_with('/') && !i.starts_with("http")) }).collect(),
        channels,
        default_notifications: g.default_notifications.clone(), verification_level: g.verification_level, afk_timeout: g.afk_timeout,
        afk_channel: g.afk_channel_id.and_then(|c| chan_idx.get(&c).copied()), system_channel: g.system_channel_id.and_then(|c| chan_idx.get(&c).copied()),
    })
}

async fn manage(state: &AppState, gid: Uuid, uid: Uuid) -> AppResult<()> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)
}

async fn fetch(state: &AppState, gid: Uuid) -> AppResult<Option<Template>> {
    Ok(sqlx::query_as::<_, Template>(&format!("SELECT {TEMPLATE_COLS} FROM guild_templates WHERE guild_id = $1")).bind(gid).fetch_optional(&state.db).await?)
}

/// `GET /guilds/:id/template` (Manage Server): this server's template, or null.
async fn mine(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Option<Template>>> {
    manage(&state, gid, uid).await?;
    Ok(Json(fetch(&state, gid).await?))
}

#[derive(Deserialize)]
struct TemplateIn { name: Option<String>, description: Option<String> }

fn clean_name(s: &str) -> AppResult<String> {
    let n: String = s.trim().chars().take(100).collect();
    if n.is_empty() { return Err(AppError::BadRequest("Give the template a name".into())) }
    Ok(n)
}

/// `POST /guilds/:id/template`: snapshot the server now.
async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<TemplateIn>) -> AppResult<(StatusCode, Json<Template>)> {
    manage(&state, gid, uid).await?;
    if fetch(&state, gid).await?.is_some() { return Err(AppError::Conflict("This server already has a template".into())) }
    let name = clean_name(req.name.as_deref().unwrap_or(""))?;
    let desc: String = req.description.unwrap_or_default().trim().chars().take(120).collect();
    let snap = snapshot(&state, gid).await?;
    let code: String = rand::thread_rng().sample_iter(&Alphanumeric).take(12).map(char::from).collect();
    let t = sqlx::query_as::<_, Template>(&format!("INSERT INTO guild_templates (code, guild_id, name, description, creator_id, snapshot) VALUES ($1, $2, $3, $4, $5, $6) RETURNING {TEMPLATE_COLS}"))
        .bind(&code).bind(gid).bind(&name).bind(&desc).bind(uid).bind(json!(snap)).fetch_one(&state.db).await?;
    let gname = crate::audit::guild_name(&state, gid).await;
    crate::audit::guild(&state, gid, uid, "guild.template_create", "guild", Some(gid), &gname, json!({ "name": name })).await;
    Ok((StatusCode::CREATED, Json(t)))
}

/// `PUT /guilds/:id/template`: re-snapshot (sync) the template with the server as it is now.
async fn sync(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Template>> {
    manage(&state, gid, uid).await?;
    let snap = snapshot(&state, gid).await?;
    let t = sqlx::query_as::<_, Template>(&format!("UPDATE guild_templates SET snapshot = $2, updated_at = now() WHERE guild_id = $1 RETURNING {TEMPLATE_COLS}"))
        .bind(gid).bind(json!(snap)).fetch_optional(&state.db).await?.ok_or(AppError::NotFound("No template".into()))?;
    Ok(Json(t))
}

async fn edit(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<TemplateIn>) -> AppResult<Json<Template>> {
    manage(&state, gid, uid).await?;
    let name = match req.name.as_deref() { Some(n) => Some(clean_name(n)?), None => None };
    let desc = req.description.map(|d| d.trim().chars().take(120).collect::<String>());
    let t = sqlx::query_as::<_, Template>(&format!("UPDATE guild_templates SET name = COALESCE($2, name), description = COALESCE($3, description) WHERE guild_id = $1 RETURNING {TEMPLATE_COLS}"))
        .bind(gid).bind(name).bind(desc).fetch_optional(&state.db).await?.ok_or(AppError::NotFound("No template".into()))?;
    Ok(Json(t))
}

async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<StatusCode> {
    manage(&state, gid, uid).await?;
    sqlx::query("DELETE FROM guild_templates WHERE guild_id = $1").bind(gid).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /templates/:code`: what the template would create (any signed-in user with the link).
async fn preview(State(state): State<AppState>, AuthUser(_): AuthUser, Path(code): Path<String>) -> AppResult<Json<Value>> {
    let row: Option<(String, String, Value, i32, Uuid, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT t.name, t.description, t.snapshot, t.usage_count, g.id, g.name, g.icon_url, u.display_name FROM guild_templates t JOIN guilds g ON g.id = t.guild_id LEFT JOIN users u ON u.id = t.creator_id WHERE t.code = $1")
        .bind(&code).fetch_optional(&state.db).await?;
    let Some((name, description, snapshot, usage_count, gid, gname, gicon, creator)) = row else { return Err(AppError::NotFound("Template not found".into())) };
    Ok(Json(json!({ "code": code, "name": name, "description": description, "usage_count": usage_count, "creator": creator, "source_guild": { "id": gid, "name": gname, "icon_url": gicon }, "snapshot": snapshot })))
}

#[derive(Deserialize)]
struct UseIn { name: String, #[serde(default)] icon_url: Option<String> }

/// `POST /templates/:code`: create a new server you own from the template.
async fn use_template(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(code): Path<String>, Json(req): Json<UseIn>) -> AppResult<(StatusCode, Json<Value>)> {
    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 100 { return Err(AppError::BadRequest("Server name must be 1-100 characters".into())) }
    crate::routes::users::validate_image(&req.icon_url)?;
    crate::routes::users::require_verified(&state, uid).await?;
    let (snap,): (Value,) = sqlx::query_as("SELECT snapshot FROM guild_templates WHERE code = $1").bind(&code).fetch_optional(&state.db).await?.ok_or(AppError::NotFound("Template not found".into()))?;
    let snap: Snapshot = serde_json::from_value(snap).map_err(|_| AppError::BadRequest("This template is damaged".into()))?;
    let mut tx = state.db.begin().await?;
    let gid = Uuid::now_v7();
    sqlx::query("INSERT INTO guilds (id, name, icon_url, owner_id, default_notifications, verification_level, afk_timeout) VALUES ($1, $2, $3, $4, $5, $6, $7)")
        .bind(gid).bind(&name).bind(req.icon_url.filter(|s| !s.is_empty())).bind(uid)
        .bind(if snap.default_notifications == "mentions" { "mentions" } else { "all" }).bind(snap.verification_level.clamp(0, 4)).bind(snap.afk_timeout.clamp(60, 3600))
        .execute(&mut *tx).await?;
    sqlx::query("INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2)").bind(gid).bind(uid).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO roles (id, guild_id, name, position, permissions) VALUES ($1, $1, '@everyone', 0, $2)").bind(gid).bind(snap.everyone_permissions & perms::ALL as i64).execute(&mut *tx).await?;
    let mut role_ids = Vec::new();
    for (i, r) in snap.roles.iter().take(250).enumerate() {
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO roles (id, guild_id, name, color, color_accent, position, permissions, hoist, mentionable, self_assignable, icon) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)")
            .bind(id).bind(gid).bind(r.name.chars().take(100).collect::<String>()).bind(&r.color).bind(&r.color_accent).bind(i as i32 + 1).bind(r.permissions & perms::ALL as i64)
            .bind(r.hoist).bind(r.mentionable).bind(r.self_assignable && (r.permissions as u64) & perms::SELF_GRANT_FORBIDDEN == 0).bind(&r.icon)
            .execute(&mut *tx).await?;
        role_ids.push(id);
    }
    const KINDS: [&str; 6] = ["text", "voice", "stage", "studio", "category", "forum"];
    let mut chan_ids: Vec<Option<Uuid>> = Vec::new();
    let mut pos: HashMap<Option<Uuid>, i32> = HashMap::new();
    for c in snap.channels.iter().take(500) {
        if !KINDS.contains(&c.kind.as_str()) { chan_ids.push(None); continue }
        let id = Uuid::now_v7();
        let parent = if c.kind == "category" { None } else { c.parent.and_then(|p| chan_ids.get(p).copied().flatten()) };
        let p = pos.entry(if c.kind == "category" { Some(Uuid::nil()) } else { parent }).or_insert(0);
        sqlx::query("INSERT INTO channels (id, guild_id, name, kind, topic, position, parent_id, nsfw, rate_limit_per_user, user_limit, audio_mode, forum_layout, forum_sort, forum_require_tag, news, media) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)")
            .bind(id).bind(gid).bind(c.name.chars().take(100).collect::<String>()).bind(&c.kind).bind(c.topic.chars().take(1024).collect::<String>()).bind(*p).bind(parent)
            .bind(c.nsfw).bind(c.rate_limit_per_user.clamp(0, 21600)).bind(c.user_limit.clamp(0, 99))
            .bind(if c.audio_mode == "music" { "music" } else { "voice" }).bind(if c.forum_layout == "list" { "list" } else { "gallery" }).bind(if c.forum_sort == "created" { "created" } else { "activity" }).bind(c.forum_require_tag).bind(c.news && c.kind == "text").bind(c.media && c.kind == "forum")
            .execute(&mut *tx).await?;
        *p += 1;
        for o in &c.overwrites {
            let target = if o.target < 0 { Some(gid) } else { role_ids.get(o.target as usize).copied() };
            if let Some(t) = target {
                sqlx::query("INSERT INTO channel_overwrites (channel_id, target_id, target_kind, allow, deny) VALUES ($1, $2, 'role', $3, $4) ON CONFLICT DO NOTHING")
                    .bind(id).bind(t).bind(o.allow & perms::ALL as i64).bind(o.deny & perms::ALL as i64).execute(&mut *tx).await?;
            }
        }
        chan_ids.push(Some(id));
    }
    let pick = |i: Option<usize>| i.and_then(|i| chan_ids.get(i).copied().flatten());
    sqlx::query("UPDATE guilds SET afk_channel_id = $2, system_channel_id = $3 WHERE id = $1").bind(gid).bind(pick(snap.afk_channel)).bind(pick(snap.system_channel)).execute(&mut *tx).await?;
    sqlx::query("UPDATE guild_templates SET usage_count = usage_count + 1 WHERE code = $1").bind(&code).execute(&mut *tx).await?;
    tx.commit().await?;

    let guild = sqlx::query_as::<_, Guild>(&format!("SELECT {GUILD_COLS} FROM guilds WHERE id = $1")).bind(gid).fetch_one(&state.db).await?;
    let mut channels = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE guild_id = $1 ORDER BY position")).bind(gid).fetch_all(&state.db).await?;
    perms::attach_overwrites(&state.db, &mut channels).await?;
    let roles = perms::list_roles(&state.db, gid).await?;
    let payload = super::guilds::guild_payload(&guild, json!({ "channels": channels, "roles": roles }));
    state.hub.emit_users(vec![uid], "GUILD_CREATE", payload.clone());
    Ok((StatusCode::CREATED, Json(payload)))
}
