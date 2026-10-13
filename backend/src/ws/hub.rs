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
}

#[derive(Debug, Clone)]
pub struct Event {
    pub target: Target,
    pub payload: Arc<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceState {
    pub guild_id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub self_mute: bool,
    pub self_deaf: bool,
    /// Which socket owns this state; another tab joining replaces it.
    #[serde(skip)]
    pub session: u64,
}

/// Fan-out hub. One global broadcast channel; each socket task filters by target.
pub struct Hub {
    tx: broadcast::Sender<Event>,
    /// user_id -> number of open sockets
    online: DashMap<Uuid, usize>,
    /// user_id -> current voice channel
    voice: DashMap<Uuid, VoiceState>,
    session_seq: std::sync::atomic::AtomicU64,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl Hub {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(4096);
        Self { tx, online: DashMap::new(), voice: DashMap::new(), session_seq: std::sync::atomic::AtomicU64::new(1) }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.tx.subscribe()
    }

    pub fn emit<T: Serialize>(&self, target: Target, t: &str, d: T) {
        let payload = Arc::new(json!({ "t": t, "d": d }));
        let _ = self.tx.send(Event { target, payload });
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
            self.emit_guild(v.guild_id, "VOICE_STATE_UPDATE",
                serde_json::json!({ "guild_id": v.guild_id, "channel_id": Value::Null, "user_id": v.user_id, "self_mute": v.self_mute, "self_deaf": v.self_deaf }));
        }
    }

    /// Voice states across a set of guilds, grouped for READY.
    pub fn voice_states_for_guilds(&self, guilds: &[Uuid]) -> Vec<VoiceState> {
        let set: HashMap<Uuid, ()> = guilds.iter().map(|g| (*g, ())).collect();
        self.voice.iter().filter(|v| set.contains_key(&v.guild_id)).map(|v| v.clone()).collect()
    }
}
