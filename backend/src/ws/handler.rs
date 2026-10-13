use crate::{
    auth::verify_token,
    models::{Channel, Guild, PrivateUser},
    routes::dms::list_dm_channels,
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
}

pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(q): Query<WsQuery>,
) -> Response {
    match verify_token(&state.config.jwt_secret, &q.token) {
        Some(uid) => ws.on_upgrade(move |socket| handle_socket(socket, state, uid)),
        None => (axum::http::StatusCode::UNAUTHORIZED, "invalid token").into_response(),
    }
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum ClientOp {
    Ping,
    Typing { channel_id: Uuid },
    VoiceJoin { channel_id: Uuid },
    VoiceLeave,
    VoiceState { self_mute: bool, self_deaf: bool },
    /// WebRTC signaling relayed verbatim to one peer in the same voice channel.
    VoiceSignal { to: Uuid, data: Value },
}

async fn handle_socket(socket: WebSocket, state: AppState, user_id: Uuid) {
    let (mut tx, mut rx) = socket.split();

    // --- Build READY payload ---
    let user = match sqlx::query_as::<_, PrivateUser>(
        "SELECT id, username, display_name, email, avatar_url, bio, status, created_at FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    {
        Ok(u) => u,
        Err(_) => return,
    };

    let guilds = sqlx::query_as::<_, Guild>(
        "SELECT g.id, g.name, g.icon_url, g.owner_id, g.created_at FROM guilds g
         JOIN guild_members m ON m.guild_id = g.id WHERE m.user_id = $1 ORDER BY m.joined_at",
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let guild_ids: Vec<Uuid> = guilds.iter().map(|g| g.id).collect();
    let mut my_guilds: HashSet<Uuid> = guild_ids.iter().copied().collect();

    let channels = sqlx::query_as::<_, Channel>(
        "SELECT id, guild_id, name, kind, topic, position, created_at FROM channels
         WHERE guild_id = ANY($1) ORDER BY position, created_at",
    )
    .bind(&guild_ids)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let dms = list_dm_channels(&state.db, user_id).await.unwrap_or_default();

    let read_states: Vec<(Uuid, Option<Uuid>)> =
        sqlx::query_as("SELECT channel_id, last_read_msg FROM read_states WHERE user_id = $1")
            .bind(user_id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    let mut all_channel_ids: Vec<Uuid> = channels.iter().map(|c| c.id).collect();
    all_channel_ids.extend(dms.iter().map(|d| d.channel.id));
    let last_ids: Vec<(Uuid, Uuid)> =
        sqlx::query_as("SELECT channel_id, MAX(id) FROM messages WHERE channel_id = ANY($1) GROUP BY channel_id")
            .bind(&all_channel_ids)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

    // Subscribe BEFORE announcing presence so we don't miss events.
    let mut events = state.hub.subscribe();
    let first = state.hub.connect(user_id);
    let online = state.hub.online_users();
    let voice_states = state.hub.voice_states_for_guilds(&guild_ids);
    let session = state.hub.next_session();

    let ready = json!({
        "t": "READY",
        "d": {
            "user": user,
            "guilds": guilds,
            "channels": channels,
            "dm_channels": dms,
            "online": online,
            "read_states": read_states.iter().map(|(c, m)| json!({"channel_id": c, "last_read_msg": m})).collect::<Vec<_>>(),
            "last_message_ids": last_ids.iter().map(|(c, m)| json!({"channel_id": c, "message_id": m})).collect::<Vec<_>>(),
            "voice_states": voice_states,
            "ice_servers": state.config.ice_servers,
        }
    });
    if tx.send(Message::Text(ready.to_string())).await.is_err() {
        state.hub.disconnect(user_id);
        return;
    }

    if first {
        state.hub.emit_all("PRESENCE_UPDATE", json!({ "user_id": user_id, "online": true }));
    }

    loop {
        tokio::select! {
            ev = events.recv() => {
                match ev {
                    Ok(ev) => {
                        let relevant = match &ev.target {
                            Target::All => true,
                            Target::Guild(g) => my_guilds.contains(g),
                            Target::Users(us) => us.contains(&user_id),
                        };
                        if !relevant { continue; }
                        track_membership(&ev.payload, user_id, &mut my_guilds);
                        if tx.send(Message::Text(ev.payload.to_string())).await.is_err() {
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
                        if let Ok(op) = serde_json::from_str::<ClientOp>(&text) {
                            handle_client_op(&state, user_id, session, op, &mut tx).await;
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
        emit_voice_leave(&state, &prev);
    }
    if state.hub.disconnect(user_id) {
        state.hub.emit_all("PRESENCE_UPDATE", json!({ "user_id": user_id, "online": false }));
    }
}

fn emit_voice_leave(state: &AppState, prev: &VoiceState) {
    state.hub.emit_guild(
        prev.guild_id,
        "VOICE_STATE_UPDATE",
        json!({ "guild_id": prev.guild_id, "channel_id": Value::Null, "user_id": prev.user_id, "self_mute": prev.self_mute, "self_deaf": prev.self_deaf }),
    );
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
        ClientOp::VoiceJoin { channel_id } => {
            let channel = match crate::routes::channels::require_channel(&state.db, channel_id, user_id).await {
                Ok(c) if c.kind == "voice" && c.guild_id.is_some() => c,
                _ => {
                    let _ = tx.send(Message::Text(json!({"t":"VOICE_ERROR","d":{"message":"Not a voice channel you can access"}}).to_string())).await;
                    return;
                }
            };
            let guild_id = channel.guild_id.unwrap();
            // Carry over mute/deaf prefs if moving between channels.
            let (self_mute, self_deaf) = state.hub.voice_state(user_id).map(|v| (v.self_mute, v.self_deaf)).unwrap_or((false, false));
            let vs = VoiceState { guild_id, channel_id, user_id, self_mute, self_deaf, session };
            if let Some(prev) = state.hub.voice_join(vs.clone()) {
                if prev.channel_id != channel_id || prev.guild_id != guild_id {
                    emit_voice_leave(state, &prev);
                }
            }
            state.hub.emit_guild(guild_id, "VOICE_STATE_UPDATE", json!(vs));
        }
        ClientOp::VoiceLeave => {
            if let Some(prev) = state.hub.voice_leave(user_id, None) {
                emit_voice_leave(state, &prev);
            }
        }
        ClientOp::VoiceState { self_mute, self_deaf } => {
            if let Some(vs) = state.hub.voice_update(user_id, |v| { v.self_mute = self_mute; v.self_deaf = self_deaf; }) {
                state.hub.emit_guild(vs.guild_id, "VOICE_STATE_UPDATE", json!(vs));
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
        ClientOp::Typing { channel_id } => {
            if let Ok(target) = crate::routes::channels::channel_target(&state.db, channel_id, user_id).await {
                state.hub.emit(target, "TYPING_START", json!({ "channel_id": channel_id, "user_id": user_id }));
            }
        }
    }
}
