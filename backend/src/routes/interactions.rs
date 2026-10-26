//! Application commands and interactions. Apps register slash (chat input), user and message commands, globally or
//! for one server. When someone uses one, an interaction goes to the app's bot over the gateway (INTERACTION_CREATE)
//! with a token; the bot answers within 3 seconds (a message, an ephemeral message only the user sees, or "thinking"
//! that it fills in later) and may send follow-ups for 15 minutes. Ephemeral messages are never stored in the channel.

use crate::{auth::AuthUser, error::{AppError, AppResult}, models::{Channel, Message, User}, perms, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::{get, post}, Json, Router};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use super::channels::{fetch_message, require_channel_perms, target_for};
use super::guilds::CHANNEL_COLS;
use super::users::USER_COLS;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/applications/:id/commands", get(list_global).put(put_global))
        .route("/applications/:id/guilds/:gid/commands", get(list_guild).put(put_guild))
        .route("/channels/:id/commands", get(available))
        .route("/interactions", post(invoke))
        .route("/interactions/:id/:token/callback", post(callback))
        .route("/interactions/:id/:token/messages/@original", axum::routing::patch(edit_original).delete(delete_original))
        .route("/interactions/:id/:token/followup", post(followup))
}

/// Ephemeral: only the person who used the command sees the response.
pub const EPHEMERAL: u64 = 1 << 6;
const OPTION_TYPES: [i64; 7] = [3, 4, 5, 6, 7, 8, 10];

#[derive(Serialize, sqlx::FromRow)]
pub struct Command { id: Uuid, application_id: Uuid, guild_id: Option<Uuid>, kind: i16, name: String, description: String, options: Value }
const CMD_COLS: &str = "id, application_id, guild_id, kind, name, description, options";

/// The app, if `uid` owns it or is its bot.
async fn my_app(state: &AppState, app: Uuid, uid: Uuid) -> AppResult<(Uuid, Option<Uuid>)> {
    let row: Option<(Uuid, Option<Uuid>)> = sqlx::query_as("SELECT id, bot_user_id FROM applications WHERE id = $1 AND (owner_id = $2 OR bot_user_id = $2)").bind(app).bind(uid).fetch_optional(&state.db).await?;
    row.ok_or_else(|| AppError::NotFound("Application not found".into()))
}

#[derive(Deserialize, Clone)]
struct CommandIn { name: String, #[serde(default)] description: String, #[serde(default = "one", rename = "type")] kind: i16, #[serde(default)] options: Vec<Value> }
fn one() -> i16 { 1 }

fn clean_option(o: &Value) -> AppResult<Value> {
    let kind = o["type"].as_i64().filter(|t| OPTION_TYPES.contains(t)).ok_or_else(|| AppError::BadRequest("option type must be 3 (string), 4 (integer), 5 (boolean), 6 (user), 7 (channel), 8 (role) or 10 (number)".into()))?;
    let name = o["name"].as_str().unwrap_or("").trim().to_lowercase();
    if name.is_empty() || name.len() > 32 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') { return Err(AppError::BadRequest("option names are 1-32 lowercase letters, digits, - or _".into())) }
    let description: String = o["description"].as_str().unwrap_or("").trim().chars().take(100).collect();
    let choices: Vec<Value> = o["choices"].as_array().map(|c| c.iter().take(25).filter_map(|c| {
        let n: String = c["name"].as_str()?.trim().chars().take(100).collect();
        (!n.is_empty() && (c["value"].is_string() || c["value"].is_number())).then(|| json!({ "name": n, "value": c["value"] }))
    }).collect()).unwrap_or_default();
    Ok(json!({ "type": kind, "name": name, "description": description, "required": o["required"].as_bool().unwrap_or(false), "choices": choices, "autocomplete": o["autocomplete"].as_bool().unwrap_or(false) }))
}

fn clean_command(c: &CommandIn) -> AppResult<(i16, String, String, Value)> {
    if !(1..=3).contains(&c.kind) { return Err(AppError::BadRequest("command type is 1 (slash), 2 (user) or 3 (message)".into())) }
    let name = if c.kind == 1 { c.name.trim().to_lowercase() } else { c.name.trim().to_string() };
    let ok = !name.is_empty() && name.chars().count() <= 32 && (c.kind != 1 || name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'));
    if !ok { return Err(AppError::BadRequest(format!("bad command name {:?}: slash commands are 1-32 lowercase letters, digits, - or _", c.name))) }
    let description: String = c.description.trim().chars().take(100).collect();
    if c.kind == 1 && description.is_empty() { return Err(AppError::BadRequest(format!("/{name} needs a description"))) }
    if c.options.len() > 25 { return Err(AppError::BadRequest("up to 25 options".into())) }
    let options = if c.kind == 1 { c.options.iter().map(clean_option).collect::<AppResult<Vec<_>>>()? } else { vec![] };
    // Required options come first, like Discord.
    let mut seen_optional = false;
    for o in &options { if o["required"].as_bool() == Some(true) { if seen_optional { return Err(AppError::BadRequest("required options must come before optional ones".into())) } } else { seen_optional = true } }
    Ok((c.kind, name, if c.kind == 1 { description } else { String::new() }, json!(options)))
}

/// Replace all of an app's commands in one scope (global, or one server) with `list`.
async fn overwrite(state: &AppState, app: Uuid, guild: Option<Uuid>, list: Vec<CommandIn>) -> AppResult<Vec<Command>> {
    if list.len() > 100 { return Err(AppError::BadRequest("up to 100 commands".into())) }
    let cleaned = list.iter().map(clean_command).collect::<AppResult<Vec<_>>>()?;
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM application_commands WHERE application_id = $1 AND guild_id IS NOT DISTINCT FROM $2").bind(app).bind(guild).execute(&mut *tx).await?;
    for (kind, name, description, options) in cleaned {
        sqlx::query("INSERT INTO application_commands (id, application_id, guild_id, kind, name, description, options) VALUES ($1, $2, $3, $4, $5, $6, $7)")
            .bind(Uuid::now_v7()).bind(app).bind(guild).bind(kind).bind(&name).bind(&description).bind(&options).execute(&mut *tx).await
            .map_err(|_| AppError::BadRequest(format!("two commands are called {name}")))?;
    }
    tx.commit().await?;
    // Clients refresh their command lists.
    state.hub.emit_all("APPLICATION_COMMANDS_UPDATE", json!({ "application_id": app, "guild_id": guild }));
    Ok(sqlx::query_as::<_, Command>(&format!("SELECT {CMD_COLS} FROM application_commands WHERE application_id = $1 AND guild_id IS NOT DISTINCT FROM $2 ORDER BY kind, name")).bind(app).bind(guild).fetch_all(&state.db).await?)
}

async fn list_global(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(app): Path<Uuid>) -> AppResult<Json<Vec<Command>>> {
    my_app(&state, app, uid).await?;
    Ok(Json(sqlx::query_as::<_, Command>(&format!("SELECT {CMD_COLS} FROM application_commands WHERE application_id = $1 AND guild_id IS NULL ORDER BY kind, name")).bind(app).fetch_all(&state.db).await?))
}
async fn put_global(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(app): Path<Uuid>, Json(list): Json<Vec<CommandIn>>) -> AppResult<Json<Vec<Command>>> {
    my_app(&state, app, uid).await?;
    Ok(Json(overwrite(&state, app, None, list).await?))
}
async fn list_guild(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((app, gid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Vec<Command>>> {
    my_app(&state, app, uid).await?;
    Ok(Json(sqlx::query_as::<_, Command>(&format!("SELECT {CMD_COLS} FROM application_commands WHERE application_id = $1 AND guild_id = $2 ORDER BY kind, name")).bind(app).bind(gid).fetch_all(&state.db).await?))
}
async fn put_guild(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((app, gid)): Path<(Uuid, Uuid)>, Json(list): Json<Vec<CommandIn>>) -> AppResult<Json<Vec<Command>>> {
    let (_, bot) = my_app(&state, app, uid).await?;
    // Only for servers the bot is in.
    let inside: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2").bind(gid).bind(bot).fetch_optional(&state.db).await?;
    if inside.is_none() { return Err(AppError::BadRequest("The app's bot isn't in that server".into())) }
    Ok(Json(overwrite(&state, app, Some(gid), list).await?))
}

/// `GET /channels/:id/commands`: commands usable here, from apps whose bot is in the server (or in this DM).
async fn available(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(cid): Path<Uuid>) -> AppResult<Json<Vec<Value>>> {
    let (c, _) = require_channel_perms(&state.db, cid, uid).await?;
    let rows: Vec<(Uuid, Uuid, Option<Uuid>, i16, String, String, Value, String, Option<String>)> = match c.guild_id {
        Some(gid) => sqlx::query_as(
            "SELECT ac.id, ac.application_id, ac.guild_id, ac.kind, ac.name, ac.description, ac.options, a.name, u.avatar_url FROM application_commands ac
             JOIN applications a ON a.id = ac.application_id JOIN users u ON u.id = a.bot_user_id
             JOIN guild_members m ON m.user_id = a.bot_user_id AND m.guild_id = $1
             WHERE ac.guild_id IS NULL OR ac.guild_id = $1 ORDER BY ac.name").bind(gid).fetch_all(&state.db).await?,
        None => sqlx::query_as(
            "SELECT ac.id, ac.application_id, ac.guild_id, ac.kind, ac.name, ac.description, ac.options, a.name, u.avatar_url FROM application_commands ac
             JOIN applications a ON a.id = ac.application_id JOIN users u ON u.id = a.bot_user_id
             JOIN channel_members m ON m.user_id = a.bot_user_id AND m.channel_id = $1
             WHERE ac.guild_id IS NULL ORDER BY ac.name").bind(cid).fetch_all(&state.db).await?,
    };
    Ok(Json(rows.into_iter().map(|(id, app, guild, kind, name, description, options, app_name, icon)| json!({ "id": id, "application_id": app, "guild_id": guild, "type": kind, "name": name, "description": description, "options": options, "application": { "name": app_name, "icon_url": icon } })).collect()))
}

#[derive(Deserialize)]
struct OptionValue { name: String, value: Value }
#[derive(Deserialize)]
struct InvokeIn { command_id: Uuid, channel_id: Uuid, #[serde(default)] options: Vec<OptionValue>, target_id: Option<Uuid> }

/// `POST /interactions`: use a command in a channel. The bot hears it as INTERACTION_CREATE. If it hasn't answered in
/// 3 seconds, the user gets INTERACTION_FAILED.
async fn invoke(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<InvokeIn>) -> AppResult<(StatusCode, Json<Value>)> {
    let (c, p) = require_channel_perms(&state.db, req.channel_id, uid).await?;
    perms::check(p, perms::SEND_MESSAGES)?;
    let cmd = sqlx::query_as::<_, Command>(&format!("SELECT {CMD_COLS} FROM application_commands WHERE id = $1")).bind(req.command_id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Unknown command".into()))?;
    // The command has to be usable here (same rule as `available`).
    let (bot, app_name): (Option<Uuid>, String) = sqlx::query_as("SELECT bot_user_id, name FROM applications WHERE id = $1").bind(cmd.application_id).fetch_one(&state.db).await?;
    let bot = bot.ok_or_else(|| AppError::BadRequest("That app has no bot".into()))?;
    let here = match c.guild_id {
        Some(gid) => (cmd.guild_id.is_none() || cmd.guild_id == Some(gid)) && sqlx::query_as::<_, (bool,)>("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2").bind(gid).bind(bot).fetch_optional(&state.db).await?.is_some(),
        None => cmd.guild_id.is_none() && sqlx::query_as::<_, (bool,)>("SELECT true FROM channel_members WHERE channel_id = $1 AND user_id = $2").bind(c.id).bind(bot).fetch_optional(&state.db).await?.is_some(),
    };
    if !here { return Err(AppError::BadRequest("That command isn't available here".into())) }
    // Options: known names, the right types, required ones present, choices respected.
    let defs = cmd.options.as_array().cloned().unwrap_or_default();
    let mut options = Vec::new();
    let mut resolved = serde_json::Map::new();
    for d in &defs {
        let name = d["name"].as_str().unwrap_or("");
        let Some(given) = req.options.iter().find(|o| o.name == name) else {
            if d["required"].as_bool() == Some(true) { return Err(AppError::BadRequest(format!("/{} needs {name}", cmd.name))) }
            continue;
        };
        let kind = d["type"].as_i64().unwrap_or(3);
        let v = &given.value;
        let value = match kind {
            3 => json!(v.as_str().ok_or_else(|| AppError::BadRequest(format!("{name} must be text")))?.chars().take(6000).collect::<String>()),
            4 => json!(v.as_i64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())).ok_or_else(|| AppError::BadRequest(format!("{name} must be a whole number")))?),
            10 => json!(v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())).ok_or_else(|| AppError::BadRequest(format!("{name} must be a number")))?),
            5 => json!(v.as_bool().or_else(|| v.as_str().map(|s| matches!(s.trim(), "true" | "yes" | "1"))).unwrap_or(false)),
            _ => {
                let id: Uuid = v.as_str().and_then(|s| s.trim().parse().ok()).ok_or_else(|| AppError::BadRequest(format!("{name} must be an id")))?;
                let found: Option<(String,)> = match kind {
                    6 => sqlx::query_as("SELECT display_name FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await?,
                    7 => sqlx::query_as("SELECT name FROM channels WHERE id = $1 AND guild_id IS NOT DISTINCT FROM $2").bind(id).bind(c.guild_id).fetch_optional(&state.db).await?,
                    _ => sqlx::query_as("SELECT name FROM roles WHERE id = $1 AND guild_id IS NOT DISTINCT FROM $2").bind(id).bind(c.guild_id).fetch_optional(&state.db).await?,
                };
                let (label,) = found.ok_or_else(|| AppError::BadRequest(format!("{name}: not found here")))?;
                let bucket = match kind { 6 => "users", 7 => "channels", _ => "roles" };
                resolved.entry(bucket).or_insert_with(|| json!({}))[id.to_string()] = json!({ "id": id, "name": label });
                json!(id)
            }
        };
        if let Some(choices) = d["choices"].as_array().filter(|c| !c.is_empty()) {
            if !choices.iter().any(|ch| ch["value"] == value) { return Err(AppError::BadRequest(format!("{name}: pick one of the choices"))) }
        }
        options.push(json!({ "name": name, "type": kind, "value": value }));
    }
    if cmd.kind != 1 && req.target_id.is_none() { return Err(AppError::BadRequest("User and message commands need a target".into())) }
    if cmd.kind == 3 {
        if let Some(t) = req.target_id { let m = fetch_message(&state.db, t, uid).await?; if m.channel_id != c.id { return Err(AppError::BadRequest("That message isn't in this channel".into())) } resolved.insert("messages".into(), json!({ t.to_string(): m })); }
    }
    let id = Uuid::now_v7();
    let token = crate::mail::new_token();
    let data = json!({ "id": cmd.id, "name": cmd.name, "type": cmd.kind, "options": options, "target_id": req.target_id, "resolved": resolved });
    sqlx::query("INSERT INTO interactions (id, token_hash, application_id, user_id, channel_id, guild_id, kind, data) VALUES ($1, $2, $3, $4, $5, $6, 2, $7)")
        .bind(id).bind(crate::routes::applications::hash(&token)).bind(cmd.application_id).bind(uid).bind(c.id).bind(c.guild_id).bind(&data).execute(&state.db).await?;
    let user = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1")).bind(uid).fetch_one(&state.db).await?;
    let member = match c.guild_id { Some(gid) => crate::routes::guilds::fetch_member(&state.db, gid, uid).await.ok().map(|m| json!({ "nickname": m.nickname, "roles": m.roles, "permissions": p.to_string() })), None => None };
    state.hub.emit_users(vec![bot], "INTERACTION_CREATE", json!({ "id": id, "token": token, "application_id": cmd.application_id, "type": 2, "data": data, "guild_id": c.guild_id, "channel_id": c.id, "user": user, "member": member }));
    // No answer in 3 seconds: tell the user.
    let st = state.clone();
    let (name, app_name2) = (cmd.name.clone(), app_name.clone());
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let done: Option<(bool,)> = sqlx::query_as("SELECT responded_at IS NOT NULL FROM interactions WHERE id = $1").bind(id).fetch_optional(&st.db).await.unwrap_or(None);
        if done.map(|d| !d.0).unwrap_or(false) { st.hub.emit_users(vec![uid], "INTERACTION_FAILED", json!({ "id": id, "name": name, "application": app_name2 })); }
    });
    Ok((StatusCode::ACCEPTED, Json(json!({ "id": id }))))
}

struct Live { app: Uuid, user: Uuid, channel: Channel, name: String, message_id: Option<Uuid>, ephemeral: Option<Value>, responded: bool, created: chrono::DateTime<Utc> }

/// The interaction a token names; 15 minutes to use it.
async fn live(state: &AppState, id: Uuid, token: &str) -> AppResult<Live> {
    let row: Option<(String, Uuid, Uuid, Uuid, Value, Option<Uuid>, Option<Value>, Option<chrono::DateTime<Utc>>, chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT token_hash, application_id, user_id, channel_id, data, message_id, ephemeral, responded_at, created_at FROM interactions WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let Some((hash, app, user, cid, data, message_id, ephemeral, responded, created)) = row else { return Err(AppError::NotFound("Unknown interaction".into())) };
    if hash != crate::routes::applications::hash(token) || created < Utc::now() - chrono::Duration::minutes(15) { return Err(AppError::NotFound("Unknown or expired interaction".into())) }
    let channel = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(cid).fetch_one(&state.db).await?;
    Ok(Live { app, user, channel, name: data["name"].as_str().unwrap_or("").to_string(), message_id, ephemeral, responded: responded.is_some(), created })
}

#[derive(Deserialize, Default)]
struct ResponseData { #[serde(default)] content: String, embeds: Option<Value>, #[serde(default)] flags: u64 }
#[derive(Deserialize)]
struct CallbackIn { #[serde(rename = "type")] kind: u8, #[serde(default)] data: Option<ResponseData> }

async fn bot_of(state: &AppState, app: Uuid) -> AppResult<Uuid> {
    let (b,): (Option<Uuid>,) = sqlx::query_as("SELECT bot_user_id FROM applications WHERE id = $1").bind(app).fetch_one(&state.db).await?;
    b.ok_or_else(|| AppError::BadRequest("The app has no bot".into()))
}

fn meta(l: &Live, user: &User, deferred: bool, interaction: Uuid) -> Value {
    json!({ "id": interaction, "name": l.name, "user": { "id": user.id, "display_name": user.display_name }, "deferred": deferred })
}

/// A response message: stored and sent to the channel, or (ephemeral) sent only to the user and never stored.
async fn respond(state: &AppState, l: &Live, interaction: Uuid, d: &ResponseData, deferred: bool) -> AppResult<(Option<Uuid>, Option<Value>)> {
    let content: String = d.content.trim_end().chars().take(2000).collect();
    let embeds = match &d.embeds { Some(e) if e.as_array().map(|a| !a.is_empty()).unwrap_or(false) => Some(crate::routes::webhooks::clean_embeds(e)?), _ => None };
    if !deferred && content.trim().is_empty() && embeds.is_none() { return Err(AppError::BadRequest("A response needs content or an embed".into())) }
    let bot = bot_of(state, l.app).await?;
    let user = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1")).bind(l.user).fetch_one(&state.db).await?;
    let m = meta(l, &user, deferred, interaction);
    if d.flags & EPHEMERAL != 0 {
        let author = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1")).bind(bot).fetch_one(&state.db).await?;
        let msg = json!({ "id": Uuid::now_v7(), "channel_id": l.channel.id, "author": author, "content": content, "created_at": Utc::now(), "edited_at": null, "pinned_at": null,
            "reactions": [], "attachments": [], "mentions": [], "mention_roles": [], "mention_everyone": false, "kind": "default", "embeds": embeds, "interaction": m, "ephemeral": true });
        state.hub.emit_users(vec![l.user], "MESSAGE_CREATE", json!({ "message": msg, "guild_id": l.channel.guild_id }));
        return Ok((None, Some(msg)));
    }
    let mid = Uuid::now_v7();
    let (users, _, _) = crate::routes::channels::parse_mentions(&content);
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, mentions, embeds, interaction) VALUES ($1, $2, $3, $4, $5, $6, $7)")
        .bind(mid).bind(l.channel.id).bind(bot).bind(&content).bind(&users).bind(&embeds).bind(&m).execute(&state.db).await?;
    let msg: Message = fetch_message(&state.db, mid, bot).await?;
    state.hub.emit(target_for(&state.db, &l.channel).await?, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": l.channel.guild_id }));
    if !deferred { crate::push::after_message(state.clone(), msg, l.channel.clone()); }
    Ok((Some(mid), None))
}

/// `POST /interactions/:id/:token/callback`: the first answer, within 3 seconds. Types: 4 = a message, 5 = "thinking"
/// (fill it in with PATCH .../messages/@original). `flags: 64` makes it ephemeral.
async fn callback(State(state): State<AppState>, Path((id, token)): Path<(Uuid, String)>, Json(req): Json<CallbackIn>) -> AppResult<StatusCode> {
    let l = live(&state, id, &token).await?;
    if l.responded { return Err(AppError::BadRequest("This interaction has already been answered".into())) }
    // 3 seconds, like Discord (plus a little for replies already on their way): after that the user was told it failed.
    if l.created < Utc::now() - chrono::Duration::milliseconds(3500) { return Err(AppError::BadRequest("Too late: answer within 3 seconds, or defer".into())) }
    let d = req.data.unwrap_or_default();
    let (mid, eph) = match req.kind {
        4 => respond(&state, &l, id, &d, false).await?,
        5 => respond(&state, &l, id, &ResponseData { content: String::new(), embeds: None, flags: d.flags }, true).await?,
        1 => (None, None),
        _ => return Err(AppError::BadRequest("Response type is 4 (message) or 5 (deferred)".into())),
    };
    let done = sqlx::query("UPDATE interactions SET responded_at = now(), message_id = $2, ephemeral = $3 WHERE id = $1 AND responded_at IS NULL").bind(id).bind(mid).bind(&eph).execute(&state.db).await?;
    if done.rows_affected() == 0 { return Err(AppError::BadRequest("This interaction has already been answered".into())) }
    Ok(StatusCode::NO_CONTENT)
}

/// `PATCH /interactions/:id/:token/messages/@original`: change (or fill in, after "thinking") the first answer.
async fn edit_original(State(state): State<AppState>, Path((id, token)): Path<(Uuid, String)>, Json(d): Json<ResponseData>) -> AppResult<Json<Value>> {
    let l = live(&state, id, &token).await?;
    if !l.responded { return Err(AppError::BadRequest("Answer the interaction first".into())) }
    let content: String = d.content.trim_end().chars().take(2000).collect();
    let embeds = match &d.embeds { Some(e) if e.as_array().map(|a| !a.is_empty()).unwrap_or(false) => Some(crate::routes::webhooks::clean_embeds(e)?), _ => None };
    if content.trim().is_empty() && embeds.is_none() { return Err(AppError::BadRequest("A response needs content or an embed".into())) }
    if let Some(mut msg) = l.ephemeral.clone() {
        msg["content"] = json!(content); msg["embeds"] = json!(embeds); msg["interaction"]["deferred"] = json!(false);
        sqlx::query("UPDATE interactions SET ephemeral = $2 WHERE id = $1").bind(id).bind(&msg).execute(&state.db).await?;
        state.hub.emit_users(vec![l.user], "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": l.channel.guild_id }));
        return Ok(Json(msg));
    }
    let mid = l.message_id.ok_or_else(|| AppError::NotFound("No original response".into()))?;
    let (was,): (Value,) = sqlx::query_as("SELECT COALESCE(interaction, '{}'::jsonb) FROM messages WHERE id = $1").bind(mid).fetch_one(&state.db).await?;
    let filling = was["deferred"].as_bool() == Some(true);
    let mut meta = was; meta["deferred"] = json!(false);
    // Filling in "thinking" isn't an edit; changing a real answer is.
    sqlx::query("UPDATE messages SET content = $2, embeds = $3, interaction = $4, edited_at = CASE WHEN $5 THEN edited_at ELSE now() END WHERE id = $1")
        .bind(mid).bind(&content).bind(&embeds).bind(&meta).bind(filling).execute(&state.db).await?;
    let bot = bot_of(&state, l.app).await?;
    let msg = fetch_message(&state.db, mid, bot).await?;
    state.hub.emit(target_for(&state.db, &l.channel).await?, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": l.channel.guild_id }));
    if filling { crate::push::after_message(state.clone(), msg.clone(), l.channel.clone()); }
    Ok(Json(json!(msg)))
}

async fn delete_original(State(state): State<AppState>, Path((id, token)): Path<(Uuid, String)>) -> AppResult<StatusCode> {
    let l = live(&state, id, &token).await?;
    if let Some(msg) = l.ephemeral { state.hub.emit_users(vec![l.user], "MESSAGE_DELETE", json!({ "id": msg["id"], "channel_id": l.channel.id })); return Ok(StatusCode::NO_CONTENT) }
    let mid = l.message_id.ok_or_else(|| AppError::NotFound("No original response".into()))?;
    sqlx::query("DELETE FROM messages WHERE id = $1").bind(mid).execute(&state.db).await?;
    state.hub.emit(target_for(&state.db, &l.channel).await?, "MESSAGE_DELETE", json!({ "id": mid, "channel_id": l.channel.id, "guild_id": l.channel.guild_id }));
    Ok(StatusCode::NO_CONTENT)
}

/// `POST /interactions/:id/:token/followup`: another message (ephemeral with `flags: 64`), within 15 minutes.
async fn followup(State(state): State<AppState>, Path((id, token)): Path<(Uuid, String)>, Json(d): Json<ResponseData>) -> AppResult<Json<Value>> {
    let l = live(&state, id, &token).await?;
    if !l.responded { return Err(AppError::BadRequest("Answer the interaction first".into())) }
    let (mid, eph) = respond(&state, &l, id, &d, false).await?;
    Ok(Json(json!({ "id": mid, "ephemeral": eph.is_some() })))
}
