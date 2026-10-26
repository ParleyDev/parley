//! Announcement channels: other servers follow one into a channel of theirs, and published posts are copied there.

use crate::{auth::AuthUser, error::{AppError, AppResult}, models::Channel, perms, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::{delete, get, post}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::channels::{fetch_message, require_channel_perms, target_for};
use super::guilds::CHANNEL_COLS;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/followers", get(followers).post(follow))
        .route("/channels/:id/followers/:target", delete(unfollow))
        .route("/channels/:id/following", get(following))
        .route("/channels/:id/messages/:mid/crosspost", post(crosspost))
}

/// A server can follow at most this many announcement channels into one channel.
const MAX_FOLLOWS_PER_TARGET: i64 = 10;

#[derive(Deserialize)]
struct FollowReq { channel_id: Uuid }

/// `POST /channels/:id/followers`: follow announcement channel `id` into `channel_id` (a text channel where you have
/// Manage Channels).
async fn follow(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<FollowReq>) -> AppResult<(StatusCode, Json<Value>)> {
    let (src, _) = require_channel_perms(&state.db, id, uid).await?;
    if !src.news { return Err(AppError::BadRequest("That isn't an announcement channel".into())) }
    let (target, p) = require_channel_perms(&state.db, req.channel_id, uid).await?;
    if target.kind != "text" || target.guild_id.is_none() { return Err(AppError::BadRequest("Pick a text channel in a server".into())) }
    if target.id == src.id { return Err(AppError::BadRequest("A channel can't follow itself".into())) }
    perms::check(p, perms::MANAGE_CHANNELS)?;
    let (n,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM channel_follows WHERE target_id = $1").bind(target.id).fetch_one(&state.db).await?;
    if n >= MAX_FOLLOWS_PER_TARGET { return Err(AppError::BadRequest(format!("A channel can follow up to {MAX_FOLLOWS_PER_TARGET} announcement channels"))) }
    let res = sqlx::query("INSERT INTO channel_follows (source_id, target_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING").bind(src.id).bind(target.id).bind(uid).execute(&state.db).await?;
    if res.rows_affected() == 1 {
        let gname = crate::audit::guild_name(&state, src.guild_id.unwrap_or_default()).await;
        super::channels::system_message(&state, &target, uid, "channel_follow", &format!("added **{gname} #{}** to this channel. Its most important updates will show up here.", src.name), vec![], None, Some(src.id)).await?;
        if let Some(gid) = target.guild_id {
            crate::audit::guild(&state, gid, uid, "channel.follow", "channel", Some(target.id), &target.name, json!({ "source": format!("{gname} #{}", src.name) })).await;
        }
    }
    Ok((StatusCode::CREATED, Json(json!({ "source_id": src.id, "target_id": target.id }))))
}

/// `GET /channels/:id/followers` (Manage Channels on the announcement channel): where it is followed.
async fn followers(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    let (_, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    let rows: Vec<(Uuid, String, Uuid, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT c.id, c.name, g.id, g.name, f.created_at FROM channel_follows f JOIN channels c ON c.id = f.target_id JOIN guilds g ON g.id = c.guild_id WHERE f.source_id = $1 ORDER BY f.created_at")
        .bind(id).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(cid, cname, gid, gname, at)| json!({ "channel_id": cid, "channel_name": cname, "guild_id": gid, "guild_name": gname, "created_at": at })).collect()))
}

/// `GET /channels/:id/following` (Manage Channels): the announcement channels followed into this channel.
async fn following(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    let (_, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    let rows: Vec<(Uuid, String, Uuid, String, Option<String>)> = sqlx::query_as(
        "SELECT c.id, c.name, g.id, g.name, g.icon_url FROM channel_follows f JOIN channels c ON c.id = f.source_id JOIN guilds g ON g.id = c.guild_id WHERE f.target_id = $1 ORDER BY f.created_at")
        .bind(id).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(cid, cname, gid, gname, icon)| json!({ "channel_id": cid, "channel_name": cname, "guild_id": gid, "guild_name": gname, "guild_icon": icon })).collect()))
}

/// `DELETE /channels/:id/followers/:target`: stop following (Manage Channels on either end).
async fn unfollow(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    let src_ok = match require_channel_perms(&state.db, id, uid).await { Ok((_, p)) => perms::has(p, perms::MANAGE_CHANNELS), Err(_) => false };
    let dst_ok = match require_channel_perms(&state.db, target, uid).await { Ok((_, p)) => perms::has(p, perms::MANAGE_CHANNELS), Err(_) => false };
    if !src_ok && !dst_ok { return Err(AppError::Forbidden) }
    sqlx::query("DELETE FROM channel_follows WHERE source_id = $1 AND target_id = $2").bind(id).bind(target).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /channels/:id/messages/:mid/crosspost` ("Publish"): copy a post of an announcement channel to every channel
/// following it. The author may publish their own post; Manage Messages publishes anyone's. Once per post.
async fn crosspost(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, mid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Value>> {
    let (src, p) = require_channel_perms(&state.db, id, uid).await?;
    if !src.news { return Err(AppError::BadRequest("Only posts in announcement channels can be published".into())) }
    let msg = fetch_message(&state.db, mid, uid).await?;
    if msg.channel_id != id || msg.kind != "default" { return Err(AppError::NotFound("Message not found".into())) }
    if msg.author.id != uid { perms::check(p, perms::MANAGE_MESSAGES)?; } else { perms::check(p, perms::SEND_MESSAGES)?; }
    let res = sqlx::query("UPDATE messages SET crosspost = '{\"published\": true}'::jsonb WHERE id = $1 AND crosspost IS NULL").bind(mid).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::Conflict("This message has already been published".into())) }
    let gid = src.guild_id.unwrap_or_default();
    let (gname, gicon): (String, Option<String>) = sqlx::query_as("SELECT name, icon_url FROM guilds WHERE id = $1").bind(gid).fetch_one(&state.db).await?;
    let origin = json!({ "guild_id": gid, "guild_name": gname, "guild_icon": gicon, "channel_id": id, "channel_name": src.name, "message_id": mid });
    let targets = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id IN (SELECT target_id FROM channel_follows WHERE source_id = $1)")).bind(id).fetch_all(&state.db).await?;
    let mut sent = 0;
    for t in &targets {
        let new_id = Uuid::now_v7();
        let mut tx = state.db.begin().await?;
        sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, sticker_id, crosspost) VALUES ($1, $2, $3, $4, $5, $6)")
            .bind(new_id).bind(t.id).bind(msg.author.id).bind(&msg.content).bind(msg.sticker.as_ref().map(|s| s.id)).bind(&origin)
            .execute(&mut *tx).await?;
        for a in &msg.attachments {
            let aid = Uuid::new_v4();
            let dir = &state.config.upload_dir;
            if tokio::fs::copy(dir.join(a.id.to_string()), dir.join(aid.to_string())).await.is_err() { continue }
            sqlx::query("INSERT INTO attachments (id, message_id, uploader_id, channel_id, filename, content_type, size, width, height, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)")
                .bind(aid).bind(new_id).bind(msg.author.id).bind(t.id).bind(&a.filename).bind(&a.content_type).bind(a.size).bind(a.width).bind(a.height).bind(&a.description)
                .execute(&mut *tx).await?;
        }
        tx.commit().await?;
        let copy = fetch_message(&state.db, new_id, uid).await?;
        state.hub.emit(target_for(&state.db, t).await?, "MESSAGE_CREATE", json!({ "message": copy, "guild_id": t.guild_id }));
        crate::push::after_message(state.clone(), copy, t.clone());
        sent += 1;
    }
    let updated = fetch_message(&state.db, mid, uid).await?;
    state.hub.emit(target_for(&state.db, &src).await?, "MESSAGE_UPDATE", json!({ "message": updated, "guild_id": src.guild_id }));
    Ok(Json(json!({ "channels": sent, "message": updated })))
}
