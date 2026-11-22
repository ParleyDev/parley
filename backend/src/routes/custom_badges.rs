//! Custom profile badges. An instance's admins make a badge (name, explanation, an emoji or a small uploaded picture,
//! a colour) and give it to people; profiles carry it as `custom:<id>` after the built-in badges, and clients draw it
//! from the public catalog (`GET /badges`), which every session is sent again when it changes (`BADGES_UPDATE`).
//! Making, changing and giving badges needs Manage Instance, and each is in the console's audit log.

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{require_perm, Perm},
    state::AppState,
};
use axum::{extract::{Path, State}, http::StatusCode, routing::{get, patch, put}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/badges", get(catalog))
        .route("/admin/badges", get(admin_list).post(create))
        .route("/admin/badges/:id", patch(update).delete(remove))
        .route("/admin/badges/:id/holders", get(holders))
        .route("/admin/users/:uid/badges", get(user_badges))
        .route("/admin/users/:uid/badges/:id", put(award).delete(revoke))
}

/// At most this many badges on an instance: they are meant to be rare.
pub const MAX_BADGES: i64 = 100;
const COLS: &str = "id, name, description, emoji, icon_url, color, position";

#[derive(sqlx::FromRow, serde::Serialize, Clone)]
pub struct Badge { pub id: Uuid, pub name: String, pub description: String, pub emoji: String, pub icon_url: Option<String>, pub color: String, pub position: i32 }

async fn all(db: &sqlx::PgPool) -> AppResult<Vec<Badge>> {
    Ok(sqlx::query_as::<_, Badge>(&format!("SELECT {COLS} FROM custom_badges ORDER BY position, created_at")).fetch_all(db).await?)
}

async fn one(db: &sqlx::PgPool, id: Uuid) -> AppResult<Badge> {
    sqlx::query_as::<_, Badge>(&format!("SELECT {COLS} FROM custom_badges WHERE id = $1")).bind(id).fetch_optional(db).await?
        .ok_or_else(|| AppError::NotFound("Badge not found".into()))
}

/// Everyone's clients redraw badges from the new catalog.
async fn broadcast(state: &AppState) {
    if let Ok(list) = all(&state.db).await { state.hub.emit_all("BADGES_UPDATE", json!({ "badges": list })); }
}

/// `GET /badges`: the instance's custom badges, for drawing them on profiles. Public.
async fn catalog(State(state): State<AppState>) -> AppResult<Json<Vec<Badge>>> {
    Ok(Json(all(&state.db).await?))
}

/// A user's custom badges, for their profile (`custom:<id>`, in the catalog's order).
pub async fn for_user(db: &sqlx::PgPool, uid: Uuid) -> Vec<String> {
    sqlx::query_as::<_, (Uuid,)>("SELECT b.id FROM user_badges ub JOIN custom_badges b ON b.id = ub.badge_id WHERE ub.user_id = $1 ORDER BY b.position, b.created_at")
        .bind(uid).fetch_all(db).await.unwrap_or_default().into_iter().map(|(id,)| format!("custom:{id}")).collect()
}

/// `GET /admin/badges`: the catalog with how many people have each.
async fn admin_list(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Value>>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let counts: Vec<(Uuid, i64)> = sqlx::query_as("SELECT badge_id, COUNT(*) FROM user_badges GROUP BY badge_id").fetch_all(&state.db).await?;
    Ok(Json(all(&state.db).await?.into_iter().map(|b| {
        let n = counts.iter().find(|c| c.0 == b.id).map(|c| c.1).unwrap_or(0);
        let mut v = json!(b); v["holders"] = json!(n); v
    }).collect()))
}

#[derive(Deserialize)]
struct BadgeIn {
    name: Option<String>,
    description: Option<String>,
    emoji: Option<String>,
    /// An uploaded image (`POST /images?kind=icon`), or "" for none.
    icon_url: Option<String>,
    color: Option<String>,
    position: Option<i32>,
}

/// A unicode emoji: short, without letters, digits or spaces.
fn emoji_ok(e: &str) -> bool { e.chars().count() <= 8 && !e.chars().any(|c| c.is_ascii_alphanumeric() || c.is_whitespace() || c.is_control()) }
fn color_ok(c: &str) -> bool { c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit()) }

/// Apply what was sent to `b`, checking each field; a badge needs a name and an emoji or a picture.
fn apply(b: &mut Badge, req: BadgeIn) -> AppResult<()> {
    if let Some(n) = req.name {
        let n = n.trim().to_string();
        if n.is_empty() || n.chars().count() > 40 { return Err(AppError::BadRequest("A badge's name is 1 to 40 characters".into())) }
        b.name = n;
    }
    if let Some(d) = req.description {
        let d = d.trim().to_string();
        if d.chars().count() > 200 { return Err(AppError::BadRequest("The explanation is up to 200 characters".into())) }
        b.description = d;
    }
    if let Some(e) = req.emoji {
        let e = e.trim().to_string();
        if !emoji_ok(&e) { return Err(AppError::BadRequest("Pick a single emoji".into())) }
        b.emoji = e;
    }
    if let Some(u) = req.icon_url {
        let u = u.trim().to_string();
        if u.is_empty() { b.icon_url = None }
        else if crate::routes::images::image_id(&u).is_none() { return Err(AppError::BadRequest("The picture must be uploaded to this instance".into())) }
        else { b.icon_url = Some(u) }
    }
    if let Some(c) = req.color {
        let c = c.trim().to_lowercase();
        if !color_ok(&c) { return Err(AppError::BadRequest("The colour is #rrggbb".into())) }
        b.color = c;
    }
    if let Some(p) = req.position { b.position = p.clamp(0, 10_000) }
    if b.name.is_empty() { return Err(AppError::BadRequest("A badge needs a name".into())) }
    if b.emoji.is_empty() && b.icon_url.is_none() { return Err(AppError::BadRequest("A badge needs an emoji or a picture".into())) }
    Ok(())
}

/// `POST /admin/badges`: make a badge.
async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<BadgeIn>) -> AppResult<(StatusCode, Json<Badge>)> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM custom_badges").fetch_one(&state.db).await?;
    if n >= MAX_BADGES { return Err(AppError::BadRequest(format!("An instance can have up to {MAX_BADGES} badges"))) }
    let (next,): (i32,) = sqlx::query_as("SELECT COALESCE(MAX(position) + 1, 0) FROM custom_badges").fetch_one(&state.db).await?;
    let mut b = Badge { id: Uuid::now_v7(), name: String::new(), description: String::new(), emoji: String::new(), icon_url: None, color: "#a78bfa".into(), position: next };
    apply(&mut b, req)?;
    sqlx::query("INSERT INTO custom_badges (id, name, description, emoji, icon_url, color, position, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)")
        .bind(b.id).bind(&b.name).bind(&b.description).bind(&b.emoji).bind(&b.icon_url).bind(&b.color).bind(b.position).bind(uid).execute(&state.db).await?;
    audit::record(&state, uid, "badge.create", "badge", Some(b.id), &b.name, json!({})).await;
    broadcast(&state).await;
    Ok((StatusCode::CREATED, Json(b)))
}

/// `PATCH /admin/badges/:id`: change a badge (everyone who has it sees the change).
async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<BadgeIn>) -> AppResult<Json<Badge>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let mut b = one(&state.db, id).await?;
    apply(&mut b, req)?;
    sqlx::query("UPDATE custom_badges SET name = $2, description = $3, emoji = $4, icon_url = $5, color = $6, position = $7 WHERE id = $1")
        .bind(id).bind(&b.name).bind(&b.description).bind(&b.emoji).bind(&b.icon_url).bind(&b.color).bind(b.position).execute(&state.db).await?;
    audit::record(&state, uid, "badge.update", "badge", Some(id), &b.name, json!({})).await;
    broadcast(&state).await;
    Ok(Json(b))
}

/// `DELETE /admin/badges/:id`: delete a badge; it goes from everyone's profile.
async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let b = one(&state.db, id).await?;
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM user_badges WHERE badge_id = $1").bind(id).fetch_one(&state.db).await?;
    sqlx::query("DELETE FROM custom_badges WHERE id = $1").bind(id).execute(&state.db).await?;
    audit::record(&state, uid, "badge.delete", "badge", Some(id), &b.name, json!({ "holders": n })).await;
    broadcast(&state).await;
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /admin/badges/:id/holders`: who has it, newest first.
async fn holders(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    one(&state.db, id).await?;
    let rows: Vec<(Uuid, String, String, Option<String>, chrono::DateTime<chrono::Utc>, String, Option<String>)> = sqlx::query_as(
        "SELECT u.id, u.username, u.display_name, u.avatar_url, ub.awarded_at, ub.note, a.username
           FROM user_badges ub JOIN users u ON u.id = ub.user_id LEFT JOIN users a ON a.id = ub.awarded_by
          WHERE ub.badge_id = $1 ORDER BY ub.awarded_at DESC LIMIT 500",
    ).bind(id).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(id, username, display_name, avatar_url, at, note, by)| json!({
        "user_id": id, "username": username, "display_name": display_name, "avatar_url": avatar_url, "awarded_at": at, "note": note, "awarded_by": by,
    })).collect()))
}

/// `GET /admin/users/:uid/badges`: the custom badges someone has.
async fn user_badges(State(state): State<AppState>, AuthUser(me): AuthUser, Path(uid): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    require_perm(&state, me, Perm::InstanceManage).await?;
    let rows: Vec<(Uuid, chrono::DateTime<chrono::Utc>, String)> = sqlx::query_as("SELECT badge_id, awarded_at, note FROM user_badges WHERE user_id = $1").bind(uid).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(b, at, note)| json!({ "badge_id": b, "awarded_at": at, "note": note })).collect()))
}

#[derive(Deserialize, Default)]
struct AwardIn { #[serde(default)] note: String }

/// `PUT /admin/users/:uid/badges/:id {note?}`: give someone a badge (the note is for admins only).
async fn award(State(state): State<AppState>, AuthUser(me): AuthUser, Path((uid, id)): Path<(Uuid, Uuid)>, body: Option<Json<AwardIn>>) -> AppResult<StatusCode> {
    require_perm(&state, me, Perm::InstanceManage).await?;
    let b = one(&state.db, id).await?;
    let ok: Option<(bool,)> = sqlx::query_as("SELECT guest OR bot OR system OR account_state <> 'active' FROM users WHERE id = $1").bind(uid).fetch_optional(&state.db).await?;
    match ok { None => return Err(AppError::NotFound("User not found".into())), Some((true,)) => return Err(AppError::BadRequest("Badges are for people's accounts".into())), _ => {} }
    let note: String = body.map(|b| b.0.note).unwrap_or_default().trim().chars().take(300).collect();
    let made = sqlx::query("INSERT INTO user_badges (user_id, badge_id, awarded_by, note) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING")
        .bind(uid).bind(id).bind(me).bind(&note).execute(&state.db).await?.rows_affected();
    if made == 1 { audit::record(&state, me, "badge.award", "user", Some(uid), &audit::username(&state, uid).await, json!({ "badge": b.name, "badge_id": id })).await; }
    Ok(StatusCode::NO_CONTENT)
}

/// `DELETE /admin/users/:uid/badges/:id`: take a badge back.
async fn revoke(State(state): State<AppState>, AuthUser(me): AuthUser, Path((uid, id)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    require_perm(&state, me, Perm::InstanceManage).await?;
    let b = one(&state.db, id).await?;
    let gone = sqlx::query("DELETE FROM user_badges WHERE user_id = $1 AND badge_id = $2").bind(uid).bind(id).execute(&state.db).await?.rows_affected();
    if gone == 1 { audit::record(&state, me, "badge.revoke", "user", Some(uid), &audit::username(&state, uid).await, json!({ "badge": b.name, "badge_id": id })).await; }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank() -> Badge { Badge { id: Uuid::nil(), name: String::new(), description: String::new(), emoji: String::new(), icon_url: None, color: "#a78bfa".into(), position: 0 } }
    fn req(v: Value) -> BadgeIn { serde_json::from_value(v).unwrap() }

    #[test]
    fn a_badge_needs_a_name_and_an_emoji_or_picture() {
        let mut b = blank();
        assert!(apply(&mut b, req(json!({ "name": "Bug hunter" }))).is_err());
        assert!(apply(&mut b, req(json!({ "name": "Bug hunter", "emoji": "🐛", "color": "#FFAA00" }))).is_ok());
        assert_eq!((b.emoji.as_str(), b.color.as_str()), ("🐛", "#ffaa00"));
        // Taking the emoji away without a picture leaves it with nothing to show.
        assert!(apply(&mut b.clone(), req(json!({ "emoji": "" }))).is_err());
    }

    #[test]
    fn fields_are_checked() {
        let mut b = blank();
        assert!(apply(&mut b, req(json!({ "name": "x".repeat(41), "emoji": "⭐" }))).is_err());
        assert!(apply(&mut b, req(json!({ "name": "Star", "emoji": "abc" }))).is_err());
        assert!(apply(&mut b, req(json!({ "name": "Star", "emoji": "⭐", "color": "red" }))).is_err());
        assert!(apply(&mut b, req(json!({ "name": "Star", "icon_url": "https://elsewhere.example/x.png" }))).is_err());
        assert!(apply(&mut b, req(json!({ "name": "Star", "emoji": "⭐", "description": "d".repeat(201) }))).is_err());
        assert!(emoji_ok("👩‍💻") && emoji_ok("🏳️‍🌈") && !emoji_ok("a") && !emoji_ok("⭐ ⭐"));
    }
}
