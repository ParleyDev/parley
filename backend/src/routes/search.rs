//! Global message search: full-text (prefix) matching over every channel the caller can see, with
//! Discord-style filters parsed out of the query string: `from:user`, `in:channel`, `has:link|image|video|file|sticker`,
//! `before:YYYY-MM-DD`, `after:YYYY-MM-DD`, `pinned:true`, `mentions:user`.

use crate::{
    auth::AuthUser,
    error::AppResult,
    models::{Message, MessageRow},
    perms,
    routes::channels::{hydrate, require_channel, MESSAGE_SELECT},
    state::AppState,
};
use axum::{extract::{Query, State}, routing::get, Json, Router};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/search", get(search))
}

#[derive(Deserialize)]
pub struct SearchParams {
    #[serde(default)]
    pub q: String,
    pub guild_id: Option<Uuid>,
    pub channel_id: Option<Uuid>,
    #[serde(default)]
    pub offset: i64,
}

#[derive(Serialize)]
pub struct Hit {
    #[serde(flatten)]
    pub message: Message,
    pub guild_id: Option<Uuid>,
    pub channel_name: String,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub total: i64,
    pub offset: i64,
    pub results: Vec<Hit>,
    /// The filters that were understood (echoed so the client can show chips).
    pub filters: Filters,
}

#[derive(Default, Serialize, Debug, PartialEq)]
pub struct Filters {
    pub text: String,
    pub from: Vec<String>,
    pub r#in: Vec<String>,
    pub has: Vec<String>,
    pub mentions: Vec<String>,
    pub before: Option<NaiveDate>,
    pub after: Option<NaiveDate>,
    pub pinned: Option<bool>,
}

/// Pull `key:value` filters out of a query; everything else is free text.
pub fn parse(q: &str) -> Filters {
    let mut f = Filters::default();
    let mut text = Vec::new();
    for tok in q.split_whitespace() {
        let Some((k, v)) = tok.split_once(':') else { text.push(tok); continue };
        let v = v.trim();
        if v.is_empty() { text.push(tok); continue }
        match k.to_ascii_lowercase().as_str() {
            "from" => f.from.push(v.trim_start_matches('@').to_lowercase()),
            "mentions" => f.mentions.push(v.trim_start_matches('@').to_lowercase()),
            "in" => f.r#in.push(v.trim_start_matches('#').to_lowercase()),
            "has" => match v.to_ascii_lowercase().as_str() {
                "link" | "embed" => f.has.push("link".into()),
                "image" | "video" | "file" | "sticker" => f.has.push(v.to_ascii_lowercase()),
                _ => text.push(tok),
            },
            "before" => match NaiveDate::parse_from_str(v, "%Y-%m-%d") { Ok(d) => f.before = Some(d), Err(_) => text.push(tok) },
            "after" => match NaiveDate::parse_from_str(v, "%Y-%m-%d") { Ok(d) => f.after = Some(d), Err(_) => text.push(tok) },
            "pinned" => f.pinned = Some(matches!(v.to_ascii_lowercase().as_str(), "true" | "yes" | "1")),
            _ => text.push(tok),
        }
    }
    f.text = text.join(" ");
    f
}

/// `hello wor` -> `hello:* & wor:*` for to_tsquery('simple'); None when nothing searchable remains.
pub fn tsquery(text: &str) -> Option<String> {
    let words: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| format!("{}:*", w.to_lowercase()))
        .collect();
    if words.is_empty() { None } else { Some(words.join(" & ")) }
}

/// Channels the user may read: a single channel, one guild's visible channels, or everything (guilds + DMs).
async fn scope(db: &PgPool, uid: Uuid, guild_id: Option<Uuid>, channel_id: Option<Uuid>) -> AppResult<Vec<(Uuid, Option<Uuid>, String)>> {
    if let Some(cid) = channel_id {
        let c = require_channel(db, cid, uid).await?;
        return Ok(vec![(c.id, c.guild_id, c.name)]);
    }
    let guilds: Vec<(Uuid,)> = match guild_id {
        Some(g) => vec![(g,)],
        None => sqlx::query_as("SELECT guild_id FROM guild_members WHERE user_id = $1").bind(uid).fetch_all(db).await?,
    };
    let mut out = Vec::new();
    for (g,) in guilds {
        for c in perms::visible_channels(db, g, uid).await? {
            if c.kind == "text" || c.kind == "voice" || c.kind == "thread" {
                out.push((c.id, Some(g), c.name));
            }
        }
    }
    if guild_id.is_none() {
        let dms: Vec<(Uuid, String)> = sqlx::query_as("SELECT c.id, c.name FROM channels c JOIN channel_members cm ON cm.channel_id = c.id WHERE cm.user_id = $1 AND c.guild_id IS NULL")
            .bind(uid)
            .fetch_all(db)
            .await?;
        out.extend(dms.into_iter().map(|(id, name)| (id, None, name)));
    }
    Ok(out)
}

/// Usernames -> ids; None when no names were given (filter off), Some(empty) when none matched.
async fn resolve_users(db: &PgPool, names: &[String]) -> AppResult<Option<Vec<Uuid>>> {
    if names.is_empty() {
        return Ok(None);
    }
    let ids: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE lower(username) = ANY($1)").bind(names).fetch_all(db).await?;
    Ok(Some(ids.into_iter().map(|r| r.0).collect()))
}

pub async fn run(state: &AppState, uid: Uuid, p: &SearchParams) -> AppResult<SearchResult> {
    let filters = parse(&p.q);
    let tsq = tsquery(&filters.text);
    let empty = SearchResult { total: 0, offset: p.offset.max(0), results: vec![], filters: Filters::default() };
    let mut channels = scope(&state.db, uid, p.guild_id, p.channel_id).await?;
    if !filters.r#in.is_empty() {
        channels.retain(|(_, _, name)| filters.r#in.iter().any(|w| name.to_lowercase() == *w));
    }
    if channels.is_empty() {
        return Ok(SearchResult { filters, ..empty });
    }
    // Nothing to look for: an empty query must not dump a channel's history.
    let any_filter = tsq.is_some() || !filters.from.is_empty() || !filters.mentions.is_empty() || !filters.has.is_empty() || filters.before.is_some() || filters.after.is_some() || filters.pinned.is_some();
    if !any_filter {
        return Ok(SearchResult { filters, ..empty });
    }
    let from_ids = resolve_users(&state.db, &filters.from).await?;
    let mention_ids = resolve_users(&state.db, &filters.mentions).await?;
    if from_ids.as_ref().map(|v| v.is_empty()).unwrap_or(false) || mention_ids.as_ref().map(|v| v.is_empty()).unwrap_or(false) {
        return Ok(SearchResult { filters, ..empty });
    }
    let ids: Vec<Uuid> = channels.iter().map(|c| c.0).collect();
    let before: Option<DateTime<Utc>> = filters.before.and_then(|d| d.and_hms_opt(0, 0, 0)).map(|t| t.and_utc());
    let after: Option<DateTime<Utc>> = filters.after.and_then(|d| (d + Duration::days(1)).and_hms_opt(0, 0, 0)).map(|t| t.and_utc());
    let has = |k: &str| filters.has.iter().any(|h| h == k);
    let where_sql = "m.channel_id = ANY($1) AND m.kind = 'default'
        AND ($2::text IS NULL OR m.search @@ to_tsquery('simple', $2))
        AND ($3::uuid[] IS NULL OR m.author_id = ANY($3))
        AND ($4::uuid[] IS NULL OR m.mentions && $4)
        AND ($5::timestamptz IS NULL OR m.created_at < $5)
        AND ($6::timestamptz IS NULL OR m.created_at >= $6)
        AND ($7::bool IS NULL OR (m.pinned_at IS NOT NULL) = $7)
        AND (NOT $8 OR m.content ~* 'https?://')
        AND (NOT $9 OR EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'image/%'))
        AND (NOT $10 OR EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'video/%'))
        AND (NOT $11 OR EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id))
        AND (NOT $12 OR m.sticker_id IS NOT NULL)";
    macro_rules! bind_all {
        ($q:expr) => {
            $q.bind(&ids).bind(&tsq).bind(&from_ids).bind(&mention_ids).bind(before).bind(after).bind(filters.pinned)
                .bind(has("link")).bind(has("image")).bind(has("video")).bind(has("file")).bind(has("sticker"))
        };
    }
    let (total,): (i64,) = bind_all!(sqlx::query_as(&format!("SELECT COUNT(*) FROM messages m WHERE {where_sql}"))).fetch_one(&state.db).await?;
    let rows = bind_all!(sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE {where_sql} ORDER BY m.id DESC LIMIT 25 OFFSET $13")))
        .bind(p.offset.max(0))
        .fetch_all(&state.db)
        .await?;
    let names: HashMap<Uuid, (Option<Uuid>, String)> = channels.into_iter().map(|(id, g, n)| (id, (g, n))).collect();
    let results = hydrate(&state.db, rows, uid, false)
        .await?
        .into_iter()
        .map(|m| {
            let (guild_id, channel_name) = names.get(&m.channel_id).cloned().unwrap_or((None, String::new()));
            Hit { message: m, guild_id, channel_name }
        })
        .collect();
    Ok(SearchResult { total, offset: p.offset.max(0), results, filters })
}

async fn search(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(p): Query<SearchParams>) -> AppResult<Json<SearchResult>> {
    Ok(Json(run(&state, uid, &p).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_filters_and_text() {
        let f = parse("hello from:@Alice in:#general has:image has:link before:2026-01-02 after:2025-12-31 pinned:true world");
        assert_eq!(f.text, "hello world");
        assert_eq!(f.from, vec!["alice"]);
        assert_eq!(f.r#in, vec!["general"]);
        assert_eq!(f.has, vec!["image", "link"]);
        assert_eq!(f.before, NaiveDate::from_ymd_opt(2026, 1, 2));
        assert_eq!(f.after, NaiveDate::from_ymd_opt(2025, 12, 31));
        assert_eq!(f.pinned, Some(true));
    }

    #[test]
    fn unknown_or_malformed_filters_stay_text() {
        let f = parse("before:yesterday has:thing foo:bar url:http://x");
        assert_eq!(f.text, "before:yesterday has:thing foo:bar url:http://x");
        assert!(f.before.is_none() && f.has.is_empty());
    }

    #[test]
    fn tsquery_prefixes_each_word() {
        assert_eq!(tsquery("Hello wor").as_deref(), Some("hello:* & wor:*"));
        assert_eq!(tsquery("%_'\"").as_deref(), None, "punctuation-only input matches nothing");
        assert_eq!(tsquery("c'est  la-vie").as_deref(), Some("c:* & est:* & la:* & vie:*"));
    }
}
