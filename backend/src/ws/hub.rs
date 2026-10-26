use dashmap::DashMap;
use serde::Serialize;
use std::collections::HashMap;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub enum Target {
    All,
    Guild(Uuid),
    Users(Vec<Uuid>),
    /// One login (sessions.id): used to log out a single device.
    Session(Uuid),
}

#[derive(Debug, Clone)]
pub struct Event {
    /// Global, monotonic; also present in the payload as `s` so clients can resume from it.
    pub seq: u64,
    pub target: Target,
    pub payload: Arc<Value>,
}

/// How many recent events are kept for `GET /ws?seq=` resumes.
pub const REPLAY_BUFFER: usize = 4096;

#[derive(Debug, Clone, Serialize)]
pub struct VoiceState {
    /// None for a DM call.
    pub guild_id: Option<Uuid>,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub self_mute: bool,
    pub self_deaf: bool,
    pub self_video: bool,
    pub self_stream: bool,
    /// Server-side: the member lacks SPEAK here (or is in a stage audience), so the client must keep its mic gate closed.
    pub suppress: bool,
    /// Server muted / deafened by a moderator (kept on the member until lifted). Deafened members can't speak either.
    #[serde(default)]
    pub mute: bool,
    #[serde(default)]
    pub deaf: bool,
    /// Stage channels: the member asked to speak (shown to moderators).
    #[serde(default)]
    pub request_to_speak: bool,
    /// The client can encrypt media end to end (it said so when joining); end-to-end encrypted calls need it.
    #[serde(skip)]
    pub e2ee: bool,
    /// Which socket owns this state; another tab joining replaces it.
    #[serde(skip)]
    pub session: u64,
    /// DM calls only: who hears about this state (the DM's members).
    #[serde(skip)]
    pub peers: Vec<Uuid>,
}

impl VoiceState {
    /// Same shape as a normal state update but with `channel_id: null`, meaning "left voice".
    pub fn leave_payload(&self) -> Value {
        json!({ "guild_id": self.guild_id, "channel_id": Value::Null, "user_id": self.user_id,
                "self_mute": self.self_mute, "self_deaf": self.self_deaf, "self_video": self.self_video, "self_stream": self.self_stream, "suppress": self.suppress,
                "mute": self.mute, "deaf": self.deaf })
    }
}

/// A DM call in progress: rewritten into "lasted N minutes" / "missed call" when the last person leaves.
#[derive(Clone, Debug)]
pub struct CallInfo {
    pub message_id: Uuid,
    pub starter: Uuid,
    pub started_at: std::time::Instant,
    pub answered: bool,
}

/// Fan-out hub. One global broadcast channel; each socket task filters by target.
pub struct Hub {
    /// This process; events carry it so other instances can tell their own echoes apart, and clients
    /// only resume (replay) against the instance that numbered their last event.
    pub instance_id: Uuid,
    tx: broadcast::Sender<Event>,
    /// Outgoing copies for the cross-instance bus (see ws::bus); None until `attach_bus`.
    bus: std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedSender<(Target, Arc<Value>)>>>,
    /// user_id -> number of open sockets
    online: DashMap<Uuid, usize>,
    /// user_id -> current voice channel
    voice: DashMap<Uuid, VoiceState>,
    /// DM channel -> the call in progress there (its notice message, who started it, whether anyone else picked up).
    pub calls: DashMap<Uuid, CallInfo>,
    /// A moderator moved this user to this voice channel: their next join there skips the user limit.
    pub moves: DashMap<Uuid, Uuid>,
    /// (user, session) -> when the DB last confirmed it live; see auth::check_session.
    session_ok: DashMap<(Uuid, Uuid), std::time::Instant>,
    session_seq: std::sync::atomic::AtomicU64,
    /// Last assigned event sequence number.
    seq: std::sync::atomic::AtomicU64,
    /// Recent events, oldest first, for reconnecting clients to replay what they missed.
    replay: std::sync::Mutex<std::collections::VecDeque<Event>>,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl Hub {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(4096);
        Self {
            instance_id: Uuid::now_v7(),
            tx,
            bus: std::sync::Mutex::new(None),
            online: DashMap::new(),
            voice: DashMap::new(),
            calls: DashMap::new(),
            moves: DashMap::new(),
            session_ok: DashMap::new(),
            session_seq: std::sync::atomic::AtomicU64::new(1),
            seq: std::sync::atomic::AtomicU64::new(0),
            replay: std::sync::Mutex::new(std::collections::VecDeque::with_capacity(REPLAY_BUFFER)),
        }
    }

    /// The newest sequence number handed out so far (0 before any event).
    pub fn current_seq(&self) -> u64 {
        self.seq.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Buffered events with seq > `after`, oldest first, or None when `after` is older than the buffer
    /// (or from a different process lifetime) and a full READY is needed instead.
    pub fn replay_after(&self, after: u64) -> Option<Vec<Event>> {
        let buf = self.replay.lock().unwrap_or_else(|e| e.into_inner());
        let current = self.current_seq();
        if after > current {
            return None;
        }
        let oldest = buf.front().map(|e| e.seq).unwrap_or(current + 1);
        // Gap check: everything after `after` must still be buffered.
        if after + 1 < oldest {
            return None;
        }
        Some(buf.iter().filter(|e| e.seq > after).cloned().collect())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.tx.subscribe()
    }

    /// Wire the outgoing side of the cross-instance bus.
    pub fn attach_bus(&self, tx: tokio::sync::mpsc::UnboundedSender<(Target, Arc<Value>)>) {
        *self.bus.lock().unwrap_or_else(|e| e.into_inner()) = Some(tx);
    }

    pub fn emit<T: Serialize>(&self, target: Target, t: &str, d: T) {
        let ev = self.publish_local(target.clone(), json!({ "t": t, "d": d }));
        if let Some(bus) = self.bus.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            let _ = bus.send((target, ev.payload));
        }
    }

    /// An event that arrived from another instance: deliver locally, never re-publish.
    pub fn inject(&self, target: Target, payload: Value) {
        // A revocation from another instance must also drop this instance's cached session check.
        if let Target::Session(sid) = &target {
            if payload.get("t").and_then(|t| t.as_str()) == Some("SESSION_REVOKED") {
                self.session_ok.retain(|(_, s), _| s != sid);
            }
        }
        self.publish_local(target, payload);
    }

    /// Was this session confirmed live within `ttl`?
    pub fn session_fresh(&self, user: Uuid, session: Uuid, ttl: std::time::Duration) -> bool {
        self.session_ok.get(&(user, session)).map(|t| t.elapsed() < ttl).unwrap_or(false)
    }
    pub fn session_confirm(&self, user: Uuid, session: Uuid) {
        self.session_ok.insert((user, session), std::time::Instant::now());
        if self.session_ok.len() > 50_000 {
            self.session_ok.retain(|_, t| t.elapsed() < std::time::Duration::from_secs(60));
        }
    }
    /// Forget every cached check for a user (revocation, suspension, deletion) so the next request hits the DB.
    pub fn session_forget(&self, user: Uuid) {
        self.session_ok.retain(|(u, _), _| *u != user);
    }

    /// Number the event, buffer it for resumes and broadcast to local sockets (all under one lock so
    /// order and numbering agree).
    fn publish_local(&self, target: Target, mut payload: Value) -> Event {
        let mut buf = self.replay.lock().unwrap_or_else(|e| e.into_inner());
        let seq = self.seq.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        if let Value::Object(m) = &mut payload {
            m.insert("s".into(), json!(seq));
        }
        let ev = Event { seq, target, payload: Arc::new(payload) };
        if buf.len() >= REPLAY_BUFFER {
            buf.pop_front();
        }
        buf.push_back(ev.clone());
        drop(buf);
        let _ = self.tx.send(ev.clone());
        ev
    }

    pub fn emit_guild<T: Serialize>(&self, guild_id: Uuid, t: &str, d: T) {
        self.emit(Target::Guild(guild_id), t, d)
    }

    pub fn emit_users<T: Serialize>(&self, users: Vec<Uuid>, t: &str, d: T) {
        self.emit(Target::Users(users), t, d)
    }

    pub fn emit_all<T: Serialize>(&self, t: &str, d: T) {
        self.emit(Target::All, t, d)
    }

    /// Returns true if this is the user's first open connection.
    pub fn connect(&self, user: Uuid) -> bool {
        let mut e = self.online.entry(user).or_insert(0);
        *e += 1;
        *e == 1
    }

    /// Returns true if this was the user's last open connection.
    pub fn disconnect(&self, user: Uuid) -> bool {
        let mut last = false;
        if let Some(mut e) = self.online.get_mut(&user) {
            *e = e.saturating_sub(1);
            last = *e == 0;
        }
        if last {
            self.online.remove(&user);
        }
        last
    }

    /// Open sockets across all users.
    pub fn socket_count(&self) -> usize {
        self.online.iter().map(|e| *e.value()).sum()
    }

    pub fn voice_count(&self) -> usize {
        self.voice.len()
    }

    pub fn online_users(&self) -> Vec<Uuid> {
        self.online.iter().map(|e| *e.key()).collect()
    }

    /// Drop every cached session check for a user (tokens revoked, account changed).
    pub fn session_forget_user(&self, user: Uuid) {
        self.session_ok.retain(|k, _| k.0 != user);
    }

    pub fn next_session(&self) -> u64 {
        self.session_seq.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }

    /// Put the user in a voice channel (replacing any previous one). Returns the previous state, if any.
    pub fn voice_join(&self, state: VoiceState) -> Option<VoiceState> {
        self.voice.insert(state.user_id, state)
    }

    /// How many users are currently in a voice channel / call.
    pub fn voice_in_channel(&self, channel: Uuid) -> usize {
        self.voice.iter().filter(|v| v.channel_id == channel).count()
    }

    /// Remove the user's voice state. If `session` is given, only remove when that session owns it.
    pub fn voice_leave(&self, user: Uuid, session: Option<u64>) -> Option<VoiceState> {
        match session {
            Some(sid) => self.voice.remove_if(&user, |_, v| v.session == sid).map(|(_, v)| v),
            None => self.voice.remove(&user).map(|(_, v)| v),
        }
    }

    pub fn voice_state(&self, user: Uuid) -> Option<VoiceState> {
        self.voice.get(&user).map(|v| v.clone())
    }

    pub fn voice_update<F: FnOnce(&mut VoiceState)>(&self, user: Uuid, f: F) -> Option<VoiceState> {
        self.voice.get_mut(&user).map(|mut v| { f(&mut v); v.clone() })
    }

    /// Evict every voice state matching the predicate, emitting a leave event for each.
    pub fn voice_evict<F: Fn(&VoiceState) -> bool>(&self, pred: F) {
        let victims: Vec<VoiceState> = self.voice.iter().filter(|v| pred(v)).map(|v| v.clone()).collect();
        for v in victims {
            self.voice.remove(&v.user_id);
            self.emit_voice(&v, v.leave_payload());
        }
    }

    /// Fan a voice payload out to the right audience: the guild, or a DM's members.
    pub fn emit_voice(&self, v: &VoiceState, payload: Value) {
        match v.guild_id {
            Some(g) => self.emit_guild(g, "VOICE_STATE_UPDATE", payload),
            None => self.emit_users(v.peers.clone(), "VOICE_STATE_UPDATE", payload),
        }
    }

    /// Voice states in a set of channels (DM calls for READY).
    pub fn voice_states_for_channels(&self, channels: &[Uuid]) -> Vec<VoiceState> {
        let set: HashMap<Uuid, ()> = channels.iter().map(|c| (*c, ())).collect();
        self.voice.iter().filter(|v| set.contains_key(&v.channel_id)).map(|v| v.clone()).collect()
    }

    /// Voice states across a set of guilds, grouped for READY.
    pub fn voice_states_for_guilds(&self, guilds: &[Uuid]) -> Vec<VoiceState> {
        let set: HashMap<Uuid, ()> = guilds.iter().map(|g| (*g, ())).collect();
        self.voice.iter().filter(|v| v.guild_id.map(|g| set.contains_key(&g)).unwrap_or(false)).map(|v| v.clone()).collect()
    }
}
