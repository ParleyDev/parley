//! Server Insights (owners and Manage Server: growth, engagement, retention over the last 7-90 days) and the server
//! activity feed (any member: what's been popular and what's coming up).

use crate::{auth::AuthUser, error::AppResult, perms, state::AppState};
use axum::{extract::{Path, Query, State}, routing::get, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/insights", get(insights))
        .route("/guilds/:id/activity", get(activity))
}

#[derive(Deserialize)]
struct Range { #[serde(default)] days: Option<i32> }

/// Messages people wrote in this server's channels and threads (not system notices).
const GUILD_MESSAGES: &str = "messages m JOIN channels c ON c.id = m.channel_id WHERE c.guild_id = $1 AND (m.kind = '' OR m.kind = 'default')";

async fn insights(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Query(q): Query<Range>) -> AppResult<Json<Value>> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    let days = q.days.unwrap_or(30).clamp(7, 90);
    let db = &state.db;
    // One row per day, oldest first, in UTC.
    let daily: Vec<(chrono::NaiveDate, i64, i64, i64, i64)> = sqlx::query_as(&format!(
        "WITH d AS (SELECT generate_series((now() - make_interval(days => $2 - 1))::date, now()::date, interval '1 day')::date AS day)
         SELECT d.day,
           (SELECT COUNT(*) FROM guild_member_log l WHERE l.guild_id = $1 AND l.kind = 'join' AND l.at::date = d.day),
           (SELECT COUNT(*) FROM guild_member_log l WHERE l.guild_id = $1 AND l.kind = 'leave' AND l.at::date = d.day),
           (SELECT COUNT(*) FROM {GUILD_MESSAGES} AND m.created_at::date = d.day),
           (SELECT COUNT(DISTINCT m.author_id) FROM {GUILD_MESSAGES} AND m.created_at::date = d.day)
         FROM d ORDER BY d.day"))
        .bind(gid).bind(days).fetch_all(db).await?;
    let (members,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM guild_members WHERE guild_id = $1").bind(gid).fetch_one(db).await?;
    let (communicators,): (i64,) = sqlx::query_as(&format!("SELECT COUNT(DISTINCT m.author_id) FROM {GUILD_MESSAGES} AND m.created_at > now() - make_interval(days => $2)")).bind(gid).bind(days).fetch_one(db).await?;
    // Thread messages count toward their parent channel.
    let channels: Vec<(Uuid, String, i64)> = sqlx::query_as(
        "SELECT COALESCE(p.id, c.id), COALESCE(p.name, c.name), COUNT(*) AS n FROM messages m JOIN channels c ON c.id = m.channel_id
         LEFT JOIN channels p ON c.kind = 'thread' AND p.id = c.parent_id
         WHERE c.guild_id = $1 AND (m.kind = '' OR m.kind = 'default') AND m.created_at > now() - make_interval(days => $2)
         GROUP BY 1, 2 ORDER BY n DESC LIMIT 8")
        .bind(gid).bind(days).fetch_all(db).await?;
    // joined_via holds the invite code used, or 'discover'.
    let sources: Vec<(String, i64)> = sqlx::query_as("SELECT CASE WHEN via IS NULL THEN 'other' WHEN via = 'discover' THEN 'discover' ELSE 'invite' END, COUNT(*) FROM guild_member_log WHERE guild_id = $1 AND kind = 'join' AND at > now() - make_interval(days => $2) GROUP BY 1 ORDER BY 2 DESC")
        .bind(gid).bind(days).fetch_all(db).await?;
    // Retention: of people who joined in the range (at least a week ago, so they've had a week), how many are still
    // here, and how many talked in their first week.
    let (cohort, stayed, talked): (i64, i64, i64) = sqlx::query_as(&format!(
        "WITH j AS (SELECT DISTINCT ON (user_id) user_id, at FROM guild_member_log WHERE guild_id = $1 AND kind = 'join' AND at > now() - make_interval(days => $2) AND at < now() - interval '7 days' ORDER BY user_id, at)
         SELECT COUNT(*),
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM guild_members gm WHERE gm.guild_id = $1 AND gm.user_id = j.user_id)),
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM {GUILD_MESSAGES} AND m.author_id = j.user_id AND m.created_at BETWEEN j.at AND j.at + interval '7 days'))
         FROM j"))
        .bind(gid).bind(days).fetch_one(db).await?;
    let sum = |f: fn(&(chrono::NaiveDate, i64, i64, i64, i64)) -> i64| daily.iter().map(f).sum::<i64>();
    Ok(Json(json!({
        "days": days,
        "totals": { "members": members, "joins": sum(|d| d.1), "leaves": sum(|d| d.2), "messages": sum(|d| d.3), "communicators": communicators },
        "daily": daily.iter().map(|(day, j, l, m, c)| json!({ "day": day, "joins": j, "leaves": l, "messages": m, "communicators": c })).collect::<Vec<_>>(),
        "top_channels": channels.iter().map(|(id, name, n)| json!({ "id": id, "name": name, "messages": n })).collect::<Vec<_>>(),
        "join_sources": sources.iter().map(|(via, n)| json!({ "via": via, "count": n })).collect::<Vec<_>>(),
        "retention": { "cohort": cohort, "stayed": stayed, "talked_first_week": talked },
    })))
}

/// `GET /guilds/:id/activity`: the week's most-reacted messages in channels you can see, new members, upcoming events
/// and busy threads.
async fn activity(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Value>> {
    perms::guild_perms(&state.db, gid, uid).await?;
    let db = &state.db;
    let visible: Vec<Uuid> = perms::visible_channels(db, gid, uid).await?.into_iter().map(|c| c.id).collect();
    let top: Vec<(Uuid, Uuid, String, Uuid, String, Option<String>, chrono::DateTime<chrono::Utc>, i64)> = sqlx::query_as(
        "SELECT m.id, m.channel_id, LEFT(m.content, 300), u.id, u.display_name, u.avatar_url, m.created_at, COUNT(r.*) AS n
         FROM messages m JOIN users u ON u.id = m.author_id JOIN reactions r ON r.message_id = m.id
         WHERE m.channel_id = ANY($1) AND m.created_at > now() - interval '7 days'
         GROUP BY m.id, u.id ORDER BY n DESC, m.created_at DESC LIMIT 5")
        .bind(&visible).fetch_all(db).await?;
    let threads: Vec<(Uuid, Option<Uuid>, String, i64)> = sqlx::query_as(
        "SELECT c.id, c.parent_id, c.name, (SELECT COUNT(*) FROM messages m WHERE m.channel_id = c.id AND m.created_at > now() - interval '7 days') AS n
         FROM channels c WHERE c.kind = 'thread' AND c.parent_id = ANY($1) AND c.id = ANY($2) ORDER BY n DESC LIMIT 5")
        .bind(&visible).bind(&visible).fetch_all(db).await?;
    let joins: Vec<(Uuid, String, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT u.id, COALESCE(m.nickname, u.display_name), u.avatar_url, m.joined_at FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = $1 ORDER BY m.joined_at DESC LIMIT 8")
        .bind(gid).fetch_all(db).await?;
    let events = crate::routes::events::events_for(db, gid, uid).await?;
    Ok(Json(json!({
        "top_messages": top.iter().map(|(id, cid, content, aid, name, avatar, at, n)| json!({ "id": id, "channel_id": cid, "content": content, "author": { "id": aid, "display_name": name, "avatar_url": avatar }, "created_at": at, "reactions": n })).collect::<Vec<_>>(),
        "busy_threads": threads.iter().filter(|t| t.3 > 0).map(|(id, parent, name, n)| json!({ "id": id, "parent_id": parent, "name": name, "messages": n })).collect::<Vec<_>>(),
        "new_members": joins.iter().map(|(id, name, avatar, at)| json!({ "id": id, "display_name": name, "avatar_url": avatar, "joined_at": at })).collect::<Vec<_>>(),
        "events": events.iter().take(3).collect::<Vec<_>>(),
    })))
}
