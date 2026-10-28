//! Official notices: messages from the instance itself, sent by its system account ("Parley", verified) as a DM the
//! person can read but not answer, the way Discord's official messages arrive. Admins send them when they act on a
//! report (to the reporter, the reported user, or both).
use crate::{
    error::{AppError, AppResult},
    models::{Channel, DmChannel, User},
    routes::{guilds::CHANNEL_COLS, users::USER_COLS},
    state::AppState,
};
use serde_json::json;
use uuid::Uuid;

/// The longest notice an admin can send.
pub const MAX_NOTICE: usize = 2000;

/// The system account, created the first time it's needed (`parley` if that name is free).
pub async fn system_user(state: &AppState) -> AppResult<Uuid> {
    if let Some((id,)) = sqlx::query_as::<_, (Uuid,)>("SELECT id FROM users WHERE system").fetch_optional(&state.db).await? { return Ok(id) }
    let mut name = "parley".to_string();
    for candidate in ["parley", "parley.system", "parley_system"] {
        let (taken,): (bool,) = sqlx::query_as("SELECT EXISTS (SELECT 1 FROM users WHERE username = $1)").bind(candidate).fetch_one(&state.db).await?;
        if !taken { name = candidate.into(); break }
        name = format!("parley_system_{}", &Uuid::now_v7().simple().to_string()[..6]);
    }
    let id = Uuid::now_v7();
    // Concurrent first uses: the unique index keeps it to one; whoever loses reads the winner.
    let made = sqlx::query("INSERT INTO users (id, username, display_name, email, password_hash, bot, verified_bot, system, email_verified_at, avatar_url, dm_privacy, message_requests, searchable)
                            VALUES ($1, $2, 'Parley', NULL, NULL, true, true, true, now(), '/brand/parley-neon-256.png', 'friends', false, false) ON CONFLICT DO NOTHING")
        .bind(id).bind(&name).execute(&state.db).await?;
    if made.rows_affected() == 1 { return Ok(id) }
    let (id,): (Uuid,) = sqlx::query_as("SELECT id FROM users WHERE system").fetch_one(&state.db).await?;
    Ok(id)
}

/// Send `content` to `to` from the system account, in their DM with it (opened, or reopened, as needed).
/// Accounts that are being deleted or are deleted get nothing.
pub async fn send(state: &AppState, to: Uuid, content: &str) -> AppResult<()> {
    let content: String = content.trim().chars().take(MAX_NOTICE).collect();
    if content.is_empty() { return Ok(()) }
    let (active,): (bool,) = sqlx::query_as("SELECT account_state = 'active' FROM users WHERE id = $1").bind(to).fetch_optional(&state.db).await?.unwrap_or((false,));
    if !active { return Ok(()) }
    let sys = system_user(state).await?;
    if sys == to { return Err(AppError::BadRequest("The system account can't message itself".into())) }
    let existing: Option<(Uuid,)> = sqlx::query_as(
        "SELECT c.id FROM channels c WHERE c.kind = 'dm'
           AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = $1)
           AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id = c.id AND user_id = $2) LIMIT 1")
        .bind(sys).bind(to).fetch_optional(&state.db).await?;
    let (cid, created) = match existing {
        Some((cid,)) => (cid, false),
        None => {
            let cid = Uuid::now_v7();
            let mut tx = state.db.begin().await?;
            sqlx::query("INSERT INTO channels (id, guild_id, name, kind) VALUES ($1, NULL, 'dm', 'dm')").bind(cid).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO channel_members (channel_id, user_id, request_state) VALUES ($1, $2, 'accepted'), ($1, $3, 'accepted')").bind(cid).bind(sys).bind(to).execute(&mut *tx).await?;
            tx.commit().await?;
            (cid, true)
        }
    };
    // A notice brings the conversation back if they had closed it.
    let reopened = sqlx::query("UPDATE channel_members SET closed = false WHERE channel_id = $1 AND user_id = $2 AND closed").bind(cid).bind(to).execute(&state.db).await?.rows_affected() > 0;
    let channel = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(cid).fetch_one(&state.db).await?;
    if created || reopened {
        let sys_user = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1")).bind(sys).fetch_one(&state.db).await?;
        let dm = DmChannel { spam_reasons: vec![], channel: channel.clone(), recipients: vec![sys_user], last_message_at: None, request_state: "accepted".into(), closed: false };
        state.hub.emit_users(vec![to], "CHANNEL_CREATE", json!(dm));
    }
    crate::routes::channels::system_message(state, &channel, sys, "default", &content, vec![], None, None).await?;
    Ok(())
}
