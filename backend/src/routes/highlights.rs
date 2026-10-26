//! Highlights: the busiest messages of the last two days from your servers (most reactions and replies, a boost for
//! friends), for the Inbox, so you can follow active servers without notifications for everything.

use crate::{auth::AuthUser, error::AppResult, models::{Message, MessageRow}, perms, routes::channels::{hydrate, MESSAGE_SELECT}, state::AppState};
use axum::{extract::State, routing::get, Json, Router};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/users/@me/highlights", get(highlights))
}

async fn highlights(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Value>>> {
    let guilds: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT g.id, g.name FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.user_id = $1
           AND NOT EXISTS (SELECT 1 FROM notification_settings n WHERE n.user_id = $1 AND n.target_id = g.id AND (n.suppress_highlights OR n.level = 'nothing'))
         ORDER BY m.joined_at LIMIT 50").bind(uid).fetch_all(&state.db).await?;
    let mut chans: HashMap<Uuid, (Uuid, String, String)> = HashMap::new();
    for (gid, gname) in &guilds {
        for c in perms::visible_channels(&state.db, *gid, uid).await? {
            if c.kind == "text" || c.kind == "thread" { chans.insert(c.id, (*gid, gname.clone(), c.name.clone())); }
        }
    }
    if chans.is_empty() { return Ok(Json(vec![])) }
    let ids: Vec<Uuid> = chans.keys().copied().collect();
    let rows = sqlx::query_as::<_, MessageRow>(&format!(
        "{MESSAGE_SELECT} WHERE m.channel_id = ANY($1) AND m.kind = 'default' AND m.author_id <> $2 AND m.created_at > now() - interval '48 hours'
           AND NOT EXISTS (SELECT 1 FROM notification_settings n WHERE n.user_id = $2 AND n.target_id = m.channel_id AND (n.level = 'nothing' OR n.muted_until > now()))
           AND ((SELECT COUNT(*) FROM reactions r WHERE r.message_id = m.id) * 2 + (SELECT COUNT(*) FROM messages x WHERE x.reply_to = m.id)
                + CASE WHEN EXISTS (SELECT 1 FROM relationships f WHERE f.user_id = $2 AND f.target_id = m.author_id AND f.kind = 'friend') THEN 3 ELSE 0 END) >= 3
         ORDER BY ((SELECT COUNT(*) FROM reactions r WHERE r.message_id = m.id) * 2 + (SELECT COUNT(*) FROM messages x WHERE x.reply_to = m.id)) DESC, m.id DESC LIMIT 15"))
        .bind(&ids).bind(uid).fetch_all(&state.db).await?;
    let msgs: Vec<Message> = hydrate(&state.db, rows, uid, false).await?;
    Ok(Json(msgs.into_iter().map(|m| {
        let (gid, gname, cname) = chans.get(&m.channel_id).cloned().unwrap_or_default();
        let mut v = json!(m);
        v["guild_id"] = json!(gid); v["guild_name"] = json!(gname); v["channel_name"] = json!(cname);
        v
    }).collect()))
}
