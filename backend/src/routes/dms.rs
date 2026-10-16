use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Channel, DmChannel, User},
    routes::{guilds::CHANNEL_COLS, users::USER_COLS},
    state::AppState,
};
use axum::{extract::{Path, State}, http::StatusCode, routing::{get, put}, Json, Router};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

pub const MAX_GROUP_MEMBERS: i64 = 10;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/@me/channels", get(list).post(open_dm))
        .route("/channels/:id/recipients/:uid", put(add_recipient).delete(remove_recipient))
}

pub async fn list_dm_channels(db: &PgPool, uid: Uuid) -> AppResult<Vec<DmChannel>> {
    let channels: Vec<(Uuid, Option<Uuid>, String, String, String, i32, DateTime<Utc>, Option<DateTime<Utc>>, Option<Uuid>, Option<String>)> = sqlx::query_as(
        "SELECT c.id, c.guild_id, c.name, c.kind, c.topic, c.position, c.created_at,
                (SELECT MAX(created_at) FROM messages WHERE channel_id = c.id), c.owner_id, c.icon_url
         FROM channels c JOIN channel_members cm ON cm.channel_id = c.id
         WHERE cm.user_id = $1 AND c.guild_id IS NULL
         ORDER BY 8 DESC NULLS LAST, c.created_at DESC",
    )
    .bind(uid)
    .fetch_all(db)
    .await?;
    let mut out = Vec::with_capacity(channels.len());
    for (id, guild_id, name, kind, topic, position, created_at, last, owner_id, icon_url) in channels {
        let recipients = recipients_for(db, id, uid).await?;
        out.push(DmChannel {
            channel: Channel { id, guild_id, name, kind, topic, position, created_at, owner_id, icon_url, parent_id: None, overwrites: vec![] },
            recipients,
            last_message_at: last,
        });
    }
    Ok(out)
}

/// Everyone in the channel except `uid`, oldest member first.
async fn recipients_for(db: &PgPool, channel_id: Uuid, uid: Uuid) -> AppResult<Vec<User>> {
    Ok(sqlx::query_as::<_, User>(&format!(
        "SELECT u.{} FROM users u JOIN channel_members cm ON cm.user_id = u.id WHERE cm.channel_id = $1 AND u.id <> $2 ORDER BY cm.joined_at, u.id",
        USER_COLS.replace(", ", ", u.")
    ))
    .bind(channel_id)
    .bind(uid)
    .fetch_all(db)
    .await?)
}

/// One member's view of a DM/group channel (recipients exclude themselves).
pub async fn dm_view(db: &PgPool, channel_id: Uuid, uid: Uuid) -> AppResult<DmChannel> {
    let channel = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(channel_id).fetch_one(db).await?;
    let last: Option<(Option<DateTime<Utc>>,)> = sqlx::query_as("SELECT MAX(created_at) FROM messages WHERE channel_id = $1").bind(channel_id).fetch_optional(db).await?;
    Ok(DmChannel { channel, recipients: recipients_for(db, channel_id, uid).await?, last_message_at: last.and_then(|l| l.0) })
}

async fn member_ids(db: &PgPool, channel_id: Uuid) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as("SELECT user_id FROM channel_members WHERE channel_id = $1 ORDER BY joined_at, user_id").bind(channel_id).fetch_all(db).await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// Insert a system notice ("X added Y") authored by the actor and push it to every member like a normal message.
/// `content` is the sentence after the actor's name.
pub async fn system_message(state: &AppState, channel_id: Uuid, actor: Uuid, kind: &str, content: &str, mentions: Vec<Uuid>) -> AppResult<()> {
    let mid = Uuid::now_v7();
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, kind, mentions) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(mid)
        .bind(channel_id)
        .bind(actor)
        .bind(content)
        .bind(kind)
        .bind(&mentions)
        .execute(&state.db)
        .await?;
    let msg = crate::routes::channels::fetch_message(&state.db, mid, actor).await?;
    crate::metrics::METRICS.messages_created.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    state.hub.emit(crate::ws::hub::Target::Users(member_ids(&state.db, channel_id).await?), "MESSAGE_CREATE", json!({ "message": msg, "guild_id": null }));
    Ok(())
}

/// Send every member their own view as CHANNEL_UPDATE (recipient lists differ per member).
pub async fn broadcast_group(state: &AppState, channel_id: Uuid) -> AppResult<()> {
    for m in member_ids(&state.db, channel_id).await? {
        let view = dm_view(&state.db, channel_id, m).await?;
        state.hub.emit_users(vec![m], "CHANNEL_UPDATE", json!(view));
    }
    Ok(())
}

async fn are_friends(db: &PgPool, a: Uuid, b: Uuid) -> AppResult<bool> {
    let r: Option<(bool,)> = sqlx::query_as("SELECT true FROM relationships WHERE user_id = $1 AND target_id = $2 AND kind = 'friend'").bind(a).bind(b).fetch_optional(db).await?;
    Ok(r.is_some())
}

async fn require_group_member(db: &PgPool, channel_id: Uuid, uid: Uuid) -> AppResult<Channel> {
    let c = sqlx::query_as::<_, Channel>(&format!(
        "SELECT c.{} FROM channels c JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $2 WHERE c.id = $1 AND c.kind = 'group'",
        CHANNEL_COLS.replace(", ", ", c.")
    ))
    .bind(channel_id)
    .bind(uid)
    .fetch_optional(db)
    .await?;
    c.ok_or_else(|| AppError::NotFound("Group not found".into()))
}

/// Add a friend to a group (any member may; up to 10 members).
async fn add_recipient(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    require_group_member(&state.db, id, uid).await?;
    if !are_friends(&state.db, uid, target).await? {
        return Err(AppError::BadRequest("You can only add your friends to a group".into()));
    }
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM channel_members WHERE channel_id = $1").bind(id).fetch_one(&state.db).await?;
    if count >= MAX_GROUP_MEMBERS {
        return Err(AppError::BadRequest(format!("Groups can have at most {MAX_GROUP_MEMBERS} members")));
    }
    let added = sqlx::query("INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(id).bind(target).execute(&state.db).await?.rows_affected();
    if added > 0 {
        state.hub.emit_users(vec![target], "CHANNEL_CREATE", json!(dm_view(&state.db, id, target).await?));
        broadcast_group(&state, id).await?;
        let name = crate::audit::username(&state, target).await;
        system_message(&state, id, uid, "recipient_add", &format!("added {name} to the group."), vec![target]).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Leave a group (yourself) or, as owner, remove someone. Ownership passes to the oldest member; an empty group is deleted.
async fn remove_recipient(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    let c = require_group_member(&state.db, id, uid).await?;
    if target != uid && c.owner_id != Some(uid) {
        return Err(AppError::Forbidden);
    }
    let removed = sqlx::query("DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2").bind(id).bind(target).execute(&state.db).await?.rows_affected();
    if removed == 0 {
        return Err(AppError::NotFound("Not a member".into()));
    }
    state.hub.emit_users(vec![target], "CHANNEL_DELETE", json!({ "id": id, "guild_id": null }));
    let remaining = member_ids(&state.db, id).await?;
    if remaining.is_empty() {
        sqlx::query("DELETE FROM channels WHERE id = $1").bind(id).execute(&state.db).await?;
        return Ok(StatusCode::NO_CONTENT);
    }
    if c.owner_id == Some(target) {
        sqlx::query("UPDATE channels SET owner_id = $2 WHERE id = $1").bind(id).bind(remaining[0]).execute(&state.db).await?;
    }
    state.hub.voice_evict(|v| v.channel_id == id && v.user_id == target);
    broadcast_group(&state, id).await?;
    if target == uid {
        system_message(&state, id, uid, "recipient_leave", "left the group.", vec![]).await?;
    } else {
        let name = crate::audit::username(&state, target).await;
        system_message(&state, id, uid, "recipient_remove", &format!("removed {name} from the group."), vec![target]).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

struct OpenDmOne {
    recipient_id: Uuid,
}

/// A fresh group with the caller as owner. Members must be friends of the creator.
async fn create_group(state: &AppState, uid: Uuid, ids: Vec<Uuid>, name: Option<String>) -> AppResult<(StatusCode, Json<DmChannel>)> {
    if ids.len() as i64 + 1 > MAX_GROUP_MEMBERS {
        return Err(AppError::BadRequest(format!("Groups can have at most {MAX_GROUP_MEMBERS} members")));
    }
    for id in &ids {
        if !are_friends(&state.db, uid, *id).await? {
            return Err(AppError::BadRequest("You can only add your friends to a group".into()));
        }
    }
    let cid = Uuid::now_v7();
    let name = name.map(|n| n.trim().chars().take(100).collect::<String>()).unwrap_or_default();
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO channels (id, guild_id, name, kind, owner_id) VALUES ($1, NULL, $2, 'group', $3)").bind(cid).bind(&name).bind(uid).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)").bind(cid).bind(uid).execute(&mut *tx).await?;
    for id in &ids {
        sqlx::query("INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2)").bind(cid).bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    for m in std::iter::once(uid).chain(ids.iter().copied()) {
        state.hub.emit_users(vec![m], "CHANNEL_CREATE", json!(dm_view(&state.db, cid, m).await?));
    }
    Ok((StatusCode::CREATED, Json(dm_view(&state.db, cid, uid).await?)))
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<DmChannel>>> {
    Ok(Json(list_dm_channels(&state.db, uid).await?))
}

#[derive(Deserialize)]
struct OpenDm {
    /// 1:1 DM (opens the existing one if any).
    recipient_id: Option<Uuid>,
    /// Two or more friends → a new group; exactly one behaves like `recipient_id`.
    #[serde(default)]
    recipient_ids: Vec<Uuid>,
    name: Option<String>,
}

async fn open_dm(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(req): Json<OpenDm>,
) -> AppResult<(StatusCode, Json<DmChannel>)> {
    let mut ids: Vec<Uuid> = req.recipient_ids.into_iter().filter(|r| *r != uid).collect();
    ids.sort();
    ids.dedup();
    if ids.len() >= 2 {
        return create_group(&state, uid, ids, req.name).await;
    }
    let recipient_id = ids.first().copied().or(req.recipient_id).ok_or_else(|| AppError::BadRequest("recipient_id required".into()))?;
    let req = OpenDmOne { recipient_id };
    if req.recipient_id == uid {
        return Err(AppError::BadRequest("Cannot DM yourself".into()));
    }
    let recipient = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1"))
        .bind(req.recipient_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    if crate::routes::relationships::blocked_either_way(&state.db, uid, req.recipient_id).await? {
        return Err(AppError::Forbidden);
    }
    // Find an existing 1:1 DM between the two users.
    let existing: Option<(Uuid,)> = sqlx::query_as(
        "SELECT c.id FROM channels c
         WHERE c.kind = 'dm'
           AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = $1)
           AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = $2)
         LIMIT 1",
    )
    .bind(uid)
    .bind(req.recipient_id)
    .fetch_optional(&state.db)
    .await?;

    let (channel, created) = match existing {
        Some((cid,)) => (
            sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1"))
                .bind(cid)
                .fetch_one(&state.db)
                .await?,
            false,
        ),
        None => {
            let mut tx = state.db.begin().await?;
            let cid = Uuid::now_v7();
            let c = sqlx::query_as::<_, Channel>(&format!(
                "INSERT INTO channels (id, guild_id, name, kind) VALUES ($1, NULL, 'dm', 'dm') RETURNING {CHANNEL_COLS}"
            ))
            .bind(cid)
            .fetch_one(&mut *tx)
            .await?;
            sqlx::query("INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)")
                .bind(cid)
                .bind(uid)
                .bind(req.recipient_id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            (c, true)
        }
    };

    let last: Option<(Option<DateTime<Utc>>,)> =
        sqlx::query_as("SELECT MAX(created_at) FROM messages WHERE channel_id = $1")
            .bind(channel.id)
            .fetch_optional(&state.db)
            .await?;

    let dm = DmChannel { channel: channel.clone(), recipients: vec![recipient], last_message_at: last.and_then(|l| l.0) };

    if created {
        // Notify both sides; each side gets the channel with the *other* party as recipient.
        let me = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1"))
            .bind(uid)
            .fetch_one(&state.db)
            .await?;
        state.hub.emit_users(vec![uid], "CHANNEL_CREATE", json!(dm));
        let other_view = DmChannel { channel, recipients: vec![me], last_message_at: None };
        state.hub.emit_users(vec![req.recipient_id], "CHANNEL_CREATE", json!(other_view));
    }
    Ok((if created { StatusCode::CREATED } else { StatusCode::OK }, Json(dm)))
}
