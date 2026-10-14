use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Channel, DmChannel, User},
    routes::{guilds::CHANNEL_COLS, users::USER_COLS},
    state::AppState,
};
use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/users/@me/channels", get(list).post(open_dm))
}

pub async fn list_dm_channels(db: &PgPool, uid: Uuid) -> AppResult<Vec<DmChannel>> {
    let channels: Vec<(Uuid, Option<Uuid>, String, String, String, i32, DateTime<Utc>, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT c.id, c.guild_id, c.name, c.kind, c.topic, c.position, c.created_at,
                (SELECT MAX(created_at) FROM messages WHERE channel_id = c.id)
         FROM channels c JOIN channel_members cm ON cm.channel_id = c.id
         WHERE cm.user_id = $1 AND c.guild_id IS NULL
         ORDER BY 8 DESC NULLS LAST, c.created_at DESC",
    )
    .bind(uid)
    .fetch_all(db)
    .await?;
    let mut out = Vec::with_capacity(channels.len());
    for (id, guild_id, name, kind, topic, position, created_at, last) in channels {
        let recipients = sqlx::query_as::<_, User>(&format!(
            "SELECT u.{} FROM users u JOIN channel_members cm ON cm.user_id = u.id WHERE cm.channel_id = $1 AND u.id <> $2",
            USER_COLS.replace(", ", ", u.")
        ))
        .bind(id)
        .bind(uid)
        .fetch_all(db)
        .await?;
        out.push(DmChannel {
            channel: Channel { id, guild_id, name, kind, topic, position, created_at, overwrites: vec![] },
            recipients,
            last_message_at: last,
        });
    }
    Ok(out)
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<DmChannel>>> {
    Ok(Json(list_dm_channels(&state.db, uid).await?))
}

#[derive(Deserialize)]
struct OpenDm {
    recipient_id: Uuid,
}

async fn open_dm(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Json(req): Json<OpenDm>,
) -> AppResult<(StatusCode, Json<DmChannel>)> {
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
