//! The MCP tools. Each one checks its scope, validates its arguments, makes one or two in-process REST calls as
//! the user (see `super::api`) and returns a compact JSON summary the model can read and cite ids from.
use super::{api, Caller};
use axum::http::Method;
use serde_json::{json, Map, Value};
use uuid::Uuid;

pub const INSTRUCTIONS: &str = "Parley is a chat app: servers (communities) contain channels; people also talk in direct messages (DMs). \
You act as the signed-in user and can only see and do what they can, within the permissions granted to this connection. \
Ids are UUIDs: get them from list_servers, list_channels, list_dms, search_messages or get_unreads. \
In message text, mention a user as <@USER_ID>, a role as <@&ROLE_ID> and a channel as <#CHANNEL_ID>; Markdown works. \
Start with get_unreads for \"what did I miss?\". Messages you send appear under the user's name, so only send, edit, delete \
or moderate when the user asked you to.";

pub enum Outcome { Unknown, Done(String), Failed(String) }

struct Tool { name: &'static str, title: &'static str, scope: &'static str, description: &'static str, read_only: bool, destructive: bool, schema: fn() -> Value }

const ID: &str = "string";
fn obj(props: Value, required: &[&str]) -> Value { json!({ "type": "object", "properties": props, "required": required, "additionalProperties": false }) }
fn id(desc: &str) -> Value { json!({ "type": ID, "format": "uuid", "description": desc }) }

const TOOLS: &[Tool] = &[
    // ---- read ----
    Tool { name: "whoami", title: "Who am I", scope: "mcp.read", read_only: true, destructive: false,
        description: "The Parley account this connection acts as: id, username, display name.", schema: || obj(json!({}), &[]) },
    Tool { name: "list_servers", title: "List servers", scope: "mcp.read", read_only: true, destructive: false,
        description: "The servers (communities) the user is a member of, with their ids.", schema: || obj(json!({}), &[]) },
    Tool { name: "list_channels", title: "List channels", scope: "mcp.read", read_only: true, destructive: false,
        description: "Channels of a server the user can see (text, announcement, forum, voice, categories), with topics and categories.",
        schema: || obj(json!({ "server_id": id("Server id from list_servers") }), &["server_id"]) },
    Tool { name: "list_dms", title: "List direct messages", scope: "mcp.read", read_only: true, destructive: false,
        description: "The user's DM and group DM conversations: channel id, who they are with, and when the last message was.", schema: || obj(json!({}), &[]) },
    Tool { name: "read_messages", title: "Read messages", scope: "mcp.read", read_only: true, destructive: false,
        description: "Messages in a channel or DM, oldest first. Without paging options: the latest ones. Use before (older than a message id), after (newer than) or around (centred on) to page.",
        schema: || obj(json!({
            "channel_id": id("Channel or DM channel id"),
            "limit": { "type": "integer", "minimum": 1, "maximum": 100, "description": "How many (default 30)" },
            "before": id("Only messages older than this message id"),
            "after": id("Only messages newer than this message id"),
            "around": id("Messages around this message id"),
        }), &["channel_id"]) },
    Tool { name: "search_messages", title: "Search messages", scope: "mcp.read", read_only: true, destructive: false,
        description: "Search messages the user can see, newest first. The query supports filters: from:username, in:channel-name, has:link|image|video|file, before:YYYY-MM-DD, after:YYYY-MM-DD, pinned:true, mentions:username.",
        schema: || obj(json!({
            "query": { "type": "string", "description": "Words to find, optionally with filters" },
            "server_id": id("Only in this server"),
            "channel_id": id("Only in this channel or DM"),
            "offset": { "type": "integer", "minimum": 0, "description": "Skip this many results (paging, 25 per page)" },
        }), &["query"]) },
    Tool { name: "list_members", title: "List server members", scope: "mcp.read", read_only: true, destructive: false,
        description: "Members of a server, optionally filtered by a name; ids, usernames, nicknames and role ids.",
        schema: || obj(json!({ "server_id": id("Server id"), "query": { "type": "string", "description": "Part of a name or username" }, "limit": { "type": "integer", "minimum": 1, "maximum": 200 } }), &["server_id"]) },
    Tool { name: "find_users", title: "Find users", scope: "mcp.read", read_only: true, destructive: false,
        description: "Look people up by name or username (to DM or mention them).",
        schema: || obj(json!({ "query": { "type": "string", "description": "Name or username" } }), &["query"]) },
    Tool { name: "get_user", title: "Get a user's profile", scope: "mcp.read", read_only: true, destructive: false,
        description: "A user's public profile: names, pronouns, bio, whether it is a bot.", schema: || obj(json!({ "user_id": id("User id") }), &["user_id"]) },
    Tool { name: "list_pins", title: "List pinned messages", scope: "mcp.read", read_only: true, destructive: false,
        description: "The pinned messages of a channel.", schema: || obj(json!({ "channel_id": id("Channel id") }), &["channel_id"]) },
    Tool { name: "list_threads", title: "List threads", scope: "mcp.read", read_only: true, destructive: false,
        description: "Threads (or forum posts) in a channel. Read one with read_messages using the thread's id as channel_id.",
        schema: || obj(json!({ "channel_id": id("Channel id") }), &["channel_id"]) },
    // ---- notifications ----
    Tool { name: "get_unreads", title: "What did I miss?", scope: "mcp.notifications", read_only: true, destructive: false,
        description: "Channels and DMs with unread messages, most mentions first: unread count (capped at 100), mentions, and the latest message id. Then read_messages with after = the user's last read point, or just the latest messages.",
        schema: || obj(json!({}), &[]) },
    Tool { name: "get_mentions", title: "Recent mentions", scope: "mcp.notifications", read_only: true, destructive: false,
        description: "Recent messages (last 30 days) that mention the user, newest first.",
        schema: || obj(json!({ "limit": { "type": "integer", "minimum": 1, "maximum": 100 } }), &[]) },
    Tool { name: "mark_read", title: "Mark as read", scope: "mcp.notifications", read_only: false, destructive: false,
        description: "Mark a channel or DM read up to a message (default: its latest message).",
        schema: || obj(json!({ "channel_id": id("Channel or DM id"), "message_id": id("Read up to this message") }), &["channel_id"]) },
    // ---- send ----
    Tool { name: "send_message", title: "Send a message", scope: "mcp.send", read_only: false, destructive: false,
        description: "Post a message in a channel, DM or thread as the user. Optionally as a reply to another message.",
        schema: || obj(json!({ "channel_id": id("Channel, DM or thread id"), "content": { "type": "string", "minLength": 1, "maxLength": 4000, "description": "Text (Markdown, <@USER_ID> mentions)" }, "reply_to_message_id": id("Reply to this message") }), &["channel_id", "content"]) },
    Tool { name: "send_dm", title: "Send a direct message", scope: "mcp.send", read_only: false, destructive: false,
        description: "Send a direct message to a user (opens the DM if needed). The other person's privacy settings may refuse it.",
        schema: || obj(json!({ "user_id": id("Recipient user id"), "content": { "type": "string", "minLength": 1, "maxLength": 4000 } }), &["user_id", "content"]) },
    Tool { name: "edit_message", title: "Edit a message", scope: "mcp.send", read_only: false, destructive: false,
        description: "Change the text of one of the user's own messages.",
        schema: || obj(json!({ "channel_id": id("Channel id"), "message_id": id("Message id"), "content": { "type": "string", "minLength": 1, "maxLength": 4000 } }), &["channel_id", "message_id", "content"]) },
    Tool { name: "add_reaction", title: "React to a message", scope: "mcp.send", read_only: false, destructive: false,
        description: "Add an emoji reaction (a Unicode emoji such as 👍, or a server emoji as name:id).",
        schema: || obj(json!({ "channel_id": id("Channel id"), "message_id": id("Message id"), "emoji": { "type": "string" } }), &["channel_id", "message_id", "emoji"]) },
    Tool { name: "remove_reaction", title: "Remove a reaction", scope: "mcp.send", read_only: false, destructive: false,
        description: "Remove the user's own emoji reaction from a message.",
        schema: || obj(json!({ "channel_id": id("Channel id"), "message_id": id("Message id"), "emoji": { "type": "string" } }), &["channel_id", "message_id", "emoji"]) },
    Tool { name: "create_thread", title: "Start a thread", scope: "mcp.send", read_only: false, destructive: false,
        description: "Start a thread in a channel, optionally from a message; in a forum channel this creates a post (give content).",
        schema: || obj(json!({ "channel_id": id("Channel id"), "name": { "type": "string", "minLength": 1, "maxLength": 100 }, "message_id": id("Start the thread from this message"), "content": { "type": "string", "description": "First message (forum posts)" } }), &["channel_id", "name"]) },
    // ---- manage ----
    Tool { name: "create_channel", title: "Create a channel", scope: "mcp.manage", read_only: false, destructive: false,
        description: "Create a channel in a server (needs the Manage Channels permission).",
        schema: || obj(json!({ "server_id": id("Server id"), "name": { "type": "string", "minLength": 1, "maxLength": 100 }, "kind": { "type": "string", "enum": ["text", "voice", "announcement", "forum", "stage", "category"], "description": "Default text" }, "topic": { "type": "string" }, "category_id": id("Create it under this category") }), &["server_id", "name"]) },
    Tool { name: "update_channel", title: "Edit a channel", scope: "mcp.manage", read_only: false, destructive: false,
        description: "Rename a channel or change its topic.",
        schema: || obj(json!({ "channel_id": id("Channel id"), "name": { "type": "string", "minLength": 1, "maxLength": 100 }, "topic": { "type": "string" } }), &["channel_id"]) },
    Tool { name: "pin_message", title: "Pin a message", scope: "mcp.manage", read_only: false, destructive: false,
        description: "Pin a message in its channel.", schema: || obj(json!({ "channel_id": id("Channel id"), "message_id": id("Message id") }), &["channel_id", "message_id"]) },
    Tool { name: "unpin_message", title: "Unpin a message", scope: "mcp.manage", read_only: false, destructive: false,
        description: "Unpin a message.", schema: || obj(json!({ "channel_id": id("Channel id"), "message_id": id("Message id") }), &["channel_id", "message_id"]) },
    Tool { name: "delete_message", title: "Delete a message", scope: "mcp.manage", read_only: false, destructive: true,
        description: "Delete a message: the user's own, or someone else's where the user may manage messages. Cannot be undone.",
        schema: || obj(json!({ "channel_id": id("Channel id"), "message_id": id("Message id") }), &["channel_id", "message_id"]) },
    Tool { name: "timeout_member", title: "Time out a member", scope: "mcp.manage", read_only: false, destructive: true,
        description: "Stop a member from talking for a while (1 minute to 28 days).",
        schema: || obj(json!({ "server_id": id("Server id"), "user_id": id("Member's user id"), "minutes": { "type": "integer", "minimum": 1, "maximum": 40320 } }), &["server_id", "user_id", "minutes"]) },
    Tool { name: "remove_timeout", title: "End a timeout", scope: "mcp.manage", read_only: false, destructive: false,
        description: "Let a timed-out member talk again.", schema: || obj(json!({ "server_id": id("Server id"), "user_id": id("Member's user id") }), &["server_id", "user_id"]) },
    Tool { name: "kick_member", title: "Kick a member", scope: "mcp.manage", read_only: false, destructive: true,
        description: "Remove a member from a server (they can rejoin with an invite).", schema: || obj(json!({ "server_id": id("Server id"), "user_id": id("Member's user id") }), &["server_id", "user_id"]) },
    Tool { name: "ban_member", title: "Ban a member", scope: "mcp.manage", read_only: false, destructive: true,
        description: "Ban someone from a server so they cannot rejoin.", schema: || obj(json!({ "server_id": id("Server id"), "user_id": id("User id"), "reason": { "type": "string", "maxLength": 512 } }), &["server_id", "user_id"]) },
    Tool { name: "unban_member", title: "Lift a ban", scope: "mcp.manage", read_only: false, destructive: false,
        description: "Lift a ban.", schema: || obj(json!({ "server_id": id("Server id"), "user_id": id("User id") }), &["server_id", "user_id"]) },
    Tool { name: "create_invite", title: "Create an invite", scope: "mcp.manage", read_only: false, destructive: false,
        description: "Create an invite link to a server. Without max_uses or max_age it can be used any number of times and never expires.",
        schema: || obj(json!({ "server_id": id("Server id"),
            "max_uses": { "type": "integer", "enum": [1, 5, 10, 25, 50, 100], "description": "How many people can use it" },
            "max_age": { "type": "integer", "enum": [1800, 3600, 21600, 43200, 86400, 604800, 2592000], "description": "Seconds until it expires (30 minutes to 30 days)" } }), &["server_id"]) },
];

/// The tools this connection's scopes allow, in MCP `tools/list` shape.
pub fn list(scopes: &[String]) -> Vec<Value> {
    TOOLS.iter().filter(|t| scopes.iter().any(|s| s == t.scope)).map(|t| json!({
        "name": t.name, "title": t.title, "description": t.description, "inputSchema": (t.schema)(),
        "annotations": { "title": t.title, "readOnlyHint": t.read_only, "destructiveHint": t.destructive, "openWorldHint": false },
    })).collect()
}

// ---- arguments -------------------------------------------------------------------------------------------

fn uuid(a: &Value, k: &str) -> Result<String, String> {
    let s = a.get(k).and_then(Value::as_str).ok_or(format!("{k} is required"))?;
    Uuid::parse_str(s.trim()).map(|u| u.to_string()).map_err(|_| format!("{k} must be an id (UUID), got {s:?}"))
}
fn opt_uuid(a: &Value, k: &str) -> Result<Option<String>, String> { if a.get(k).is_some_and(|v| !v.is_null()) { uuid(a, k).map(Some) } else { Ok(None) } }
fn text(a: &Value, k: &str) -> Result<String, String> {
    a.get(k).and_then(Value::as_str).map(str::to_string).filter(|s| !s.trim().is_empty()).ok_or(format!("{k} is required"))
}
fn opt_text(a: &Value, k: &str) -> Option<String> { a.get(k).and_then(Value::as_str).map(str::to_string) }
fn int(a: &Value, k: &str, default: i64, min: i64, max: i64) -> i64 { a.get(k).and_then(Value::as_i64).unwrap_or(default).clamp(min, max) }
fn qs(pairs: &[(&str, Option<String>)]) -> String {
    let mut s = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs { if let Some(v) = v { s.append_pair(k, v); } }
    let out = s.finish();
    if out.is_empty() { out } else { format!("?{out}") }
}
fn enc(segment: &str) -> String { url::form_urlencoded::byte_serialize(segment.as_bytes()).collect::<String>().replace('+', "%20") }

// ---- output shaping ------------------------------------------------------------------------------------------

fn pick(v: &Value, keys: &[&str]) -> Value {
    let mut m = Map::new();
    for k in keys { if let Some(x) = v.get(*k) { if !x.is_null() { m.insert((*k).to_string(), x.clone()); } } }
    Value::Object(m)
}
fn user(u: &Value) -> Value { pick(u, &["id", "username", "display_name", "bot"]) }
fn absolute(base: &str, url: &Value) -> Value { url.as_str().map(|u| if u.starts_with('/') { json!(format!("{base}{u}")) } else { json!(u) }).unwrap_or(Value::Null) }

fn message(base: &str, m: &Value) -> Value {
    let mut out = pick(m, &["id", "channel_id", "content", "created_at", "edited_at", "reply_to"]);
    out["author"] = user(&m["author"]);
    if m.get("kind").and_then(Value::as_str).is_some_and(|k| k != "default") { out["kind"] = m["kind"].clone(); }
    if m.get("pinned_at").is_some_and(|p| !p.is_null()) { out["pinned"] = json!(true); }
    if let Some(a) = m.get("attachments").and_then(Value::as_array).filter(|a| !a.is_empty()) {
        out["attachments"] = a.iter().map(|x| { let mut y = pick(x, &["filename", "content_type", "transcript"]); y["url"] = absolute(base, &x["url"]); y }).collect();
    }
    if let Some(r) = m.get("reactions").and_then(Value::as_array).filter(|a| !a.is_empty()) { out["reactions"] = r.iter().map(|x| pick(x, &["emoji", "count"])).collect(); }
    if let Some(t) = m.get("thread").filter(|t| !t.is_null()) { out["thread"] = pick(t, &["id", "name", "message_count"]); }
    if let Some(p) = m.get("poll").filter(|p| !p.is_null()) { out["poll"] = pick(p, &["question", "answers", "expires_at"]); }
    out
}
fn messages(base: &str, v: &Value) -> Vec<Value> {
    let mut list: Vec<Value> = v.as_array().cloned().unwrap_or_default();
    list.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str())); // v7 ids sort by time
    list.iter().map(|m| message(base, m)).collect()
}

// ---- dispatch -------------------------------------------------------------------------------------------------

pub async fn call(c: &Caller, name: &str, a: &Value) -> Outcome {
    let Some(t) = TOOLS.iter().find(|t| t.name == name) else { return Outcome::Unknown };
    if !c.scopes.iter().any(|s| s == t.scope) {
        return Outcome::Failed(format!("This connection was not given the \"{}\" permission. Reconnect Parley in the AI app and allow it on the consent screen.", t.scope));
    }
    match run(c, name, a).await {
        Ok(v) => Outcome::Done(if v.is_string() { v.as_str().unwrap_or("").to_string() } else { v.to_string() }),
        Err(e) => Outcome::Failed(e),
    }
}

async fn run(c: &Caller, name: &str, a: &Value) -> Result<Value, String> {
    let base = c.base.as_str();
    Ok(match name {
        "whoami" => user(&api(c, Method::GET, "/users/@me", None).await?),
        "list_servers" => {
            let v = api(c, Method::GET, "/guilds", None).await?;
            json!({ "servers": v.as_array().map(|a| a.iter().map(|g| pick(g, &["id", "name"])).collect::<Vec<_>>()).unwrap_or_default() })
        }
        "list_channels" => {
            let v = api(c, Method::GET, &format!("/guilds/{}/channels", uuid(a, "server_id")?), None).await?;
            let list = v.as_array().cloned().unwrap_or_default();
            let cat = |id: &Value| list.iter().find(|x| &x["id"] == id).and_then(|x| x["name"].as_str()).map(str::to_string);
            json!({ "channels": list.iter().map(|ch| { let mut o = pick(ch, &["id", "name", "kind", "topic"]); if let Some(n) = cat(&ch["parent_id"]) { o["category"] = json!(n); } o }).collect::<Vec<_>>() })
        }
        "list_dms" => {
            let v = api(c, Method::GET, "/users/@me/channels", None).await?;
            json!({ "dms": v.as_array().map(|a| a.iter().map(|d| { let mut o = pick(d, &["name", "last_message_at", "request_state"]); o["channel_id"] = d["id"].clone(); o["with"] = d["recipients"].as_array().map(|r| r.iter().map(user).collect::<Vec<_>>()).into(); o }).collect::<Vec<_>>()).unwrap_or_default() })
        }
        "read_messages" => {
            let ch = uuid(a, "channel_id")?;
            let q = qs(&[("limit", Some(int(a, "limit", 30, 1, 100).to_string())), ("before", opt_uuid(a, "before")?), ("after", opt_uuid(a, "after")?), ("around", opt_uuid(a, "around")?)]);
            let list = messages(base, &api(c, Method::GET, &format!("/channels/{ch}/messages{q}"), None).await?);
            json!({ "channel_id": ch, "count": list.len(), "messages": list })
        }
        "search_messages" => {
            let q = qs(&[("q", Some(text(a, "query")?)), ("guild_id", opt_uuid(a, "server_id")?), ("channel_id", opt_uuid(a, "channel_id")?), ("offset", a.get("offset").and_then(Value::as_i64).map(|o| o.max(0).to_string()))]);
            let v = api(c, Method::GET, &format!("/search{q}"), None).await?;
            let results: Vec<Value> = v["results"].as_array().map(|r| r.iter().map(|h| { let mut m = message(base, h); m["channel_name"] = h["channel_name"].clone(); if !h["guild_id"].is_null() { m["server_id"] = h["guild_id"].clone(); } m }).collect()).unwrap_or_default();
            json!({ "total": v["total"], "offset": v["offset"], "results": results })
        }
        "list_members" => {
            let v = api(c, Method::GET, &format!("/guilds/{}/members", uuid(a, "server_id")?), None).await?;
            let needle = opt_text(a, "query").map(|s| s.to_lowercase());
            let limit = int(a, "limit", 100, 1, 200) as usize;
            let all = v.as_array().cloned().unwrap_or_default();
            let hits: Vec<Value> = all.iter().filter(|m| needle.as_ref().is_none_or(|n| ["username", "display_name", "nickname"].iter().any(|k| m[*k].as_str().is_some_and(|s| s.to_lowercase().contains(n))))).take(limit)
                .map(|m| pick(m, &["user_id", "username", "display_name", "nickname", "roles", "timeout_until"])).collect();
            json!({ "total": all.len(), "members": hits })
        }
        "find_users" => {
            let v = api(c, Method::GET, &format!("/users/search{}", qs(&[("q", Some(text(a, "query")?))])), None).await?;
            json!({ "users": v.as_array().map(|u| u.iter().map(user).collect::<Vec<_>>()).unwrap_or_default() })
        }
        "get_user" => pick(&api(c, Method::GET, &format!("/users/{}", uuid(a, "user_id")?), None).await?, &["id", "username", "display_name", "pronouns", "bio", "bot", "created_at"]),
        "list_pins" => json!({ "pins": messages(base, &api(c, Method::GET, &format!("/channels/{}/pins", uuid(a, "channel_id")?), None).await?) }),
        "list_threads" => {
            let v = api(c, Method::GET, &format!("/channels/{}/threads", uuid(a, "channel_id")?), None).await?;
            let list = v.as_array().cloned().or_else(|| v["threads"].as_array().cloned()).unwrap_or_default();
            json!({ "threads": list.iter().map(|t| pick(t, &["id", "name", "message_count", "last_message_at", "archived", "owner_id"])).collect::<Vec<_>>() })
        }
        "get_unreads" => api(c, Method::GET, "/users/@me/unreads", None).await?,
        "get_mentions" => json!({ "mentions": messages(base, &api(c, Method::GET, &format!("/users/@me/mentions?limit={}", int(a, "limit", 25, 1, 100)), None).await?).into_iter().rev().collect::<Vec<_>>() }),
        "mark_read" => {
            let ch = uuid(a, "channel_id")?;
            let mid = match opt_uuid(a, "message_id")? {
                Some(m) => m,
                None => api(c, Method::GET, &format!("/channels/{ch}/messages?limit=1"), None).await?.as_array().and_then(|l| l.first()).and_then(|m| m["id"].as_str()).map(str::to_string).ok_or("That channel has no messages")?,
            };
            api(c, Method::PUT, &format!("/channels/{ch}/read"), Some(json!({ "message_id": mid }))).await?;
            json!(format!("Marked read up to message {mid}."))
        }
        "send_message" => {
            let ch = uuid(a, "channel_id")?;
            let body = json!({ "content": text(a, "content")?, "reply_to": opt_uuid(a, "reply_to_message_id")? });
            message(base, &api(c, Method::POST, &format!("/channels/{ch}/messages"), Some(body)).await?)
        }
        "send_dm" => {
            let dm = api(c, Method::POST, "/users/@me/channels", Some(json!({ "recipient_id": uuid(a, "user_id")? }))).await?;
            let ch = dm["id"].as_str().ok_or("Could not open the DM")?.to_string();
            json!({ "channel_id": ch, "message": message(base, &api(c, Method::POST, &format!("/channels/{ch}/messages"), Some(json!({ "content": text(a, "content")? }))).await?) })
        }
        "edit_message" => message(base, &api(c, Method::PATCH, &format!("/channels/{}/messages/{}", uuid(a, "channel_id")?, uuid(a, "message_id")?), Some(json!({ "content": text(a, "content")? }))).await?),
        "add_reaction" | "remove_reaction" => {
            let m = if name == "add_reaction" { Method::PUT } else { Method::DELETE };
            api(c, m, &format!("/channels/{}/messages/{}/reactions/{}", uuid(a, "channel_id")?, uuid(a, "message_id")?, enc(text(a, "emoji")?.trim())), None).await?;
            json!(if name == "add_reaction" { "Reaction added." } else { "Reaction removed." })
        }
        "create_thread" => {
            let body = json!({ "name": text(a, "name")?, "message_id": opt_uuid(a, "message_id")?, "content": opt_text(a, "content").unwrap_or_default() });
            pick(&api(c, Method::POST, &format!("/channels/{}/threads", uuid(a, "channel_id")?), Some(body)).await?, &["id", "name", "parent_id", "kind"])
        }
        "create_channel" => {
            let body = json!({ "name": text(a, "name")?, "kind": opt_text(a, "kind"), "topic": opt_text(a, "topic"), "parent_id": opt_uuid(a, "category_id")? });
            pick(&api(c, Method::POST, &format!("/guilds/{}/channels", uuid(a, "server_id")?), Some(body)).await?, &["id", "name", "kind", "topic", "parent_id"])
        }
        "update_channel" => {
            let mut body = Map::new();
            if let Some(n) = opt_text(a, "name") { body.insert("name".into(), json!(n)); }
            if let Some(t) = opt_text(a, "topic") { body.insert("topic".into(), json!(t)); }
            if body.is_empty() { return Err("Give a new name or topic".into()); }
            pick(&api(c, Method::PATCH, &format!("/channels/{}", uuid(a, "channel_id")?), Some(Value::Object(body))).await?, &["id", "name", "kind", "topic"])
        }
        "pin_message" | "unpin_message" => {
            let m = if name == "pin_message" { Method::PUT } else { Method::DELETE };
            api(c, m, &format!("/channels/{}/pins/{}", uuid(a, "channel_id")?, uuid(a, "message_id")?), None).await?;
            json!(if name == "pin_message" { "Pinned." } else { "Unpinned." })
        }
        "delete_message" => { api(c, Method::DELETE, &format!("/channels/{}/messages/{}", uuid(a, "channel_id")?, uuid(a, "message_id")?), None).await?; json!("Deleted.") }
        "timeout_member" => {
            let minutes = int(a, "minutes", 10, 1, 40320);
            api(c, Method::PUT, &format!("/guilds/{}/members/{}/timeout", uuid(a, "server_id")?, uuid(a, "user_id")?), Some(json!({ "minutes": minutes }))).await?;
            json!(format!("Timed out for {minutes} minutes."))
        }
        "remove_timeout" => { api(c, Method::DELETE, &format!("/guilds/{}/members/{}/timeout", uuid(a, "server_id")?, uuid(a, "user_id")?), None).await?; json!("Timeout ended.") }
        "kick_member" => { api(c, Method::DELETE, &format!("/guilds/{}/members/{}", uuid(a, "server_id")?, uuid(a, "user_id")?), None).await?; json!("Kicked.") }
        "ban_member" => { api(c, Method::PUT, &format!("/guilds/{}/bans/{}", uuid(a, "server_id")?, uuid(a, "user_id")?), Some(json!({ "reason": opt_text(a, "reason") }))).await?; json!("Banned.") }
        "unban_member" => { api(c, Method::DELETE, &format!("/guilds/{}/bans/{}", uuid(a, "server_id")?, uuid(a, "user_id")?), None).await?; json!("Ban lifted.") }
        "create_invite" => {
            let body = json!({ "max_uses": a.get("max_uses").and_then(Value::as_i64), "max_age": a.get("max_age").and_then(Value::as_i64) });
            let v = api(c, Method::POST, &format!("/guilds/{}/invites", uuid(a, "server_id")?), Some(body)).await?;
            let code = v["code"].as_str().unwrap_or("");
            json!({ "code": code, "url": format!("{base}/invite/{code}"), "max_uses": v["max_uses"], "expires_at": v["expires_at"] })
        }
        _ => return Err(format!("Unknown tool {name}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tool_has_a_valid_schema_and_rest_scope() {
        let mut names = std::collections::HashSet::new();
        for t in TOOLS {
            assert!(names.insert(t.name), "duplicate {}", t.name);
            let s = (t.schema)();
            assert_eq!(s["type"], "object", "{}", t.name);
            for r in s["required"].as_array().unwrap() { assert!(s["properties"].get(r.as_str().unwrap()).is_some(), "{} requires unknown {r}", t.name); }
            assert!(super::super::oauth::SCOPES.iter().any(|(k, _)| *k == t.scope));
        }
        let read_only: Vec<String> = vec!["mcp.read".into()];
        assert!(list(&read_only).iter().all(|t| t["annotations"]["readOnlyHint"] == true));
        assert_eq!(list(&[]).len(), 0);
    }

    #[test]
    fn helpers() {
        assert_eq!(enc("👍"), "%F0%9F%91%8D");
        assert_eq!(enc("party blob:0190"), "party%20blob%3A0190");
        assert_eq!(qs(&[("q", Some("a b&c".into())), ("x", None)]), "?q=a+b%26c");
        assert!(uuid(&json!({ "id": "nope" }), "id").is_err());
    }
}
