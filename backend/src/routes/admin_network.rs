//! The admin Network view (super admins only, `Perm::NetworkRead`): friendships and server memberships as a graph.
//! `GET /admin/network?focus=&depth=` grows outward from one person or server, `GET /admin/network/summary` is the
//! whole instance as servers linked by the members they share, and `GET /admin/network/people` opens that summary up
//! into the people in some servers. Every request is written to the admin access log.
//!
//! Also `GET /admin/guilds/:id/overview`, the admin server page (conversation metadata; friendship counts only for
//! those who may see the network).

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{self, Entry, Perm},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use uuid::Uuid;

/// Servers with more members than this aren't opened up past the first step: they would pull in everyone.
pub const BIG: i64 = 50;
/// The most people and servers one graph around a focus returns.
pub const MAX_NODES: usize = 400;
/// The most people the instance view opens up at once.
pub const MAX_PEOPLE: usize = 1500;
/// The most servers the instance summary shows (the biggest first).
pub const MAX_SERVERS: i64 = 300;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/network", get(around))
        .route("/admin/network/summary", get(summary))
        .route("/admin/network/people", get(people))
        .route("/admin/network/search", get(search))
        .route("/admin/guilds/:id/overview", get(guild_overview))
}

/// People who count: not deleted, not webhooks, bots only when parameter `$n` (the `bots` flag) says so.
fn person(n: u8) -> String { format!("u.account_state <> 'deleted' AND NOT u.webhook AND (${n} OR NOT u.bot)") }

#[derive(Deserialize)]
struct AroundQ { focus: Uuid, depth: Option<u8>, #[serde(default)] bots: bool }
#[derive(Deserialize)]
struct SummaryQ { #[serde(default)] bots: bool }
#[derive(Deserialize)]
struct SearchQ { q: String }
#[derive(Deserialize)]
struct PeopleQ { guilds: Option<String>, #[serde(default)] loose: bool, #[serde(default)] bots: bool }

/// Adds ids to a node list in order, until the graph is full. Returns the ones that were new.
fn take(into: &mut Vec<Uuid>, seen: &mut HashSet<Uuid>, ids: Vec<Uuid>, room: &mut usize, truncated: &mut bool) -> Vec<Uuid> {
    let mut fresh = Vec::new();
    for id in ids {
        if seen.contains(&id) { continue }
        if *room == 0 { *truncated = true; break }
        seen.insert(id); into.push(id); fresh.push(id); *room -= 1;
    }
    fresh
}

/// `GET /admin/network?focus=<user or server>&depth=1|2&bots=`: everyone and every server within `depth` steps.
async fn around(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Query(q): Query<AroundQ>) -> AppResult<Json<Value>> {
    let a = admin_access::require_perm(&state, uid, Perm::NetworkRead).await?;
    let p2 = person(2);
    let depth = q.depth.unwrap_or(2).clamp(1, 2);
    let is_user = sqlx::query_as::<_, (bool,)>("SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND account_state <> 'deleted')").bind(q.focus).fetch_one(&state.db).await?.0;
    let is_guild = !is_user && sqlx::query_as::<_, (bool,)>("SELECT EXISTS (SELECT 1 FROM guilds WHERE id = $1 AND state <> 'deleted')").bind(q.focus).fetch_one(&state.db).await?.0;
    if !is_user && !is_guild { return Err(AppError::NotFound("No person or server with that id".into())) }

    let (mut us, mut gs, mut seen) = (Vec::new(), Vec::new(), HashSet::from([q.focus]));
    let (mut fu, mut fg) = if is_user { us.push(q.focus); (vec![q.focus], vec![]) } else { gs.push(q.focus); (vec![], vec![q.focus]) };
    let (mut room, mut truncated) = (MAX_NODES - 1, false);
    for _ in 0..depth {
        let (mut nu, mut ng) = (Vec::new(), Vec::new());
        if !fu.is_empty() {
            let friends: Vec<(Uuid,)> = sqlx::query_as(&format!(
                "SELECT r.target_id FROM relationships r JOIN users u ON u.id = r.target_id WHERE r.user_id = ANY($1) AND r.kind = 'friend' AND {p2} ORDER BY r.created_at LIMIT {MAX_NODES}"
            )).bind(&fu).bind(q.bots).fetch_all(&state.db).await?;
            nu.extend(take(&mut us, &mut seen, friends.into_iter().map(|r| r.0).collect(), &mut room, &mut truncated));
            let servers: Vec<(Uuid,)> = sqlx::query_as(
                "SELECT m.guild_id FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.user_id = ANY($1) AND g.state <> 'deleted' GROUP BY m.guild_id ORDER BY MIN(m.joined_at) LIMIT 400",
            ).bind(&fu).fetch_all(&state.db).await?;
            ng.extend(take(&mut gs, &mut seen, servers.into_iter().map(|r| r.0).collect(), &mut room, &mut truncated));
        }
        if !fg.is_empty() {
            let members: Vec<(Uuid,)> = sqlx::query_as(&format!(
                "SELECT m.user_id FROM guild_members m JOIN users u ON u.id = m.user_id
                 WHERE m.guild_id = ANY($1) AND {p2} AND (m.guild_id = $3 OR (SELECT COUNT(*) FROM guild_members x WHERE x.guild_id = m.guild_id) <= $4)
                 ORDER BY (u.id = (SELECT owner_id FROM guilds WHERE id = m.guild_id)) DESC, m.joined_at LIMIT {MAX_NODES}"
            )).bind(&fg).bind(q.bots).bind(q.focus).bind(BIG).fetch_all(&state.db).await?;
            nu.extend(take(&mut us, &mut seen, members.into_iter().map(|r| r.0).collect(), &mut room, &mut truncated));
        }
        (fu, fg) = (nu, ng);
        if room == 0 { break }
    }
    admin_access::log(&state, uid, &a.roles, &headers, Entry { action: "network.view", query: "", filters: json!({ "depth": depth, "bots": q.bots }), justification: "", targets: &[q.focus] }).await?;
    let mut nodes = people_nodes(&state, &us).await?;
    nodes.extend(server_nodes(&state, &gs, q.bots).await?);
    Ok(Json(json!({ "focus": q.focus, "nodes": nodes, "edges": edges(&state, &us, Some(&gs)).await?, "truncated": truncated, "big": BIG })))
}

/// `GET /admin/network/summary?bots=`: every server (the biggest `MAX_SERVERS`) with how many members each pair shares.
async fn summary(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Query(q): Query<SummaryQ>) -> AppResult<Json<Value>> {
    let a = admin_access::require_perm(&state, uid, Perm::NetworkRead).await?;
    let p2 = person(2);
    let ids: Vec<(Uuid,)> = sqlx::query_as(&format!(
        "SELECT g.id FROM guilds g WHERE g.state <> 'deleted'
         ORDER BY (SELECT COUNT(*) FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = g.id AND {}) DESC, g.created_at LIMIT {MAX_SERVERS}", person(1)
    )).bind(q.bots).fetch_all(&state.db).await?;
    let ids: Vec<Uuid> = ids.into_iter().map(|r| r.0).collect();
    let links: Vec<(Uuid, Uuid, i64)> = sqlx::query_as(&format!(
        "SELECT a.guild_id, b.guild_id, COUNT(*) FROM guild_members a JOIN guild_members b ON b.user_id = a.user_id AND a.guild_id < b.guild_id JOIN users u ON u.id = a.user_id
         WHERE a.guild_id = ANY($1) AND b.guild_id = ANY($1) AND {p2} GROUP BY 1, 2"
    )).bind(&ids).bind(q.bots).fetch_all(&state.db).await?;
    let (in_servers,): (i64,) = sqlx::query_as(&format!("SELECT COUNT(DISTINCT m.user_id) FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = ANY($1) AND {p2}"))
        .bind(&ids).bind(q.bots).fetch_one(&state.db).await?;
    let (loose,): (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM users u WHERE {} AND NOT u.guest AND NOT EXISTS (SELECT 1 FROM guild_members m WHERE m.user_id = u.id)", person(1)))
        .bind(q.bots).fetch_one(&state.db).await?;
    let (servers_total,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM guilds WHERE state <> 'deleted'").fetch_one(&state.db).await?;
    admin_access::log(&state, uid, &a.roles, &headers, Entry { action: "network.view", query: "", filters: json!({ "summary": true, "bots": q.bots }), justification: "", targets: &[] }).await?;
    Ok(Json(json!({
        "servers": server_nodes(&state, &ids, q.bots).await?,
        "links": links.into_iter().map(|(a, b, w)| json!({ "a": a, "b": b, "t": "shared", "w": w })).collect::<Vec<_>>(),
        "people_in_servers": in_servers, "loose": loose, "servers_total": servers_total, "max_people": MAX_PEOPLE,
    })))
}

/// `GET /admin/network/people?guilds=<id,id>&loose=&bots=`: the people in those servers (and, with `loose`, people in
/// none), the friendships between them and all their memberships. Without `guilds`, everyone.
async fn people(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Query(q): Query<PeopleQ>) -> AppResult<Json<Value>> {
    let a = admin_access::require_perm(&state, uid, Perm::NetworkRead).await?;
    let p2 = person(2);
    let guilds: Option<Vec<Uuid>> = q.guilds.as_deref().map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).take(MAX_SERVERS as usize).collect());
    let limit = MAX_PEOPLE as i64 + 1;
    let mut ids: Vec<Uuid> = match &guilds {
        Some(g) => sqlx::query_as::<_, (Uuid,)>(&format!(
            "SELECT m.user_id FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = ANY($1) AND {p2} GROUP BY m.user_id ORDER BY MIN(m.joined_at) LIMIT {limit}"
        )).bind(g).bind(q.bots).fetch_all(&state.db).await?,
        None => sqlx::query_as::<_, (Uuid,)>(&format!("SELECT u.id FROM users u WHERE {} AND NOT u.guest ORDER BY u.created_at LIMIT {limit}", person(1)))
            .bind(q.bots).fetch_all(&state.db).await?,
    }.into_iter().map(|r| r.0).collect();
    if q.loose && guilds.is_some() && ids.len() < limit as usize {
        let rest = limit - ids.len() as i64;
        let loose: Vec<(Uuid,)> = sqlx::query_as(&format!("SELECT u.id FROM users u WHERE {} AND NOT u.guest AND NOT EXISTS (SELECT 1 FROM guild_members m WHERE m.user_id = u.id) ORDER BY u.created_at LIMIT {rest}", person(1)))
            .bind(q.bots).fetch_all(&state.db).await?;
        ids.extend(loose.into_iter().map(|r| r.0));
    }
    let truncated = ids.len() > MAX_PEOPLE;
    ids.truncate(MAX_PEOPLE);
    admin_access::log(&state, uid, &a.roles, &headers, Entry { action: "network.view", query: "", filters: json!({ "people": true, "servers": guilds.as_ref().map(|g| g.len()), "bots": q.bots }), justification: "", targets: guilds.as_deref().unwrap_or(&[]) }).await?;
    Ok(Json(json!({ "nodes": people_nodes(&state, &ids).await?, "edges": edges(&state, &ids, None).await?, "truncated": truncated })))
}

/// `GET /admin/network/search?q=`: people (by username or display name) and servers (by name) to start from.
async fn search(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<SearchQ>) -> AppResult<Json<Value>> {
    admin_access::require_perm(&state, uid, Perm::NetworkRead).await?;
    let term = q.q.trim();
    if term.is_empty() { return Ok(Json(json!({ "users": [], "servers": [] }))) }
    let pat = format!("%{}%", term.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    let users: Vec<(Uuid, String, String, Option<String>, bool)> = sqlx::query_as(
        "SELECT id, username, display_name, avatar_url, bot FROM users WHERE account_state <> 'deleted' AND NOT webhook AND (username ILIKE $1 OR display_name ILIKE $1)
         ORDER BY lower(username) = lower($2) DESC, username LIMIT 8",
    ).bind(&pat).bind(term).fetch_all(&state.db).await?;
    let servers: Vec<(Uuid, String, Option<String>)> = sqlx::query_as("SELECT id, name, icon_url FROM guilds WHERE state <> 'deleted' AND name ILIKE $1 ORDER BY lower(name) = lower($2) DESC, name LIMIT 6")
        .bind(&pat).bind(term).fetch_all(&state.db).await?;
    Ok(Json(json!({
        "users": users.into_iter().map(|(id, username, display_name, avatar_url, bot)| json!({ "id": id, "kind": "user", "username": username, "display_name": display_name, "avatar_url": avatar_url, "bot": bot })).collect::<Vec<_>>(),
        "servers": servers.into_iter().map(|(id, name, icon_url)| json!({ "id": id, "kind": "server", "name": name, "icon_url": icon_url })).collect::<Vec<_>>(),
    })))
}

async fn people_nodes(state: &AppState, ids: &[Uuid]) -> AppResult<Vec<Value>> {
    let rows: Vec<(Uuid, String, String, Option<String>, bool, bool, Option<DateTime<Utc>>, i64, i64)> = sqlx::query_as(
        "SELECT u.id, u.username, u.display_name, u.avatar_url, u.bot, u.guest, u.suspended_at,
                (SELECT COUNT(*) FROM relationships r WHERE r.user_id = u.id AND r.kind = 'friend'),
                (SELECT COUNT(*) FROM guild_members m WHERE m.user_id = u.id)
         FROM users u WHERE u.id = ANY($1)",
    ).bind(ids).fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|(id, username, display_name, avatar_url, bot, guest, suspended, friends, servers)| json!({
        "id": id, "kind": "user", "username": username, "display_name": display_name, "avatar_url": avatar_url, "bot": bot, "guest": guest,
        "suspended": suspended.is_some(), "friends": friends, "servers": servers,
    })).collect())
}

async fn server_nodes(state: &AppState, ids: &[Uuid], bots: bool) -> AppResult<Vec<Value>> {
    let p2 = person(2);
    let rows: Vec<(Uuid, String, Option<String>, Uuid, String, i64)> = sqlx::query_as(&format!(
        "SELECT g.id, g.name, g.icon_url, g.owner_id, g.state, (SELECT COUNT(*) FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = g.id AND {p2})
         FROM guilds g WHERE g.id = ANY($1)"
    )).bind(ids).bind(bots).fetch_all(&state.db).await?;
    Ok(rows.into_iter().map(|(id, name, icon_url, owner_id, st, members)| json!({
        "id": id, "kind": "server", "name": name, "icon_url": icon_url, "owner_id": owner_id, "state": st, "members": members,
    })).collect())
}

/// Friendships between these people, and their memberships (in `guilds`, or in any server).
async fn edges(state: &AppState, users: &[Uuid], guilds: Option<&[Uuid]>) -> AppResult<Vec<Value>> {
    let friends: Vec<(Uuid, Uuid, DateTime<Utc>)> = sqlx::query_as(
        "SELECT user_id, target_id, created_at FROM relationships WHERE kind = 'friend' AND user_id = ANY($1) AND target_id = ANY($1) AND user_id < target_id",
    ).bind(users).fetch_all(&state.db).await?;
    let members: Vec<(Uuid, Uuid, bool, DateTime<Utc>)> = sqlx::query_as(
        "SELECT m.user_id, m.guild_id, g.owner_id = m.user_id, m.joined_at FROM guild_members m JOIN guilds g ON g.id = m.guild_id
         WHERE m.user_id = ANY($1) AND g.state <> 'deleted' AND ($2::uuid[] IS NULL OR m.guild_id = ANY($2))",
    ).bind(users).bind(guilds).fetch_all(&state.db).await?;
    let mut out: Vec<Value> = friends.into_iter().map(|(a, b, at)| json!({ "a": a, "b": b, "t": "friend", "since": at })).collect();
    out.extend(members.into_iter().map(|(u, g, owner, at)| json!({ "a": u, "b": g, "t": if owner { "owner" } else { "member" }, "since": at })));
    Ok(out)
}

/// `GET /admin/guilds/:id/overview`: one server at a glance: what it is, how active, its standing, its members and the
/// servers it shares members with.
async fn guild_overview(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let a = admin_access::require_perm(&state, uid, Perm::ConversationMetadataRead).await?;
    let net = a.has(Perm::NetworkRead);
    let g: (Uuid, String, Option<String>, DateTime<Utc>, Uuid, String, String, String, Option<DateTime<Utc>>, Option<String>) = sqlx::query_as(
        "SELECT g.id, g.name, g.icon_url, g.created_at, g.owner_id, u.username, u.display_name, g.state, g.deletion_scheduled_for, d.status
         FROM guilds g JOIN users u ON u.id = g.owner_id LEFT JOIN guild_discovery d ON d.guild_id = g.id WHERE g.id = $1 AND g.state <> 'deleted'",
    ).bind(id).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Server not found".into()))?;
    let channels: Vec<(String, i64)> = sqlx::query_as("SELECT kind, COUNT(*) FROM channels WHERE guild_id = $1 GROUP BY kind").bind(id).fetch_all(&state.db).await?;
    let one = |sql: &'static str| { let db = state.db.clone(); async move { sqlx::query_as::<_, (i64,)>(sql).bind(id).fetch_one(&db).await.map(|r| r.0) } };
    let total = one("SELECT COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.guild_id = $1 AND m.kind = 'default'").await?;
    let week = one("SELECT COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.guild_id = $1 AND m.kind = 'default' AND m.created_at > now() - interval '7 days'").await?;
    let active = one("SELECT COUNT(DISTINCT m.author_id) FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.guild_id = $1 AND m.kind = 'default' AND m.created_at > now() - interval '7 days'").await?;
    let daily: Vec<(NaiveDate, i64)> = sqlx::query_as(
        "SELECT d::date, COALESCE((SELECT COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.guild_id = $1 AND m.kind = 'default' AND m.created_at >= d AND m.created_at < d + interval '1 day'), 0)
         FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d ORDER BY d",
    ).bind(id).fetch_all(&state.db).await?;
    let reports_open = one("SELECT COUNT(*) FROM reports WHERE guild_id = $1 AND status = 'open'").await?;
    let reports = one("SELECT COUNT(*) FROM reports WHERE guild_id = $1").await?;
    let bans = one("SELECT COUNT(*) FROM guild_bans WHERE guild_id = $1").await?;
    let bots = one("SELECT COUNT(*) FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = $1 AND u.bot").await?;
    let member_count = one("SELECT COUNT(*) FROM guild_members WHERE guild_id = $1").await?;
    let inside = if net { Some(one("SELECT COUNT(*) FROM relationships r JOIN guild_members a ON a.user_id = r.user_id AND a.guild_id = $1 JOIN guild_members b ON b.user_id = r.target_id AND b.guild_id = $1 WHERE r.kind = 'friend' AND r.user_id < r.target_id").await?) } else { None };
    let members: Vec<(Uuid, String, String, Option<String>, bool, Option<DateTime<Utc>>, DateTime<Utc>, Option<String>, i64, Option<i64>)> = sqlx::query_as(
        "SELECT u.id, u.username, u.display_name, u.avatar_url, u.bot, u.suspended_at, m.joined_at,
                (SELECT r.name FROM member_roles mr JOIN roles r ON r.id = mr.role_id WHERE mr.guild_id = m.guild_id AND mr.user_id = m.user_id ORDER BY r.position DESC LIMIT 1),
                (SELECT COUNT(*) FROM guild_members x WHERE x.user_id = u.id),
                CASE WHEN $2 THEN (SELECT COUNT(*) FROM relationships r JOIN guild_members x ON x.user_id = r.target_id AND x.guild_id = m.guild_id WHERE r.user_id = u.id AND r.kind = 'friend') END
         FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = $1
         ORDER BY (u.id = (SELECT owner_id FROM guilds WHERE id = $1)) DESC, m.joined_at LIMIT 500",
    ).bind(id).bind(net).fetch_all(&state.db).await?;
    let overlap: Vec<(Uuid, String, Option<String>, String, i64, i64)> = sqlx::query_as(
        "SELECT g.id, g.name, g.icon_url, ou.username, (SELECT COUNT(*) FROM guild_members x WHERE x.guild_id = g.id), COUNT(*)
         FROM guild_members a JOIN guild_members b ON b.user_id = a.user_id AND b.guild_id <> a.guild_id JOIN guilds g ON g.id = b.guild_id JOIN users ou ON ou.id = g.owner_id
         WHERE a.guild_id = $1 AND g.state <> 'deleted' GROUP BY g.id, ou.username ORDER BY COUNT(*) DESC, g.name LIMIT 50",
    ).bind(id).fetch_all(&state.db).await?;
    let ch = |k: &str| channels.iter().find(|c| c.0 == k).map_or(0, |c| c.1);
    Ok(Json(json!({
        "server": {
            "id": g.0, "name": g.1, "icon_url": g.2, "created_at": g.3, "owner": { "id": g.4, "username": g.5, "display_name": g.6 },
            "state": g.7, "deletion_scheduled_for": g.8, "discovery_status": g.9, "members": member_count, "text_channels": ch("text"), "voice_channels": ch("voice"),
        },
        "activity": { "messages": total, "last_week": week, "active_week": active, "daily": daily.into_iter().map(|(d, n)| json!({ "day": d, "count": n })).collect::<Vec<_>>() },
        "standing": { "reports_open": reports_open, "reports": reports, "bans": bans, "bots": bots, "friendships_inside": inside },
        "members": members.into_iter().map(|(uid, username, display_name, avatar_url, bot, suspended, joined, role, servers, friends_here)| json!({
            "id": uid, "username": username, "display_name": display_name, "avatar_url": avatar_url, "bot": bot, "suspended": suspended.is_some(),
            "joined_at": joined, "role": role, "servers": servers, "friends_here": friends_here,
        })).collect::<Vec<_>>(),
        "overlap": overlap.into_iter().map(|(oid, name, icon_url, owner, members, shared)| json!({ "id": oid, "name": name, "icon_url": icon_url, "owner_username": owner, "members": members, "shared": shared })).collect::<Vec<_>>(),
        "can_network": net,
    })))
}
