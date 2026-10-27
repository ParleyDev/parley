use crate::{
    auth::{check_session, verify_session_token},
    models::{Channel, Guild, Member, PrivateUser, Role},
    perms::{self, has},
    routes::{dms::list_dm_channels, roles::attach_roles},
    state::AppState,
    ws::hub::{Target, VoiceState},
};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    response::{IntoResponse, Response},
};
use futures::{sink::SinkExt, stream::StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct WsQuery {
    token: String,
    /// Last event sequence number the client saw; when the gap is still buffered the server replays it
    /// (RESUMED) instead of sending a fresh READY.
    seq: Option<u64>,
    /// The instance that issued `seq` (from READY/RESUMED `i`); a resume against another instance is a READY.
    instance: Option<Uuid>,
    /// Where this client runs: web (default), desktop, mobile or vr; shown as a presence indicator.
    platform: Option<String>,
    /// 1 when the client connects already away (e.g. a mobile app reconnecting in the background).
    idle: Option<u8>,
    /// Bots (token `bot_…`): which events they want (see `ws::intents`). Default: everything not privileged.
    intents: Option<u32>,
}

pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(q): Query<WsQuery>,
) -> Response {
    // Bots connect with their bot token and choose intents; people with a session token.
    let (uid, sid, intents) = if q.token.starts_with("bot_") {
        match crate::ws::intents::authorize_bot(&state, &q.token, q.intents).await {
            Ok((uid, intents)) => (uid, Uuid::nil(), Some(intents)),
            Err(msg) => return (axum::http::StatusCode::UNAUTHORIZED, msg).into_response(),
        }
    } else {
        let Some((uid, sid)) = verify_session_token(&state.config.jwt_secret, &q.token) else {
            return (axum::http::StatusCode::UNAUTHORIZED, "invalid token").into_response();
        };
        if !check_session(&state, uid, sid).await.unwrap_or(false) {
            return (axum::http::StatusCode::UNAUTHORIZED, "session revoked or account suspended").into_response();
        }
        (uid, sid, None)
    };
    let resume = match (q.seq, q.instance) {
        (Some(s), Some(i)) if i == state.hub.instance_id => Some(s),
        (Some(_), Some(_)) => None,
        (s, None) => s,
        (None, _) => None,
    };
    let platform = q.platform.as_deref().filter(|p| crate::ws::bus::PLATFORMS.contains(p)).unwrap_or("web").to_string();
    let idle = q.idle.unwrap_or(0) != 0;
    ws.on_upgrade(move |socket| handle_socket(socket, state, uid, sid, resume, platform, idle, intents))
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum ClientOp {
    Ping,
    Typing { channel_id: Uuid },
    /// `e2ee`: the client can encrypt media end to end (required to join a channel with `e2ee` on).
    VoiceJoin { channel_id: Uuid, #[serde(default)] e2ee: bool },
    VoiceLeave,
    /// `priority`: Priority Speaker switched on (only counts with the permission).
    VoiceState { self_mute: bool, self_deaf: bool, #[serde(default)] self_video: bool, #[serde(default)] self_stream: bool, #[serde(default)] priority: bool },
    /// WebRTC signaling relayed verbatim to one peer in the same voice channel.
    VoiceSignal { to: Uuid, data: Value },
    /// The user is active at the keyboard (sent at most once a minute while focused): feeds the push inactive timeout.
    Activity,
    /// The user went away from this client (no input for a while, or the app went to the background) or came back.
    Idle { idle: bool },
    /// Started or stopped watching someone's screen share in the same call.
    StreamWatch { user_id: Uuid, on: bool },
    /// A floating emoji reaction in the call.
    VoiceReaction { emoji: String },
    /// Turn live captions on or off for yourself in the current call.
    VoiceCaptions { on: bool },
}

#[allow(clippy::too_many_arguments)]
async fn handle_socket(socket: WebSocket, state: AppState, user_id: Uuid, session_id: Uuid, resume_from: Option<u64>, platform: String, idle: bool, intents: Option<u32>) {
    let (mut tx, mut rx) = socket.split();

    // --- Resume: replay what this client missed if it is all still buffered ---
    if let Some(after) = resume_from.filter(|a| *a > 0) {
        // Subscribe first so nothing emitted between the snapshot and the loop is lost (dedup by seq below).
        let events = state.hub.subscribe();
        if let Some(missed) = state.hub.replay_after(after) {
            let guild_ids: Vec<Uuid> = sqlx::query_as::<_, (Uuid,)>("SELECT guild_id FROM guild_members WHERE user_id = $1")
                .bind(user_id)
                .fetch_all(&state.db)
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|r| r.0)
                .collect();
            let my_guilds: HashSet<Uuid> = guild_ids.into_iter().collect();
            let relevant: Vec<_> = missed.into_iter().filter(|ev| matches_target(&ev.target, user_id, session_id, &my_guilds)).collect();
            let last = relevant.last().map(|e| e.seq).unwrap_or(after).max(after);
            let first = crate::ws::bus::connect(&state, user_id, &platform, idle).await;
            crate::metrics::METRICS.ws_resumes.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let resumed = json!({ "t": "RESUMED", "d": { "replayed": relevant.len(), "from": after }, "s": state.hub.current_seq(), "i": state.hub.instance_id });
            if tx.send(Message::Text(resumed.to_string())).await.is_err() {
                crate::ws::bus::disconnect(&state, user_id, &platform, idle).await;
                return;
            }
            for ev in &relevant {
                let Some(payload) = crate::ws::intents::filter(intents, &ev.payload, user_id) else { continue };
                if tx.send(Message::Text(payload.to_string())).await.is_err() {
                    crate::ws::bus::disconnect(&state, user_id, &platform, idle).await;
                    return;
                }
            }
            let _ = first;
            crate::ws::bus::announce(&state, user_id).await;
            let session = state.hub.next_session();
            run_loop(&state, user_id, session_id, session, my_guilds, events, last, &mut tx, &mut rx, &platform, idle, intents).await;
            return;
        }
        tracing::debug!(user = %user_id, after, "resume gap not buffered; sending READY");
    }

    // --- Build READY payload ---
    let mut user = match sqlx::query_as::<_, PrivateUser>(
        &format!("SELECT {} FROM users WHERE id = $1", crate::routes::users::PRIVATE_USER_COLS),
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(u) => u,
        Err(_) => return,
    };
    if !user.is_admin && crate::routes::users::ensure_admin(&state, user_id).await.unwrap_or(false) {
        user.is_admin = true;
    }

    let guilds = sqlx::query_as::<_, Guild>(&format!(
        "SELECT g.{} FROM guilds g JOIN guild_members m ON m.guild_id = g.id WHERE m.user_id = $1 ORDER BY m.joined_at",
        crate::routes::guilds::GUILD_COLS.replace(", ", ", g.")
    ))
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let guild_ids: Vec<Uuid> = guilds.iter().map(|g| g.id).collect();
    let my_guilds: HashSet<Uuid> = guild_ids.iter().copied().collect();

    // Only channels this user may view, plus every guild's roles and the user's own member rows.
    let mut channels: Vec<Channel> = Vec::new();
    let mut roles: Vec<Role> = Vec::new();
    let mut me_members: Vec<Member> = Vec::new();
    for gid in &guild_ids {
        channels.extend(perms::visible_channels(&state.db, *gid, user_id).await.unwrap_or_default());
        roles.extend(perms::list_roles(&state.db, *gid).await.unwrap_or_default());
        if let Ok(mut m) = sqlx::query_as::<_, Member>(
            "SELECT m.guild_id, m.user_id, m.nickname, m.joined_at, u.username, u.display_name, u.avatar_url, u.status, u.custom_status, m.timeout_until, m.rules_accepted_at, m.mute, m.deaf, u.avatar_decoration, u.clan_tag, m.guild_avatar, m.guild_banner, m.guild_bio, m.guild_pronouns
             FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = $1 AND m.user_id = $2",
        )
        .bind(gid)
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        {
            let _ = attach_roles(&state.db, std::slice::from_mut(&mut m)).await;
            me_members.push(m);
        }
    }

    let emojis = crate::routes::expressions::emojis_for_guilds(&state.db, &guild_ids).await.unwrap_or_default();
    let stickers = crate::routes::expressions::stickers_for_guilds(&state.db, &guild_ids).await.unwrap_or_default();
    let bookmarks = crate::routes::channels::bookmark_ids(&state.db, user_id).await.unwrap_or_default();
    let notification_settings = crate::routes::users::notif_settings_for(&state.db, user_id).await.unwrap_or_default();
    let dms = list_dm_channels(&state.db, user_id).await.unwrap_or_default();
    let relationships = crate::routes::relationships::list_for(&state.db, user_id).await.unwrap_or_default();

    let read_states: Vec<(Uuid, Option<Uuid>)> =
        sqlx::query_as("SELECT channel_id, last_read_msg FROM read_states WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    let mut all_channel_ids: Vec<Uuid> = channels.iter().map(|c| c.id).collect();
    all_channel_ids.extend(dms.iter().map(|d| d.channel.id));
    // Unread messages that mention me (directly, via one of my roles, or @everyone) per channel. In accepted DMs every
    // message counts, as in Discord, so the server bar can badge each unread DM with its message count.
    let dm_ids: Vec<Uuid> = dms.iter().filter(|d| d.request_state == "accepted").map(|d| d.channel.id).collect();
    let mention_counts = mention_counts(&state.db, user_id, &all_channel_ids, &dm_ids).await;
    let guild_layout: serde_json::Value = sqlx::query_as::<_, (serde_json::Value,)>("SELECT guild_layout FROM users WHERE id = $1").bind(user_id).fetch_one(&state.db).await.map(|r| r.0).unwrap_or(serde_json::json!([]));
    // Postgres has no max(uuid); DISTINCT ON picks the newest (v7 ids sort by time) per channel.
    let last_ids: Vec<(Uuid, Uuid)> =
        sqlx::query_as("SELECT DISTINCT ON (channel_id) channel_id, id FROM messages WHERE channel_id = ANY($1) ORDER BY channel_id, id DESC")
            .bind(&all_channel_ids)
            .fetch_all(&state.db)
            .await
            .unwrap_or_else(|e| { tracing::error!(error = ?e, "last message ids"); Vec::new() });

    // Subscribe BEFORE announcing presence so we don't miss events.
    let events = state.hub.subscribe();
    let seq_at_subscribe = state.hub.current_seq();
    let first = crate::ws::bus::connect(&state, user_id, &platform, idle).await;
    let online = crate::ws::bus::online_users(&state.db).await;
    let idle_users = crate::ws::bus::idle_users(&state.db).await;
    let activities = crate::routes::spotify::ready_activities(&state.db).await;
    let platforms: serde_json::Map<String, Value> = crate::ws::bus::online_platforms(&state.db).await.into_iter().map(|(u, p)| (u.to_string(), json!(p))).collect();
    let mut voice_states = state.hub.voice_states_for_guilds(&guild_ids);
    voice_states.extend(state.hub.voice_states_for_channels(&dms.iter().map(|d| d.channel.id).collect::<Vec<_>>()));
    let session = state.hub.next_session();

    let ready = json!({
        "t": "READY",
        "s": seq_at_subscribe,
        "i": state.hub.instance_id,
        "d": {
            "user": user,
            "guilds": guilds,
            "channels": channels,
            "roles": roles,
            "emojis": emojis,
            "stickers": stickers,
            "bookmarks": bookmarks,
            "notification_settings": notification_settings,
            "mention_counts": mention_counts.iter().map(|(c, n)| json!({"channel_id": c, "count": n})).collect::<Vec<_>>(),
            "guild_layout": guild_layout,
            "me_members": me_members,
            "dm_channels": dms,
            "relationships": relationships,
            "online": online,
            "platforms": platforms,
            "idle": idle_users,
            "activities": activities,
            "read_states": read_states.iter().map(|(c, m)| json!({"channel_id": c, "last_read_msg": m})).collect::<Vec<_>>(),
            "last_message_ids": last_ids.iter().map(|(c, m)| json!({"channel_id": c, "message_id": m})).collect::<Vec<_>>(),
            "voice_states": voice_states,
            "ice_servers": state.config.ice_servers,
        }
    });
    if tx.send(Message::Text(ready.to_string())).await.is_err() {
        crate::ws::bus::disconnect(&state, user_id, &platform, idle).await;
        return;
    }
    crate::metrics::METRICS.ws_connects.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    let _ = first;
    crate::ws::bus::announce(&state, user_id).await;

    run_loop(&state, user_id, session_id, session, my_guilds, events, seq_at_subscribe, &mut tx, &mut rx, &platform, idle, intents).await;
}

fn matches_target(target: &Target, user_id: Uuid, session_id: Uuid, my_guilds: &HashSet<Uuid>) -> bool {
    match target {
        Target::All => true,
        Target::Guild(g) => my_guilds.contains(g),
        Target::Users(us) => us.contains(&user_id),
        Target::Session(s) => *s == session_id,
    }
}

/// Stream events (skipping any with seq <= `already_sent`, which a resume replayed) and handle client ops
/// until the socket closes; then tidy voice and presence.
#[allow(clippy::too_many_arguments)]
async fn run_loop(
    state: &AppState,
    user_id: Uuid,
    session_id: Uuid,
    session: u64,
    mut my_guilds: HashSet<Uuid>,
    mut events: tokio::sync::broadcast::Receiver<crate::ws::hub::Event>,
    already_sent: u64,
    tx: &mut futures::stream::SplitSink<WebSocket, Message>,
    rx: &mut futures::stream::SplitStream<WebSocket>,
    platform: &str,
    mut idle: bool,
    intents: Option<u32>,
) {
    let mut last_seq = already_sent;
    loop {
        tokio::select! {
            ev = events.recv() => {
                match ev {
                    Ok(ev) => {
                        if ev.seq <= last_seq { continue; }
                        if !matches_target(&ev.target, user_id, session_id, &my_guilds) { continue; }
                        last_seq = ev.seq;
                        track_membership(&ev.payload, user_id, &mut my_guilds);
                        let Some(payload) = crate::ws::intents::filter(intents, &ev.payload, user_id) else { continue };
                        if tx.send(Message::Text(payload.to_string())).await.is_err() {
                            break;
                        }
                    }
                    Err(RecvError::Lagged(n)) => {
                        tracing::warn!(user = %user_id, lagged = n, "ws receiver lagged; asking client to resync");
                        let _ = tx.send(Message::Text(json!({"t":"RESYNC","d":{}}).to_string())).await;
                    }
                    Err(RecvError::Closed) => break,
                }
            }
            msg = rx.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<ClientOp>(&text) {
                            // Per-socket state: only announce when the user as a whole goes away or comes back.
                            Ok(ClientOp::Idle { idle: now }) => if now != idle {
                                let before = crate::ws::bus::is_idle(&state.db, user_id).await;
                                crate::ws::bus::set_idle(state, user_id, now).await;
                                idle = now;
                                if crate::ws::bus::is_idle(&state.db, user_id).await != before { crate::ws::bus::announce(state, user_id).await; }
                            },
                            Ok(op) => handle_client_op(state, user_id, session, op, tx).await,
                            Err(_) => {}
                        }
                    }
                    Some(Ok(Message::Ping(p))) => { let _ = tx.send(Message::Pong(p)).await; }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }

    // Leave voice if this socket owned the voice session.
    if let Some(prev) = state.hub.voice_leave(user_id, Some(session)) {
        emit_voice_leave(state, &prev);
    }
    if crate::ws::bus::disconnect(state, user_id, platform, idle).await {
        // Offline everywhere now: temporary members without a role leave their temporary servers.
        let st = state.clone();
        tokio::spawn(async move { crate::routes::guilds::drop_temporary(&st, user_id).await });
    }
    crate::ws::bus::announce(state, user_id).await;
}

pub fn emit_voice_leave(state: &AppState, prev: &VoiceState) {
    state.hub.emit_voice(prev, prev.leave_payload());
    // Last one out of a server voice channel: its status goes with them.
    if prev.guild_id.is_some() && state.hub.voice_in_channel(prev.channel_id) == 0 {
        let st = state.clone();
        let channel_id = prev.channel_id;
        tokio::spawn(async move {
            if let Err(e) = crate::routes::channels::set_voice_status_inner(&st, channel_id, "").await {
                tracing::warn!(error = ?e, "voice status clear failed");
            }
        });
    }
    // Last one out of a DM call: settle its notice.
    if prev.guild_id.is_none() && state.hub.voice_in_channel(prev.channel_id) == 0 {
        if let Some((_, call)) = state.hub.calls.remove(&prev.channel_id) {
            let st = state.clone();
            let channel_id = prev.channel_id;
            tokio::spawn(async move {
                if let Err(e) = crate::routes::channels::finish_call(&st, channel_id, call).await {
                    tracing::warn!(error = ?e, "call wrap-up failed");
                }
            });
        }
    }
}

/// Keep the per-socket guild set in sync from the event stream itself.
fn track_membership(payload: &Value, me: Uuid, my_guilds: &mut HashSet<Uuid>) {
    let t = payload.get("t").and_then(|v| v.as_str()).unwrap_or("");
    let d = match payload.get("d") { Some(d) => d, None => return };
    let uuid = |k: &str| d.get(k).and_then(|v| v.as_str()).and_then(|s| Uuid::parse_str(s).ok());
    match t {
        "GUILD_CREATE" => { if let Some(id) = uuid("id") { my_guilds.insert(id); } }
        "GUILD_DELETE" => { if let Some(id) = uuid("id") { my_guilds.remove(&id); } }
        "GUILD_MEMBER_REMOVE" => {
            if uuid("user_id") == Some(me) {
                if let Some(g) = uuid("guild_id") { my_guilds.remove(&g); }
            }
        }
        _ => {}
    }
}

async fn handle_client_op(
    state: &AppState,
    user_id: Uuid,
    session: u64,
    op: ClientOp,
    tx: &mut futures::stream::SplitSink<WebSocket, Message>,
) {
    match op {
        ClientOp::VoiceJoin { channel_id, e2ee } => {
            // Guild voice channels need CONNECT; a DM channel is a 1:1/group call for its members.
            let (channel, p) = match crate::routes::channels::require_channel_perms(&state.db, channel_id, user_id).await {
                Ok((c, p)) if c.guild_id.is_none() || ((c.kind == "voice" || c.kind == "stage" || c.kind == "studio") && has(p, perms::CONNECT)) => (c, p),
                _ => {
                    let _ = tx.send(Message::Text(json!({"t":"VOICE_ERROR","d":{"message":"You don't have permission to join this voice channel"}}).to_string())).await;
                    return;
                }
            };
            if channel.e2ee && !e2ee {
                let _ = tx.send(Message::Text(json!({"t":"VOICE_ERROR","d":{"message":"This call is end-to-end encrypted, and this app or browser can't encrypt calls. Update Parley or use a current browser to join."}}).to_string())).await;
                return;
            }
            let guild_id = channel.guild_id;
            // A full channel turns people away, except those who may move members and someone a moderator just moved here.
            let moved_here = state.hub.moves.remove(&user_id).map(|(_, c)| c == channel_id).unwrap_or(false);
            let already_here = state.hub.voice_state(user_id).map(|v| v.channel_id == channel_id).unwrap_or(false);
            if channel.user_limit > 0 && !already_here && !moved_here && !has(p, perms::MOVE_MEMBERS) && state.hub.voice_in_channel(channel_id) >= channel.user_limit as usize {
                let _ = tx.send(Message::Text(json!({"t":"VOICE_ERROR","d":{"message":"This voice channel is full"}}).to_string())).await;
                return;
            }
            // Server mute and deafen follow the member from channel to channel.
            let (mute, deaf) = match guild_id {
                Some(g) => sqlx::query_as::<_, (bool, bool)>("SELECT mute, deaf FROM guild_members WHERE guild_id = $1 AND user_id = $2").bind(g).bind(user_id).fetch_optional(&state.db).await.ok().flatten().unwrap_or((false, false)),
                None => (false, false),
            };
            let peers: Vec<Uuid> = if guild_id.is_none() {
                sqlx::query_as::<_, (Uuid,)>("SELECT user_id FROM channel_members WHERE channel_id = $1").bind(channel_id).fetch_all(&state.db).await.map(|r| r.into_iter().map(|x| x.0).collect()).unwrap_or_default()
            } else { Vec::new() };
            // Carry over mute/deaf prefs if moving between channels.
            let (self_mute, self_deaf) = state.hub.voice_state(user_id).map(|v| (v.self_mute, v.self_deaf)).unwrap_or((false, false));
            // Video/screen always start off in a new channel: the client re-attaches tracks after joining.
            // Stage: everyone but moderators joins as audience. Studio: the engineer and moderators are in the band from the start.
            let crew = perms::stage_mod(p) || (channel.kind == "studio" && perms::is_engineer(&state.db, channel_id, user_id).await.unwrap_or(false));
            // The server's inactive (AFK) channel is listen-only.
            let suppress = guild_id.is_some() && (!has(p, perms::SPEAK) || ((channel.kind == "stage" || channel.kind == "studio") && !crew) || is_afk_channel(&state.db, &channel).await);
            // The "active for" timer keeps counting across reconnects to the same channel.
            let joined_at = state.hub.voice_state(user_id).filter(|v| v.channel_id == channel_id).map(|v| v.joined_at).unwrap_or_else(chrono::Utc::now);
            let vs = VoiceState { guild_id, channel_id, user_id, self_mute, self_deaf, self_video: false, self_stream: false, suppress, mute, deaf, request_to_speak: false, e2ee, session, peers, watching: Vec::new(), joined_at, priority: false, captions: false };
            let moved_in = state.hub.voice_join(vs.clone()).map(|prev| {
                if prev.channel_id != channel_id || prev.guild_id != guild_id { emit_voice_leave(state, &prev); true } else { false }
            }).unwrap_or(true);
            if guild_id.is_some() {
                let target = perms::channel_audience(&state.db, &channel).await.unwrap_or(Target::Users(vec![user_id]));
                state.hub.emit(target, "VOICE_STATE_UPDATE", json!(vs));
                // Their entrance sound, if they have one and may make noise here.
                if moved_in && !suppress && !mute && channel.kind == "voice" {
                    if let Ok(Some((es,))) = sqlx::query_as::<_, (String,)>("SELECT entrance_sound FROM users WHERE id = $1 AND entrance_sound <> ''").bind(user_id).fetch_optional(&state.db).await {
                        if let Ok(Some(sound)) = crate::routes::sounds::resolve(&state.db, user_id, &es).await {
                            let _ = crate::routes::sounds::emit_play(state, &channel, user_id, sound, true).await;
                        }
                    }
                }
            } else {
                state.hub.emit_voice(&vs, json!(vs));
                // First person in a DM call: leave a "started a call" notice in the conversation and remember the
                // call so the notice can become "lasted N minutes" or "missed call" once everyone has left.
                if state.hub.voice_in_channel(channel_id) == 1 {
                    match crate::routes::channels::system_message(state, &channel, user_id, "call_started", "started a call.", vec![], None, None).await {
                        Ok(m) => { state.hub.calls.insert(channel_id, crate::ws::hub::CallInfo { message_id: m.id, starter: user_id, started_at: std::time::Instant::now(), answered: false }); }
                        Err(e) => tracing::warn!(error = ?e, "call notice failed"),
                    }
                } else if let Some(mut c) = state.hub.calls.get_mut(&channel_id) {
                    if c.starter != user_id { c.answered = true; }
                }
            }
        }
        ClientOp::VoiceLeave => {
            if let Some(prev) = state.hub.voice_leave(user_id, None) {
                emit_voice_leave(state, &prev);
            }
        }
        ClientOp::VoiceState { self_mute, self_deaf, self_video, self_stream, priority } => {
            let Some(cur) = state.hub.voice_state(user_id) else { return };
            // Re-check channel permissions on every update so revoked STREAM/SPEAK take effect.
            let (channel, p) = match crate::routes::channels::require_channel_perms(&state.db, cur.channel_id, user_id).await {
                Ok(x) => x,
                Err(_) => {
                    if let Some(prev) = state.hub.voice_leave(user_id, None) { emit_voice_leave(state, &prev); }
                    return;
                }
            };
            let can_stream = channel.guild_id.is_none() || has(p, perms::STREAM);
            let suppress = channel.guild_id.is_some() && (!has(p, perms::SPEAK) || is_afk_channel(&state.db, &channel).await);
            if let Some(vs) = state.hub.voice_update(user_id, |v| {
                v.self_mute = self_mute; v.self_deaf = self_deaf;
                v.self_video = self_video && can_stream; v.self_stream = self_stream && can_stream;
                // Stage audience stays suppressed across mute/deaf toggles; only a moderator lifts it.
                v.suppress = suppress || ((channel.kind == "stage" || channel.kind == "studio") && v.suppress);
                v.priority = priority && channel.guild_id.is_some() && has(p, perms::PRIORITY_SPEAKER);
            }) {
                if channel.guild_id.is_some() {
                    let target = perms::channel_audience(&state.db, &channel).await.unwrap_or(Target::Users(vec![user_id]));
                    state.hub.emit(target, "VOICE_STATE_UPDATE", json!(vs));
                } else {
                    state.hub.emit_voice(&vs, json!(vs));
                }
            }
        }
        ClientOp::StreamWatch { user_id: streamer, on } => {
            let Some(peer) = state.hub.voice_state(streamer) else { return };
            let Some(vs) = state.hub.voice_update(user_id, |v| {
                if v.channel_id != peer.channel_id { return }
                v.watching.retain(|x| *x != streamer);
                if on { v.watching.push(streamer) }
            }) else { return };
            broadcast_voice(state, &vs).await;
        }
        ClientOp::VoiceCaptions { on } => {
            let Some(vs) = state.hub.voice_update(user_id, |v| v.captions = on) else { return };
            broadcast_voice(state, &vs).await;
        }
        ClientOp::VoiceReaction { emoji } => {
            let emoji: String = emoji.trim().chars().take(64).collect();
            if emoji.is_empty() { return }
            let Some(vs) = state.hub.voice_state(user_id) else { return };
            let now = std::time::Instant::now();
            if state.hub.reacted.get(&user_id).map(|t| now.duration_since(*t) < std::time::Duration::from_millis(250)).unwrap_or(false) { return }
            state.hub.reacted.insert(user_id, now);
            let d = json!({ "channel_id": vs.channel_id, "user_id": user_id, "emoji": emoji });
            match vs.guild_id {
                Some(g) => state.hub.emit_guild(g, "VOICE_REACTION", d),
                None => state.hub.emit_users(vs.peers.clone(), "VOICE_REACTION", d),
            }
        }
        ClientOp::VoiceSignal { to, data } => {
            // Only relay between two users in the same voice channel.
            let (Some(me), Some(peer)) = (state.hub.voice_state(user_id), state.hub.voice_state(to)) else { return };
            if me.channel_id != peer.channel_id { return; }
            state.hub.emit_users(vec![to], "VOICE_SIGNAL", json!({ "from": user_id, "channel_id": me.channel_id, "data": data }));
        }
        ClientOp::Ping => {
            let _ = tx.send(Message::Text(json!({"t":"PONG","d":{}}).to_string())).await;
        }
        // Handled in run_loop, which owns the socket's idle flag.
        ClientOp::Idle { .. } => {}
        ClientOp::Activity => {
            let _ = sqlx::query("UPDATE users SET active_at = now() WHERE id = $1").bind(user_id).execute(&state.db).await;
        }
        ClientOp::Typing { channel_id } => {
            let shows: Option<(bool,)> = sqlx::query_as("SELECT show_typing FROM users WHERE id = $1").bind(user_id).fetch_optional(&state.db).await.unwrap_or(None);
            if !shows.map(|x| x.0).unwrap_or(true) { return; }
            if let Ok((c, p)) = crate::routes::channels::require_channel_perms(&state.db, channel_id, user_id).await {
                if !has(p, perms::SEND_MESSAGES) { return; }
                if let Ok(target) = crate::routes::channels::target_for(&state.db, &c).await {
                    state.hub.emit(target, "TYPING_START", json!({ "channel_id": channel_id, "user_id": user_id }));
                }
            }
        }
    }
}

/// Unread messages that mention `user_id` (directly, via one of their roles, or @everyone) per channel; in accepted
/// DMs (`dm_ids`) every unread message counts. Used by READY and by `GET /users/@me/unreads`.
pub async fn mention_counts(db: &sqlx::PgPool, user_id: Uuid, channel_ids: &[Uuid], dm_ids: &[Uuid]) -> Vec<(Uuid, i64)> {
    let my_roles: Vec<Uuid> = sqlx::query_as::<_, (Uuid,)>("SELECT role_id FROM member_roles WHERE user_id = $1").bind(user_id).fetch_all(db).await.unwrap_or_default().into_iter().map(|r| r.0).collect();
    sqlx::query_as(
        "SELECT m.channel_id, COUNT(*) FROM messages m
         LEFT JOIN read_states rs ON rs.channel_id = m.channel_id AND rs.user_id = $1
         WHERE m.channel_id = ANY($2) AND m.author_id <> $1 AND (rs.last_read_msg IS NULL OR m.id > rs.last_read_msg)
           AND (m.channel_id = ANY($4) OR m.mentions @> ARRAY[$1]::uuid[]
                OR (m.mention_everyone AND NOT COALESCE(
                      (SELECT suppress_everyone FROM notification_settings WHERE user_id = $1 AND target_id = m.channel_id),
                      (SELECT ns.suppress_everyone FROM notification_settings ns JOIN channels c ON c.guild_id = ns.target_id WHERE ns.user_id = $1 AND c.id = m.channel_id),
                      false))
                OR (m.mention_roles && $3::uuid[] AND NOT COALESCE(
                      (SELECT suppress_roles FROM notification_settings WHERE user_id = $1 AND target_id = m.channel_id),
                      (SELECT ns.suppress_roles FROM notification_settings ns JOIN channels c ON c.guild_id = ns.target_id WHERE ns.user_id = $1 AND c.id = m.channel_id),
                      false)))
         GROUP BY m.channel_id",
    )
    .bind(user_id)
    .bind(channel_ids)
    .bind(&my_roles)
    .bind(dm_ids)
    .fetch_all(db)
    .await
    .unwrap_or_else(|e| { tracing::error!(error = ?e, "mention counts"); Vec::new() })
}

/// Whether `channel` is its server's inactive (AFK) channel, where nobody can speak.
async fn is_afk_channel(db: &sqlx::PgPool, channel: &crate::models::Channel) -> bool {
    let Some(g) = channel.guild_id else { return false };
    sqlx::query_as::<_, (bool,)>("SELECT afk_channel_id IS NOT DISTINCT FROM $2 FROM guilds WHERE id = $1").bind(g).bind(channel.id)
        .fetch_one(db).await.map(|r| r.0).unwrap_or(false)
}

/// Send a member's voice state to whoever can see that channel (or the DM's members).
async fn broadcast_voice(state: &AppState, vs: &VoiceState) {
    if vs.guild_id.is_some() {
        let Ok(channel) = sqlx::query_as::<_, crate::models::Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS)).bind(vs.channel_id).fetch_one(&state.db).await else { return };
        let target = perms::channel_audience(&state.db, &channel).await.unwrap_or(Target::Users(vec![vs.user_id]));
        state.hub.emit(target, "VOICE_STATE_UPDATE", json!(vs));
    } else {
        state.hub.emit_voice(vs, json!(vs));
    }
}
