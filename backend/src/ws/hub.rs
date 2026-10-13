use dashmap::DashMap;
use serde::Serialize;
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

/// Fan-out hub. One global broadcast channel; each socket task filters by target.
pub struct Hub {
    tx: broadcast::Sender<Event>,
    /// user_id -> number of open sockets
    online: DashMap<Uuid, usize>,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl Hub {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(4096);
        Self { tx, online: DashMap::new() }
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
}
