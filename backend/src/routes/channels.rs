use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Channel, Message, MessageRow, Pagination, Reaction},
    perms::{self, has},
    routes::attachments::{attachments_for, link},
    routes::guilds::{normalize_channel_name, CHANNEL_COLS},
    state::AppState,
    ws::hub::Target,
};
use crate::ratelimit::rl_messages;
use axum::{middleware::from_fn,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id", get(get_channel).patch(update_channel).delete(delete_channel))
        .route("/channels/:id/messages", get(list_messages).post(create_message).route_layer(from_fn(rl_messages)))
        .route("/channels/:id/messages/:mid", get(get_message).patch(edit_message).delete(delete_message))
        .route("/channels/:id/messages/bulk-delete", post(bulk_delete))
        .route("/channels/:id/voice-status", put(set_voice_status))
        .route("/channels/:id/voice-invite", post(voice_invite))
        .route("/channels/:id/messages/:mid/history", get(message_history))
        .route("/channels/:id/messages/:mid/reactions/:emoji", get(list_reactors).put(add_reaction).delete(remove_reaction))
        .route("/channels/:id/messages/:mid/reactions/:emoji/:user", axum::routing::delete(remove_user_reaction))
        .route("/channels/:id/messages/:mid/forward", post(forward_message))
        .route("/users/@me/bookmarks", get(list_bookmarks))
        .route("/users/@me/bookmarks/:mid", put(add_bookmark).delete(remove_bookmark).patch(move_bookmark))
        .route("/channels/:id/receipts", get(receipts))
        .route("/channels/:id/pins", get(list_pins))
        .route("/channels/:id/pins/:mid", put(pin_message).delete(unpin_message))
        .route("/channels/:id/search", get(search_messages))
        .route("/channels/:id/typing", post(typing))
        .route("/channels/:id/read", put(mark_read))
        .route("/channels/:id/permissions/:target", put(set_overwrite).delete(delete_overwrite))
        .route("/channels/:id/permissions-sync", post(sync_permissions))
}

/// Verify the user can access the channel. Returns the channel.
pub async fn require_channel(db: &PgPool, channel_id: Uuid, user_id: Uuid) -> AppResult<Channel> {
    Ok(require_channel_perms(db, channel_id, user_id).await?.0)
}

/// Channel (with overwrites) plus the caller's effective permissions in it.
/// Guild channels the caller cannot view are reported as not found. DMs grant everything to their members.
pub async fn require_channel_perms(db: &PgPool, channel_id: Uuid, user_id: Uuid) -> AppResult<(Channel, u64)> {
    let mut c = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1"))
        .bind(channel_id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;
    match c.guild_id {
        Some(_) => {
            perms::attach_overwrites(db, std::slice::from_mut(&mut c)).await?;
            let (_, p) = perms::channel_perms(db, &c, user_id).await.map_err(|_| AppError::NotFound("Channel not found".into()))?;
            if !has(p, perms::VIEW_CHANNEL) {
                return Err(AppError::NotFound("Channel not found".into()));
            }
            Ok((c, p))
        }
        None => {
            let ok: Option<(bool,)> =
                sqlx::query_as("SELECT true FROM channel_members WHERE channel_id = $1 AND user_id = $2")
                    .bind(channel_id)
                    .bind(user_id)
                    .fetch_optional(db)
                    .await?;
            if ok.is_none() {
                return Err(AppError::NotFound("Channel not found".into()));
            }
            Ok((c, perms::ALL))
        }
    }
}

pub async fn target_for(db: &PgPool, c: &Channel) -> AppResult<Target> {
    match c.guild_id {
        Some(_) => perms::channel_audience(db, c).await,
        None => {
            let rows: Vec<(Uuid,)> = sqlx::query_as("SELECT user_id FROM channel_members WHERE channel_id = $1")
                .bind(c.id)
                .fetch_all(db)
                .await?;
            Ok(Target::Users(rows.into_iter().map(|r| r.0).collect()))
        }
    }
}

async fn get_channel(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Channel>> {
    Ok(Json(require_channel(&state.db, id, uid).await?))
}

#[derive(Deserialize)]
struct UpdateChannel {
    name: Option<String>,
    topic: Option<String>,
    /// Group DMs: empty string clears.
    icon_url: Option<String>,
    /// Group DMs: hand the group to another member (owner only).
    owner_id: Option<Uuid>,
    /// Guild channels: move under a category (null = top level).
    #[serde(default, deserialize_with = "crate::routes::roles::deserialize_nullable_uuid")]
    parent_id: Option<Option<Uuid>>,
    position: Option<i32>,
    /// Guild text channels: age-restricted.
    nsfw: Option<bool>,
    /// Guild text channels: spoiler warning before viewing.
    spoiler: Option<bool>,
    /// Voice channels: 'auto' or 'full'.
    video_quality: Option<String>,
    /// Forums: 'gallery' | 'list', 'activity' | 'created', require a tag, default reaction ('' for none).
    forum_layout: Option<String>,
    forum_sort: Option<String>,
    forum_require_tag: Option<bool>,
    forum_default_reaction: Option<String>,
    /// Text channels: announcement channel. Forums: media channel.
    news: Option<bool>,
    media: Option<bool>,
    /// Voice/stage/studio audio profile: 'voice' | 'music'.
    audio_mode: Option<String>,
    /// Opus kbps, 8..510, or 0 for the mode's default.
    audio_bitrate: Option<i32>,
    audio_low_latency: Option<bool>,
    /// Voice/stage/studio channels (Manage Channels) and DM / group calls (any member): end-to-end encrypted calls.
    e2ee: Option<bool>,
    /// Server text channels, forums and threads: slowmode in seconds (0 to 21600).
    rate_limit_per_user: Option<i32>,
    /// Voice channels: most people allowed in at once (0 = no limit, up to 99).
    user_limit: Option<i32>,
}

/// Call encryption was switched on or off: anyone in the call whose client can't encrypt is dropped from it (their
/// media would be readable, or unreadable to everyone else). Clients that can encrypt rejoin on their own to rekey.
fn call_e2ee_changed(state: &AppState, channel_id: Uuid, on: bool) {
    if on {
        state.hub.voice_evict(|v| v.channel_id == channel_id && !v.e2ee);
    }
}

async fn update_channel(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateChannel>,
) -> AppResult<Json<Channel>> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    if c.guild_id.is_none() {
        // DM and group calls: any member may switch end-to-end encryption on or off.
        if let Some(on) = req.e2ee.filter(|on| *on != c.e2ee) {
            sqlx::query("UPDATE channels SET e2ee = $2 WHERE id = $1").bind(id).bind(on).execute(&state.db).await?;
            call_e2ee_changed(&state, id, on);
            crate::routes::dms::broadcast_group(&state, id).await?;
            let text = if on { "turned on end-to-end encryption for calls." } else { "turned off end-to-end encryption for calls." };
            crate::routes::dms::system_message(&state, id, uid, "call_e2ee_change", text, vec![]).await?;
        }
        // Group DMs: any member may rename or change the icon.
        if c.kind != "group" {
            if req.e2ee.is_some() && req.name.is_none() && req.icon_url.is_none() && req.owner_id.is_none() {
                return Ok(Json(sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(id).fetch_one(&state.db).await?));
            }
            return Err(AppError::BadRequest("Cannot edit DM channels".into()));
        }
        crate::routes::users::validate_image(&req.icon_url)?;
        let name = req.name.map(|n| n.trim().chars().take(100).collect::<String>());
        let renamed = name.as_ref().map(|n| *n != c.name).unwrap_or(false);
        let icon_changed = req.icon_url.as_ref().map(|u| u.as_str() != c.icon_url.as_deref().unwrap_or("")).unwrap_or(false);
        sqlx::query("UPDATE channels SET name = COALESCE($2, name), icon_url = CASE WHEN $3::text IS NULL THEN icon_url WHEN $3 = '' THEN NULL ELSE $3 END WHERE id = $1")
            .bind(id)
            .bind(&name)
            .bind(req.icon_url)
            .execute(&state.db)
            .await?;
        crate::routes::dms::broadcast_group(&state, id).await?;
        if renamed {
            let n = name.clone().unwrap_or_default();
            let text = if n.is_empty() { "cleared the group name.".to_string() } else { format!("changed the group name to {n}.") };
            crate::routes::dms::system_message(&state, id, uid, "channel_name_change", &text, vec![]).await?;
        }
        if icon_changed {
            crate::routes::dms::system_message(&state, id, uid, "channel_icon_change", "changed the group icon.", vec![]).await?;
        }
        if let Some(new_owner) = req.owner_id.filter(|o| Some(*o) != c.owner_id) {
            if c.owner_id != Some(uid) {
                return Err(AppError::Forbidden);
            }
            let member: Option<(bool,)> = sqlx::query_as("SELECT true FROM channel_members WHERE channel_id = $1 AND user_id = $2").bind(id).bind(new_owner).fetch_optional(&state.db).await?;
            if member.is_none() {
                return Err(AppError::BadRequest("That user is not in the group".into()));
            }
            sqlx::query("UPDATE channels SET owner_id = $2 WHERE id = $1").bind(id).bind(new_owner).execute(&state.db).await?;
            crate::routes::dms::broadcast_group(&state, id).await?;
            let name = crate::audit::username(&state, new_owner).await;
            crate::routes::dms::system_message(&state, id, uid, "channel_owner_change", &format!("made {name} the group owner."), vec![new_owner]).await?;
        }
        return Ok(Json(sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(id).fetch_one(&state.db).await?));
    }
    perms::check(p, perms::MANAGE_CHANNELS)?;
    if let Some(m) = &req.audio_mode {
        if m != "voice" && m != "music" {
            return Err(AppError::BadRequest("audio_mode must be 'voice' or 'music'".into()));
        }
    }
    if let Some(b) = req.audio_bitrate {
        if b != 0 && !(8..=510).contains(&b) {
            return Err(AppError::BadRequest("audio_bitrate must be 8-510 kbps (or 0 for the default)".into()));
        }
    }
    if let Some(n) = req.user_limit {
        if !(0..=99).contains(&n) { return Err(AppError::BadRequest("User limit must be 0 (none) to 99".into())) }
    }
    if let Some(s) = req.rate_limit_per_user {
        if !(0..=21600).contains(&s) { return Err(AppError::BadRequest("Slowmode must be 0 to 21600 seconds (6 hours)".into())) }
    }
    if req.e2ee == Some(true) && !matches!(c.kind.as_str(), "voice" | "stage" | "studio") {
        return Err(AppError::BadRequest("Only voice, stage and studio channels have calls to encrypt".into()));
    }
    let name = match req.name {
        Some(n) => Some(normalize_channel_name(&n, &c.kind)?),
        None => None,
    };
    let gid = c.guild_id.unwrap_or_default();
    if req.video_quality.as_deref().map(|q| q != "auto" && q != "full").unwrap_or(false) {
        return Err(AppError::BadRequest("video_quality must be 'auto' or 'full'".into()));
    }
    if req.forum_layout.as_deref().map(|q| q != "gallery" && q != "list").unwrap_or(false) || req.forum_sort.as_deref().map(|q| q != "activity" && q != "created").unwrap_or(false) {
        return Err(AppError::BadRequest("forum_layout is 'gallery' or 'list'; forum_sort is 'activity' or 'created'".into()));
    }
    if req.news == Some(true) && c.kind != "text" { return Err(AppError::BadRequest("Only text channels can be announcement channels".into())) }
    if req.media == Some(true) && c.kind != "forum" { return Err(AppError::BadRequest("Only forums can be media channels".into())) }
    let reaction = req.forum_default_reaction.as_ref().map(|r| r.trim().chars().take(64).collect::<String>());
    let parent = match req.parent_id {
        Some(p) => Some(crate::routes::guilds::check_parent(&state.db, gid, &c.kind, p).await?),
        None => None,
    };
    let before = if parent.is_some() { Some(perms::visibility(&state.db, gid).await?) } else { None };
    let mut updated = sqlx::query_as::<_, Channel>(&format!(
        "UPDATE channels SET name = COALESCE($2, name), topic = COALESCE($3, topic), position = COALESCE($4, position),
         parent_id = CASE WHEN $5 THEN $6 ELSE parent_id END, nsfw = COALESCE($7, nsfw),
         audio_mode = COALESCE($8, audio_mode), audio_bitrate = COALESCE($9, audio_bitrate), audio_low_latency = COALESCE($10, audio_low_latency), e2ee = COALESCE($11, e2ee),
         rate_limit_per_user = COALESCE($12, rate_limit_per_user), user_limit = COALESCE($13, user_limit), spoiler = COALESCE($14, spoiler), video_quality = COALESCE($15, video_quality),
         forum_layout = COALESCE($16, forum_layout), forum_sort = COALESCE($17, forum_sort), forum_require_tag = COALESCE($18, forum_require_tag), forum_default_reaction = COALESCE($19, forum_default_reaction),
         news = COALESCE($20, news), media = COALESCE($21, media)
         WHERE id = $1 RETURNING {CHANNEL_COLS}"
    ))
    .bind(id)
    .bind(name)
    .bind(req.topic.map(|t| t.chars().take(1024).collect::<String>()))
    .bind(req.position)
    .bind(parent.is_some())
    .bind(parent.flatten())
    .bind(req.nsfw)
    .bind(&req.audio_mode)
    .bind(req.audio_bitrate)
    .bind(req.audio_low_latency)
    .bind(req.e2ee)
    .bind(req.rate_limit_per_user)
    .bind(req.user_limit)
    .bind(req.spoiler)
    .bind(&req.video_quality)
    .bind(&req.forum_layout)
    .bind(&req.forum_sort)
    .bind(req.forum_require_tag)
    .bind(&reaction)
    .bind(req.news)
    .bind(req.media)
    .fetch_one(&state.db)
    .await?;
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut updated)).await?;
    if let Some(before) = before {
        perms::resync_visibility(&state, gid, &before).await?;
    }
    if updated.e2ee != c.e2ee {
        call_e2ee_changed(&state, id, updated.e2ee);
    }
    let target = perms::channel_audience(&state.db, &updated).await?;
    state.hub.emit(target, "CHANNEL_UPDATE", json!(updated));
    if let Some(gid) = updated.guild_id {
        let mut d = serde_json::Map::new();
        if updated.name != c.name { d.insert("name".into(), json!(updated.name)); }
        if updated.topic != c.topic { d.insert("topic".into(), json!(updated.topic)); }
        if updated.news != c.news { d.insert("news".into(), json!(updated.news)); }
        if updated.media != c.media { d.insert("media".into(), json!(updated.media)); }
        if updated.spoiler != c.spoiler { d.insert("spoiler".into(), json!(updated.spoiler)); }
        if updated.video_quality != c.video_quality { d.insert("video_quality".into(), json!(updated.video_quality)); }
        if updated.audio_mode != c.audio_mode { d.insert("audio_mode".into(), json!(updated.audio_mode)); }
        if updated.audio_bitrate != c.audio_bitrate { d.insert("audio_bitrate".into(), json!(updated.audio_bitrate)); }
        if updated.audio_low_latency != c.audio_low_latency { d.insert("audio_low_latency".into(), json!(updated.audio_low_latency)); }
        if updated.e2ee != c.e2ee { d.insert("e2ee".into(), json!(updated.e2ee)); }
        if updated.rate_limit_per_user != c.rate_limit_per_user { d.insert("slowmode".into(), json!(updated.rate_limit_per_user)); }
        if updated.user_limit != c.user_limit { d.insert("user_limit".into(), json!(updated.user_limit)); }
        crate::audit::guild(&state, gid, uid, "channel.update", "channel", Some(id), &updated.name, serde_json::Value::Object(d)).await;
    }
    Ok(Json(updated))
}

async fn delete_channel(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    let gid = c.guild_id.ok_or_else(|| AppError::BadRequest("Cannot delete DM channels".into()))?;
    perms::check(p, perms::MANAGE_CHANNELS)?;
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM channels WHERE guild_id = $1 AND kind = 'text'")
        .bind(gid)
        .fetch_one(&state.db)
        .await?;
    if c.kind == "text" && count <= 1 {
        return Err(AppError::BadRequest("A server must keep at least one text channel".into()));
    }
    sqlx::query("DELETE FROM channels WHERE id = $1").bind(id).execute(&state.db).await?;
    state.hub.voice_evict(|v| v.channel_id == id);
    state.hub.emit_guild(gid, "CHANNEL_DELETE", json!({ "id": id, "guild_id": gid }));
    crate::audit::guild(&state, gid, uid, "channel.delete", "channel", Some(id), &c.name, json!({ "kind": c.kind })).await;
    Ok(StatusCode::NO_CONTENT)
}

pub const MESSAGE_SELECT: &str = "SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to, m.created_at, m.edited_at, m.pinned_at,
    u.username, u.display_name, u.avatar_url, m.sticker_id, s.name AS sticker_name, s.animated AS sticker_animated, m.forwarded_from,
    m.mentions, m.mention_roles, m.mention_everyone, m.kind, m.ref_id, m.suppress_embeds, m.tts, m.crosspost, m.webhook_id, m.author_override, m.embeds, m.interaction, m.components, u.avatar_decoration, u.clan_tag, u.clan_tag_guild AS author_clan_tag_guild, u.bot AS author_bot, u.verified_bot AS author_verified_bot, u.name_primary AS author_name_primary, u.name_accent AS author_name_accent, u.name_style AS author_name_style
    FROM messages m JOIN users u ON u.id = m.author_id LEFT JOIN stickers s ON s.id = m.sticker_id";

async fn reactions_for(db: &PgPool, ids: &[Uuid], me: Uuid) -> AppResult<HashMap<Uuid, Vec<Reaction>>> {
    let mut map: HashMap<Uuid, Vec<Reaction>> = HashMap::new();
    if ids.is_empty() {
        return Ok(map);
    }
    let rows: Vec<(Uuid, String, i64, bool, bool)> = sqlx::query_as(
        "SELECT message_id, emoji, COUNT(*), bool_or(user_id = $2), burst FROM reactions
         WHERE message_id = ANY($1) GROUP BY message_id, emoji, burst ORDER BY MIN(created_at), burst",
    )
    .bind(ids)
    .bind(me)
    .fetch_all(db)
    .await?;
    for (mid, emoji, count, me, burst) in rows {
        map.entry(mid).or_default().push(Reaction { emoji, count, me, burst });
    }
    Ok(map)
}

/// Insert a system notice ("X pinned a message") authored by the actor and push it to the channel's audience like a normal
/// message. `content` is the sentence after the actor's name; `reply_to` links a related message, `ref_id` a related object.
pub async fn system_message(state: &AppState, c: &Channel, actor: Uuid, kind: &str, content: &str, mentions: Vec<Uuid>, reply_to: Option<Uuid>, ref_id: Option<Uuid>) -> AppResult<Message> {
    let mid = Uuid::now_v7();
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, kind, mentions, reply_to, ref_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)")
        .bind(mid).bind(c.id).bind(actor).bind(content).bind(kind).bind(&mentions).bind(reply_to).bind(ref_id)
        .execute(&state.db)
        .await?;
    let msg = fetch_message(&state.db, mid, actor).await?;
    crate::metrics::METRICS.messages_created.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let target = target_for(&state.db, c).await?;
    state.hub.emit(target, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": c.guild_id }));
    Ok(msg)
}

/// Human length of a call: "a few seconds", "4 minutes", "1 hour 12 minutes".
pub fn call_duration(secs: u64) -> String {
    if secs < 60 { return "a few seconds".into() }
    let (h, m) = (secs / 3600, (secs % 3600) / 60);
    let mins = |m: u64| format!("{m} minute{}", if m == 1 { "" } else { "s" });
    if h == 0 { mins(m) } else if m == 0 { format!("{h} hour{}", if h == 1 { "" } else { "s" }) } else { format!("{h} hour{} {}", if h == 1 { "" } else { "s" }, mins(m)) }
}

/// The last person left a DM call: turn its "started a call." notice into "started a call that lasted N minutes."
/// (call_ended) or, if nobody else ever picked up, a missed call (call_missed).
pub async fn finish_call(state: &AppState, channel_id: Uuid, call: crate::ws::hub::CallInfo) -> AppResult<()> {
    let (kind, content) = if call.answered {
        ("call_ended", format!("started a call that lasted {}.", call_duration(call.started_at.elapsed().as_secs())))
    } else {
        ("call_missed", "started a call. No one answered.".to_string())
    };
    sqlx::query("UPDATE messages SET kind = $1, content = $2 WHERE id = $3 AND kind = 'call_started'")
        .bind(kind).bind(&content).bind(call.message_id).execute(&state.db).await?;
    let Some(mut c) = sqlx::query_as::<_, Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS))
        .bind(channel_id).fetch_optional(&state.db).await? else { return Ok(()) };
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut c)).await?;
    let msg = fetch_message(&state.db, call.message_id, call.starter).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": c.guild_id }));
    Ok(())
}

/// Post a server-wide notice ("X joined the server") to the guild's system channel: the one chosen in Server
/// Settings, else its first text channel. Join notices can be switched off.
pub async fn guild_system_message(state: &AppState, guild_id: Uuid, actor: Uuid, kind: &str, content: &str) -> AppResult<()> {
    let (chosen, joins): (Option<Uuid>, bool) = sqlx::query_as("SELECT system_channel_id, join_notices FROM guilds WHERE id = $1").bind(guild_id).fetch_one(&state.db).await?;
    if kind == "member_join" && !joins { return Ok(()) }
    let Some(mut c) = sqlx::query_as::<_, Channel>(&format!(
        "SELECT {} FROM channels WHERE guild_id = $1 AND kind = 'text' ORDER BY (id = $2) DESC, position, created_at LIMIT 1", crate::routes::guilds::CHANNEL_COLS))
        .bind(guild_id).bind(chosen).fetch_optional(&state.db).await? else { return Ok(()) };
    perms::attach_overwrites(&state.db, std::slice::from_mut(&mut c)).await?;
    system_message(state, &c, actor, kind, content, vec![], None, None).await?;
    Ok(())
}

/// `GET /channels/:id/messages/:mid`: one message (message link previews).
/// 18+ channels (or threads under one): only people with a birth date on file who are 18 or older.
pub async fn check_age(db: &PgPool, c: &Channel, uid: Uuid) -> AppResult<()> {
    let nsfw = c.nsfw || (c.kind == "thread" && match c.parent_id {
        Some(p) => sqlx::query_as::<_, (bool,)>("SELECT nsfw FROM channels WHERE id = $1").bind(p).fetch_optional(db).await?.map(|r| r.0).unwrap_or(false),
        None => false,
    });
    if !nsfw { return Ok(()) }
    let (adult, known): (bool, bool) = sqlx::query_as("SELECT COALESCE(birthdate <= (now() - interval '18 years')::date, false), birthdate IS NOT NULL FROM users WHERE id = $1").bind(uid).fetch_one(db).await?;
    if adult { Ok(()) } else { Err(AppError::AgeGate(known)) }
}

async fn get_message(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, mid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Message>> {
    let c = require_channel(&state.db, id, uid).await?;
    check_age(&state.db, &c, uid).await?;
    let m = fetch_message(&state.db, mid, uid).await?;
    if m.channel_id != id {
        return Err(AppError::NotFound("Message not found".into()));
    }
    Ok(Json(m))
}

pub async fn fetch_message(db: &PgPool, mid: Uuid, me: Uuid) -> AppResult<Message> {
    let row = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.id = $1"))
        .bind(mid)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Message not found".into()))?;
    Ok(hydrate(db, vec![row], me, false).await?.pop().ok_or_else(|| AppError::NotFound("Message not found".into()))?)
}

async fn list_messages(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Query(p): Query<Pagination>,
) -> AppResult<Json<Vec<Message>>> {
    let (c, perm) = require_channel_perms(&state.db, id, uid).await?;
    check_age(&state.db, &c, uid).await?;
    // Without Read Message History you only see what arrives while you're looking.
    if c.guild_id.is_some() && !has(perm, perms::READ_MESSAGE_HISTORY) { return Ok(Json(Vec::new())) }
    let limit = p.limit.unwrap_or(50).clamp(1, 100);
    if let Some(anchor) = p.around {
        let half = limit / 2;
        let mut older = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.id <= $2 ORDER BY m.id DESC LIMIT $3"))
            .bind(id).bind(anchor).bind(half).fetch_all(&state.db).await?;
        older.reverse();
        let newer = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT $3"))
            .bind(id).bind(anchor).bind(limit - half).fetch_all(&state.db).await?;
        older.extend(newer);
        return Ok(Json(hydrate(&state.db, older, uid, false).await?));
    }
    if let Some(after) = p.after {
        let rows = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT $3"))
            .bind(id).bind(after).bind(limit).fetch_all(&state.db).await?;
        return Ok(Json(hydrate(&state.db, rows, uid, false).await?));
    }
    let rows = match p.before {
        Some(b) => {
            sqlx::query_as::<_, MessageRow>(&format!(
                "{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.id < $2 ORDER BY m.id DESC LIMIT $3"
            ))
            .bind(id)
            .bind(b)
            .bind(limit)
            .fetch_all(&state.db)
            .await?
        }
        None => {
            sqlx::query_as::<_, MessageRow>(&format!(
                "{MESSAGE_SELECT} WHERE m.channel_id = $1 ORDER BY m.id DESC LIMIT $2"
            ))
            .bind(id)
            .bind(limit)
            .fetch_all(&state.db)
            .await?
        }
    };
    Ok(Json(hydrate(&state.db, rows, uid, true).await?))
}

#[derive(Deserialize)]
struct CreateMessage {
    #[serde(default)]
    content: String,
    reply_to: Option<Uuid>,
    #[serde(default)]
    attachment_ids: Vec<Uuid>,
    sticker_id: Option<Uuid>,
    poll: Option<crate::routes::polls::PollInput>,
    /// Alt text for the attachments being sent, by attachment id.
    #[serde(default)]
    attachment_descriptions: HashMap<Uuid, String>,
    /// Read it aloud (needs Send TTS Messages in a server; quietly ignored without it).
    #[serde(default)]
    tts: bool,
    /// Bots only: up to 10 rich embeds (see `webhooks::clean_embeds`).
    embeds: Option<serde_json::Value>,
    /// Bots only: buttons and select menus (see `interactions::clean_components`).
    components: Option<serde_json::Value>,
}

async fn create_message(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<CreateMessage>,
) -> AppResult<(StatusCode, Json<Message>)> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::SEND_MESSAGES)?;
    check_age(&state.db, &c, uid).await?;
    if let Some(gid) = c.guild_id {
        crate::routes::guilds::check_rules(&state.db, gid, uid).await?;
    }
    if c.kind == "category" {
        return Err(AppError::BadRequest("Categories cannot hold messages".into()));
    }
    if c.kind == "forum" {
        return Err(AppError::BadRequest("Forum channels hold posts: create a post instead".into()));
    }
    if c.kind == "directory" {
        return Err(AppError::BadRequest("Directory channels list servers; they don't hold messages".into()));
    }
    if c.kind == "thread" { crate::routes::threads::check_locked(&state.db, c.id, p).await?; }
    if let Some(gid) = c.guild_id { check_verification(&state.db, gid, uid).await?; }
    check_slowmode(&state.db, &c, p, uid).await?;
    let content = req.content.trim_end().to_string();
    let embeds = match &req.embeds {
        Some(e) if !(e.is_array() && e.as_array().map(|a| a.is_empty()).unwrap_or(true)) => {
            let (bot,): (bool,) = sqlx::query_as("SELECT bot FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
            if !bot { return Err(AppError::BadRequest("Only bots and webhooks can send embeds".into())) }
            Some(crate::routes::webhooks::clean_embeds(e)?)
        }
        _ => None,
    };
    let components = match &req.components {
        Some(v) if v.as_array().map(|a| !a.is_empty()).unwrap_or(false) => {
            let (bot,): (bool,) = sqlx::query_as("SELECT bot FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
            if !bot { return Err(AppError::BadRequest("Only bots can send buttons and menus".into())) }
            Some(crate::routes::interactions::clean_components(v)?)
        }
        _ => None,
    };
    if (content.trim().is_empty() && req.attachment_ids.is_empty() && req.sticker_id.is_none() && req.poll.is_none() && embeds.is_none()) || content.chars().count() > 2000 {
        return Err(AppError::BadRequest("Message must be 1-2000 characters".into()));
    }
    if let Some(sid) = req.sticker_id {
        if !crate::routes::expressions::sendable_sticker(&state.db, sid, uid).await? {
            return Err(AppError::BadRequest("Unknown sticker".into()));
        }
    }
    if !req.attachment_ids.is_empty() && c.guild_id.is_some() {
        perms::check(p, perms::ATTACH_FILES)?;
    }
    if c.guild_id.is_none() && c.kind == "dm" {
        // 1:1 DMs: either side blocking the other closes the channel to new messages. Groups stay open.
        let others: Vec<(Uuid,)> = sqlx::query_as("SELECT user_id FROM channel_members WHERE channel_id = $1 AND user_id <> $2").bind(id).bind(uid).fetch_all(&state.db).await?;
        for (other,) in others {
            if crate::routes::relationships::blocked_either_way(&state.db, uid, other).await? || !crate::routes::dms::can_dm(&state.db, uid, other).await? {
                return Err(AppError::Undeliverable);
            }
            crate::routes::dms::spam_check(&state, id, uid, other, &req.content).await;
        }
    }
    if let Some(r) = req.reply_to {
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM messages WHERE id = $1 AND channel_id = $2")
            .bind(r)
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
        if ok.is_none() {
            return Err(AppError::BadRequest("Reply target not in this channel".into()));
        }
    }
    let mid = Uuid::now_v7();
    let (m_users, m_roles, m_everyone) = parse_mentions(&content);
    // @everyone only counts inside a server for members allowed to use it (it still renders as text otherwise).
    let m_everyone = m_everyone && c.guild_id.is_some() && has(p, perms::MENTION_EVERYONE);
    let m_roles = mentionable_roles(&state.db, c.guild_id, m_roles, has(p, perms::MENTION_EVERYONE)).await?;
    crate::routes::automod::check_message(&state, &c, uid, p, &content, m_users.len() + m_roles.len() + usize::from(m_everyone)).await?;
    crate::routes::safety::check_links(&state, &content).await?;
    if c.guild_id.is_none() { crate::routes::safety::check_dm_spam(&state, uid, id).await?; }
    let mut tx = state.db.begin().await?;
    let tts = req.tts && !content.trim().is_empty() && (c.guild_id.is_none() || has(p, perms::SEND_TTS_MESSAGES));
    // Without Embed Links, links don't unfurl; without Use External Emoji, only this server's custom emoji.
    let no_embeds = c.guild_id.is_some() && !has(p, perms::EMBED_LINKS);
    if let Some(gid) = c.guild_id {
        if !has(p, perms::USE_EXTERNAL_EMOJIS) {
            let ids = custom_emoji_ids(&content);
            if !ids.is_empty() {
                let (outside,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM emojis WHERE id = ANY($1) AND guild_id <> $2").bind(&ids).bind(gid).fetch_one(&state.db).await?;
                if outside > 0 { return Err(AppError::Forbidden) }
            }
        }
    }
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, reply_to, sticker_id, mentions, mention_roles, mention_everyone, tts, suppress_embeds, embeds, components) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)")
        .bind(mid)
        .bind(id)
        .bind(uid)
        .bind(&content)
        .bind(req.reply_to)
        .bind(req.sticker_id)
        .bind(&m_users)
        .bind(&m_roles)
        .bind(m_everyone)
        .bind(tts)
        .bind(no_embeds)
        .bind(&embeds)
        .bind(&components)
        .execute(&mut *tx)
        .await?;
    link(&mut tx, mid, id, uid, &req.attachment_ids).await?;
    if let Some(poll) = &req.poll {
        crate::routes::polls::insert(&mut tx, mid, poll).await?;
    }
    tx.commit().await?;
    if !req.attachment_descriptions.is_empty() { set_descriptions(&state.db, mid, &req.attachment_descriptions).await?; }
    crate::metrics::METRICS.messages_created.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    // Author has implicitly read their own message.
    sqlx::query(
        "INSERT INTO read_states (user_id, channel_id, last_read_msg) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_msg = EXCLUDED.last_read_msg",
    )
    .bind(uid)
    .bind(id)
    .bind(mid)
    .execute(&state.db)
    .await?;
    if !req.attachment_ids.is_empty() {
        crate::routes::attachments::queue_transcriptions(&state, mid, uid, &c).await?;
    }
    // A new message brings a closed DM back to everyone's list.
    if c.guild_id.is_none() {
        sqlx::query("UPDATE channel_members SET closed = false WHERE channel_id = $1 AND closed").bind(id).execute(&state.db).await?;
    }
    let msg = fetch_message(&state.db, mid, uid).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": c.guild_id }));
    crate::push::after_message(state.clone(), msg.clone(), c.clone());
    if c.kind == "thread" {
        crate::routes::threads::on_thread_message(&state, c.id, uid).await?;
    }
    Ok((StatusCode::CREATED, Json(msg)))
}

#[derive(Deserialize)]
struct EditMessage {
    content: Option<String>,
    /// "Remove embeds" (the author, or anyone who can manage messages here).
    suppress_embeds: Option<bool>,
    /// Alt text for this message's attachments, by id (the author).
    #[serde(default)]
    attachment_descriptions: HashMap<Uuid, String>,
    /// Mark or unmark attachments as spoilers, by id (the author). Spoilers are the SPOILER_ filename prefix.
    #[serde(default)]
    attachment_spoilers: HashMap<Uuid, bool>,
}

/// Alt text for a message's attachments (up to 1024 characters each; empty clears it).
async fn set_descriptions(db: &PgPool, mid: Uuid, descs: &HashMap<Uuid, String>) -> AppResult<()> {
    for (aid, d) in descs {
        let d: String = d.trim().chars().take(1024).collect();
        sqlx::query("UPDATE attachments SET description = NULLIF($3, '') WHERE id = $1 AND message_id = $2").bind(aid).bind(mid).bind(&d).execute(db).await?;
    }
    Ok(())
}

async fn edit_message(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid)): Path<(Uuid, Uuid)>,
    Json(req): Json<EditMessage>,
) -> AppResult<Json<Message>> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    let author: Option<(Uuid,)> = sqlx::query_as("SELECT author_id FROM messages WHERE id = $1 AND channel_id = $2").bind(mid).bind(id).fetch_optional(&state.db).await?;
    let Some((author,)) = author else { return Err(AppError::NotFound("Message not found".into())) };
    if let Some(on) = req.suppress_embeds {
        if author != uid && !(c.guild_id.is_some() && has(p, perms::MANAGE_MESSAGES)) { return Err(AppError::Forbidden) }
        sqlx::query("UPDATE messages SET suppress_embeds = $2 WHERE id = $1").bind(mid).bind(on).execute(&state.db).await?;
    }
    if !req.attachment_descriptions.is_empty() {
        if author != uid { return Err(AppError::Forbidden) }
        set_descriptions(&state.db, mid, &req.attachment_descriptions).await?;
    }
    if !req.attachment_spoilers.is_empty() {
        if author != uid { return Err(AppError::Forbidden) }
        for (aid, on) in &req.attachment_spoilers {
            sqlx::query("UPDATE attachments SET filename = CASE WHEN $3 THEN 'SPOILER_' ELSE '' END || regexp_replace(filename, '^SPOILER_', '') WHERE id = $1 AND message_id = $2")
                .bind(aid).bind(mid).bind(on).execute(&state.db).await?;
        }
    }
    let Some(content) = req.content else {
        let msg = fetch_message(&state.db, mid, uid).await?;
        let target = target_for(&state.db, &c).await?;
        state.hub.emit(target, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": c.guild_id }));
        return Ok(Json(msg));
    };
    let content = content.trim_end().to_string();
    if content.trim().is_empty() || content.chars().count() > 2000 {
        return Err(AppError::BadRequest("Message must be 1-2000 characters".into()));
    }
    let (m_users, m_roles, m_everyone) = parse_mentions(&content);
    let m_everyone = m_everyone && c.guild_id.is_some() && has(p, perms::MENTION_EVERYONE);
    let m_roles = mentionable_roles(&state.db, c.guild_id, m_roles, has(p, perms::MENTION_EVERYONE)).await?;
    let mut tx = state.db.begin().await?;
    // Keep what is being replaced (only when it actually changes) so readers can see the history.
    sqlx::query("INSERT INTO message_revisions (id, message_id, content) SELECT $1, id, content FROM messages WHERE id = $2 AND channel_id = $3 AND author_id = $4 AND content <> $5")
        .bind(Uuid::now_v7())
        .bind(mid)
        .bind(id)
        .bind(uid)
        .bind(&content)
        .execute(&mut *tx)
        .await?;
    let res = sqlx::query(
        "UPDATE messages SET content = $3, edited_at = now(), mentions = $5, mention_roles = $6, mention_everyone = $7 WHERE id = $1 AND channel_id = $2 AND author_id = $4",
    )
    .bind(mid)
    .bind(id)
    .bind(&content)
    .bind(uid)
    .bind(&m_users)
    .bind(&m_roles)
    .bind(m_everyone)
    .execute(&mut *tx)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }
    tx.commit().await?;
    let msg = fetch_message(&state.db, mid, uid).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": c.guild_id }));
    Ok(Json(msg))
}

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
struct Revision {
    id: Uuid,
    content: String,
    replaced_at: chrono::DateTime<chrono::Utc>,
}

/// Previous contents of an edited message, oldest first (anyone who can read the channel).
async fn message_history(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, mid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Vec<Revision>>> {
    require_channel_perms(&state.db, id, uid).await?;
    let exists: Option<(bool,)> = sqlx::query_as("SELECT true FROM messages WHERE id = $1 AND channel_id = $2").bind(mid).bind(id).fetch_optional(&state.db).await?;
    if exists.is_none() {
        return Err(AppError::NotFound("Message not found".into()));
    }
    Ok(Json(sqlx::query_as::<_, Revision>("SELECT id, content, replaced_at FROM message_revisions WHERE message_id = $1 ORDER BY id").bind(mid).fetch_all(&state.db).await?))
}

async fn delete_message(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    // Author, or anyone who may manage messages in this channel.
    let moderator = c.guild_id.is_some() && has(p, perms::MANAGE_MESSAGES);
    // Collect attachment ids first; files are removed only after the row delete proves the caller may.
    let files: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM attachments WHERE message_id = $1").bind(mid).fetch_all(&state.db).await?;
    let author: Option<(Uuid,)> = sqlx::query_as("SELECT author_id FROM messages WHERE id = $1").bind(mid).fetch_optional(&state.db).await?;
    let res = if moderator {
        sqlx::query("DELETE FROM messages WHERE id = $1 AND channel_id = $2").bind(mid).bind(id)
    } else {
        sqlx::query("DELETE FROM messages WHERE id = $1 AND channel_id = $2 AND author_id = $3").bind(mid).bind(id).bind(uid)
    }
    .execute(&state.db)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::Forbidden);
    }
    for (fid,) in files {
        let _ = tokio::fs::remove_file(state.config.upload_dir.join(fid.to_string())).await; let _ = tokio::fs::remove_file(state.config.upload_dir.join(format!("{fid}.thumb"))).await;
    }
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_DELETE", json!({ "id": mid, "channel_id": id, "guild_id": c.guild_id }));
    if let (Some(gid), Some((author_id,))) = (c.guild_id, author) {
        if author_id != uid {
            crate::audit::guild(&state, gid, uid, "message.delete", "user", Some(author_id), &crate::audit::username(&state, author_id).await, json!({ "channel": c.name, "message_id": mid })).await;
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Server verification level: members without a role must have a verified email (1), an account older than five
/// minutes (2) and have been in the server ten minutes (3) before they can talk. The owner is exempt.
pub async fn check_verification(db: &PgPool, guild_id: Uuid, uid: Uuid) -> AppResult<()> {
    let row: Option<(i16, bool, bool, f64, f64, bool)> = sqlx::query_as(
        "SELECT g.verification_level, g.owner_id = u.id, u.email_verified_at IS NOT NULL,
                EXTRACT(EPOCH FROM now() - u.created_at)::float8, EXTRACT(EPOCH FROM now() - m.joined_at)::float8,
                EXISTS (SELECT 1 FROM member_roles r WHERE r.guild_id = g.id AND r.user_id = u.id)
         FROM guilds g JOIN guild_members m ON m.guild_id = g.id AND m.user_id = $2 JOIN users u ON u.id = $2 WHERE g.id = $1")
        .bind(guild_id).bind(uid).fetch_optional(db).await?;
    let Some((level, owner, verified, account_secs, member_secs, has_role)) = row else { return Ok(()) };
    if level == 0 || owner || has_role { return Ok(()) }
    if !verified { return Err(AppError::BadRequest("This server requires a verified email address. Check your inbox for the verification link.".into())) }
    if level >= 2 && account_secs < 300.0 {
        return Err(AppError::BadRequest(format!("This server requires an account older than 5 minutes. Try again in {} seconds.", (300.0 - account_secs).ceil() as i64)));
    }
    if level >= 3 && member_secs < 600.0 {
        return Err(AppError::BadRequest(format!("This server requires members to wait 10 minutes before talking. Try again in {} seconds.", (600.0 - member_secs).ceil() as i64)));
    }
    Ok(())
}

#[derive(Deserialize)]
struct VoiceStatusReq { status: String }

/// Set a voice channel's status ("Watching the finals"): anyone in the channel, or who can manage it. Up to 500 characters.
async fn set_voice_status(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<VoiceStatusReq>) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    if c.guild_id.is_none() || c.kind != "voice" { return Err(AppError::BadRequest("Only server voice channels have a status".into())) }
    let inside = state.hub.voice_state(uid).map(|v| v.channel_id == id).unwrap_or(false);
    if !inside && !has(p, perms::MANAGE_CHANNELS) { return Err(AppError::Forbidden) }
    let status: String = req.status.trim().chars().take(500).collect();
    set_voice_status_inner(&state, id, &status).await
}

#[derive(Deserialize)]
struct VoiceInviteReq { user_id: Uuid }

/// `POST /channels/:id/voice-invite`: from inside a server voice channel, ask someone who can join it to hop in.
async fn voice_invite(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<VoiceInviteReq>) -> AppResult<StatusCode> {
    let (c, _) = require_channel_perms(&state.db, id, uid).await?;
    if c.guild_id.is_none() || c.kind != "voice" { return Err(AppError::BadRequest("Only server voice channels".into())) }
    if !state.hub.voice_state(uid).map(|v| v.channel_id == id).unwrap_or(false) { return Err(AppError::BadRequest("Join the voice channel first".into())) }
    if req.user_id == uid { return Err(AppError::BadRequest("That's you".into())) }
    let Ok((_, tp)) = require_channel_perms(&state.db, id, req.user_id).await else { return Err(AppError::BadRequest("They can't see this channel".into())) };
    if !has(tp, perms::CONNECT) { return Err(AppError::BadRequest("They can't join this channel".into())) }
    if crate::routes::relationships::blocked_either_way(&state.db, uid, req.user_id).await? { return Err(AppError::Forbidden) }
    if state.hub.voice_state(req.user_id).map(|v| v.channel_id == id).unwrap_or(false) { return Err(AppError::BadRequest("They're already here".into())) }
    let now = std::time::Instant::now();
    let key = (uid, req.user_id);
    if state.hub.voice_invites.get(&key).map(|t| now.duration_since(*t) < std::time::Duration::from_secs(30)).unwrap_or(false) {
        return Err(AppError::TooMany("You just invited them. Give them a moment.".into()));
    }
    state.hub.voice_invites.insert(key, now);
    let from: crate::models::User = sqlx::query_as::<_, crate::models::User>(&format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::USER_COLS)).bind(uid).fetch_one(&state.db).await?;
    state.hub.emit_users(vec![req.user_id], "VOICE_INVITE", json!({ "channel_id": id, "guild_id": c.guild_id, "channel_name": c.name, "from": from }));
    if !crate::ws::bus::online_users(&state.db).await.contains(&req.user_id) {
        crate::push::notify(&state, &[req.user_id], "Join voice?", &format!("{} invited you to 🔊 {}", from.display_name, c.name), json!({ "kind": "voice_invite", "channel_id": id, "guild_id": c.guild_id })).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Store a voice channel's status and tell everyone who can see the channel (no-op when unchanged).
pub async fn set_voice_status_inner(state: &AppState, id: Uuid, status: &str) -> AppResult<StatusCode> {
    let updated = sqlx::query_as::<_, Channel>(&format!("UPDATE channels SET voice_status = $2 WHERE id = $1 AND voice_status <> $2 RETURNING {CHANNEL_COLS}"))
        .bind(id).bind(status).fetch_optional(&state.db).await?;
    if let Some(mut c) = updated {
        perms::attach_overwrites(&state.db, std::slice::from_mut(&mut c)).await?;
        let target = perms::channel_audience(&state.db, &c).await?;
        state.hub.emit(target, "CHANNEL_UPDATE", json!(c));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Slowmode: refuse a message sent too soon after this member's last one here (system notices such as their join
/// don't count). Members who can manage messages or the channel are exempt, as in Discord.
pub async fn check_slowmode(db: &PgPool, c: &Channel, p: u64, uid: Uuid) -> AppResult<()> {
    if c.rate_limit_per_user <= 0 || has(p, perms::MANAGE_MESSAGES) || has(p, perms::MANAGE_CHANNELS) { return Ok(()) }
    // MAX() is NULL when they have never posted here.
    let wait: Option<(Option<f64>,)> = sqlx::query_as(
        "SELECT EXTRACT(EPOCH FROM (MAX(created_at) + make_interval(secs => $3) - now()))::float8 FROM messages WHERE channel_id = $1 AND author_id = $2 AND kind = 'default'")
        .bind(c.id).bind(uid).bind(c.rate_limit_per_user as f64).fetch_optional(db).await?;
    match wait {
        Some((Some(secs),)) if secs > 0.0 => Err(AppError::TooMany(format!("Slowmode is on. You can send another message in {} second{}.", secs.ceil() as i64, if secs.ceil() as i64 == 1 { "" } else { "s" }))),
        _ => Ok(()),
    }
}

/// Delete messages that the caller may already delete, with their attachment files, and tell each channel's
/// audience in one MESSAGE_DELETE_BULK per channel. Returns how many were deleted.
pub async fn delete_many(state: &AppState, ids: &[Uuid]) -> AppResult<usize> {
    if ids.is_empty() { return Ok(0) }
    let files: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM attachments WHERE message_id = ANY($1)").bind(ids).fetch_all(&state.db).await?;
    let gone: Vec<(Uuid, Uuid)> = sqlx::query_as("DELETE FROM messages WHERE id = ANY($1) RETURNING id, channel_id").bind(ids).fetch_all(&state.db).await?;
    for (fid,) in files {
        let _ = tokio::fs::remove_file(state.config.upload_dir.join(fid.to_string())).await; let _ = tokio::fs::remove_file(state.config.upload_dir.join(format!("{fid}.thumb"))).await;
    }
    let mut by_channel: std::collections::HashMap<Uuid, Vec<Uuid>> = std::collections::HashMap::new();
    for (mid, cid) in &gone { by_channel.entry(*cid).or_default().push(*mid); }
    for (cid, mids) in by_channel {
        let Ok(c) = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(cid).fetch_one(&state.db).await else { continue };
        let target = target_for(&state.db, &c).await?;
        state.hub.emit(target, "MESSAGE_DELETE_BULK", json!({ "ids": mids, "channel_id": cid, "guild_id": c.guild_id }));
    }
    Ok(gone.len())
}

#[derive(Deserialize)]
struct BulkDelete {
    /// Specific messages in this channel (up to 100)...
    #[serde(default)]
    messages: Vec<Uuid>,
    /// ...or the newest `limit` messages (1 to 100), optionally only `author_id`'s.
    limit: Option<i64>,
    author_id: Option<Uuid>,
}

/// Bulk delete (Manage Messages, server channels): by id, or the newest N messages (`/purge`).
async fn bulk_delete(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<BulkDelete>,
) -> AppResult<Json<serde_json::Value>> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    let Some(gid) = c.guild_id else { return Err(AppError::BadRequest("Bulk delete is for server channels".into())) };
    perms::check(p, perms::MANAGE_MESSAGES)?;
    let ids: Vec<Uuid> = if !req.messages.is_empty() {
        if req.messages.len() > 100 { return Err(AppError::BadRequest("At most 100 messages at a time".into())) }
        sqlx::query_as::<_, (Uuid,)>("SELECT id FROM messages WHERE channel_id = $1 AND id = ANY($2)").bind(id).bind(&req.messages).fetch_all(&state.db).await?.into_iter().map(|r| r.0).collect()
    } else {
        let n = req.limit.unwrap_or(0);
        if !(1..=100).contains(&n) { return Err(AppError::BadRequest("limit must be 1 to 100".into())) }
        sqlx::query_as::<_, (Uuid,)>("SELECT id FROM messages WHERE channel_id = $1 AND ($2::uuid IS NULL OR author_id = $2) ORDER BY id DESC LIMIT $3")
            .bind(id).bind(req.author_id).bind(n).fetch_all(&state.db).await?.into_iter().map(|r| r.0).collect()
    };
    let deleted = delete_many(&state, &ids).await?;
    if deleted > 0 {
        crate::audit::guild(&state, gid, uid, "message.bulk_delete", "channel", Some(id), &c.name, json!({ "count": deleted })).await;
    }
    Ok(Json(json!({ "deleted": deleted })))
}

/// Role mentions that notify: roles marked mentionable, or any role for members with Mention Everyone. Others
/// still render as a mention, they just don't ping anyone.
async fn mentionable_roles(db: &PgPool, guild: Option<Uuid>, roles: Vec<Uuid>, all: bool) -> AppResult<Vec<Uuid>> {
    let Some(g) = guild else { return Ok(Vec::new()) };
    if roles.is_empty() || all { return Ok(roles) }
    Ok(sqlx::query_as::<_, (Uuid,)>("SELECT id FROM roles WHERE guild_id = $1 AND id = ANY($2) AND mentionable").bind(g).bind(&roles).fetch_all(db).await?.into_iter().map(|r| r.0).collect())
}

/// Mentions in Discord's wire syntax: `<@id>` users, `<@&id>` roles, `@everyone` / `@here`.
pub fn parse_mentions(content: &str) -> (Vec<Uuid>, Vec<Uuid>, bool) {
    let mut users = Vec::new();
    let mut roles = Vec::new();
    let mut rest = content;
    while let Some(i) = rest.find("<@") {
        let after = &rest[i + 2..];
        let (is_role, body) = match after.strip_prefix('&') { Some(b) => (true, b), None => (false, after) };
        if let Some(end) = body.find('>') {
            if let Ok(id) = Uuid::parse_str(&body[..end]) {
                let v = if is_role { &mut roles } else { &mut users };
                if !v.contains(&id) { v.push(id) }
            }
            rest = &body[end + 1..];
        } else {
            break;
        }
    }
    let everyone = content.contains("@everyone") || content.contains("@here");
    (users, roles, everyone)
}

/// A unicode emoji (short, no letters/digits) or a custom `<:name:id>` token.
fn valid_emoji(e: &str) -> bool {
    if crate::routes::expressions::parse_custom_emoji(e).is_some() {
        return true;
    }
    !e.is_empty() && e.chars().count() <= 8 && !e.chars().any(|c| c.is_ascii_alphanumeric() || c.is_whitespace())
}

/// `?burst=true`: a super reaction.
#[derive(Deserialize, Default)]
struct BurstQ { #[serde(default)] burst: bool }

/// Super reactions a person can send in a rolling day.
pub const SUPER_REACTIONS_PER_DAY: i64 = 5;

async fn add_reaction(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid, emoji)): Path<(Uuid, Uuid, String)>,
    Query(q): Query<BurstQ>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::ADD_REACTIONS)?;
    if !valid_emoji(&emoji) {
        return Err(AppError::BadRequest("Invalid emoji".into()));
    }
    if let Some((_, _, eid)) = crate::routes::expressions::parse_custom_emoji(&emoji) {
        if !crate::routes::expressions::usable_emoji(&state.db, eid, uid).await? {
            return Err(AppError::BadRequest("Unknown emoji".into()));
        }
    }
    let exists: Option<(bool,)> = sqlx::query_as("SELECT true FROM messages WHERE id = $1 AND channel_id = $2")
        .bind(mid).bind(id).fetch_optional(&state.db).await?;
    if exists.is_none() {
        return Err(AppError::NotFound("Message not found".into()));
    }
    if q.burst {
        let (used,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM reactions WHERE user_id = $1 AND burst AND created_at > now() - interval '1 day'").bind(uid).fetch_one(&state.db).await?;
        if used >= SUPER_REACTIONS_PER_DAY { return Err(AppError::BadRequest(format!("You've used your {SUPER_REACTIONS_PER_DAY} super reactions for today"))) }
    }
    let added = sqlx::query("INSERT INTO reactions (message_id, user_id, emoji, burst) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING")
        .bind(mid).bind(uid).bind(&emoji).bind(q.burst).execute(&state.db).await?.rows_affected();
    if added > 0 {
        let target = target_for(&state.db, &c).await?;
        state.hub.emit(target, "REACTION_ADD", json!({ "message_id": mid, "channel_id": id, "user_id": uid, "emoji": emoji, "burst": q.burst }));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Who reacted with one emoji (for the reaction tooltip), oldest first, capped at 100.
async fn list_reactors(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid, emoji)): Path<(Uuid, Uuid, String)>,
    Query(q): Query<BurstQ>,
) -> AppResult<Json<Vec<serde_json::Value>>> {
    require_channel(&state.db, id, uid).await?;
    let rows: Vec<(Uuid, String, Option<String>)> = sqlx::query_as(
        "SELECT u.id, u.display_name, u.avatar_url FROM reactions r JOIN users u ON u.id = r.user_id
         WHERE r.message_id = $1 AND r.emoji = $2 AND r.burst = $3 ORDER BY r.created_at LIMIT 100",
    )
    .bind(mid)
    .bind(&emoji)
    .bind(q.burst)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows.into_iter().map(|(id, name, avatar)| json!({ "id": id, "display_name": name, "avatar_url": avatar })).collect()))
}

async fn remove_reaction(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid, emoji)): Path<(Uuid, Uuid, String)>,
    Query(q): Query<BurstQ>,
) -> AppResult<StatusCode> {
    let c = require_channel(&state.db, id, uid).await?;
    let gone = sqlx::query("DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 AND burst = $4")
        .bind(mid).bind(uid).bind(&emoji).bind(q.burst).execute(&state.db).await?.rows_affected();
    if gone > 0 {
        let target = target_for(&state.db, &c).await?;
        state.hub.emit(target, "REACTION_REMOVE", json!({ "message_id": mid, "channel_id": id, "user_id": uid, "emoji": emoji, "burst": q.burst }));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Remove someone else's reaction (Manage Messages, server channels), from the reactions list.
async fn remove_user_reaction(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid, emoji, user)): Path<(Uuid, Uuid, String, Uuid)>,
    Query(q): Query<BurstQ>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    if user != uid && !(c.guild_id.is_some() && has(p, perms::MANAGE_MESSAGES)) { return Err(AppError::Forbidden) }
    let gone = sqlx::query("DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 AND burst = $4").bind(mid).bind(user).bind(&emoji).bind(q.burst).execute(&state.db).await?.rows_affected();
    if gone > 0 {
        let target = target_for(&state.db, &c).await?;
        state.hub.emit(target, "REACTION_REMOVE", json!({ "message_id": mid, "channel_id": id, "user_id": user, "emoji": emoji, "burst": q.burst }));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn typing(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    perms::check(p, perms::SEND_MESSAGES)?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "TYPING_START", json!({ "channel_id": id, "user_id": uid }));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct SetOverwrite {
    kind: String,
    allow: i64,
    deny: i64,
}

/// Create or replace a permission overwrite for a role or member on a guild channel.
/// `POST /channels/:id/permissions-sync`: drop this channel's own overwrites so it follows its category again.
async fn sync_permissions(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    let gid = c.guild_id.ok_or_else(|| AppError::BadRequest("DM channels have no permissions".into()))?;
    perms::check(p, perms::MANAGE_ROLES)?;
    if c.parent_id.is_none() { return Err(AppError::BadRequest("This channel isn't in a category".into())) }
    let before = perms::visibility(&state.db, gid).await?;
    sqlx::query("DELETE FROM channel_overwrites WHERE channel_id = $1").bind(id).execute(&state.db).await?;
    perms::resync_visibility(&state, gid, &before).await?;
    crate::audit::guild(&state, gid, uid, "channel.permissions_sync", "channel", Some(id), &c.name, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn set_overwrite(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
    Json(req): Json<SetOverwrite>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    let gid = c.guild_id.ok_or_else(|| AppError::BadRequest("DM channels have no permissions".into()))?;
    perms::check(p, perms::MANAGE_ROLES)?;
    if !["role", "member"].contains(&req.kind.as_str()) {
        return Err(AppError::BadRequest("kind must be role or member".into()));
    }
    let (ctx, _) = perms::guild_perms(&state.db, gid, uid).await?;
    if req.kind == "role" {
        let role = ctx.roles.get(&target).ok_or_else(|| AppError::NotFound("Role not found".into()))?;
        if !ctx.outranks_role(uid, role) {
            return Err(AppError::Forbidden);
        }
    } else if !ctx.is_member(target) {
        return Err(AppError::NotFound("Member not found".into()));
    }
    let allow = (req.allow as u64) & perms::ALL;
    let deny = (req.deny as u64) & perms::ALL & !allow;
    // Only touch bits you hold here yourself (admins hold all).
    let existing = c.overwrites.iter().find(|o| o.target_id == target);
    let (old_allow, old_deny) = existing.map(|o| (o.allow as u64, o.deny as u64)).unwrap_or((0, 0));
    if ((old_allow ^ allow) | (old_deny ^ deny)) & !p != 0 {
        return Err(AppError::Forbidden);
    }
    let before = perms::visibility(&state.db, gid).await?;
    sqlx::query(
        "INSERT INTO channel_overwrites (channel_id, target_id, target_kind, allow, deny) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (channel_id, target_id) DO UPDATE SET target_kind = EXCLUDED.target_kind, allow = EXCLUDED.allow, deny = EXCLUDED.deny",
    )
    .bind(id)
    .bind(target)
    .bind(&req.kind)
    .bind(allow as i64)
    .bind(deny as i64)
    .execute(&state.db)
    .await?;
    perms::resync_visibility(&state, gid, &before).await?;
    crate::audit::guild(&state, gid, uid, "channel.overwrite", "channel", Some(id), &c.name, json!({ "target": target, "kind": req.kind, "allow": allow, "deny": deny })).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_overwrite(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, target)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    let gid = c.guild_id.ok_or_else(|| AppError::BadRequest("DM channels have no permissions".into()))?;
    perms::check(p, perms::MANAGE_ROLES)?;
    let existing = c.overwrites.iter().find(|o| o.target_id == target).ok_or_else(|| AppError::NotFound("Overwrite not found".into()))?;
    if ((existing.allow as u64) | (existing.deny as u64)) & !p != 0 {
        return Err(AppError::Forbidden);
    }
    if existing.target_kind == "role" {
        let (ctx, _) = perms::guild_perms(&state.db, gid, uid).await?;
        if let Some(role) = ctx.roles.get(&target) {
            if !ctx.outranks_role(uid, role) {
                return Err(AppError::Forbidden);
            }
        }
    }
    let before = perms::visibility(&state.db, gid).await?;
    sqlx::query("DELETE FROM channel_overwrites WHERE channel_id = $1 AND target_id = $2").bind(id).bind(target).execute(&state.db).await?;
    perms::resync_visibility(&state, gid, &before).await?;
    crate::audit::guild(&state, gid, uid, "channel.overwrite_delete", "channel", Some(id), &c.name, json!({ "target": target })).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct MarkRead {
    message_id: Uuid,
}

async fn mark_read(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<MarkRead>,
) -> AppResult<StatusCode> {
    let c = require_channel(&state.db, id, uid).await?;
    let prev: Option<(Option<Uuid>,)> = sqlx::query_as("SELECT last_read_msg FROM read_states WHERE user_id = $1 AND channel_id = $2").bind(uid).bind(id).fetch_optional(&state.db).await?;
    sqlx::query(
        "INSERT INTO read_states (user_id, channel_id, last_read_msg) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_msg = EXCLUDED.last_read_msg",
    )
    .bind(uid).bind(id).bind(req.message_id).execute(&state.db).await?;
    state.hub.emit_users(vec![uid], "READ_STATE_UPDATE", json!({ "channel_id": id, "last_read_msg": req.message_id }));
    // Read receipt for everyone else in the channel, only when the pointer actually moved forward and the
    // reader has not turned receipts off.
    let advanced = prev.and_then(|p| p.0).map(|p| req.message_id > p).unwrap_or(true);
    let (shows,): (bool,) = sqlx::query_as("SELECT show_read_receipts FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    if advanced && shows {
        if let Ok(target) = target_for(&state.db, &c).await {
            state.hub.emit(target, "READ_RECEIPT", json!({ "channel_id": id, "user_id": uid, "message_id": req.message_id }));
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct Receipt {
    user_id: Uuid,
    message_id: Uuid,
}

/// Where everyone else in this channel has read up to (what the "seen" markers are built from).
async fn receipts(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Receipt>>> {
    require_channel(&state.db, id, uid).await?;
    Ok(Json(
        sqlx::query_as::<_, Receipt>("SELECT rs.user_id, rs.last_read_msg AS message_id FROM read_states rs JOIN users u ON u.id = rs.user_id WHERE rs.channel_id = $1 AND rs.user_id <> $2 AND rs.last_read_msg IS NOT NULL AND u.show_read_receipts ORDER BY rs.last_read_msg DESC LIMIT 500")
            .bind(id).bind(uid)
            .fetch_all(&state.db)
            .await?,
    ))
}

/// Hydrate rows into messages (oldest first when `rows` is newest-first).
pub async fn hydrate(db: &PgPool, rows: Vec<MessageRow>, me: Uuid, reverse: bool) -> AppResult<Vec<Message>> {
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let mut reactions = reactions_for(db, &ids, me).await?;
    let mut atts = attachments_for(db, &ids).await?;
    let mut polls = crate::routes::polls::polls_for(db, &ids, me).await?;
    let mut threads = crate::routes::threads::threads_for(db, &ids).await?;
    let mut refs = referenced_for(db, &rows).await?;
    let it = rows.into_iter().map(|r| {
        let rx = reactions.remove(&r.id).unwrap_or_default();
        let at = atts.remove(&r.id).unwrap_or_default();
        let poll = polls.remove(&r.id);
        let thread = threads.remove(&r.id);
        let referenced = r.reply_to.and_then(|t| refs.get(&t).cloned());
        let mut m = r.into_message(rx, at);
        m.poll = poll;
        m.thread = thread;
        m.referenced = referenced.map(Box::new);
        m
    });
    Ok(if reverse { it.rev().collect() } else { it.collect() })
}

/// Previews of the messages these rows reply to, keyed by the original's id (missing when deleted).
async fn referenced_for(db: &PgPool, rows: &[MessageRow]) -> AppResult<HashMap<Uuid, crate::models::Referenced>> {
    let mut targets: Vec<Uuid> = rows.iter().filter_map(|r| r.reply_to).collect();
    targets.sort(); targets.dedup();
    if targets.is_empty() { return Ok(HashMap::new()) }
    let originals = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.id = ANY($1)"))
        .bind(&targets).fetch_all(db).await?;
    let counts: Vec<(Uuid, i64)> = sqlx::query_as("SELECT message_id, count(*) FROM attachments WHERE message_id = ANY($1) GROUP BY message_id")
        .bind(&targets).fetch_all(db).await?;
    let counts: HashMap<Uuid, i64> = counts.into_iter().collect();
    Ok(originals.into_iter().map(|r| {
        let m = r.into_message(vec![], vec![]);
        (m.id, crate::models::Referenced { id: m.id, author: m.author, content: m.content, attachment_count: counts.get(&m.id).copied().unwrap_or(0), kind: m.kind })
    }).collect())
}

async fn list_pins(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<Message>>> {
    require_channel(&state.db, id, uid).await?;
    let rows = sqlx::query_as::<_, MessageRow>(&format!(
        "{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.pinned_at IS NOT NULL ORDER BY m.pinned_at DESC LIMIT 50"
    ))
    .bind(id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(hydrate(&state.db, rows, uid, false).await?))
}

/// Pinning needs Manage Messages in a server; anyone in a DM may pin.
async fn set_pinned(state: &AppState, id: Uuid, mid: Uuid, uid: Uuid, pinned: bool) -> AppResult<Json<Message>> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    if c.guild_id.is_some() && !has(p, perms::MANAGE_MESSAGES) {
        return Err(AppError::Forbidden);
    }
    let res = sqlx::query(if pinned {
        "UPDATE messages SET pinned_at = now() WHERE id = $1 AND channel_id = $2 AND pinned_at IS NULL"
    } else {
        "UPDATE messages SET pinned_at = NULL WHERE id = $1 AND channel_id = $2 AND pinned_at IS NOT NULL"
    })
    .bind(mid)
    .bind(id)
    .execute(&state.db)
    .await?;
    if res.rows_affected() == 0 {
        // Either the message is missing or already in the requested state; report which.
        let exists: Option<(bool,)> = sqlx::query_as("SELECT true FROM messages WHERE id = $1 AND channel_id = $2").bind(mid).bind(id).fetch_optional(&state.db).await?;
        if exists.is_none() {
            return Err(AppError::NotFound("Message not found".into()));
        }
    }
    let msg = fetch_message(&state.db, mid, uid).await?;
    let target = target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": c.guild_id }));
    if pinned && res.rows_affected() > 0 {
        system_message(state, &c, uid, "pins_add", "pinned a message to this channel.", vec![], Some(mid), None).await?;
    }
    Ok(Json(msg))
}

async fn pin_message(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, mid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Message>> {
    set_pinned(&state, id, mid, uid, true).await
}

async fn unpin_message(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, mid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Message>> {
    set_pinned(&state, id, mid, uid, false).await
}

#[derive(Deserialize)]
pub struct SearchQuery {
    q: String,
}

/// Case-insensitive substring search over a channel's messages, newest first.
/// Per-channel search (the header box in a DM); same engine as `GET /search` with the channel fixed.
async fn search_messages(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<Message>>> {
    let params = crate::routes::search::SearchParams { q: q.q, guild_id: None, channel_id: Some(id), offset: 0, sort: None, context: false };
    Ok(Json(crate::routes::search::run(&state, uid, &params).await?.results.into_iter().map(|h| h.message).collect()))
}

#[derive(Deserialize)]
struct ForwardReq {
    channel_id: Uuid,
}

/// Copy a message (content, sticker, attachments) into another channel as a new message by the
/// forwarder, marked with `forwarded_from`. Needs view on the source and send (+ attach) on the target.
async fn forward_message(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path((id, mid)): Path<(Uuid, Uuid)>,
    Json(req): Json<ForwardReq>,
) -> AppResult<(StatusCode, Json<Message>)> {
    require_channel(&state.db, id, uid).await?;
    let src = fetch_message(&state.db, mid, uid).await?;
    if src.channel_id != id {
        return Err(AppError::NotFound("Message not found".into()));
    }
    let (target_ch, p) = require_channel_perms(&state.db, req.channel_id, uid).await?;
    perms::check(p, perms::SEND_MESSAGES)?;
    if !src.attachments.is_empty() && target_ch.guild_id.is_some() {
        perms::check(p, perms::ATTACH_FILES)?;
    }
    if target_ch.guild_id.is_none() {
        let others: Vec<(Uuid,)> = sqlx::query_as("SELECT user_id FROM channel_members WHERE channel_id = $1 AND user_id <> $2").bind(req.channel_id).bind(uid).fetch_all(&state.db).await?;
        for (other,) in others {
            if crate::routes::relationships::blocked_either_way(&state.db, uid, other).await? || (target_ch.kind == "dm" && !crate::routes::dms::can_dm(&state.db, uid, other).await?) {
                return Err(AppError::Undeliverable);
            }
        }
    }
    let new_id = Uuid::now_v7();
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, sticker_id, forwarded_from) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(new_id)
        .bind(req.channel_id)
        .bind(uid)
        .bind(&src.content)
        .bind(src.sticker.as_ref().map(|s| s.id))
        .bind(mid)
        .execute(&mut *tx)
        .await?;
    // Duplicate attachment rows and files so the copy survives deletion of the original.
    for a in &src.attachments {
        let aid = Uuid::new_v4();
        let dir = &state.config.upload_dir;
        tokio::fs::copy(dir.join(a.id.to_string()), dir.join(aid.to_string())).await.map_err(|e| AppError::Other(anyhow::anyhow!(e)))?;
        sqlx::query(
            "INSERT INTO attachments (id, message_id, uploader_id, channel_id, filename, content_type, size, width, height) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(aid)
        .bind(new_id)
        .bind(uid)
        .bind(req.channel_id)
        .bind(&a.filename)
        .bind(&a.content_type)
        .bind(a.size)
        .bind(a.width)
        .bind(a.height)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    sqlx::query(
        "INSERT INTO read_states (user_id, channel_id, last_read_msg) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_msg = EXCLUDED.last_read_msg",
    )
    .bind(uid)
    .bind(req.channel_id)
    .bind(new_id)
    .execute(&state.db)
    .await?;
    let msg = fetch_message(&state.db, new_id, uid).await?;
    let target = target_for(&state.db, &target_ch).await?;
    state.hub.emit(target, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": target_ch.guild_id }));
    Ok((StatusCode::CREATED, Json(msg)))
}

/// Bookmarked messages the user can still see, newest bookmark first, with their channel's guild id.
async fn list_bookmarks(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<serde_json::Value>>> {
    let rows = sqlx::query_as::<_, MessageRow>(&format!(
        "{MESSAGE_SELECT} JOIN bookmarks b ON b.message_id = m.id AND b.user_id = $1 ORDER BY b.folder, b.position, b.created_at DESC LIMIT 200"
    ))
    .bind(uid)
    .fetch_all(&state.db)
    .await?;
    let meta: Vec<(Uuid, String, i32, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as("SELECT message_id, folder, position, CASE WHEN reminded THEN NULL ELSE remind_at END FROM bookmarks WHERE user_id = $1").bind(uid).fetch_all(&state.db).await?;
    let meta: HashMap<Uuid, (String, i32, Option<chrono::DateTime<chrono::Utc>>)> = meta.into_iter().map(|(id, f, p, r)| (id, (f, p, r))).collect();
    let msgs = hydrate(&state.db, rows, uid, false).await?;
    let mut out = Vec::with_capacity(msgs.len());
    for m in msgs {
        // Skip messages in channels the user can no longer view.
        let Ok(c) = require_channel(&state.db, m.channel_id, uid).await else { continue };
        let (folder, position, remind_at) = meta.get(&m.id).cloned().unwrap_or_default();
        let mut v = json!(m);
        v["remind_at"] = json!(remind_at);
        v["guild_id"] = json!(c.guild_id);
        v["channel_name"] = json!(c.name);
        v["folder"] = json!(folder);
        v["position"] = json!(position);
        out.push(v);
    }
    Ok(Json(out))
}

async fn add_bookmark(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(mid): Path<Uuid>) -> AppResult<StatusCode> {
    let ch: Option<(Uuid,)> = sqlx::query_as("SELECT channel_id FROM messages WHERE id = $1").bind(mid).fetch_optional(&state.db).await?;
    let (channel_id,) = ch.ok_or_else(|| AppError::NotFound("Message not found".into()))?;
    require_channel(&state.db, channel_id, uid).await?;
    sqlx::query("INSERT INTO bookmarks (user_id, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(uid).bind(mid).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct MoveBookmark {
    /// Folder name (empty = no folder), up to 40 chars.
    folder: Option<String>,
    /// "Remind me": when to remind (null clears the reminder).
    #[serde(default, deserialize_with = "crate::routes::roles::deserialize_nullable_time")]
    remind_at: Option<Option<chrono::DateTime<chrono::Utc>>>,
    /// Manual order inside the folder (lower first).
    position: Option<i32>,
}

/// `PATCH /users/@me/bookmarks/:mid`: move a bookmark into a folder and/or reorder it.
async fn move_bookmark(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(mid): Path<Uuid>, Json(req): Json<MoveBookmark>) -> AppResult<Json<serde_json::Value>> {
    let folder = req.folder.map(|f| f.trim().chars().take(40).collect::<String>());
    let row: Option<(String, i32, Option<chrono::DateTime<chrono::Utc>>)> = sqlx::query_as(
        "UPDATE bookmarks SET folder = COALESCE($3, folder), position = COALESCE($4, position),
           remind_at = CASE WHEN $5 THEN $6 ELSE remind_at END, reminded = CASE WHEN $5 THEN false ELSE reminded END
         WHERE user_id = $1 AND message_id = $2 RETURNING folder, position, remind_at",
    )
    .bind(uid).bind(mid).bind(&folder).bind(req.position).bind(req.remind_at.is_some()).bind(req.remind_at.flatten())
    .fetch_optional(&state.db)
    .await?;
    let (folder, position, remind_at): (String, i32, Option<chrono::DateTime<chrono::Utc>>) = row.ok_or_else(|| AppError::NotFound("Bookmark not found".into()))?;
    Ok(Json(json!({ "message_id": mid, "folder": folder, "position": position, "remind_at": remind_at })))
}

/// Background task: deliver due "Remind me" bookmarks once, to the user's sessions (and phone when offline).
pub async fn bookmark_reminders(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(20)).await;
        let due: Vec<(Uuid, Uuid)> = sqlx::query_as("UPDATE bookmarks SET reminded = true WHERE remind_at <= now() AND NOT reminded RETURNING user_id, message_id")
            .fetch_all(&state.db).await.unwrap_or_default();
        for (uid, mid) in due {
            let Ok(m) = fetch_message(&state.db, mid, uid).await else { continue };
            let Ok(c) = require_channel(&state.db, m.channel_id, uid).await else { continue };
            state.hub.emit_users(vec![uid], "BOOKMARK_REMINDER", json!({ "message": m, "guild_id": c.guild_id, "channel_name": c.name }));
            if !crate::ws::bus::online_users(&state.db).await.contains(&uid) {
                let body: String = format!("{}: {}", m.author.display_name, m.content).chars().take(140).collect();
                crate::push::notify(&state, &[uid], "Reminder", &body, json!({ "kind": "reminder", "channel_id": m.channel_id, "message_id": mid })).await;
            }
        }
    }
}

async fn remove_bookmark(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(mid): Path<Uuid>) -> AppResult<StatusCode> {
    sqlx::query("DELETE FROM bookmarks WHERE user_id = $1 AND message_id = $2").bind(uid).bind(mid).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Ids of the user's bookmarks, for READY.
pub async fn bookmark_ids(db: &PgPool, uid: Uuid) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> = sqlx::query_as("SELECT message_id FROM bookmarks WHERE user_id = $1").bind(uid).fetch_all(db).await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// Custom emoji ids in a message (`<:name:id>` / `<a:name:id>`).
pub fn custom_emoji_ids(content: &str) -> Vec<Uuid> {
    let mut out = Vec::new();
    let mut rest = content;
    while let Some(i) = rest.find('<') {
        rest = &rest[i + 1..];
        let Some(end) = rest.find('>') else { break };
        let inner = &rest[..end];
        let inner = inner.strip_prefix("a:").or_else(|| inner.strip_prefix(':'));
        if let Some(inner) = inner {
            if let Some((_, id)) = inner.rsplit_once(':') { if let Ok(u) = id.parse::<Uuid>() { out.push(u) } }
        }
    }
    out
}
