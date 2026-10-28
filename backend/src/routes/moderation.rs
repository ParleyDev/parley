//! Admin content moderation: find any message, see what a user has posted and uploaded, purge it.

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Attachment, AttachmentJson, Message, MessageRow},
    routes::{admin_access, channels::{hydrate, MESSAGE_SELECT}, search::tsquery},
    state::AppState,
    ws::hub::Target,
};
use axum::{
    extract::{Path, Query, State},
    routing::{delete, get},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/messages", get(find_messages))
        .route("/admin/users/:id/content", get(user_content))
        .route("/admin/users/:id/messages", delete(purge_messages))
        .route("/admin/users/:id/uploads", delete(purge_uploads))
}

#[derive(Serialize)]
pub struct Hit {
    #[serde(flatten)]
    pub message: Message,
    pub guild_id: Option<Uuid>,
    pub guild_name: String,
    pub channel_name: String,
}

async fn decorate(state: &AppState, rows: Vec<MessageRow>, me: Uuid) -> AppResult<Vec<Hit>> {
    let cids: Vec<Uuid> = rows.iter().map(|r| r.channel_id).collect();
    let names: HashMap<Uuid, (Option<Uuid>, String, String)> = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, Option<String>)>(
        "SELECT c.id, c.guild_id, c.name, g.name FROM channels c LEFT JOIN guilds g ON g.id = c.guild_id WHERE c.id = ANY($1)",
    )
    .bind(&cids)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|(id, g, cn, gn)| (id, (g, gn.unwrap_or_default(), cn)))
    .collect();
    Ok(hydrate(&state.db, rows, me, false)
        .await?
        .into_iter()
        .map(|m| {
            let (guild_id, guild_name, channel_name) = names.get(&m.channel_id).cloned().unwrap_or((None, String::new(), String::new()));
            Hit { message: m, guild_id, guild_name, channel_name }
        })
        .collect())
}

#[derive(Deserialize)]
struct FindQuery {
    #[serde(default)]
    q: String,
    user_id: Option<Uuid>,
    before: Option<Uuid>,
    /// Required: why this search is needed (logged with it).
    justification: Option<String>,
}

/// Any message on the instance, newest first, 50 per page: free text (prefix full-text) and/or author.
/// Phase 0 lockdown: `SUPER_ADMIN_TEMP` only, a justification every time, and every search (with the ids it returned)
/// goes to the append-only access log.
async fn find_messages(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: axum::http::HeaderMap, Query(q): Query<FindQuery>) -> AppResult<Json<Vec<Hit>>> {
    let roles = admin_access::require_content_access(&state, uid).await?;
    let tsq = tsquery(&q.q);
    if tsq.is_none() && q.user_id.is_none() {
        return Ok(Json(vec![]));
    }
    let why = admin_access::justification(q.justification.as_deref())?;
    let rows = sqlx::query_as::<_, MessageRow>(&format!(
        "{MESSAGE_SELECT} WHERE m.kind = 'default' AND ($1::text IS NULL OR m.search @@ to_tsquery('simple', $1)) AND ($2::uuid IS NULL OR m.author_id = $2) AND ($3::uuid IS NULL OR m.id < $3) ORDER BY m.id DESC LIMIT 50"
    ))
    .bind(&tsq)
    .bind(q.user_id)
    .bind(q.before)
    .fetch_all(&state.db)
    .await?;
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    admin_access::log(&state, uid, &roles, &headers, admin_access::Entry {
        action: "content.search", query: &q.q, filters: json!({ "user_id": q.user_id, "before": q.before }), justification: &why, targets: &ids,
    }).await?;
    Ok(Json(decorate(&state, rows, uid).await?))
}

#[derive(Serialize)]
struct UploadRow {
    #[serde(flatten)]
    file: AttachmentJson,
    message_id: Option<Uuid>,
    channel_id: Uuid,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Serialize, sqlx::FromRow)]
struct ImageRow {
    id: Uuid,
    kind: String,
    content_type: String,
    size: i64,
    created_at: chrono::DateTime<chrono::Utc>,
    #[sqlx(skip)]
    url: String,
}

/// A user's recent messages and everything they uploaded, with totals. Message content: same lockdown as search.
async fn user_content(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: axum::http::HeaderMap, Path(id): Path<Uuid>, Query(j): Query<admin_access::Justified>) -> AppResult<Json<Value>> {
    let roles = admin_access::require_content_access(&state, uid).await?;
    let why = admin_access::justification(j.justification.as_deref())?;
    let user: Option<(String, String)> = sqlx::query_as("SELECT username, display_name FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let Some((username, display_name)) = user else { return Err(AppError::NotFound("User not found".into())) };
    let rows = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.author_id = $1 AND m.kind = 'default' ORDER BY m.id DESC LIMIT 50")).bind(id).fetch_all(&state.db).await?;
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    admin_access::log(&state, uid, &roles, &headers, admin_access::Entry { action: "content.user", query: "", filters: json!({ "user_id": id }), justification: &why, targets: &ids }).await?;
    let messages = decorate(&state, rows, uid).await?;
    let atts = sqlx::query_as::<_, Attachment>("SELECT id, message_id, uploader_id, channel_id, filename, content_type, size, width, height, created_at FROM attachments WHERE uploader_id = $1 ORDER BY created_at DESC LIMIT 200")
        .bind(id)
        .fetch_all(&state.db)
        .await?;
    let uploads: Vec<UploadRow> = atts.into_iter().map(|a| UploadRow { message_id: a.message_id, channel_id: a.channel_id, created_at: a.created_at, file: a.into() }).collect();
    let mut images = sqlx::query_as::<_, ImageRow>("SELECT id, kind, content_type, size, created_at FROM images WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 200").bind(id).fetch_all(&state.db).await?;
    for i in &mut images { i.url = crate::routes::images::image_url(i.id) }
    let (message_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM messages WHERE author_id = $1 AND kind = 'default'").bind(id).fetch_one(&state.db).await?;
    let (attachment_bytes,): (i64,) = sqlx::query_as("SELECT COALESCE(SUM(size), 0)::bigint FROM attachments WHERE uploader_id = $1").bind(id).fetch_one(&state.db).await?;
    let (image_bytes,): (i64,) = sqlx::query_as("SELECT COALESCE(SUM(size), 0)::bigint FROM images WHERE owner_id = $1").bind(id).fetch_one(&state.db).await?;
    Ok(Json(json!({
        "user": { "id": id, "username": username, "display_name": display_name },
        "messages": messages, "uploads": uploads, "images": images,
        "totals": { "messages": message_count, "attachments": uploads.len(), "attachment_bytes": attachment_bytes, "images": images.len(), "image_bytes": image_bytes },
        "quota": crate::routes::storage::quota(&state, id).await?,
        "quota_override": sqlx::query_as::<_, (Option<i64>,)>("SELECT upload_quota_bytes FROM users WHERE id = $1").bind(id).fetch_one(&state.db).await?.0,
    })))
}

/// Delete every message the user wrote. Open clients hear about the most recent 200; the rest vanish on reload.
async fn purge_messages(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::ContentAction).await?;
    let recent: Vec<(Uuid, Uuid, Option<Uuid>)> = sqlx::query_as("SELECT m.id, m.channel_id, c.guild_id FROM messages m JOIN channels c ON c.id = m.channel_id WHERE m.author_id = $1 ORDER BY m.id DESC LIMIT 200")
        .bind(id)
        .fetch_all(&state.db)
        .await?;
    let files: Vec<(Uuid,)> = sqlx::query_as("SELECT a.id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.author_id = $1").bind(id).fetch_all(&state.db).await?;
    let deleted = sqlx::query("DELETE FROM messages WHERE author_id = $1 AND kind = 'default'").bind(id).execute(&state.db).await?.rows_affected();
    // Their system notices (joins, pins…) go too, but are not counted as purged messages.
    sqlx::query("DELETE FROM messages WHERE author_id = $1").bind(id).execute(&state.db).await?;
    for (fid,) in files {
        let _ = tokio::fs::remove_file(state.config.upload_dir.join(fid.to_string())).await; let _ = tokio::fs::remove_file(state.config.upload_dir.join(format!("{fid}.thumb"))).await;
    }
    for (mid, cid, gid) in recent {
        let target = match gid { Some(g) => Target::Guild(g), None => Target::Users(sqlx::query_as::<_, (Uuid,)>("SELECT user_id FROM channel_members WHERE channel_id = $1").bind(cid).fetch_all(&state.db).await?.into_iter().map(|r| r.0).collect()) };
        state.hub.emit(target, "MESSAGE_DELETE", json!({ "id": mid, "channel_id": cid, "guild_id": gid }));
    }
    audit::record(&state, uid, "user.purge_messages", "user", Some(id), &audit::username(&state, id).await, json!({ "deleted": deleted })).await;
    Ok(Json(json!({ "deleted": deleted })))
}

/// Remove every file the user uploaded: attachments (their messages stay, minus the files) and profile images
/// (avatar/banner are cleared). Emoji and stickers they uploaded belong to servers and are left alone.
async fn purge_uploads(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::ContentAction).await?;
    let atts: Vec<(Uuid,)> = sqlx::query_as("DELETE FROM attachments WHERE uploader_id = $1 RETURNING id").bind(id).fetch_all(&state.db).await?;
    let imgs: Vec<(Uuid,)> = sqlx::query_as("DELETE FROM images WHERE owner_id = $1 AND kind IN ('avatar', 'banner', 'icon') RETURNING id").bind(id).fetch_all(&state.db).await?;
    for (fid,) in atts.iter().chain(imgs.iter()) {
        let _ = tokio::fs::remove_file(state.config.upload_dir.join(fid.to_string())).await; let _ = tokio::fs::remove_file(state.config.upload_dir.join(format!("{fid}.thumb"))).await;
    }
    sqlx::query("UPDATE users SET avatar_url = NULL, banner_url = NULL WHERE id = $1 AND (avatar_url LIKE '/api/images/%' OR banner_url LIKE '/api/images/%')").bind(id).execute(&state.db).await?;
    if let Ok(public) = sqlx::query_as::<_, crate::models::User>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::USER_COLS)).bind(id).fetch_one(&state.db).await {
        state.hub.emit_all("USER_UPDATE", json!(public));
    }
    audit::record(&state, uid, "user.purge_uploads", "user", Some(id), &audit::username(&state, id).await, json!({ "attachments": atts.len(), "images": imgs.len() })).await;
    Ok(Json(json!({ "attachments": atts.len(), "images": imgs.len() })))
}
