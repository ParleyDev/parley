//! Communities: a named group of channels inside one server. A community is identity data (slug, name, icon,
//! description, an optional external reference) pointing at one ordinary category; the channels under that category
//! are its channels and access is plain server permissions. Manage Channels creates and edits; the owner or an Administrator deletes.

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
        .route("/guilds/:id/communities/:slug/managers", get(list_managers))
        .route("/guilds/:id/communities/:slug/managers/:target", axum::routing::put(add_manager).delete(remove_manager))
}

const COLS: &str = "id, guild_id, slug, name, icon_url, description, banner_url, about, links, external_ref, category_id, last_activity_at, created_at";
/// What a community manager holds on the community's category and on those of its channels that carry their own entries.
pub const MANAGER_BITS: u64 = perms::MANAGE_CHANNELS | perms::MANAGE_MESSAGES | perms::MANAGE_THREADS;
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

/// Empty clears; otherwise an image the same way `icon_url` is checked.
fn clean_image(v: Option<String>) -> AppResult<Option<String>> {
    crate::routes::users::validate_image(&v)?;
    Ok(v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
}

fn clean_about(s: &str) -> AppResult<String> {
    // Leading whitespace is kept: formatted text may start with an indented block.
    let a = s.trim_end();
    if a.chars().count() > 4000 { return Err(AppError::BadRequest("About must be at most 4000 characters".into())) }
    Ok(a.to_string())
}

#[derive(Deserialize)]
struct LinkIn { #[serde(default)] label: String, #[serde(default)] url: String }

/// http or https (any case), a host, no whitespace or control characters, at most 500 characters.
fn valid_link(url: &str) -> bool {
    url.chars().count() <= 500
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
        && url::Url::parse(url).is_ok_and(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some_and(|h| !h.is_empty()))
}

/// At most 10 links, each a label of 1-80 characters and an http(s) URL of up to 500; unknown keys are dropped.
fn clean_links(links: Vec<LinkIn>) -> AppResult<Value> {
    if links.len() > 10 { return Err(AppError::BadRequest("At most 10 links".into())) }
    let mut out = vec![];
    for l in links {
        let (label, url) = (l.label.trim(), l.url.trim());
        if label.is_empty() || label.chars().count() > 80 { return Err(AppError::BadRequest("A link label must be 1-80 characters".into())) }
        if !valid_link(url) { return Err(AppError::BadRequest("A link must be an http(s) URL with a host, at most 500 characters, without spaces".into())) }
        out.push(json!({ "label": label, "url": url }));
    }
    Ok(Value::Array(out))
}

fn taken(e: sqlx::Error) -> AppError {
    match e { sqlx::Error::Database(d) if d.is_unique_violation() => AppError::Conflict(TAKEN.into()), e => e.into() }
}

fn slim(c: &Community) -> Value {
    json!({ "id": c.id, "guild_id": c.guild_id, "slug": c.slug, "name": c.name, "icon_url": c.icon_url, "description": c.description, "banner_url": c.banner_url, "category_id": c.category_id })
}

/// The community for the caller: counts, whether they follow it and the child channels they can view. `None` when the
/// caller cannot view its category (the same decision channel listing makes).
async fn hydrate(state: &AppState, c: Community, uid: Uuid) -> AppResult<Option<Community>> {
    let v = view(state, c.guild_id, uid).await?;
    if !v.visible.iter().any(|x| x.id == c.category_id) { return Ok(None) }
    Ok(Some(fill(state, c, uid, &v).await?))
}

/// One load of a server for one caller: its permission context, every channel (with overwrites) and the ones they can view.
struct View { ctx: perms::GuildCtx, all: Vec<Channel>, visible: Vec<Channel> }

async fn view(state: &AppState, gid: Uuid, uid: Uuid) -> AppResult<View> {
    let ctx = perms::GuildCtx::load(&state.db, gid).await?;
    let all = perms::guild_channels(&state.db, gid).await?;
    let visible = match ctx.base(uid) { Some(base) => all.iter().filter(|c| perms::has(ctx.in_channel(uid, base, &c.overwrites), perms::VIEW_CHANNEL)).cloned().collect(), None => vec![] };
    Ok(View { ctx, all, visible })
}

/// `hydrate` without the visibility gate: what the caller who just wrote the community gets back.
async fn fill(state: &AppState, mut c: Community, uid: Uuid, v: &View) -> AppResult<Community> {
    let mut kids: Vec<&Channel> = v.visible.iter().filter(|v| v.parent_id == Some(c.category_id)).collect();
    kids.sort_by_key(|k| (k.position, k.created_at));
    c.channel_ids = kids.into_iter().map(|k| k.id).collect();
    let (followers, on, me): (i64, i64, bool) = sqlx::query_as(&format!(
        "SELECT COUNT(*), COUNT(*) FILTER (WHERE user_id IN ({})), COALESCE(bool_or(user_id = $2), false) FROM community_follows WHERE community_id = $1", crate::ws::bus::visible_online_sql()))
        .bind(c.id).bind(uid).fetch_one(&state.db).await?;
    (c.follower_count, c.online_count, c.following) = (followers, on, me);
    set_flags(&mut c, &v.ctx, uid, &v.all);
    Ok(c)
}

/// The caller's flags. Manage Channels is computed in the category's own overwrites, as `manage_in_category` does.
/// `all` is every channel with overwrites (`in_channel` gives nothing in one the caller cannot view).
fn set_flags(c: &mut Community, ctx: &perms::GuildCtx, uid: Uuid, all: &[Channel]) {
    let Some(base) = ctx.base(uid) else { return };
    c.can_delete = perms::has(base, perms::ADMINISTRATOR);
    c.can_edit = all.iter().find(|v| v.id == c.category_id).is_some_and(|cat| perms::has(ctx.in_channel(uid, base, &cat.overwrites), perms::MANAGE_CHANNELS));
    // The same plan an appointment runs (category and children with entries of their own), for a fresh member target.
    c.can_manage_managers = c.can_edit && plan_entries(ctx, uid, all, c.category_id, "member", uid, true, true, |(a, d)| (a | MANAGER_BITS, d & !MANAGER_BITS)).is_ok();
}

async fn written(state: &AppState, c: Community, uid: Uuid) -> AppResult<Community> {
    let v = view(state, c.guild_id, uid).await?;
    fill(state, c, uid, &v).await
}

/// Manage Channels as computed in this channel (its overwrites apply), as `PATCH`/`DELETE /channels/:id` check it.
/// A channel the caller cannot view is a 404, like there.
async fn manage_in_category(state: &AppState, channel_id: Uuid, uid: Uuid) -> AppResult<()> {
    let (_, p) = super::channels::require_channel_perms(&state.db, channel_id, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)
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
struct CreateIn { slug: String, name: String, #[serde(default)] description: String, icon_url: Option<String>, banner_url: Option<String>, #[serde(default)] about: String, #[serde(default)] links: Vec<LinkIn>, external_ref: Option<String>, channels: Option<Vec<NewChannel>> }

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
    let banner = clean_image(req.banner_url)?;
    let about = clean_about(&req.about)?;
    let links = clean_links(req.links)?;
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
        "INSERT INTO communities (id, guild_id, slug, name, icon_url, description, banner_url, about, links, external_ref, category_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING {COLS}"))
        .bind(Uuid::now_v7()).bind(gid).bind(&req.slug).bind(&name).bind(&icon).bind(&description).bind(&banner).bind(&about).bind(&links).bind(&ext).bind(category.id).bind(uid)
        .fetch_one(&mut *tx).await.map_err(taken)?;
    // The creator follows it, unless they are a bot (which has no sidebar to put it in).
    let is_bot: bool = sqlx::query_scalar("SELECT bot FROM users WHERE id = $1").bind(uid).fetch_one(&mut *tx).await?;
    if !is_bot { sqlx::query("INSERT INTO community_follows (community_id, user_id) VALUES ($1, $2)").bind(c.id).bind(uid).execute(&mut *tx).await?; }
    tx.commit().await?;
    let mut category = category;
    let target = audience(&state, &mut category).await?;
    let out = written(&state, c.clone(), uid).await?;
    state.hub.emit(target.clone(), "CHANNEL_CREATE", json!(category));
    for ch in &created { state.hub.emit(target.clone(), "CHANNEL_CREATE", json!(ch)); }
    state.hub.emit(target, "COMMUNITY_CREATE", slim(&c));
    if !is_bot { state.hub.emit_users(vec![uid], "COMMUNITY_FOLLOW_UPDATE", json!({ "guild_id": gid, "community_id": c.id, "following": true })); }
    crate::audit::guild(&state, gid, uid, "community.create", "community", Some(c.id), &c.name, json!({ "slug": c.slug, "channels": created.len() })).await;
    Ok((StatusCode::CREATED, Json(out)))
}

/// `GET /guilds/:id/communities/:slug`.
async fn get_one(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, slug)): Path<(Uuid, String)>) -> AppResult<Json<Community>> {
    require_member(&state.db, gid, uid).await?;
    let c = by_slug(&state, gid, &slug).await?;
    hydrate(&state, c, uid).await?.map(Json).ok_or_else(|| AppError::NotFound("Community not found".into()))
}

#[derive(Deserialize)]
struct PatchIn { slug: Option<String>, name: Option<String>, description: Option<String>, icon_url: Option<String>, banner_url: Option<String>, about: Option<String>, links: Option<Vec<LinkIn>>, external_ref: Option<String> }

/// `PATCH /guilds/:id/communities/:slug`: any of slug, name (renames the category too), description, icon_url,
/// banner_url, about, links (replaced as a whole), external_ref. Empty icon_url, banner_url or external_ref clears it.
async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, slug)): Path<(Uuid, String)>, Json(req): Json<PatchIn>) -> AppResult<Json<Community>> {
    let cur = by_slug(&state, gid, &slug).await?;
    manage_in_category(&state, cur.category_id, uid).await?;
    let new_slug = match req.slug { Some(s) if !valid_slug(&s) => return Err(AppError::BadRequest("Address must be lower-case letters, digits and dashes, starting with a letter or digit, up to 63 characters".into())), Some(s) => s, None => cur.slug.clone() };
    let name = match &req.name { Some(n) => clean_name(n)?, None => cur.name.clone() };
    let description = match &req.description { Some(d) => clean_description(d)?, None => cur.description.clone() };
    crate::routes::users::validate_image(&req.icon_url)?;
    let icon = match req.icon_url { Some(i) => Some(i.trim().to_string()).filter(|s| !s.is_empty()), None => cur.icon_url.clone() };
    let banner = match req.banner_url { Some(b) => clean_image(Some(b))?, None => cur.banner_url.clone() };
    let about = match &req.about { Some(a) => clean_about(a)?, None => cur.about.clone() };
    let links = match req.links { Some(l) => clean_links(l)?, None => cur.links.clone() };
    let ext = match req.external_ref { Some(e) => clean_opt(Some(e), 200, "External reference")?, None => cur.external_ref.clone() };
    let mut tx = state.db.begin().await?;
    let c: Community = sqlx::query_as(&format!("UPDATE communities SET slug = $2, name = $3, description = $4, icon_url = $5, external_ref = $6, banner_url = $7, about = $8, links = $9 WHERE id = $1 RETURNING {COLS}"))
        .bind(cur.id).bind(&new_slug).bind(&name).bind(&description).bind(&icon).bind(&ext).bind(&banner).bind(&about).bind(&links).fetch_one(&mut *tx).await.map_err(taken)?;
    let mut category: Channel = sqlx::query_as(&format!("UPDATE channels SET name = $2 WHERE id = $1 RETURNING {CHANNEL_COLS}")).bind(cur.category_id).bind(&name).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    let target = audience(&state, &mut category).await?;
    let out = written(&state, c.clone(), uid).await?;
    if name != cur.name { state.hub.emit(target.clone(), "CHANNEL_UPDATE", json!(category)); }
    state.hub.emit(target, "COMMUNITY_UPDATE", slim(&c));
    let mut details = json!({ "slug": c.slug });
    if c.name != cur.name { details["old_name"] = json!(cur.name) }
    if c.slug != cur.slug { details["old_slug"] = json!(cur.slug) }
    let changed: Vec<&str> = [("banner_url", c.banner_url != cur.banner_url), ("about", c.about != cur.about), ("links", c.links != cur.links)].into_iter().filter(|(_, d)| *d).map(|(n, _)| n).collect();
    if !changed.is_empty() { details["changed"] = json!(changed) }
    crate::audit::guild(&state, gid, uid, "community.update", "community", Some(c.id), &c.name, details).await;
    Ok(Json(out))
}

/// `DELETE /guilds/:id/communities/:slug`: its channels go the way a single deleted channel does (threads, uploads,
/// events), then the category, which takes the community row with it.
async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, slug)): Path<(Uuid, String)>) -> AppResult<StatusCode> {
    let c = by_slug(&state, gid, &slug).await?;
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    if !perms::has(p, perms::ADMINISTRATOR) {
        // A community the caller cannot view is a 404, not a 403.
        super::channels::require_channel_perms(&state.db, c.category_id, uid).await?;
        return Err(AppError::Forbidden);
    }
    let mut category: Channel = sqlx::query_as(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(c.category_id).fetch_one(&state.db).await?;
    let target = audience(&state, &mut category).await?;
    let kids: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM channels WHERE parent_id = $1 ORDER BY position, created_at").bind(c.category_id).fetch_all(&state.db).await?;
    // The server keeps a text channel, as for DELETE /channels/:id.
    let (outside, inside): (i64, i64) = sqlx::query_as("SELECT COUNT(*) FILTER (WHERE parent_id IS DISTINCT FROM $2), COUNT(*) FILTER (WHERE parent_id = $2) FROM channels WHERE guild_id = $1 AND kind = 'text'")
        .bind(gid).bind(c.category_id).fetch_one(&state.db).await?;
    if outside == 0 && inside > 0 { return Err(AppError::BadRequest("A server must keep at least one text channel".into())) }
    for (id,) in &kids { super::channels::remove_channel(&state, gid, *id).await?; }
    super::channels::remove_channel(&state, gid, c.category_id).await?;
    state.hub.emit(target, "COMMUNITY_DELETE", json!({ "id": c.id, "guild_id": gid }));
    crate::audit::guild(&state, gid, uid, "community.delete", "community", Some(c.id), &c.name, json!({ "slug": c.slug, "channels": kids.len() })).await;
    Ok(StatusCode::NO_CONTENT)
}

/// A new message under a community's category (directly, or in a thread of one of its channels) is activity.
/// Debounced in SQL: a busy channel rewrites the row at most every 10 seconds. Failures only warn; the message is sent.
pub async fn touch_activity(db: &sqlx::PgPool, channel_id: Uuid) {
    let r = sqlx::query(
        "UPDATE communities SET last_activity_at = now() WHERE (last_activity_at IS NULL OR last_activity_at < now() - interval '10 seconds') AND category_id IN (
           SELECT parent_id FROM channels WHERE id = $1
           UNION SELECT p.parent_id FROM channels c JOIN channels p ON p.id = c.parent_id WHERE c.id = $1)")
        .bind(channel_id).execute(db).await;
    if let Err(e) = r { tracing::warn!(error = ?e, %channel_id, "community activity update failed") }
}

/// `touch_activity` off the request path: sending a message does not wait for it.
pub fn touch_activity_bg(db: &sqlx::PgPool, channel_id: Uuid) {
    let db = db.clone();
    tokio::spawn(async move { touch_activity(&db, channel_id).await });
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
    let vw = view(&state, gid, uid).await?;
    let visible = &vw.visible;
    let cats: Vec<Uuid> = visible.iter().filter(|v| v.kind == "category").map(|v| v.id).collect();
    let key = "COALESCE(last_activity_at, 'epoch'::timestamptz)";
    // One keyset comparison per sort; name then id break ties so pages never repeat or skip an item.
    let (after, order) = if by_name {
        ("($5::text IS NULL OR (name, id) > ($5, $6::uuid))".to_string(), "name, id".to_string())
    } else {
        (format!("($5::timestamptz IS NULL OR {key} < $5 OR ({key} = $5 AND (name, id) > ($6::text, $7::uuid)))"), format!("{key} DESC, name, id"))
    };
    let sql = format!(
        "SELECT {COLS} FROM communities WHERE guild_id = $1 AND category_id = ANY($2)
           AND ($3::text IS NULL OR position(lower($3) in lower(name)) > 0) AND ($4::text IS NULL OR external_ref = $4) AND {after}
         ORDER BY {order} LIMIT {}", limit + 1);
    let needle = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let query = sqlx::query_as::<_, Community>(&sql).bind(gid).bind(&cats).bind(needle).bind(q.external_ref.as_deref().filter(|s| !s.is_empty()));
    let (n, i) = (cur.as_ref().map(|c| c.n.clone()), cur.as_ref().map(|c| c.i));
    let mut rows: Vec<Community> = if by_name {
        query.bind(n).bind(i).fetch_all(&state.db).await?
    } else {
        let at = match &cur { Some(c) => Some(DateTime::from_timestamp_micros(c.t).ok_or_else(bad_cursor)?), None => None };
        query.bind(at).bind(n).bind(i).fetch_all(&state.db).await?
    };
    let next = if rows.len() as i64 > limit {
        rows.truncate(limit as usize);
        let l = rows.last().unwrap();
        let t = l.last_activity_at.map(|t| t.timestamp_micros()).unwrap_or(0);
        Some(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&Cursor { s: sort.into(), t, n: l.name.clone(), i: l.id }).unwrap()))
    } else { None };
    let ids: Vec<Uuid> = rows.iter().map(|c| c.id).collect();
    let counts: Vec<(Uuid, i64, i64, bool)> = sqlx::query_as(&format!(
        "SELECT community_id, COUNT(*), COUNT(*) FILTER (WHERE user_id IN ({})), COALESCE(bool_or(user_id = $2), false) FROM community_follows WHERE community_id = ANY($1) GROUP BY community_id", crate::ws::bus::visible_online_sql()))
        .bind(&ids).bind(uid).fetch_all(&state.db).await?;
    let counts: std::collections::HashMap<Uuid, (i64, i64, bool)> = counts.into_iter().map(|(id, f, o, m)| (id, (f, o, m))).collect();
    let mut kids: std::collections::HashMap<Uuid, Vec<&Channel>> = std::collections::HashMap::new();
    for v in visible { if let Some(p) = v.parent_id { kids.entry(p).or_default().push(v) } }
    for c in rows.iter_mut() {
        set_flags(c, &vw.ctx, uid, &vw.all);
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

/// The slim form of the community a category backs, if any (for visibility changes).
pub async fn slim_for_categories(db: &sqlx::PgPool, category_ids: &[Uuid]) -> AppResult<std::collections::HashMap<Uuid, Value>> {
    if category_ids.is_empty() { return Ok(Default::default()) }
    let cs: Vec<Community> = sqlx::query_as(&format!("SELECT {COLS} FROM communities WHERE category_id = ANY($1)")).bind(category_ids).fetch_all(db).await?;
    Ok(cs.iter().map(|c| (c.category_id, slim(c))).collect())
}

/// Which of `users` follow community `community_id`, in one query.
pub async fn followers_among(db: &sqlx::PgPool, community_id: Uuid, users: &[Uuid]) -> AppResult<Vec<Uuid>> {
    Ok(sqlx::query_scalar("SELECT user_id FROM community_follows WHERE community_id = $1 AND user_id = ANY($2)").bind(community_id).bind(users).fetch_all(db).await?)
}

/// A server payload (GUILD_CREATE, the join responses) plus the communities `uid` can see there and the ones they
/// follow, so a member who joins mid-session hides unfollowed community categories from the first frame.
/// `visible` is every channel they can view in the server. Failures only warn, as for the connect payload.
pub async fn with_communities(db: &sqlx::PgPool, uid: Uuid, gid: Uuid, visible: &[Channel], mut extra: Value) -> Value {
    let (communities, follows) = connect_payload(db, uid, &[gid], visible).await.unwrap_or_else(|e| { tracing::warn!(error = ?e, "communities payload failed"); Default::default() });
    let follows = follows.first().map(|f| f["community_ids"].clone()).unwrap_or_else(|| json!([]));
    if let Some(o) = extra.as_object_mut() {
        o.insert("communities".into(), json!(communities));
        o.insert("community_follows".into(), follows);
    }
    extra
}

/// The community, for a caller who can view it: a community they cannot view is a 404 like an unknown one, while
/// failures that are not about visibility (database, server unavailable) stay what they are.
async fn viewable_community(state: &AppState, gid: Uuid, uid: Uuid, slug: &str) -> AppResult<Community> {
    require_member(&state.db, gid, uid).await?;
    let c = by_slug(state, gid, slug).await?;
    match super::channels::require_channel_perms(&state.db, c.category_id, uid).await {
        Ok(_) => Ok(c),
        Err(AppError::NotFound(_) | AppError::Forbidden) => Err(AppError::NotFound("Community not found".into())),
        Err(e) => Err(e),
    }
}

/// `GET /guilds/:id/communities/:slug/managers`: the members and roles whose entry on the category allows Manage
/// Channels. A community the caller cannot view is a 404.
async fn list_managers(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, slug)): Path<(Uuid, String)>) -> AppResult<Json<Value>> {
    let c = viewable_community(&state, gid, uid, &slug).await?;
    let members: Vec<(Uuid, String, Option<String>)> = sqlx::query_as(
        "SELECT u.id, COALESCE(NULLIF(m.nickname, ''), u.display_name), u.avatar_url FROM channel_overwrites o
         JOIN guild_members m ON m.user_id = o.target_id AND m.guild_id = $2 JOIN users u ON u.id = m.user_id
         WHERE o.channel_id = $1 AND o.target_kind = 'member' AND (o.allow & $3) <> 0 AND u.account_state = 'active' ORDER BY 2, u.id")
        .bind(c.category_id).bind(gid).bind(perms::MANAGE_CHANNELS as i64).fetch_all(&state.db).await?;
    let roles: Vec<(Uuid, String, Option<String>)> = sqlx::query_as(
        "SELECT r.id, r.name, r.color FROM channel_overwrites o JOIN roles r ON r.id = o.target_id AND r.guild_id = $2
         WHERE o.channel_id = $1 AND o.target_kind = 'role' AND (o.allow & $3) <> 0 ORDER BY r.position DESC, r.name, r.id")
        .bind(c.category_id).bind(gid).bind(perms::MANAGE_CHANNELS as i64).fetch_all(&state.db).await?;
    Ok(Json(json!({
        "members": members.into_iter().map(|(id, display_name, avatar_url)| json!({ "id": id, "display_name": display_name, "avatar_url": avatar_url })).collect::<Vec<_>>(),
        "roles": roles.into_iter().map(|(id, name, color)| json!({ "id": id, "name": name, "color": color })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
struct ManagerIn { kind: String }

/// One entry change: the channel and the entry after (`None`: the row goes).
struct EntryChange { channel: Channel, new: Option<(u64, u64)> }

/// Plan `f` over the target's entry on the category and on each child with entries of its own, every one authorised by
/// the shared entry rule with the caller's permissions in that channel. `creating` also covers children where the
/// target has no entry yet (appointing); otherwise only where it has one. `fresh` ignores the target's current entries
/// (the question "could I appoint someone new"). A child never loses its own-entries state by this: clearing the
/// last bits of its only entry keeps the row, empty, so it does not start following the category.
/// Nothing is written here.
fn plan_entries(ctx: &perms::GuildCtx, uid: Uuid, all: &[Channel], category_id: Uuid, kind: &str, target: Uuid, creating: bool, fresh: bool, f: impl Fn((u64, u64)) -> (u64, u64)) -> AppResult<Vec<EntryChange>> {
    let base = ctx.base(uid).ok_or_else(|| AppError::NotFound("Server not found".into()))?;
    let mut out = vec![];
    for ch in all.iter().filter(|c| c.id == category_id || (c.parent_id == Some(category_id) && c.permissions_synced == Some(false))) {
        let is_category = ch.id == category_id;
        let own = if fresh { None } else { ch.overwrites.iter().find(|o| o.target_id == target).cloned() };
        if !is_category && own.is_none() && !creating { continue }
        let old = own.as_ref().map(|o| (o.allow as u64, o.deny as u64)).unwrap_or((0, 0));
        let (allow, deny) = f(old);
        let new = if (allow, deny) != (0, 0) { Some((allow, deny)) } else if is_category || ch.overwrites.iter().any(|o| o.target_id != target) { None } else { Some((0, 0)) };
        let p = ctx.in_channel(uid, base, &ch.overwrites);
        super::channels::check_overwrite_edit(ctx, uid, p, own.as_ref(), kind, target, Some((allow, deny)), !creating)?;
        let changed = match (&own, new) { (Some(_), None) => true, (None, None) => false, (_, Some(n)) => n != old };
        if changed { out.push(EntryChange { channel: ch.clone(), new }) }
    }
    Ok(out)
}

/// Write the planned changes in one transaction, relative to what the rows hold at that moment (so a concurrent edit
/// of other bits survives), then one visibility resync and one audit entry per channel changed.
async fn write_entries(state: &AppState, gid: Uuid, uid: Uuid, kind: &str, target: Uuid, add: bool, changes: Vec<EntryChange>) -> AppResult<()> {
    if changes.is_empty() { return Ok(()) }
    let before = perms::visibility(&state.db, gid).await?;
    let bits = MANAGER_BITS as i64;
    let mut tx = state.db.begin().await?;
    for ch in &changes {
        if add {
            sqlx::query(
                "INSERT INTO channel_overwrites (channel_id, target_id, target_kind, allow, deny) VALUES ($1, $2, $3, $4, 0)
                 ON CONFLICT (channel_id, target_id) DO UPDATE SET allow = channel_overwrites.allow | $4, deny = channel_overwrites.deny & ~$4")
                .bind(ch.channel.id).bind(target).bind(kind).bind(bits).execute(&mut *tx).await?;
        } else {
            sqlx::query("UPDATE channel_overwrites SET allow = allow & ~$3 WHERE channel_id = $1 AND target_id = $2").bind(ch.channel.id).bind(target).bind(bits).execute(&mut *tx).await?;
            if ch.new.is_none() { sqlx::query("DELETE FROM channel_overwrites WHERE channel_id = $1 AND target_id = $2 AND allow = 0 AND deny = 0").bind(ch.channel.id).bind(target).execute(&mut *tx).await?; }
        }
    }
    tx.commit().await?;
    perms::resync_visibility(state, gid, &before).await?;
    for ch in &changes {
        match ch.new {
            Some((allow, deny)) => crate::audit::guild(state, gid, uid, "channel.overwrite", "channel", Some(ch.channel.id), &ch.channel.name, json!({ "target": target, "kind": kind, "allow": allow, "deny": deny })).await,
            None => crate::audit::guild(state, gid, uid, "channel.overwrite_delete", "channel", Some(ch.channel.id), &ch.channel.name, json!({ "target": target })).await,
        }
    }
    Ok(())
}

/// `PUT /guilds/:id/communities/:slug/managers/:target` `{ kind }`: the target gains the manager bits on the category
/// and on each of its channels that has entries of its own (the others follow the category). Other bits are kept.
async fn add_manager(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, slug, target)): Path<(Uuid, String, Uuid)>, Json(req): Json<ManagerIn>) -> AppResult<StatusCode> {
    let c = viewable_community(&state, gid, uid, &slug).await?;
    // @everyone is the role with the server's id: appointing it would make every member a manager.
    if target == gid { return Err(AppError::BadRequest("Everyone can't be a community manager".into())) }
    let v = view(&state, gid, uid).await?;
    let changes = plan_entries(&v.ctx, uid, &v.all, c.category_id, &req.kind, target, true, false, |(a, d)| (a | MANAGER_BITS, d & !MANAGER_BITS))?;
    write_entries(&state, gid, uid, &req.kind, target, true, changes).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `DELETE /guilds/:id/communities/:slug/managers/:target`: the manager bits leave the allow of the same entries; an
/// entry left empty is removed (on a child only while it has other entries, so it keeps its own-entries state).
/// Works for a target that is gone (a member who left, a deleted role) as long as an entry names it.
async fn remove_manager(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, slug, target)): Path<(Uuid, String, Uuid)>) -> AppResult<StatusCode> {
    let c = viewable_community(&state, gid, uid, &slug).await?;
    let v = view(&state, gid, uid).await?;
    let kind = if v.ctx.roles.contains_key(&target) { "role" } else { "member" };
    let changes = plan_entries(&v.ctx, uid, &v.all, c.category_id, kind, target, false, false, |(a, d)| (a & !MANAGER_BITS, d))?;
    write_entries(&state, gid, uid, kind, target, false, changes).await?;
    Ok(StatusCode::NO_CONTENT)
}
