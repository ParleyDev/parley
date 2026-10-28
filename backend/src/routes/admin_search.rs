//! Admin message search (docs/admin-access-and-server-deletion.md, Phase 3). There is no global search: an admin
//! searches either public Discover servers (`/admin/search/public`) or inside a case (`/admin/cases/:id/search`).
//! Results are metadata only (sender, conversation, time); opening a message's content is a separate, logged action.
//! Moderators and legal search public servers only under an open case; T&S leads may without one.
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Message, MessageRow},
    routes::{
        admin_access::{self, justification, log_case, Entry, Perm::*},
        cases,
        channels::{hydrate, MESSAGE_SELECT},
        search::tsquery,
    },
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/search/public", get(search_public))
        .route("/admin/search/public/:mid/open", post(open_public))
}

/// A search result before anyone opens it: who, where, when. No content.
#[derive(Debug, Serialize, FromRow)]
pub struct MetaHit {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub channel_name: String,
    pub guild_id: Option<Uuid>,
    pub guild_name: Option<String>,
    pub author_id: Uuid,
    pub author_username: String,
    pub created_at: DateTime<Utc>,
    pub has_attachments: bool,
}

/// Full-text search over these channels only (the scope is applied in the query), newest first, 50 per page.
pub async fn meta_search(state: &AppState, channels: &[Uuid], tsq: &str, before: Option<Uuid>, from: Option<DateTime<Utc>>, to: Option<DateTime<Utc>>) -> AppResult<Vec<MetaHit>> {
    Ok(sqlx::query_as::<_, MetaHit>(
        "SELECT m.id, m.channel_id, c.name AS channel_name, c.guild_id, g.name AS guild_name, m.author_id, u.username AS author_username, m.created_at,
                EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id) AS has_attachments
         FROM messages m JOIN channels c ON c.id = m.channel_id LEFT JOIN guilds g ON g.id = c.guild_id JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = ANY($1) AND m.kind = 'default' AND m.search @@ to_tsquery('simple', $2) AND ($3::uuid IS NULL OR m.id < $3)
           AND ($4::timestamptz IS NULL OR m.created_at >= $4) AND ($5::timestamptz IS NULL OR m.created_at <= $5)
         ORDER BY m.id DESC LIMIT 50",
    )
    .bind(channels).bind(tsq).bind(before).bind(from).bind(to)
    .fetch_all(&state.db).await?)
}

/// Text channels anyone can read in servers listed in Discover.
async fn public_channel_ids(state: &AppState) -> AppResult<Vec<Uuid>> {
    let guilds: Vec<(Uuid,)> = sqlx::query_as("SELECT guild_id FROM guild_discovery WHERE status = 'approved'").fetch_all(&state.db).await?;
    let mut out = Vec::new();
    for (g,) in guilds {
        if let Ok((_, chans)) = crate::routes::discovery::public_channels(&state.db, g).await { out.extend(chans.into_iter().map(|c| c.id)) }
    }
    Ok(out)
}

/// Public search is unbound for T&S leads; moderators and legal need an open case to search under.
async fn public_access(state: &AppState, uid: Uuid, case_id: Option<Uuid>) -> AppResult<(admin_access::Access, Option<Uuid>)> {
    let a = admin_access::require_perm(state, uid, ContentSearchPublic).await?;
    if let Some(cid) = case_id {
        cases::usable(&cases::load(state, cid).await?)?;
        return Ok((a, Some(cid)));
    }
    if a.public_search_unbound() { Ok((a, None)) } else { Err(AppError::BadRequest("Search public servers under an open case".into())) }
}

#[derive(Deserialize)]
struct PublicQuery {
    #[serde(default)]
    q: String,
    case_id: Option<Uuid>,
    before: Option<Uuid>,
    justification: Option<String>,
}

/// `GET /admin/search/public?q=&justification=&case_id=`: metadata for matching messages in public Discover channels.
async fn search_public(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Query(q): Query<PublicQuery>) -> AppResult<Json<Vec<MetaHit>>> {
    let (a, case_id) = public_access(&state, uid, q.case_id).await?;
    let why = justification(q.justification.as_deref())?;
    let Some(tsq) = tsquery(&q.q) else { return Ok(Json(vec![])) };
    let chans = public_channel_ids(&state).await?;
    let hits = meta_search(&state, &chans, &tsq, q.before, None, None).await?;
    let ids: Vec<Uuid> = hits.iter().map(|h| h.id).collect();
    log_case(&state, uid, &a.roles, &headers, case_id, Entry { action: "content.search_public", query: &q.q, filters: json!({ "before": q.before }), justification: &why, targets: &ids }).await?;
    Ok(Json(hits))
}

#[derive(Deserialize)]
struct OpenReq { justification: Option<String>, case_id: Option<Uuid> }

/// `POST /admin/search/public/:mid/open`: one public message's content. Logged.
async fn open_public(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path(mid): Path<Uuid>, Json(req): Json<OpenReq>) -> AppResult<Json<Message>> {
    let (a, case_id) = public_access(&state, uid, req.case_id).await?;
    let why = justification(req.justification.as_deref())?;
    let row = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.id = $1")).bind(mid).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Message not found".into()))?;
    if !public_channel_ids(&state).await?.contains(&row.channel_id) { return Err(AppError::Forbidden) }
    log_case(&state, uid, &a.roles, &headers, case_id, Entry { action: "content.open_public", query: "", filters: json!({ "channel_id": row.channel_id }), justification: &why, targets: &[mid] }).await?;
    Ok(Json(hydrate(&state.db, vec![row], uid, false).await?.pop().ok_or_else(|| AppError::NotFound("Message not found".into()))?))
}
