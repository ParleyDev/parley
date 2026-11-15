//! Communities: a named group of channels inside one server. A community is identity data (slug, name, icon,
//! description, an optional external reference) pointing at one ordinary category; the channels under that category
//! are its channels and access is plain server permissions. Manage Channels creates, edits and deletes.

use crate::{auth::AuthUser, error::{AppError, AppResult}, models::{Channel, Community}, perms, routes::guilds::{normalize_channel_name, require_member, CHANNEL_COLS}, state::AppState};
use axum::{extract::{Path, Query, State}, http::StatusCode, routing::get, Json, Router};
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/communities", get(list).post(create))
        .route("/guilds/:id/communities/:slug", get(get_one).patch(update).delete(remove))
        .route("/guilds/:id/communities/:slug/follow", axum::routing::put(follow).delete(unfollow))
}

const COLS: &str = "id, guild_id, slug, name, icon_url, description, external_ref, category_id, last_activity_at, created_at";
const TAKEN: &str = "A community with that address already exists";

fn valid_slug(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty() && b.len() <= 63 && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit()) && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

fn clean_name(s: &str) -> AppResult<String> {
    let n = s.trim();
    if n.is_empty() || n.chars().count() > 100 { return Err(AppError::BadRequest("Name must be 1-100 characters".into())) }
    Ok(n.to_string())
}

fn clean_description(s: &str) -> AppResult<String> {
    let d = s.trim();
    if d.chars().count() > 300 { return Err(AppError::BadRequest("Description must be at most 300 characters".into())) }
    Ok(d.to_string())
}

/// Empty clears; otherwise at most `max` characters.
fn clean_opt(s: Option<String>, max: usize, what: &str) -> AppResult<Option<String>> {
    let Some(s) = s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) else { return Ok(None) };
    if s.chars().count() > max { return Err(AppError::BadRequest(format!("{what} must be at most {max} characters"))) }
    Ok(Some(s))
}

fn taken(e: sqlx::Error) -> AppError {
    match e { sqlx::Error::Database(d) if d.is_unique_violation() => AppError::Conflict(TAKEN.into()), e => e.into() }
}

fn slim(c: &Community) -> Value {
    json!({ "id": c.id, "guild_id": c.guild_id, "slug": c.slug, "name": c.name, "icon_url": c.icon_url, "description": c.description, "category_id": c.category_id })
}

/// The community for the caller: counts, whether they follow it and the child channels they can view. `None` when the
/// caller cannot view its category (the same decision channel listing makes).
async fn hydrate(state: &AppState, c: Community, uid: Uuid) -> AppResult<Option<Community>> {
    let visible = perms::visible_channels(&state.db, c.guild_id, uid).await?;
    if !visible.iter().any(|v| v.id == c.category_id) { return Ok(None) }
    Ok(Some(fill(state, c, uid, &visible).await?))
}

/// `hydrate` without the visibility gate: what the caller who just wrote the community gets back.
async fn fill(state: &AppState, mut c: Community, uid: Uuid, visible: &[Channel]) -> AppResult<Community> {
    let mut kids: Vec<&Channel> = visible.iter().filter(|v| v.parent_id == Some(c.category_id)).collect();
    kids.sort_by_key(|k| (k.position, k.created_at));
    c.channel_ids = kids.into_iter().map(|k| k.id).collect();
    let online = crate::ws::bus::visible_online_users(&state.db).await;
    let (followers, on, me): (i64, i64, bool) = sqlx::query_as(
        "SELECT COUNT(*), COUNT(*) FILTER (WHERE user_id = ANY($2)), COALESCE(bool_or(user_id = $3), false) FROM community_follows WHERE community_id = $1")
        .bind(c.id).bind(&online).bind(uid).fetch_one(&state.db).await?;
    (c.follower_count, c.online_count, c.following) = (followers, on, me);
    Ok(c)
}

async fn written(state: &AppState, c: Community, uid: Uuid) -> AppResult<Community> {
    let visible = perms::visible_channels(&state.db, c.guild_id, uid).await?;
    fill(state, c, uid, &visible).await
}

/// Who may see the community: the category's channel audience, as for ordinary channel events.
async fn audience(state: &AppState, category: &mut Channel) -> AppResult<crate::ws::hub::Target> {
    perms::attach_overwrites(&state.db, std::slice::from_mut(category)).await?;
    perms::channel_audience(&state.db, category).await
}

async fn by_slug(state: &AppState, gid: Uuid, slug: &str) -> AppResult<Community> {
    sqlx::query_as::<_, Community>(&format!("SELECT {COLS} FROM communities WHERE guild_id = $1 AND slug = $2"))
        .bind(gid).bind(slug).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Community not found".into()))
}

#[derive(Deserialize)]
struct NewChannel { name: String, kind: String }

#[derive(Deserialize)]
struct CreateIn { slug: String, name: String, #[serde(default)] description: String, icon_url: Option<String>, external_ref: Option<String>, channels: Option<Vec<NewChannel>> }

/// `POST /guilds/:id/communities`: a category named `name`, positioned last, with the listed channels (or one text
/// channel `chat`) under it, in one transaction.
async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<CreateIn>) -> AppResult<(StatusCode, Json<Community>)> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    if !valid_slug(&req.slug) { return Err(AppError::BadRequest("Address must be lower-case letters, digits and dashes, starting with a letter or digit, up to 63 characters".into())) }
    let name = clean_name(&req.name)?;
    let description = clean_description(&req.description)?;
    crate::routes::users::validate_image(&req.icon_url)?;
    let icon = req.icon_url.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let ext = clean_opt(req.external_ref, 200, "External reference")?;
    let chans = req.channels.unwrap_or_else(|| vec![NewChannel { name: "chat".into(), kind: "text".into() }]);
    if chans.len() > 25 { return Err(AppError::BadRequest("At most 25 channels".into())) }
    let mut planned = vec![];
    for ch in &chans {
        if !["text", "voice", "forum"].contains(&ch.kind.as_str()) { return Err(AppError::BadRequest("Channel kind must be text, voice or forum".into())) }
        planned.push((normalize_channel_name(&ch.name, &ch.kind)?, ch.kind.clone()));
    }
    let mut tx = state.db.begin().await?;
    let (pos,): (i32,) = sqlx::query_as("SELECT COALESCE(MAX(position), -1) + 1 FROM channels WHERE guild_id = $1").bind(gid).fetch_one(&mut *tx).await?;
    let category: Channel = sqlx::query_as(&format!("INSERT INTO channels (id, guild_id, name, kind, position) VALUES ($1, $2, $3, 'category', $4) RETURNING {CHANNEL_COLS}"))
        .bind(Uuid::now_v7()).bind(gid).bind(&name).bind(pos).fetch_one(&mut *tx).await?;
    let mut created = vec![];
    for (i, (cname, kind)) in planned.iter().enumerate() {
        let ch: Channel = sqlx::query_as(&format!(
            "INSERT INTO channels (id, guild_id, name, kind, position, parent_id, audio_mode) VALUES ($1, $2, $3, $4, $5, $6, 'voice') RETURNING {CHANNEL_COLS}"))
            .bind(Uuid::now_v7()).bind(gid).bind(cname).bind(kind).bind(pos + 1 + i as i32).bind(category.id).fetch_one(&mut *tx).await?;
        created.push(ch);
    }
    let c: Community = sqlx::query_as(&format!(
        "INSERT INTO communities (id, guild_id, slug, name, icon_url, description, external_ref, category_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING {COLS}"))
        .bind(Uuid::now_v7()).bind(gid).bind(&req.slug).bind(&name).bind(&icon).bind(&description).bind(&ext).bind(category.id).bind(uid)
        .fetch_one(&mut *tx).await.map_err(taken)?;
    tx.commit().await?;
    let mut category = category;
    let target = audience(&state, &mut category).await?;
    let out = written(&state, c.clone(), uid).await?;
    state.hub.emit(target.clone(), "CHANNEL_CREATE", json!(category));
    for ch in &created { state.hub.emit(target.clone(), "CHANNEL_CREATE", json!(ch)); }
    state.hub.emit(target, "COMMUNITY_CREATE", slim(&c));
    Ok((StatusCode::CREATED, Json(out)))
}

/// `GET /guilds/:id/communities/:slug`.
async fn get_one(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, slug)): Path<(Uuid, String)>) -> AppResult<Json<Community>> {
    require_member(&state.db, gid, uid).await?;
    let c = by_slug(&state, gid, &slug).await?;
    hydrate(&state, c, uid).await?.map(Json).ok_or_else(|| AppError::NotFound("Community not found".into()))
}

#[derive(Deserialize)]
struct PatchIn { slug: Option<String>, name: Option<String>, description: Option<String>, icon_url: Option<String>, external_ref: Option<String> }

/// `PATCH /guilds/:id/communities/:slug`: any of slug, name (renames the category too), description, icon_url,
/// external_ref. Empty icon_url or external_ref clears it.
async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, slug)): Path<(Uuid, String)>, Json(req): Json<PatchIn>) -> AppResult<Json<Community>> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    let cur = by_slug(&state, gid, &slug).await?;
    let new_slug = match req.slug { Some(s) if !valid_slug(&s) => return Err(AppError::BadRequest("Address must be lower-case letters, digits and dashes, starting with a letter or digit, up to 63 characters".into())), Some(s) => s, None => cur.slug.clone() };
    let name = match &req.name { Some(n) => clean_name(n)?, None => cur.name.clone() };
    let description = match &req.description { Some(d) => clean_description(d)?, None => cur.description.clone() };
    crate::routes::users::validate_image(&req.icon_url)?;
    let icon = match req.icon_url { Some(i) => Some(i.trim().to_string()).filter(|s| !s.is_empty()), None => cur.icon_url.clone() };
    let ext = match req.external_ref { Some(e) => clean_opt(Some(e), 200, "External reference")?, None => cur.external_ref.clone() };
    let mut tx = state.db.begin().await?;
    let c: Community = sqlx::query_as(&format!("UPDATE communities SET slug = $2, name = $3, description = $4, icon_url = $5, external_ref = $6 WHERE id = $1 RETURNING {COLS}"))
        .bind(cur.id).bind(&new_slug).bind(&name).bind(&description).bind(&icon).bind(&ext).fetch_one(&mut *tx).await.map_err(taken)?;
    let mut category: Channel = sqlx::query_as(&format!("UPDATE channels SET name = $2 WHERE id = $1 RETURNING {CHANNEL_COLS}")).bind(cur.category_id).bind(&name).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    let target = audience(&state, &mut category).await?;
    let out = written(&state, c.clone(), uid).await?;
    if name != cur.name { state.hub.emit(target.clone(), "CHANNEL_UPDATE", json!(category)); }
    state.hub.emit(target, "COMMUNITY_UPDATE", slim(&c));
    Ok(Json(out))
}

/// `DELETE /guilds/:id/communities/:slug`: its channels go the way a single deleted channel does (threads, uploads,
/// events), then the category, which takes the community row with it.
async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, slug)): Path<(Uuid, String)>) -> AppResult<StatusCode> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    let c = by_slug(&state, gid, &slug).await?;
    let mut category: Channel = sqlx::query_as(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(c.category_id).fetch_one(&state.db).await?;
    let target = audience(&state, &mut category).await?;
    let kids: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM channels WHERE parent_id = $1 ORDER BY position, created_at").bind(c.category_id).fetch_all(&state.db).await?;
    for (id,) in kids { super::channels::remove_channel(&state, gid, id).await?; }
    super::channels::remove_channel(&state, gid, c.category_id).await?;
    state.hub.emit(target, "COMMUNITY_DELETE", json!({ "id": c.id, "guild_id": gid }));
    Ok(StatusCode::NO_CONTENT)
}

/// A new message under a community's category (directly, or in a thread of one of its channels) is activity.
pub async fn touch_activity(db: &sqlx::PgPool, channel_id: Uuid) -> AppResult<()> {
    sqlx::query(
        "UPDATE communities SET last_activity_at = now() WHERE category_id IN (
           SELECT parent_id FROM channels WHERE id = $1
           UNION SELECT p.parent_id FROM channels c JOIN channels p ON p.id = c.parent_id WHERE c.id = $1)")
        .bind(channel_id).execute(db).await?;
    Ok(())
}

async fn set_follow(state: &AppState, gid: Uuid, uid: Uuid, slug: &str, on: bool) -> AppResult<StatusCode> {
    require_member(&state.db, gid, uid).await?;
    let c = by_slug(state, gid, slug).await?;
    let visible = perms::visible_channels(&state.db, gid, uid).await?;
    if !visible.iter().any(|v| v.id == c.category_id) { return Err(AppError::NotFound("Community not found".into())) }
    if on {
        sqlx::query("INSERT INTO community_follows (community_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(c.id).bind(uid).execute(&state.db).await?;
    } else {
        sqlx::query("DELETE FROM community_follows WHERE community_id = $1 AND user_id = $2").bind(c.id).bind(uid).execute(&state.db).await?;
    }
    state.hub.emit_users(vec![uid], "COMMUNITY_FOLLOW_UPDATE", json!({ "guild_id": gid, "community_id": c.id, "following": on }));
    Ok(StatusCode::NO_CONTENT)
}

/// `PUT /guilds/:id/communities/:slug/follow`: idempotent. A sidebar preference, never access.
async fn follow(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, slug)): Path<(Uuid, String)>) -> AppResult<StatusCode> {
    set_follow(&state, gid, uid, &slug, true).await
}

/// `DELETE /guilds/:id/communities/:slug/follow`: idempotent.
async fn unfollow(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, slug)): Path<(Uuid, String)>) -> AppResult<StatusCode> {
    set_follow(&state, gid, uid, &slug, false).await
}

#[derive(Deserialize)]
struct ListQuery { q: Option<String>, sort: Option<String>, limit: Option<i64>, after: Option<String>, external_ref: Option<String> }

/// Opaque keyset cursor: the sort key of the last item (activity micros since the epoch, 0 for none; name; id).
#[derive(Deserialize, serde::Serialize)]
struct Cursor { s: String, t: i64, n: String, i: Uuid }

fn bad_cursor() -> AppError { AppError::BadRequest("Invalid cursor".into()) }

/// `GET /guilds/:id/communities`: `{ items, next }`. Communities whose category the caller cannot view are left out.
/// Ordered by recent activity (nulls last) or name, with name then id as tie-breakers so paging is stable.
async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Query(q): Query<ListQuery>) -> AppResult<Json<Value>> {
    require_member(&state.db, gid, uid).await?;
    let by_name = match q.sort.as_deref() { None | Some("activity") => false, Some("name") => true, _ => return Err(AppError::BadRequest("sort must be activity or name".into())) };
    let sort = if by_name { "name" } else { "activity" };
    let limit = q.limit.unwrap_or(50);
    if !(1..=100).contains(&limit) { return Err(AppError::BadRequest("limit must be 1 to 100".into())) }
    let cur = match q.after.as_deref().filter(|s| !s.is_empty()) {
        None => None,
        Some(a) => {
            let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(a).map_err(|_| bad_cursor())?;
            let c: Cursor = serde_json::from_slice(&raw).map_err(|_| bad_cursor())?;
            if c.s != sort { return Err(bad_cursor()) }
            Some(c)
        }
    };
    let visible = perms::visible_channels(&state.db, gid, uid).await?;
    let cats: Vec<Uuid> = visible.iter().filter(|v| v.kind == "category").map(|v| v.id).collect();
    let key = "COALESCE(last_activity_at, 'epoch'::timestamptz)";
    let (after, order) = if by_name {
        ("($5::timestamptz IS NULL AND ($6::text IS NULL OR (name, id) > ($6::text, $7::uuid)))".to_string(), "name, id".to_string())
    } else {
        (format!("($5::timestamptz IS NULL OR {key} < $5 OR ({key} = $5 AND (name, id) > ($6::text, $7::uuid)))"), format!("{key} DESC, name, id"))
    };
    let at: Option<DateTime<Utc>> = match &cur { Some(c) if !by_name => Some(DateTime::from_timestamp_micros(c.t).ok_or_else(bad_cursor)?), _ => None };
    let sql = format!(
        "SELECT {COLS} FROM communities WHERE guild_id = $1 AND category_id = ANY($2)
           AND ($3::text IS NULL OR position(lower($3) in lower(name)) > 0) AND ($4::text IS NULL OR external_ref = $4) AND {after}
         ORDER BY {order} LIMIT $8");
    let needle = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let mut rows: Vec<Community> = sqlx::query_as(&sql)
        .bind(gid).bind(&cats).bind(needle).bind(q.external_ref.as_deref().filter(|s| !s.is_empty())).bind(at)
        .bind(cur.as_ref().map(|c| c.n.clone())).bind(cur.as_ref().map(|c| c.i)).bind(limit + 1)
        .fetch_all(&state.db).await?;
    let next = if rows.len() as i64 > limit {
        rows.truncate(limit as usize);
        let l = rows.last().unwrap();
        let t = l.last_activity_at.map(|t| t.timestamp_micros()).unwrap_or(0);
        Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&Cursor { s: sort.into(), t, n: l.name.clone(), i: l.id }).unwrap()))
    } else { None };
    let ids: Vec<Uuid> = rows.iter().map(|c| c.id).collect();
    let online = crate::ws::bus::visible_online_users(&state.db).await;
    let counts: Vec<(Uuid, i64, i64, bool)> = sqlx::query_as(
        "SELECT community_id, COUNT(*), COUNT(*) FILTER (WHERE user_id = ANY($2)), COALESCE(bool_or(user_id = $3), false) FROM community_follows WHERE community_id = ANY($1) GROUP BY community_id")
        .bind(&ids).bind(&online).bind(uid).fetch_all(&state.db).await?;
    let counts: std::collections::HashMap<Uuid, (i64, i64, bool)> = counts.into_iter().map(|(id, f, o, m)| (id, (f, o, m))).collect();
    let mut kids: std::collections::HashMap<Uuid, Vec<&Channel>> = std::collections::HashMap::new();
    for v in &visible { if let Some(p) = v.parent_id { kids.entry(p).or_default().push(v) } }
    for c in rows.iter_mut() {
        (c.follower_count, c.online_count, c.following) = counts.get(&c.id).copied().unwrap_or((0, 0, false));
        let mut k = kids.remove(&c.category_id).unwrap_or_default();
        k.sort_by_key(|k| (k.position, k.created_at));
        c.channel_ids = k.into_iter().map(|k| k.id).collect();
    }
    Ok(Json(json!({ "items": rows, "next": next })))
}

/// For the connect payload: slim forms of the communities the user can view across `guilds` (`visible` is every
/// channel they can view there), and their follows per server, oldest first.
pub async fn connect_payload(db: &sqlx::PgPool, uid: Uuid, guilds: &[Uuid], visible: &[Channel]) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let cats: Vec<Uuid> = visible.iter().filter(|v| v.kind == "category").map(|v| v.id).collect();
    let rows: Vec<Community> = sqlx::query_as(&format!("SELECT {COLS} FROM communities WHERE guild_id = ANY($1) AND category_id = ANY($2) ORDER BY created_at, id"))
        .bind(guilds).bind(&cats).fetch_all(db).await?;
    let follows: Vec<(Uuid, Vec<Uuid>)> = sqlx::query_as(
        "SELECT c.guild_id, array_agg(c.id ORDER BY f.created_at, c.id) FROM community_follows f JOIN communities c ON c.id = f.community_id
         WHERE f.user_id = $1 AND c.guild_id = ANY($2) AND c.category_id = ANY($3) GROUP BY c.guild_id")
        .bind(uid).bind(guilds).bind(&cats).fetch_all(db).await?;
    Ok((rows.iter().map(slim).collect(), follows.into_iter().map(|(g, ids)| json!({ "guild_id": g, "community_ids": ids })).collect()))
}
