//! Official notices: messages from the instance itself, sent by its system account ("Parley", verified) as a DM the
//! person can read but not answer, the way Discord's official messages arrive. Admins send them when they act on a
//! report (to the reporter, the reported user, or both), and post announcements (release notes) in a server channel
//! as that account.
use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Channel, DmChannel, Message, User},
    routes::{guilds::CHANNEL_COLS, users::USER_COLS},
    state::AppState,
};
use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};
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

#[derive(Deserialize)]
pub struct Announce {
    channel_id: Uuid,
    content: String,
    /// In an announcement channel, also publish it to every channel following it (the default).
    #[serde(default = "yes")]
    publish: bool,
}
fn yes() -> bool { true }

/// `POST /admin/announce` (Instance Manage): post `content` in a server's text or announcement channel as the system
/// account ("Parley"), the way release notes are announced. Mentions count (`@everyone` pings), and in an announcement
/// channel the post is published to its followers unless `publish` is false. Audited.
pub async fn announce(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<Announce>) -> AppResult<(StatusCode, Json<Value>)> {
    crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::InstanceManage).await?;
    let content = crate::routes::channels::tidy_content(&req.content);
    if content.trim().is_empty() || content.chars().count() > 2000 { return Err(AppError::BadRequest("Message must be 1-2000 characters".into())) }
    let c = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(req.channel_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;
    if c.guild_id.is_none() || c.kind != "text" { return Err(AppError::BadRequest("Announcements go in a server's text or announcement channel".into())) }
    let sys = system_user(&state).await?;
    let (m_users, m_roles, m_everyone) = crate::routes::channels::parse_mentions(&content);
    let mid = Uuid::now_v7();
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, mentions, mention_roles, mention_everyone) VALUES ($1, $2, $3, $4, $5, $6, $7)")
        .bind(mid).bind(c.id).bind(sys).bind(&content).bind(&m_users).bind(&m_roles).bind(m_everyone)
        .execute(&state.db).await?;
    crate::metrics::METRICS.messages_created.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let msg = crate::routes::channels::fetch_message(&state.db, mid, uid).await?;
    state.hub.emit(crate::routes::channels::target_for(&state.db, &c).await?, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": c.guild_id }));
    crate::push::after_message(state.clone(), msg.clone(), c.clone());
    let (published, msg): (Option<usize>, Message) = if c.news && req.publish {
        let (n, m) = crate::routes::announcements::publish(&state, &c, mid, uid).await?;
        (Some(n), m)
    } else { (None, msg) };
    audit::record(&state, uid, "announce.post", "channel", Some(c.id), &c.name, json!({ "message_id": mid, "published_to": published })).await;
    Ok((StatusCode::CREATED, Json(json!({ "message": msg, "published_to": published }))))
}
