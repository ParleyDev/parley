//! The public API reference: `/api/openapi.json` (OpenAPI 3.1) from a curated list of the endpoints apps and bots
//! use. The same API answers at `/api/v1/…` (the stable, versioned prefix) and `/api/…`.

use axum::{routing::get, Json, Router};
use serde_json::{json, Map, Value};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/openapi.json", get(spec))
}

/// (method, path, group, summary, who may call it: "user", "bot", "user|bot", "scope:<name>", "none", "token in URL").
const ENDPOINTS: &[(&str, &str, &str, &str, &str)] = &[
    ("GET", "/users/@me", "Users", "The current user (bots: the bot user)", "user|bot|scope:identify"),
    ("GET", "/users/{user_id}", "Users", "A user's public profile", "user|bot|scope:identify"),
    ("GET", "/users/@me/connections", "Users", "Accounts the user linked", "user|scope:connections"),
    ("GET", "/users/@me/channels", "Users", "The user's DMs and groups", "user|bot"),
    ("POST", "/users/@me/channels", "Users", "Open a DM (recipient_id) or a group (recipient_ids)", "user|bot"),
    ("GET", "/guilds/{guild_id}", "Servers", "A server you're in", "user|bot"),
    ("GET", "/guilds/{guild_id}/channels", "Servers", "Channels you can see", "user|bot"),
    ("POST", "/guilds/{guild_id}/channels", "Servers", "Create a channel (kind: text, voice, forum, stage, category, announcement, media)", "user|bot"),
    ("GET", "/guilds/{guild_id}/members", "Servers", "Members with roles", "user|bot"),
    ("PATCH", "/guilds/{guild_id}/members/{user_id}", "Servers", "Nickname, roles, mute/deaf, move, server profile", "user|bot"),
    ("PUT", "/guilds/{guild_id}/members/{user_id}", "Servers", "Add a user who gave your app guilds.join (body: access_token)", "bot"),
    ("DELETE", "/guilds/{guild_id}/members/{user_id}", "Servers", "Kick", "user|bot"),
    ("PUT", "/guilds/{guild_id}/bans/{user_id}", "Servers", "Ban (reason)", "user|bot"),
    ("GET", "/guilds/{guild_id}/roles", "Servers", "Roles, highest last", "user|bot"),
    ("POST", "/guilds/{guild_id}/roles", "Servers", "Create a role", "user|bot"),
    ("PATCH", "/guilds/{guild_id}/roles/{role_id}", "Servers", "Edit a role", "user|bot"),
    ("GET", "/guilds/{guild_id}/events", "Servers", "Upcoming events", "user|bot"),
    ("GET", "/channels/{channel_id}/messages", "Messages", "Messages (limit, before, after, around)", "user|bot|scope:messages.read"),
    ("POST", "/channels/{channel_id}/messages", "Messages", "Send a message (content, reply_to, attachment_ids; bots: embeds, components)", "user|bot|scope:messages.write"),
    ("GET", "/channels/{channel_id}/messages/{message_id}", "Messages", "One message", "user|bot|scope:messages.read"),
    ("PATCH", "/channels/{channel_id}/messages/{message_id}", "Messages", "Edit your message", "user|bot|scope:messages.write"),
    ("DELETE", "/channels/{channel_id}/messages/{message_id}", "Messages", "Delete a message", "user|bot|scope:messages.write"),
    ("PUT", "/channels/{channel_id}/messages/{message_id}/reactions/{emoji}", "Messages", "React (?burst=true for a super reaction)", "user|bot|scope:messages.write"),
    ("POST", "/channels/{channel_id}/typing", "Messages", "Show typing", "user|bot"),
    ("POST", "/channels/{channel_id}/attachments", "Messages", "Upload a file (multipart) to attach to a message", "user|bot"),
    ("POST", "/channels/{channel_id}/threads", "Messages", "Start a thread or forum post", "user|bot"),
    ("POST", "/channels/{channel_id}/webhooks", "Webhooks", "Create a webhook (returns its token once)", "user|bot"),
    ("POST", "/webhooks/{webhook_id}/{token}", "Webhooks", "Post as the webhook (content, username, avatar_url, embeds, allowed_mentions; ?wait=true)", "token in URL"),
    ("GET", "/webhooks/{webhook_id}/{token}", "Webhooks", "What the webhook posts as", "token in URL"),
    ("GET", "/applications/{app_id}/commands", "Commands", "Global commands", "user|bot"),
    ("PUT", "/applications/{app_id}/commands", "Commands", "Replace global commands (slash 1, user 2, message 3)", "user|bot"),
    ("PUT", "/applications/{app_id}/guilds/{guild_id}/commands", "Commands", "Replace one server's commands", "user|bot"),
    ("POST", "/interactions/{interaction_id}/{token}/callback", "Interactions", "Answer within 3 s: 4 message, 5 defer, 6 ack, 7 update, 8 autocomplete, 9 form", "token in URL"),
    ("PATCH", "/interactions/{interaction_id}/{token}/messages/@original", "Interactions", "Edit (or fill in) the first answer", "token in URL"),
    ("POST", "/interactions/{interaction_id}/{token}/followup", "Interactions", "Another message, for 15 minutes", "token in URL"),
    ("PUT", "/applications/{app_id}/role-connections/metadata", "Linked roles", "Declare what the app reports about users", "user|bot"),
    ("PUT", "/users/@me/applications/{app_id}/role-connection", "Linked roles", "Set what the app reports about this user", "scope:role_connections.write"),
    ("GET", "/oauth2/authorize", "OAuth2", "Consent screen data (client_id, scope, redirect_uri, permissions)", "user"),
    ("POST", "/oauth2/token", "OAuth2", "authorization_code or client_credentials grant (form)", "none"),
    ("GET", "/oauth2/@me", "OAuth2", "What a token is: app, user, scopes", "user|bot"),
];

/// Turn the list into an OpenAPI document.
async fn spec() -> Json<Value> {
    let mut paths = Map::new();
    for (method, path, tag, summary, auth) in ENDPOINTS {
        let security: Vec<Value> = auth.split('|').filter_map(|a| match a {
            "user" => Some(json!({ "session": [] })),
            "bot" => Some(json!({ "bot": [] })),
            a if a.starts_with("scope:") => Some(json!({ "oauth2": [a.trim_start_matches("scope:")] })),
            _ => None,
        }).collect();
        let params: Vec<Value> = path.split('/').filter(|s| s.starts_with('{')).map(|s| json!({ "name": s.trim_matches(|c| c == '{' || c == '}'), "in": "path", "required": true, "schema": { "type": "string" } })).collect();
        let op = json!({ "tags": [tag], "summary": summary, "parameters": params, "security": security, "x-auth": auth, "responses": { "200": { "description": "OK" }, "4XX": { "description": "{ error } (and `code` for some)" }, "429": { "description": "Rate limited: see Retry-After and X-RateLimit-* headers" } } });
        paths.entry(path.to_string()).or_insert_with(|| json!({}))[method.to_lowercase()] = op;
    }
    Json(json!({
        "openapi": "3.1.0",
        "info": { "title": "Parley API", "version": "1", "description": "Bots authenticate with `Authorization: Bot <token>`, apps with `Bearer <access token>`. Every rate-limited response carries X-RateLimit-Bucket, -Limit, -Remaining and -Reset-After. Bots receive events over the gateway at /ws?token=<bot token>&intents=<bits>." },
        "servers": [{ "url": "/api/v1" }],
        "components": { "securitySchemes": {
            "session": { "type": "http", "scheme": "bearer", "description": "A signed-in user's session" },
            "bot": { "type": "apiKey", "in": "header", "name": "Authorization", "description": "Bot <token>" },
            "oauth2": { "type": "oauth2", "flows": { "authorizationCode": { "authorizationUrl": "/oauth2/authorize", "tokenUrl": "/api/v1/oauth2/token", "scopes": crate::routes::applications::SCOPES.iter().map(|(k, v)| (k.to_string(), json!(v))).collect::<Map<_, _>>() } } },
        } },
        "paths": paths,
    }))
}
