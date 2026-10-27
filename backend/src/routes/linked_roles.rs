//! Linked roles: requirements on a role (account age, verified email, a linked account, or an app-reported value);
//! members who meet them can claim it in Channels & Roles, and lose it when they stop meeting them. Apps describe the
//! values they report (role connection metadata) and set them per user with the role_connections.write scope.

use crate::{auth::AuthUser, error::{AppError, AppResult}, perms, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::{get, put}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/applications/:id/role-connections/metadata", get(get_metadata).put(put_metadata))
        .route("/users/@me/applications/:app/role-connection", get(get_connection).put(put_connection))
        .route("/guilds/:id/roles/:rid/requirements", put(set_requirements))
        .route("/guilds/:id/linked-roles", get(guild_linked))
        .route("/guilds/:id/me/linked-roles/:rid", put(claim))
}

/// Metadata types (Discord's): 1 integer ≤, 2 integer ≥, 3 integer =, 4 integer ≠, 5 date ≤ (days ago), 6 date ≥,
/// 7 boolean =, 8 boolean ≠.
const TYPES: [i64; 8] = [1, 2, 3, 4, 5, 6, 7, 8];

async fn app_access(state: &AppState, app: Uuid, uid: Uuid) -> AppResult<()> {
    let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM applications WHERE id = $1 AND (owner_id = $2 OR bot_user_id = $2)").bind(app).bind(uid).fetch_optional(&state.db).await?;
    ok.map(|_| ()).ok_or_else(|| AppError::NotFound("Application not found".into()))
}

async fn get_metadata(State(state): State<AppState>, AuthUser(_): AuthUser, Path(app): Path<Uuid>) -> AppResult<Json<Value>> {
    let (m,): (Value,) = sqlx::query_as("SELECT role_connection_metadata FROM applications WHERE id = $1").bind(app).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Application not found".into()))?;
    Ok(Json(m))
}

/// `PUT /applications/:id/role-connections/metadata`: up to 5 records {key, name, description, type}.
async fn put_metadata(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(app): Path<Uuid>, Json(list): Json<Vec<Value>>) -> AppResult<Json<Value>> {
    app_access(&state, app, uid).await?;
    if list.len() > 5 { return Err(AppError::BadRequest("Up to 5 metadata records".into())) }
    let mut out = Vec::new();
    for m in &list {
        let key = m["key"].as_str().unwrap_or("").trim().to_lowercase();
        if key.is_empty() || key.len() > 50 || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') { return Err(AppError::BadRequest("keys are 1-50 lowercase letters, digits or _".into())) }
        let kind = m["type"].as_i64().filter(|t| TYPES.contains(t)).ok_or_else(|| AppError::BadRequest("type is 1-8".into()))?;
        let name: String = m["name"].as_str().unwrap_or(&key).trim().chars().take(100).collect();
        out.push(json!({ "key": key, "type": kind, "name": name, "description": m["description"].as_str().unwrap_or("").trim().chars().take(200).collect::<String>() }));
    }
    let v = json!(out);
    sqlx::query("UPDATE applications SET role_connection_metadata = $2 WHERE id = $1").bind(app).bind(&v).execute(&state.db).await?;
    Ok(Json(v))
}

async fn get_connection(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(app): Path<Uuid>) -> AppResult<Json<Value>> {
    let row: Option<(String, String, Value)> = sqlx::query_as("SELECT platform_name, platform_username, metadata FROM user_role_connections WHERE user_id = $1 AND app_id = $2").bind(uid).bind(app).fetch_optional(&state.db).await?;
    Ok(Json(row.map(|(n, u, m)| json!({ "platform_name": n, "platform_username": u, "metadata": m })).unwrap_or(json!({ "platform_name": null, "platform_username": null, "metadata": {} }))))
}

#[derive(Deserialize)]
struct ConnIn { #[serde(default)] platform_name: String, #[serde(default)] platform_username: String, #[serde(default)] metadata: serde_json::Map<String, Value> }

/// `PUT /users/@me/applications/:app/role-connection` (the user's token for that app, role_connections.write): what
/// the app knows about this user. Only declared keys are kept. Then the user's linked roles are checked again.
async fn put_connection(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(app): Path<Uuid>, Json(req): Json<ConnIn>) -> AppResult<Json<Value>> {
    let (meta,): (Value,) = sqlx::query_as("SELECT role_connection_metadata FROM applications WHERE id = $1").bind(app).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Application not found".into()))?;
    let keys: Vec<String> = meta.as_array().into_iter().flatten().filter_map(|m| m["key"].as_str().map(str::to_string)).collect();
    let values: serde_json::Map<String, Value> = req.metadata.into_iter().filter(|(k, v)| keys.contains(k) && (v.is_number() || v.is_boolean() || v.is_string())).collect();
    sqlx::query("INSERT INTO user_role_connections (user_id, app_id, platform_name, platform_username, metadata) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, app_id) DO UPDATE SET platform_name = EXCLUDED.platform_name, platform_username = EXCLUDED.platform_username, metadata = EXCLUDED.metadata, updated_at = now()")
        .bind(uid).bind(app).bind(req.platform_name.chars().take(50).collect::<String>()).bind(req.platform_username.chars().take(100).collect::<String>()).bind(json!(values)).execute(&state.db).await?;
    recheck_user(&state, uid).await?;
    Ok(Json(json!({ "metadata": values })))
}

/// Does `uid` meet a role's requirements? Each unmet one is listed (for the claim screen).
async fn unmet(state: &AppState, uid: Uuid, req: &Value) -> AppResult<Vec<String>> {
    let mut out = Vec::new();
    let (age_days, verified): (f64, bool) = sqlx::query_as("SELECT EXTRACT(EPOCH FROM now() - created_at)::float8 / 86400, email_verified_at IS NOT NULL FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if let Some(d) = req["account_age_days"].as_f64().filter(|d| *d > 0.0) { if age_days < d { out.push(format!("Account at least {d} days old")) } }
    if req["verified_email"].as_bool() == Some(true) && !verified { out.push("A verified email".into()) }
    if let Some(p) = req["connection"].as_str().filter(|p| !p.is_empty()) {
        let has: Option<(bool,)> = sqlx::query_as("SELECT true FROM connections WHERE user_id = $1 AND provider = $2").bind(uid).bind(p).fetch_optional(&state.db).await?;
        if has.is_none() { out.push(format!("A linked {p} account")) }
    }
    if let Some(a) = req.get("app").filter(|a| a.is_object()) {
        let app: Uuid = a["app_id"].as_str().and_then(|s| s.parse().ok()).unwrap_or_default();
        let key = a["key"].as_str().unwrap_or("");
        let row: Option<(Value, String)> = sqlx::query_as("SELECT c.metadata, ap.name FROM user_role_connections c JOIN applications ap ON ap.id = c.app_id WHERE c.user_id = $1 AND c.app_id = $2").bind(uid).bind(app).fetch_optional(&state.db).await?;
        let label = a["label"].as_str().unwrap_or(key).to_string();
        let ok = match &row {
            Some((m, _)) => {
                let have = &m[key];
                let want = &a["value"];
                match a["type"].as_i64().unwrap_or(2) {
                    1 => have.as_f64().zip(want.as_f64()).map(|(h, w)| h <= w).unwrap_or(false),
                    2 => have.as_f64().zip(want.as_f64()).map(|(h, w)| h >= w).unwrap_or(false),
                    3 => have.as_f64().zip(want.as_f64()).map(|(h, w)| h == w).unwrap_or(false),
                    4 => have.as_f64().zip(want.as_f64()).map(|(h, w)| h != w).unwrap_or(false),
                    // Dates: a timestamp the app set; the requirement is in days since it.
                    5 | 6 => have.as_str().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).zip(want.as_f64()).map(|(t, w)| {
                        let days = (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_seconds() as f64 / 86400.0;
                        if a["type"].as_i64() == Some(5) { days <= w } else { days >= w }
                    }).unwrap_or(false),
                    7 => have.as_bool().map(|h| Some(h) == want.as_bool()).unwrap_or(false),
                    8 => have.as_bool().map(|h| Some(h) != want.as_bool()).unwrap_or(false),
                    _ => false,
                }
            }
            None => false,
        };
        if !ok { out.push(format!("{label} ({})", row.map(|r| r.1).unwrap_or_else(|| "connect the app".into()))) }
    }
    Ok(out)
}

#[derive(Deserialize)]
struct ReqIn { requirements: Option<Value> }

/// `PUT /guilds/:id/roles/:rid/requirements` (Manage Roles): make a role a linked role, or not (null).
async fn set_requirements(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, rid)): Path<(Uuid, Uuid)>, Json(req): Json<ReqIn>) -> AppResult<Json<Value>> {
    let (ctx, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_ROLES)?;
    let role = ctx.roles.get(&rid).ok_or_else(|| AppError::NotFound("Role not found".into()))?;
    if rid == gid || role.managed_app_id.is_some() || !ctx.outranks_role(uid, role) { return Err(AppError::Forbidden) }
    if (role.permissions as u64) & perms::SELF_GRANT_FORBIDDEN != 0 { return Err(AppError::BadRequest("Roles with moderation powers can't be claimed".into())) }
    let clean = match req.requirements.filter(|r| r.is_object()) {
        None => Value::Null,
        Some(r) => {
            let mut o = serde_json::Map::new();
            if let Some(d) = r["account_age_days"].as_f64().filter(|d| *d > 0.0) { o.insert("account_age_days".into(), json!(d.min(3650.0))); }
            if r["verified_email"].as_bool() == Some(true) { o.insert("verified_email".into(), json!(true)); }
            if let Some(c) = r["connection"].as_str().filter(|c| crate::routes::connections::PROVIDERS.contains(c)) { o.insert("connection".into(), json!(c)); }
            if let Some(a) = r.get("app").filter(|a| a.is_object()) {
                let app: Uuid = a["app_id"].as_str().and_then(|s| s.parse().ok()).ok_or_else(|| AppError::BadRequest("app_id needed".into()))?;
                let (meta,): (Value,) = sqlx::query_as("SELECT role_connection_metadata FROM applications WHERE id = $1").bind(app).fetch_optional(&state.db).await?.ok_or_else(|| AppError::BadRequest("Unknown app".into()))?;
                let key = a["key"].as_str().unwrap_or("");
                let m = meta.as_array().into_iter().flatten().find(|m| m["key"].as_str() == Some(key)).cloned().ok_or_else(|| AppError::BadRequest("That app doesn't report that".into()))?;
                o.insert("app".into(), json!({ "app_id": app, "key": key, "type": m["type"], "label": m["name"], "value": a["value"] }));
            }
            if o.is_empty() { return Err(AppError::BadRequest("Add at least one requirement".into())) }
            Value::Object(o)
        }
    };
    sqlx::query("UPDATE roles SET requirements = $2 WHERE id = $1").bind(rid).bind(if clean.is_null() { None } else { Some(&clean) }).execute(&state.db).await?;
    crate::routes::roles::emit_roles(&state, gid).await?;
    Ok(Json(json!({ "requirements": clean })))
}

/// `GET /guilds/:id/linked-roles`: the server's linked roles and, for each, what you still need.
async fn guild_linked(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    let (ctx, _) = perms::guild_perms(&state.db, gid, uid).await?;
    let mine = ctx.member_roles.get(&uid).cloned().unwrap_or_default();
    let mut out = Vec::new();
    for r in ctx.roles.values().filter(|r| r.requirements.is_some()) {
        let missing = unmet(&state, uid, r.requirements.as_ref().unwrap()).await?;
        out.push(json!({ "id": r.id, "name": r.name, "color": r.color, "requirements": r.requirements, "missing": missing, "have": mine.contains(&r.id) }));
    }
    Ok(Json(out))
}

/// `PUT /guilds/:id/me/linked-roles/:rid`: claim a linked role you qualify for.
async fn claim(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, rid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    let (ctx, _) = perms::guild_perms(&state.db, gid, uid).await?;
    let role = ctx.roles.get(&rid).filter(|r| r.requirements.is_some()).ok_or_else(|| AppError::NotFound("No such linked role".into()))?;
    let missing = unmet(&state, uid, role.requirements.as_ref().unwrap()).await?;
    if !missing.is_empty() { return Err(AppError::BadRequest(format!("You still need: {}", missing.join(", ")))) }
    set_role(&state, gid, uid, rid, true).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn set_role(state: &AppState, gid: Uuid, uid: Uuid, rid: Uuid, add: bool) -> AppResult<()> {
    let before = perms::visibility(&state.db, gid).await?;
    if add { sqlx::query("INSERT INTO member_roles (guild_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING").bind(gid).bind(uid).bind(rid).execute(&state.db).await?; }
    else { sqlx::query("DELETE FROM member_roles WHERE guild_id = $1 AND user_id = $2 AND role_id = $3").bind(gid).bind(uid).bind(rid).execute(&state.db).await?; }
    perms::resync_visibility(state, gid, &before).await?;
    if let Ok(m) = crate::routes::guilds::fetch_member(&state.db, gid, uid).await { state.hub.emit_guild(gid, "GUILD_MEMBER_UPDATE", json!(m)); }
    Ok(())
}

/// After someone's connections or app values change: take away linked roles they no longer qualify for.
pub async fn recheck_user(state: &AppState, uid: Uuid) -> AppResult<()> {
    let held: Vec<(Uuid, Uuid, Value)> = sqlx::query_as("SELECT r.guild_id, r.id, r.requirements FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.user_id = $1 AND r.requirements IS NOT NULL")
        .bind(uid).fetch_all(&state.db).await?;
    for (gid, rid, req) in held {
        if !unmet(state, uid, &req).await?.is_empty() { set_role(state, gid, uid, rid, false).await?; }
    }
    Ok(())
}
