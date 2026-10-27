//! Gateway intents for bots: which events a bot connection receives. Bits follow Discord's. Privileged intents
//! (server members, presences, message content) must be switched on for the app first. Without Message Content a bot
//! still sees messages in DMs, ones that mention it, and its own; elsewhere content, embeds and attachments are blank.

use crate::state::AppState;
use serde_json::Value;
use uuid::Uuid;

pub const GUILDS: u32 = 1 << 0;
pub const GUILD_MEMBERS: u32 = 1 << 1;
pub const GUILD_MODERATION: u32 = 1 << 2;
pub const GUILD_EXPRESSIONS: u32 = 1 << 3;
pub const GUILD_VOICE_STATES: u32 = 1 << 7;
pub const GUILD_PRESENCES: u32 = 1 << 8;
pub const GUILD_MESSAGES: u32 = 1 << 9;
pub const GUILD_MESSAGE_REACTIONS: u32 = 1 << 10;
pub const GUILD_MESSAGE_TYPING: u32 = 1 << 11;
pub const DIRECT_MESSAGES: u32 = 1 << 12;
pub const DIRECT_MESSAGE_REACTIONS: u32 = 1 << 13;
pub const DIRECT_MESSAGE_TYPING: u32 = 1 << 14;
pub const MESSAGE_CONTENT: u32 = 1 << 15;
pub const GUILD_SCHEDULED_EVENTS: u32 = 1 << 16;

pub const PRIVILEGED: u32 = GUILD_MEMBERS | GUILD_PRESENCES | MESSAGE_CONTENT;
pub const ALL: u32 = GUILDS | GUILD_MEMBERS | GUILD_MODERATION | GUILD_EXPRESSIONS | GUILD_VOICE_STATES | GUILD_PRESENCES | GUILD_MESSAGES
    | GUILD_MESSAGE_REACTIONS | GUILD_MESSAGE_TYPING | DIRECT_MESSAGES | DIRECT_MESSAGE_REACTIONS | DIRECT_MESSAGE_TYPING | MESSAGE_CONTENT | GUILD_SCHEDULED_EVENTS;

/// A bot token's user, and the intents it may have: those asked for (default: all non-privileged), refused if a
/// privileged one isn't enabled for the app.
pub async fn authorize_bot(state: &AppState, token: &str, asked: Option<u32>) -> Result<(Uuid, u32), &'static str> {
    let row: Option<(Uuid, i32)> = sqlx::query_as(
        "SELECT t.user_id, a.privileged_intents FROM oauth_tokens t JOIN applications a ON a.bot_user_id = t.user_id
         WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.kind = 'bot'")
        .bind(crate::routes::applications::hash(token)).fetch_optional(&state.db).await.unwrap_or(None);
    let Some((uid, allowed)) = row else { return Err("invalid bot token") };
    let intents = asked.unwrap_or(ALL & !PRIVILEGED) & ALL;
    if intents & PRIVILEGED & !(allowed as u32) != 0 { return Err("disallowed intents: switch the privileged intents on for the app first") }
    Ok((uid, intents))
}

/// The intent an event needs, given whether it happened in a DM.
fn needs(t: &str, dm: bool) -> Option<u32> {
    Some(match t {
        "MESSAGE_CREATE" | "MESSAGE_UPDATE" | "MESSAGE_DELETE" | "MESSAGE_DELETE_BULK" | "POLL_UPDATE" => if dm { DIRECT_MESSAGES } else { GUILD_MESSAGES },
        "REACTION_ADD" | "REACTION_REMOVE" => if dm { DIRECT_MESSAGE_REACTIONS } else { GUILD_MESSAGE_REACTIONS },
        "TYPING_START" => if dm { DIRECT_MESSAGE_TYPING } else { GUILD_MESSAGE_TYPING },
        "GUILD_MEMBER_ADD" | "GUILD_MEMBER_REMOVE" | "GUILD_MEMBER_UPDATE" => GUILD_MEMBERS,
        "GUILD_BAN_ADD" | "GUILD_BAN_REMOVE" => GUILD_MODERATION,
        "GUILD_EMOJIS_UPDATE" | "GUILD_STICKERS_UPDATE" | "SOUNDBOARD_UPDATE" => GUILD_EXPRESSIONS,
        "VOICE_STATE_UPDATE" => GUILD_VOICE_STATES,
        "PRESENCE_UPDATE" | "ACTIVITY_UPDATE" => GUILD_PRESENCES,
        "EVENT_UPDATE" | "EVENT_START" => GUILD_SCHEDULED_EVENTS,
        t if t.starts_with("GUILD_") || t.starts_with("CHANNEL_") || t.starts_with("ROLE") || t.starts_with("THREAD_") => GUILDS,
        _ => return None,
    })
}

/// What a bot connection gets for one event: nothing, the event, or the event with message content blanked.
/// People (`intents` None) get everything unchanged.
pub fn filter(intents: Option<u32>, payload: &Value, me: Uuid) -> Option<Value> {
    let Some(intents) = intents else { return Some(payload.clone()) };
    let t = payload["t"].as_str().unwrap_or("");
    let d = &payload["d"];
    let msg = &d["message"];
    // DMs have no guild id on the event (or on the message's channel).
    let dm = d.get("guild_id").map(|g| g.is_null()).unwrap_or(true) && msg.get("guild_id").map(|g| g.is_null()).unwrap_or(true);
    if let Some(need) = needs(t, dm) { if intents & need == 0 { return None } }
    if (t == "MESSAGE_CREATE" || t == "MESSAGE_UPDATE") && intents & MESSAGE_CONTENT == 0 && !dm {
        let mine = msg["author"]["id"].as_str() == Some(&me.to_string());
        let mentioned = msg["mentions"].as_array().map(|m| m.iter().any(|x| x.as_str() == Some(&me.to_string()))).unwrap_or(false);
        if !mine && !mentioned {
            let mut p = payload.clone();
            p["d"]["message"]["content"] = Value::String(String::new());
            p["d"]["message"]["embeds"] = Value::Null;
            p["d"]["message"]["attachments"] = Value::Array(vec![]);
            return Some(p);
        }
    }
    Some(payload.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn filters() {
        let me = Uuid::now_v7();
        let ev = json!({ "t": "MESSAGE_CREATE", "d": { "guild_id": Uuid::now_v7(), "message": { "content": "hello", "author": { "id": Uuid::now_v7() }, "mentions": [] } } });
        assert!(filter(Some(GUILDS), &ev, me).is_none());
        assert_eq!(filter(Some(GUILD_MESSAGES), &ev, me).unwrap()["d"]["message"]["content"], "");
        assert_eq!(filter(Some(GUILD_MESSAGES | MESSAGE_CONTENT), &ev, me).unwrap()["d"]["message"]["content"], "hello");
        assert_eq!(filter(None, &ev, me).unwrap()["d"]["message"]["content"], "hello");
        let mention = json!({ "t": "MESSAGE_CREATE", "d": { "guild_id": Uuid::now_v7(), "message": { "content": "hi bot", "author": { "id": Uuid::now_v7() }, "mentions": [me] } } });
        assert_eq!(filter(Some(GUILD_MESSAGES), &mention, me).unwrap()["d"]["message"]["content"], "hi bot");
        let inter = json!({ "t": "INTERACTION_CREATE", "d": {} });
        assert!(filter(Some(0), &inter, me).is_some());
    }
}
