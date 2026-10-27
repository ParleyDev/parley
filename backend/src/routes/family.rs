//! Family Center (Settings → Family Center). A teen (13–17 by their birth date) makes a one-time code, shown as text
//! and a QR code; an adult enters it and becomes a linked parent. A parent sees a summary of the teen's last days:
//! servers joined, friends added, and who they messaged and how many times — never what was said. The teen sees the
//! same summary, so nothing is hidden from them. Either side can unlink at any time; a teen can have up to 4
//! parents linked. FAMILY_UPDATE tells both sides when links change.

use crate::{auth::AuthUser, error::{AppError, AppResult}, models::User, state::AppState};
use axum::{extract::{Path, Query, State}, http::StatusCode, routing::{delete, get, post}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/family", get(overview))
        .route("/family/code", post(make_code))
        .route("/family/links", post(link))
        .route("/family/links/:id", delete(unlink))
        .route("/family/teens/:id/summary", get(summary))
}

const MAX_PARENTS: i64 = 4;

/// 'teen', 'adult' or 'unknown' (no birth date yet), as the account settings have it.
async fn age(db: &sqlx::PgPool, uid: Uuid) -> AppResult<String> {
    Ok(sqlx::query_as::<_, (String,)>("SELECT CASE WHEN birthdate IS NULL THEN 'unknown' WHEN birthdate > (now() - interval '18 years')::date THEN 'teen' ELSE 'adult' END FROM users WHERE id = $1")
        .bind(uid).fetch_one(db).await?.0)
}

async fn users(db: &sqlx::PgPool, sql: &str, uid: Uuid) -> AppResult<Vec<User>> {
    Ok(sqlx::query_as::<_, User>(&format!("SELECT {} FROM users WHERE id IN ({sql}) ORDER BY display_name", crate::routes::users::USER_COLS)).bind(uid).fetch_all(db).await?)
}

/// Your side of it: whether you're a teen or an adult here, and who you're linked with.
async fn overview(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    let role = age(&state.db, uid).await?;
    let parents = users(&state.db, "SELECT parent_id FROM family_links WHERE teen_id = $1", uid).await?;
    let teens = users(&state.db, "SELECT teen_id FROM family_links WHERE parent_id = $1", uid).await?;
    Ok(Json(json!({ "role": role, "parents": parents, "teens": teens })))
}

/// A teen's one-time code for a parent to enter (15 minutes).
async fn make_code(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    match age(&state.db, uid).await?.as_str() {
        "teen" => {}
        "unknown" => return Err(AppError::BadRequest("Add your birthday in My Account first".into())),
        _ => return Err(AppError::BadRequest("Family Center links a teen's account to a parent's: the code comes from the teen".into())),
    }
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM family_links WHERE teen_id = $1").bind(uid).fetch_one(&state.db).await?;
    if n >= MAX_PARENTS { return Err(AppError::BadRequest("You already have 4 parents linked".into())) }
    sqlx::query("DELETE FROM family_codes WHERE teen_id = $1 OR expires_at < now()").bind(uid).execute(&state.db).await?;
    // Easy to read aloud or type: no 0/O or 1/I.
    const ABC: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let raw = crate::mail::new_token();
    let code: String = raw.bytes().take(8).map(|b| ABC[b as usize % ABC.len()] as char).collect();
    let (exp,): (chrono::DateTime<chrono::Utc>,) = sqlx::query_as("INSERT INTO family_codes (code, teen_id, expires_at) VALUES ($1, $2, now() + interval '15 minutes') RETURNING expires_at")
        .bind(&code).bind(uid).fetch_one(&state.db).await?;
    Ok(Json(json!({ "code": code, "expires_at": exp })))
}

#[derive(Deserialize)]
struct LinkReq { code: String }

/// A parent enters the teen's code.
async fn link(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<LinkReq>) -> AppResult<Json<Value>> {
    if age(&state.db, uid).await? != "adult" { return Err(AppError::BadRequest("Parents need an adult account with a birthday set".into())) }
    let code = req.code.trim().to_uppercase().replace([' ', '-'], "");
    let row: Option<(Uuid,)> = sqlx::query_as("DELETE FROM family_codes WHERE code = $1 AND expires_at > now() RETURNING teen_id").bind(&code).fetch_optional(&state.db).await?;
    let (teen,) = row.ok_or_else(|| AppError::BadRequest("That code is wrong or has expired; ask for a new one".into()))?;
    if teen == uid { return Err(AppError::BadRequest("That's your own code".into())) }
    let (n,): (i64,) = sqlx::query_as("SELECT count(*) FROM family_links WHERE teen_id = $1").bind(teen).fetch_one(&state.db).await?;
    if n >= MAX_PARENTS { return Err(AppError::BadRequest("They already have 4 parents linked".into())) }
    sqlx::query("INSERT INTO family_links (parent_id, teen_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(uid).bind(teen).execute(&state.db).await?;
    state.hub.emit_users(vec![uid, teen], "FAMILY_UPDATE", json!({}));
    Ok(Json(json!({ "teen_id": teen })))
}

/// Either side ends a link.
async fn unlink(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(other): Path<Uuid>) -> AppResult<StatusCode> {
    let n = sqlx::query("DELETE FROM family_links WHERE (parent_id = $1 AND teen_id = $2) OR (parent_id = $2 AND teen_id = $1)").bind(uid).bind(other).execute(&state.db).await?.rows_affected();
    if n == 0 { return Err(AppError::NotFound("Not linked".into())) }
    state.hub.emit_users(vec![uid, other], "FAMILY_UPDATE", json!({}));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct SummaryQ { days: Option<i64> }

/// The teen's last days (7 by default, up to 30), for a linked parent or the teen themselves. No message content.
async fn summary(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<String>, Query(q): Query<SummaryQ>) -> AppResult<Json<Value>> {
    let teen = if id == "@me" { uid } else { Uuid::parse_str(&id).map_err(|_| AppError::NotFound("Not linked".into()))? };
    if teen != uid {
        let linked = sqlx::query_as::<_, (bool,)>("SELECT EXISTS (SELECT 1 FROM family_links WHERE parent_id = $1 AND teen_id = $2)").bind(uid).bind(teen).fetch_one(&state.db).await?.0;
        if !linked { return Err(AppError::NotFound("Not linked".into())) }
    }
    let days = q.days.unwrap_or(7).clamp(1, 30);
    let since = chrono::Utc::now() - chrono::Duration::days(days);
    let servers: Vec<(Uuid, String, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT g.id, g.name, g.icon_url, m.joined_at FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.user_id = $1 AND m.joined_at >= $2 ORDER BY m.joined_at DESC LIMIT 50",
    ).bind(teen).bind(since).fetch_all(&state.db).await?;
    let friends: Vec<(Uuid, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT target_id, created_at FROM relationships WHERE user_id = $1 AND kind = 'friend' AND created_at >= $2 ORDER BY created_at DESC LIMIT 50",
    ).bind(teen).bind(since).fetch_all(&state.db).await?;
    // People they messaged one to one or in groups, with how many messages they sent there.
    let partners: Vec<(Uuid, i64)> = sqlx::query_as(
        "SELECT cm.user_id, count(DISTINCT msg.id) FROM messages msg JOIN channels c ON c.id = msg.channel_id AND c.kind IN ('dm', 'group_dm')
         JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id <> $1
         WHERE msg.author_id = $1 AND msg.kind = 'default' AND msg.created_at >= $2 GROUP BY cm.user_id ORDER BY 2 DESC LIMIT 50",
    ).bind(teen).bind(since).fetch_all(&state.db).await?;
    let (sent_dm, sent_servers): (i64, i64) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE c.kind IN ('dm', 'group_dm')), count(*) FILTER (WHERE c.guild_id IS NOT NULL)
         FROM messages msg JOIN channels c ON c.id = msg.channel_id WHERE msg.author_id = $1 AND msg.kind = 'default' AND msg.created_at >= $2",
    ).bind(teen).bind(since).fetch_one(&state.db).await?;
    let mut ids: Vec<Uuid> = friends.iter().map(|f| f.0).chain(partners.iter().map(|p| p.0)).collect();
    ids.push(teen); ids.sort(); ids.dedup();
    let people: Vec<User> = sqlx::query_as::<_, User>(&format!("SELECT {} FROM users WHERE id = ANY($1)", crate::routes::users::USER_COLS)).bind(&ids).fetch_all(&state.db).await?;
    let user = |id: Uuid| people.iter().find(|u| u.id == id).map(|u| json!(u)).unwrap_or(json!({ "id": id }));
    Ok(Json(json!({
        "teen": user(teen), "days": days, "since": since,
        "servers_joined": servers.iter().map(|(id, name, icon, at)| json!({ "id": id, "name": name, "icon_url": icon, "joined_at": at })).collect::<Vec<_>>(),
        "friends_added": friends.iter().map(|(id, at)| json!({ "user": user(*id), "at": at })).collect::<Vec<_>>(),
        "messaged": partners.iter().map(|(id, n)| json!({ "user": user(*id), "messages": n })).collect::<Vec<_>>(),
        "messages_sent": { "direct": sent_dm, "servers": sent_servers },
    })))
}
