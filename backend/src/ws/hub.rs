use dashmap::DashMap;
use serde::Serialize;
use std::collections::HashMap;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

#[derive(Debug, Clone)]
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
    /// Server-side: the member lacks SPEAK here, so the client must keep its mic gate closed.
    pub suppress: bool,
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
                "self_mute": self.self_mute, "self_deaf": self.self_deaf, "self_video": self.self_video, "self_stream": self.self_stream, "suppress": self.suppress })
    }
}

/// Fan-out hub. One global broadcast channel; each socket task filters by target.
pub struct Hub {
    tx: broadcast::Sender<Event>,
    /// user_id -> number of open sockets
    online: DashMap<Uuid, usize>,
    /// user_id -> current voice channel
    voice: DashMap<Uuid, VoiceState>,
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
            tx,
            online: DashMap::new(),
            voice: DashMap::new(),
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

    pub fn emit<T: Serialize>(&self, target: Target, t: &str, d: T) {
        // Assign the sequence number and buffer the event under one lock so order and numbering agree.
        let mut buf = self.replay.lock().unwrap_or_else(|e| e.into_inner());
        let seq = self.seq.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        let payload = Arc::new(json!({ "t": t, "d": d, "s": seq }));
        let ev = Event { seq, target, payload };
        if buf.len() >= REPLAY_BUFFER {
            buf.pop_front();
        }
        buf.push_back(ev.clone());
        drop(buf);
        let _ = self.tx.send(ev);
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

    pub fn online_users(&self) -> Vec<Uuid> {
        self.online.iter().map(|e| *e.key()).collect()
    }

    pub fn next_session(&self) -> u64 {
        self.session_seq.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }

    /// Put the user in a voice channel (replacing any previous one). Returns the previous state, if any.
    pub fn voice_join(&self, state: VoiceState) -> Option<VoiceState> {
        self.voice.insert(state.user_id, state)
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
