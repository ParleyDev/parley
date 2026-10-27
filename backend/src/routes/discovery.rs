//! Discover: servers submit a listing (description, category, banner) from Server Settings;
//! Parley admins approve or reject; approved listings are browsable and joinable by anyone.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    perms,
    routes::{guilds::{fetch_member, is_banned, GUILD_COLS}, users::{require_admin, validate_image_max}},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

pub const CATEGORIES: &[&str] = &["gaming", "music", "entertainment", "science_tech", "education", "student_hubs", "community"];
const MAX_DESCRIPTION: usize = 300;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/discover", get(browse))
        .route("/discover/stages", get(live_stages))
        .route("/discover/:gid/join", post(join))
        .route("/discover/:gid/preview", get(preview))
        .route("/discover/:gid/channels/:cid/messages", get(preview_messages))
        .route("/guilds/:id/discovery", get(get_listing).put(put_listing).delete(delete_listing))
        .route("/admin/discovery", get(admin_list))
        .route("/admin/discovery/:gid/review", post(review))
        .route("/admin/discovery/:gid", axum::routing::patch(admin_update))
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Listing {
    pub guild_id: Uuid,
    pub name: String,
    pub icon_url: Option<String>,
    pub description: String,
    pub category: String,
    pub banner_url: Option<String>,
    pub status: String,
    pub note: String,
    pub submitted_at: DateTime<Utc>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub member_count: i64,
    /// Admin-chosen spot on the Discover home page (lower first); null = not featured.
    #[sqlx(default)]
    #[serde(default)]
    pub featured_order: Option<i32>,
    /// Admin-granted badge: the instance vouches for this server (more than being approved for listing).
    #[sqlx(default)]
    #[serde(default)]
    pub verified: bool,
    #[sqlx(default)]
    #[serde(default)]
    pub partnered: bool,
    #[sqlx(skip)]
    #[serde(default)]
    pub online_count: i64,
    #[sqlx(skip)]
    #[serde(default)]
    pub joined: bool,
}

const LISTING_SELECT: &str = "SELECT d.guild_id, g.name, g.icon_url, d.description, d.category, COALESCE(d.banner_url, g.banner_url) AS banner_url, d.status, d.note, d.submitted_at, d.reviewed_at,
    d.featured_order, d.verified, g.partnered,
    (SELECT COUNT(*) FROM guild_members m WHERE m.guild_id = d.guild_id) AS member_count
    FROM guild_discovery d JOIN guilds g ON g.id = d.guild_id";

/// Fill in live online counts and whether the caller is a member.
async fn decorate(state: &AppState, uid: Uuid, mut rows: Vec<Listing>) -> AppResult<Vec<Listing>> {
    if rows.is_empty() {
        return Ok(rows);
    }
    let online = crate::ws::bus::online_users(&state.db).await;
    let ids: Vec<Uuid> = rows.iter().map(|l| l.guild_id).collect();
    // One grouped query for every listing on the page instead of two per row.
    let stats: Vec<(Uuid, i64, bool)> = sqlx::query_as(
        "SELECT guild_id, COUNT(*) FILTER (WHERE user_id = ANY($2)), bool_or(user_id = $3)
         FROM guild_members WHERE guild_id = ANY($1) GROUP BY guild_id",
    )
    .bind(&ids)
    .bind(&online)
    .bind(uid)
    .fetch_all(&state.db)
    .await?;
    let by_guild: std::collections::HashMap<Uuid, (i64, bool)> = stats.into_iter().map(|(g, n, j)| (g, (n, j))).collect();
    for l in &mut rows {
        let (n, joined) = by_guild.get(&l.guild_id).copied().unwrap_or((0, false));
        l.online_count = n;
        l.joined = joined;
    }
    Ok(rows)
}

#[derive(Deserialize)]
struct BrowseQuery {
    category: Option<String>,
    #[serde(default)]
    q: String,
}

/// Approved listings, optionally filtered by category and a search term; most members first.
async fn browse(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<BrowseQuery>) -> AppResult<Json<Vec<Listing>>> {
    let term = q.q.trim().replace('%', "\\%").replace('_', "\\_");
    let pattern = if term.is_empty() { None } else { Some(format!("%{term}%")) };
    let category = q.category.filter(|c| CATEGORIES.contains(&c.as_str()));
    let rows = sqlx::query_as::<_, Listing>(&format!(
        "{LISTING_SELECT} WHERE d.status = 'approved' AND ($1::text IS NULL OR d.category = $1)
           AND ($2::text IS NULL OR g.name ILIKE $2 OR d.description ILIKE $2)
         ORDER BY d.featured_order ASC NULLS LAST, member_count DESC, g.name LIMIT 100"
    ))
    .bind(category)
    .bind(pattern)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(decorate(&state, uid, rows).await?))
}

/// `GET /discover/stages`: stages live right now (someone on stage) in your servers and in Discover servers whose
/// stage everyone can see. Most listeners first.
async fn live_stages(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Value>>> {
    let gids: Vec<Uuid> = sqlx::query_as::<_, (Uuid,)>(
        "SELECT guild_id FROM guild_discovery WHERE status = 'approved' UNION SELECT guild_id FROM guild_members WHERE user_id = $1",
    ).bind(uid).fetch_all(&state.db).await?.into_iter().map(|r| r.0).collect();
    let states = state.hub.voice_states_for_guilds(&gids);
    let mut by_channel: std::collections::HashMap<Uuid, Vec<&crate::ws::hub::VoiceState>> = std::collections::HashMap::new();
    for v in &states { by_channel.entry(v.channel_id).or_default().push(v); }
    let ids: Vec<Uuid> = by_channel.keys().copied().collect();
    let chans: Vec<(Uuid, Uuid, String, String, String, Option<String>, bool)> = sqlx::query_as(
        "SELECT c.id, c.guild_id, c.name, c.topic, g.name, g.icon_url, EXISTS (SELECT 1 FROM guild_members m WHERE m.guild_id = c.guild_id AND m.user_id = $2)
         FROM channels c JOIN guilds g ON g.id = c.guild_id WHERE c.id = ANY($1) AND c.kind = 'stage'",
    ).bind(&ids).bind(uid).fetch_all(&state.db).await?;
    let mut out = Vec::new();
    for (cid, gid, name, topic, gname, gicon, member) in chans {
        let vs = &by_channel[&cid];
        let speakers: Vec<Uuid> = vs.iter().filter(|v| !v.suppress).map(|v| v.user_id).collect();
        if speakers.is_empty() { continue; }
        // You see a stage you can see: as a member, by your own permissions; otherwise only if @everyone can.
        let p = if member {
            match crate::routes::channels::require_channel_perms(&state.db, cid, uid).await { Ok((_, p)) => p, Err(_) => 0 }
        } else {
            let ctx = perms::GuildCtx::load(&state.db, gid).await?;
            let everyone = ctx.roles.get(&gid).map(|r| r.permissions as u64).unwrap_or(0);
            perms::guild_channels(&state.db, gid).await?.into_iter().find(|c| c.id == cid).map(|c| ctx.in_channel(Uuid::nil(), everyone, &c.overwrites)).unwrap_or(0)
        };
        if !perms::has(p, perms::VIEW_CHANNEL) || !perms::has(p, perms::CONNECT) { continue; }
        let people: Vec<(Uuid, String, Option<String>)> = sqlx::query_as("SELECT id, display_name, avatar_url FROM users WHERE id = ANY($1)").bind(&speakers[..speakers.len().min(5)]).fetch_all(&state.db).await?;
        out.push(json!({
            "guild": { "id": gid, "name": gname, "icon_url": gicon }, "channel": { "id": cid, "name": name, "topic": topic },
            "member": member, "listeners": vs.len(), "speaker_count": speakers.len(),
            "speakers": people.into_iter().map(|(id, n, a)| json!({ "id": id, "display_name": n, "avatar_url": a })).collect::<Vec<_>>(),
        }));
    }
    out.sort_by_key(|v| std::cmp::Reverse(v["listeners"].as_u64().unwrap_or(0)));
    out.truncate(50);
    Ok(Json(out))
}

/// Join an approved server from Discover (no invite needed).
async fn join(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Value>> {
    crate::routes::users::require_verified(&state, uid).await?;
    let approved: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_discovery WHERE guild_id = $1 AND status = 'approved'").bind(gid).fetch_optional(&state.db).await?;
    if approved.is_none() {
        return Err(AppError::NotFound("Server not found in Discover".into()));
    }
    if is_banned(&state.db, gid, uid).await? {
        return Err(AppError::BadRequest("You are banned from this server".into()));
    }
    if crate::routes::invites::invites_paused(&state.db, gid, uid).await? {
        return Err(AppError::BadRequest("This server has paused new members right now".into()));
    }
    let inserted = sqlx::query("INSERT INTO guild_members (guild_id, user_id, joined_via) VALUES ($1, $2, 'discover') ON CONFLICT DO NOTHING")
        .bind(gid)
        .bind(uid)
        .execute(&state.db)
        .await?
        .rows_affected();
    if inserted > 0 { crate::routes::users::apply_join_defaults(&state.db, uid, gid).await; }
    let guild = sqlx::query_as::<_, crate::models::Guild>(&format!("SELECT {GUILD_COLS} FROM guilds WHERE id = $1")).bind(gid).fetch_one(&state.db).await?;
    let channels = perms::visible_channels(&state.db, gid, uid).await?;
    let roles = perms::list_roles(&state.db, gid).await?;
    let emojis = crate::routes::expressions::emojis_for_guilds(&state.db, &[gid]).await?;
    let stickers = crate::routes::expressions::stickers_for_guilds(&state.db, &[gid]).await?;
    let payload = crate::routes::guilds::guild_payload(&guild, json!({ "channels": channels, "roles": roles, "emojis": emojis, "stickers": stickers }));
    if inserted > 0 {
        state.hub.emit_users(vec![uid], "GUILD_CREATE", payload.clone());
        if let Ok(member) = fetch_member(&state.db, gid, uid).await {
            state.hub.emit_guild(gid, "GUILD_MEMBER_ADD", json!(member));
        }
        if let Err(e) = crate::routes::channels::guild_system_message(&state, gid, uid, "member_join", "joined the server.").await {
            tracing::warn!(error = ?e, "join notice failed");
        }
        crate::routes::safety::after_join(&state, gid, uid).await;
    }
    Ok(Json(payload))
}

/// Text channels of an approved Discover server that @everyone may view (what a non-member sees in preview).
async fn public_channels(db: &PgPool, gid: Uuid) -> AppResult<(perms::GuildCtx, Vec<crate::models::Channel>)> {
    let approved: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_discovery WHERE guild_id = $1 AND status = 'approved'").bind(gid).fetch_optional(db).await?;
    if approved.is_none() {
        return Err(AppError::NotFound("Server not found in Discover".into()));
    }
    let ctx = perms::GuildCtx::load(db, gid).await?;
    let everyone = ctx.roles.get(&gid).map(|r| r.permissions as u64).unwrap_or(0);
    let channels = perms::guild_channels(db, gid).await?
        .into_iter()
        .filter(|c| c.kind == "text" && perms::has(ctx.in_channel(Uuid::nil(), everyone, &c.overwrites), perms::VIEW_CHANNEL))
        .collect();
    Ok((ctx, channels))
}

/// Discord-style preview for non-members: the server, its public text channels and the listing.
async fn preview(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Value>> {
    let (ctx, channels) = public_channels(&state.db, gid).await?;
    let listing = listing_for(&state, uid, gid).await?;
    Ok(Json(json!({ "guild": ctx.guild, "channels": channels, "listing": listing, "joined": ctx.is_member(uid) })))
}

#[derive(Deserialize)]
struct PreviewMessagesQuery {
    before: Option<Uuid>,
    #[serde(default = "default_limit")]
    limit: i64,
}
fn default_limit() -> i64 {
    50
}

/// Read-only message history for one public channel of an approved server.
async fn preview_messages(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, cid)): Path<(Uuid, Uuid)>, Query(q): Query<PreviewMessagesQuery>) -> AppResult<Json<Vec<crate::models::Message>>> {
    let (_, channels) = public_channels(&state.db, gid).await?;
    if !channels.iter().any(|c| c.id == cid) {
        return Err(AppError::NotFound("Channel not found".into()));
    }
    let limit = q.limit.clamp(1, 100);
    let select = crate::routes::channels::MESSAGE_SELECT;
    let rows = match q.before {
        Some(b) => sqlx::query_as::<_, crate::models::MessageRow>(&format!("{select} WHERE m.channel_id = $1 AND m.id < $2 ORDER BY m.id DESC LIMIT $3")).bind(cid).bind(b).bind(limit).fetch_all(&state.db).await?,
        None => sqlx::query_as::<_, crate::models::MessageRow>(&format!("{select} WHERE m.channel_id = $1 ORDER BY m.id DESC LIMIT $2")).bind(cid).bind(limit).fetch_all(&state.db).await?,
    };
    Ok(Json(crate::routes::channels::hydrate(&state.db, rows, uid, true).await?))
}

async fn require_manage(db: &PgPool, gid: Uuid, uid: Uuid) -> AppResult<()> {
    let (_, p) = perms::guild_perms(db, gid, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)
}

async fn listing_for(state: &AppState, uid: Uuid, gid: Uuid) -> AppResult<Option<Listing>> {
    let row = sqlx::query_as::<_, Listing>(&format!("{LISTING_SELECT} WHERE d.guild_id = $1")).bind(gid).fetch_optional(&state.db).await?;
    Ok(match row {
        Some(l) => decorate(state, uid, vec![l]).await?.pop(),
        None => None,
    })
}

async fn get_listing(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Option<Listing>>> {
    require_manage(&state.db, id, uid).await?;
    Ok(Json(listing_for(&state, uid, id).await?))
}

#[derive(Deserialize)]
struct PutListing {
    #[serde(default)]
    description: String,
    #[serde(default = "default_category")]
    category: String,
    banner_url: Option<String>,
}
fn default_category() -> String {
    "community".into()
}

/// Submit or update a listing. New and rejected listings go (back) to pending; an approved one stays approved.
async fn put_listing(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<PutListing>) -> AppResult<Json<Listing>> {
    require_manage(&state.db, id, uid).await?;
    crate::routes::users::require_verified(&state, uid).await?;
    let description = req.description.trim().chars().take(MAX_DESCRIPTION).collect::<String>();
    if description.chars().count() < 10 {
        return Err(AppError::BadRequest("Describe your server in at least 10 characters".into()));
    }
    if !CATEGORIES.contains(&req.category.as_str()) {
        return Err(AppError::BadRequest("Unknown category".into()));
    }
    validate_image_max(&req.banner_url, 1024 * 1024)?;
    sqlx::query(
        "INSERT INTO guild_discovery (guild_id, description, category, banner_url, status, submitted_by, submitted_at)
         VALUES ($1, $2, $3, NULLIF($4, ''), 'pending', $5, now())
         ON CONFLICT (guild_id) DO UPDATE SET description = EXCLUDED.description, category = EXCLUDED.category,
           banner_url = CASE WHEN $4::text IS NULL THEN guild_discovery.banner_url WHEN $4 = '' THEN NULL ELSE $4 END,
           status = CASE WHEN guild_discovery.status = 'approved' THEN 'approved' ELSE 'pending' END,
           note = CASE WHEN guild_discovery.status = 'approved' THEN guild_discovery.note ELSE '' END,
           submitted_by = EXCLUDED.submitted_by, submitted_at = now()",
    )
    .bind(id)
    .bind(&description)
    .bind(&req.category)
    .bind(req.banner_url)
    .bind(uid)
    .execute(&state.db)
    .await?;
    crate::audit::guild(&state, id, uid, "discovery.submit", "guild", Some(id), &crate::audit::guild_name(&state, id).await, json!({ "category": req.category })).await;
    Ok(Json(listing_for(&state, uid, id).await?.ok_or_else(|| AppError::NotFound("Listing not found".into()))?))
}

async fn delete_listing(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    require_manage(&state.db, id, uid).await?;
    sqlx::query("DELETE FROM guild_discovery WHERE guild_id = $1").bind(id).execute(&state.db).await?;
    crate::audit::guild(&state, id, uid, "discovery.withdraw", "guild", Some(id), &crate::audit::guild_name(&state, id).await, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct AdminQuery {
    #[serde(default = "default_status")]
    status: String,
}
fn default_status() -> String {
    "pending".into()
}

/// Admin review queue (pending by default), oldest submission first.
async fn admin_list(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<AdminQuery>) -> AppResult<Json<Vec<Listing>>> {
    require_admin(&state, uid).await?;
    if !["pending", "approved", "rejected"].contains(&q.status.as_str()) {
        return Err(AppError::BadRequest("Unknown status".into()));
    }
    let rows = sqlx::query_as::<_, Listing>(&format!("{LISTING_SELECT} WHERE d.status = $1 ORDER BY d.submitted_at ASC LIMIT 200"))
        .bind(&q.status)
        .fetch_all(&state.db)
        .await?;
    Ok(Json(decorate(&state, uid, rows).await?))
}

#[derive(Deserialize)]
struct Review {
    status: String,
    #[serde(default)]
    note: String,
}

async fn review(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<Review>) -> AppResult<Json<Listing>> {
    require_admin(&state, uid).await?;
    if !["approved", "rejected", "pending"].contains(&req.status.as_str()) {
        return Err(AppError::BadRequest("Status must be approved, rejected or pending".into()));
    }
    let res = sqlx::query("UPDATE guild_discovery SET status = $2, note = $3, reviewed_by = $4, reviewed_at = now() WHERE guild_id = $1")
        .bind(gid)
        .bind(&req.status)
        .bind(req.note.trim().chars().take(500).collect::<String>())
        .bind(uid)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Listing not found".into()));
    }
    crate::audit::record(&state, uid, &format!("discovery.{}", req.status), "guild", Some(gid), &crate::audit::guild_name(&state, gid).await, json!({ "note": req.note.trim() })).await;
    Ok(Json(listing_for(&state, uid, gid).await?.ok_or_else(|| AppError::NotFound("Listing not found".into()))?))
}

#[derive(Deserialize)]
struct AdminUpdate {
    /// Featured spot (lower first); explicit null un-features.
    #[serde(default, deserialize_with = "deserialize_nullable_i32")]
    featured_order: Option<Option<i32>>,
    verified: Option<bool>,
    /// Partnered with this instance (a badge on the server everywhere).
    partnered: Option<bool>,
}
fn deserialize_nullable_i32<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<i32>>, D::Error> {
    Ok(Some(Option::<i32>::deserialize(d)?))
}

/// Admin: feature a listing (and order it) and/or grant the verified badge. Only approved listings can be featured or verified.
async fn admin_update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<AdminUpdate>) -> AppResult<Json<Listing>> {
    require_admin(&state, uid).await?;
    let status: Option<(String,)> = sqlx::query_as("SELECT status FROM guild_discovery WHERE guild_id = $1").bind(gid).fetch_optional(&state.db).await?;
    let Some((status,)) = status else { return Err(AppError::NotFound("Listing not found".into())) };
    let featuring = req.featured_order.map(|f| f.is_some()).unwrap_or(false);
    if status != "approved" && (featuring || req.verified == Some(true)) {
        return Err(AppError::BadRequest("Only approved listings can be featured or verified".into()));
    }
    if let Some(Some(n)) = req.featured_order { if !(0..=1000).contains(&n) { return Err(AppError::BadRequest("Featured order must be 0-1000".into())); } }
    sqlx::query("UPDATE guild_discovery SET featured_order = CASE WHEN $2 THEN $3 ELSE featured_order END, verified = COALESCE($4, verified) WHERE guild_id = $1")
        .bind(gid).bind(req.featured_order.is_some()).bind(req.featured_order.flatten()).bind(req.verified)
        .execute(&state.db)
        .await?;
    if let Some(p) = req.partnered {
        sqlx::query("UPDATE guilds SET partnered = $2 WHERE id = $1").bind(gid).bind(p).execute(&state.db).await?;
        if let Ok(g) = sqlx::query_as::<_, crate::models::Guild>(&format!("SELECT {} FROM guilds WHERE id = $1", crate::routes::guilds::GUILD_COLS)).bind(gid).fetch_one(&state.db).await { state.hub.emit_guild(gid, "GUILD_UPDATE", json!(g)); }
    }
    let mut details = serde_json::Map::new();
    if let Some(p) = req.partnered { details.insert("partnered".into(), json!(p)); }
    if let Some(f) = req.featured_order { details.insert("featured_order".into(), json!(f)); }
    if let Some(v) = req.verified { details.insert("verified".into(), json!(v)); }
    crate::audit::record(&state, uid, "discovery.update", "guild", Some(gid), &crate::audit::guild_name(&state, gid).await, Value::Object(details)).await;
    Ok(Json(listing_for(&state, uid, gid).await?.ok_or_else(|| AppError::NotFound("Listing not found".into()))?))
}
