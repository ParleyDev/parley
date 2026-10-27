//! Year in review: what you did on the instance in a year (messages, busiest month and day, top servers and
//! channels, reactions, new friends and servers). Only counted, never shared.

use crate::{auth::AuthUser, error::AppResult, state::AppState};
use axum::{extract::{Query, State}, routing::get, Json, Router};
use chrono::Datelike;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/users/@me/recap", get(recap))
}

#[derive(Deserialize)]
struct YearQ { year: Option<i32> }

async fn recap(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<YearQ>) -> AppResult<Json<Value>> {
    let year = q.year.unwrap_or_else(|| chrono::Utc::now().year()).clamp(2000, 2100);
    let db = &state.db;
    const MINE: &str = "FROM messages m WHERE m.author_id = $1 AND (m.kind = '' OR m.kind = 'default') AND EXTRACT(YEAR FROM m.created_at) = $2";
    let (messages, days, chars): (i64, i64, i64) = sqlx::query_as(&format!("SELECT COUNT(*), COUNT(DISTINCT m.created_at::date), COALESCE(SUM(LENGTH(m.content)), 0) {MINE}")).bind(uid).bind(year as f64).fetch_one(db).await?;
    let months: Vec<(i32, i64)> = sqlx::query_as(&format!("SELECT EXTRACT(MONTH FROM m.created_at)::int, COUNT(*) {MINE} GROUP BY 1 ORDER BY 1")).bind(uid).bind(year as f64).fetch_all(db).await?;
    let busiest_day: Option<(chrono::NaiveDate, i64)> = sqlx::query_as(&format!("SELECT m.created_at::date, COUNT(*) {MINE} GROUP BY 1 ORDER BY 2 DESC LIMIT 1")).bind(uid).bind(year as f64).fetch_optional(db).await?;
    let servers: Vec<(Uuid, String, Option<String>, i64)> = sqlx::query_as(
        "SELECT g.id, g.name, g.icon_url, COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id JOIN guilds g ON g.id = c.guild_id
         WHERE m.author_id = $1 AND EXTRACT(YEAR FROM m.created_at) = $2 GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 5").bind(uid).bind(year as f64).fetch_all(db).await?;
    let channels: Vec<(Uuid, String, Option<String>, i64)> = sqlx::query_as(
        "SELECT c.id, c.name, g.name, COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id LEFT JOIN guilds g ON g.id = c.guild_id
         WHERE m.author_id = $1 AND EXTRACT(YEAR FROM m.created_at) = $2 AND c.guild_id IS NOT NULL GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 5").bind(uid).bind(year as f64).fetch_all(db).await?;
    let (dms,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.author_id = $1 AND c.guild_id IS NULL AND EXTRACT(YEAR FROM m.created_at) = $2").bind(uid).bind(year as f64).fetch_one(db).await?;
    let emoji: Vec<(String, i64)> = sqlx::query_as("SELECT emoji, COUNT(*) FROM reactions WHERE user_id = $1 AND EXTRACT(YEAR FROM created_at) = $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 5").bind(uid).bind(year as f64).fetch_all(db).await?;
    let (reactions_got,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM reactions r JOIN messages m ON m.id = r.message_id WHERE m.author_id = $1 AND r.user_id <> $1 AND EXTRACT(YEAR FROM m.created_at) = $2").bind(uid).bind(year as f64).fetch_one(db).await?;
    let (friends,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM relationships WHERE user_id = $1 AND kind = 'friend' AND EXTRACT(YEAR FROM created_at) = $2").bind(uid).bind(year as f64).fetch_one(db).await?;
    let (joined,): (i64,) = sqlx::query_as("SELECT COUNT(DISTINCT guild_id) FROM guild_member_log WHERE user_id = $1 AND kind = 'join' AND EXTRACT(YEAR FROM at) = $2").bind(uid).bind(year as f64).fetch_one(db).await?;
    Ok(Json(json!({
        "year": year, "messages": messages, "active_days": days, "characters": chars, "dm_messages": dms,
        "months": (1..=12).map(|m| json!({ "month": m, "messages": months.iter().find(|x| x.0 == m).map(|x| x.1).unwrap_or(0) })).collect::<Vec<_>>(),
        "busiest_day": busiest_day.map(|(d, n)| json!({ "day": d, "messages": n })),
        "top_servers": servers.iter().map(|(id, n, i, c)| json!({ "id": id, "name": n, "icon_url": i, "messages": c })).collect::<Vec<_>>(),
        "top_channels": channels.iter().map(|(id, n, g, c)| json!({ "id": id, "name": n, "guild": g, "messages": c })).collect::<Vec<_>>(),
        "top_emoji": emoji.iter().map(|(e, c)| json!({ "emoji": e, "count": c })).collect::<Vec<_>>(),
        "reactions_received": reactions_got, "new_friends": friends, "servers_joined": joined,
    })))
}
