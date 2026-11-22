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
    ("GET", "/invites/{code}", "Invites", "Server, member and online counts for an invite", "none"),
    ("GET", "/invites/{code}/preview-messages", "Invites", "Up to five recent messages of the server's invite preview channel (404 when none is set)", "none"),
    ("GET", "/guilds/{guild_id}", "Servers", "A server you're in", "user|bot"),
    ("GET", "/guilds/{guild_id}/channels", "Servers", "Channels you can see", "user|bot"),
    ("POST", "/guilds/{guild_id}/communities", "Communities", "Create a community: a category with its channels, plus page fields banner_url, about (up to 4000 characters) and links (up to 10 of label and http(s) url); the creator follows it unless a bot (needs Manage Channels)", "user|bot"),
    ("GET", "/guilds/{guild_id}/communities", "Communities", "Browse communities you can see: q, sort (activity or name), limit, after, external_ref; returns items and next", "user|bot"),
    ("PUT", "/guilds/{guild_id}/communities/{slug}/follow", "Communities", "Follow a community (a sidebar preference, not access)", "user"),
    ("DELETE", "/guilds/{guild_id}/communities/{slug}/follow", "Communities", "Unfollow a community", "user"),
    ("GET", "/guilds/{guild_id}/communities/{slug}", "Communities", "One community, with its channels you can see and follower counts", "user|bot"),
    ("PATCH", "/guilds/{guild_id}/communities/{slug}", "Communities", "Edit a community's address, name, description, icon, banner, about, links or external reference (needs Manage Channels)", "user|bot"),
    ("DELETE", "/guilds/{guild_id}/communities/{slug}", "Communities", "Delete a community and its channels (owner or Administrator only)", "user|bot"),
    ("GET", "/guilds/{guild_id}/communities/{slug}/managers", "Communities", "The members and roles that manage a community (their entry on its category allows Manage Channels); 404 when you cannot view it", "user|bot"),
    ("PUT", "/guilds/{guild_id}/communities/{slug}/managers/{target}", "Communities", "Appoint a member or role (body kind) manager: Manage Channels, Manage Messages and Manage Threads on the category and on channels with their own permission entries; needs Manage Roles there and those bits yourself", "user|bot"),
    ("DELETE", "/guilds/{guild_id}/communities/{slug}/managers/{target}", "Communities", "Remove a manager (same rule as appointing)", "user|bot"),
    ("POST", "/guilds/{guild_id}/channels", "Servers", "Create a channel (kind: text, voice, forum, stage, category, announcement, media); needs Manage Channels, or Manage Channels inside the category given as parent_id (not for categories)", "user|bot"),
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
    ("GET", "/assets/avatar-decorations", "Cosmetics", "The instance's avatar decorations from its assets folder: id, name, description, tags (from metadata.json, lower case), animated", "none"),
    ("GET", "/assets/nameplates", "Cosmetics", "The instance's nameplates: id, name, description, tags, animated", "none"),
    ("GET", "/assets/profile-effects", "Cosmetics", "The instance's profile effects: id, name, description, tags, layers, stills", "none"),
    ("GET", "/assets/profile-frames", "Cosmetics", "The instance's profile frames: id, name, description, tags, layers, layout", "none"),
    ("GET", "/admin/cosmetics-folder", "Cosmetics", "Whether the assets folder is writable (needs Manage Instance)", "user|scope:cosmetics.manage"),
    ("GET", "/admin/cosmetics/{kind}", "Cosmetics", "Every item of a kind (decoration, nameplate, effect, frame): value, source, name, description, tags, enabled, data, users (needs Manage Instance)", "user|scope:cosmetics.manage"),
    ("POST", "/admin/cosmetics/{kind}/folder", "Cosmetics", "Add an item to the assets folder (multipart: meta as JSON with name, description, tags and, for effects and frames, layers and layout; then its files)", "user"),
    ("PATCH", "/admin/cosmetics/{kind}/folder/{id}", "Cosmetics", "Edit a folder item (multipart: meta as JSON, any of name, description, tags, layers, layout; files to add or replace). tags is a list of text, stored lower case without '#' (up to 20 of 32 characters); [] removes them", "user|scope:cosmetics.manage"),
    ("POST", "/admin/cosmetics/{kind}/import/check", "Cosmetics", "Which of keys (file or folder names) are missing, present or clash here", "user|scope:cosmetics.manage"),
    ("POST", "/admin/cosmetics/{kind}/import", "Cosmetics", "Import one item (multipart: entry, its metadata.json entry kept as it is, tags included; then its files); 409 unless it is missing", "user|scope:cosmetics.manage"),
    ("GET", "/admin/event-routes", "Event notifications", "Where each category (users, servers, safety, console) posts: channel, webhook host, last failure (needs Manage Instance)", "user"),
    ("PUT", "/admin/event-routes", "Event notifications", "Change some categories: {<category>: {channel_id (a server text channel, or null), webhook_url (http(s); \"\" removes it)}}; fields left out stay as they are", "user"),
    ("GET", "/admin/event-routes/channels", "Event notifications", "Text channels on the instance whose name or server's name matches q", "user"),
    ("POST", "/admin/event-routes/{category}/test", "Event notifications", "Post a test to the category's channel and webhook now; says how each went", "user"),
];

/// Turn the list into an OpenAPI document.
async fn spec() -> Json<Value> {
    let mut paths = Map::new();
    for (method, path, tag, summary, auth) in ENDPOINTS {
        let security: Vec<Value> = auth.split('|').filter_map(|a| match a {
            "user" => Some(json!({ "session": [] })),
            "bot" => Some(json!({ "bot": [] })),
            // Tool scopes (Profile Studio's cosmetics.manage) come from the MCP sign-in, not an app's OAuth2.
            a if a.starts_with("scope:") => {
                let s = a.trim_start_matches("scope:");
                let scheme = if crate::mcp::oauth::ASK_ONLY.contains(&s) { "tools" } else { "oauth2" };
                Some(json!({ scheme: [s] }))
            }
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
            "tools": { "type": "oauth2", "description": "Tools that act for an admin, such as Profile Studio: the MCP sign-in (dynamic registration, PKCE), asking for the scope by name", "flows": { "authorizationCode": { "authorizationUrl": "/oauth/authorize", "tokenUrl": "/oauth/token", "scopes": crate::mcp::oauth::SCOPES.iter().filter(|(k, _)| crate::mcp::oauth::ASK_ONLY.contains(k)).map(|(k, v)| (k.to_string(), json!(v))).collect::<Map<_, _>>() } } },
        } },
        "paths": paths,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cosmetics_calls_are_listed_with_their_tool_scope() {
        let Json(s) = spec().await;
        let edit = &s["paths"]["/admin/cosmetics/{kind}/folder/{id}"]["patch"];
        assert!(edit["summary"].as_str().unwrap().contains("tags"));
        assert_eq!(edit["security"], json!([{ "session": [] }, { "tools": ["cosmetics.manage"] }]));
        assert!(s["components"]["securitySchemes"]["tools"]["flows"]["authorizationCode"]["scopes"]["cosmetics.manage"].is_string());
        // App scopes stay on the app OAuth2 scheme.
        assert_eq!(s["paths"]["/users/@me/connections"]["get"]["security"][1], json!({ "oauth2": ["connections"] }));
        assert!(s["paths"]["/assets/profile-frames"]["get"]["summary"].as_str().unwrap().contains("tags"));
    }
}
