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
        .route("/interactions/component", post(component))
        .route("/interactions/modal", post(modal_submit))
        .route("/interactions/autocomplete", post(autocomplete))
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
    // Plus the global commands of apps you installed to your account (they work for you anywhere).
    let mine: Vec<(Uuid, Uuid, Option<Uuid>, i16, String, String, Value, String, Option<String>)> = sqlx::query_as(
        "SELECT ac.id, ac.application_id, ac.guild_id, ac.kind, ac.name, ac.description, ac.options, a.name, u.avatar_url FROM application_commands ac
         JOIN applications a ON a.id = ac.application_id LEFT JOIN users u ON u.id = a.bot_user_id
         JOIN user_app_installs i ON i.app_id = a.id AND i.user_id = $1 WHERE ac.guild_id IS NULL ORDER BY ac.name").bind(uid).fetch_all(&state.db).await?;
    let mut seen = std::collections::HashSet::new();
    Ok(Json(rows.into_iter().map(|r| (r, false)).chain(mine.into_iter().map(|r| (r, true))).filter(|(r, _)| seen.insert(r.0)).map(|((id, app, guild, kind, name, description, options, app_name, icon), user_installed)| json!({ "id": id, "application_id": app, "guild_id": guild, "type": kind, "name": name, "description": description, "options": options, "application": { "name": app_name, "icon_url": icon }, "user_installed": user_installed })).collect()))
}

#[derive(Deserialize)]
struct OptionValue { name: String, value: Value }
#[derive(Deserialize)]
struct InvokeIn { command_id: Uuid, channel_id: Uuid, #[serde(default)] options: Vec<OptionValue>, target_id: Option<Uuid> }

/// A command's option values: known names, the right types, required ones present, choices respected, ids resolved.
/// With `focused` (autocomplete) the option being typed passes as typed and nothing is required yet.
async fn read_options(state: &AppState, c: &Channel, cmd: &Command, given_all: &[OptionValue], focused: Option<&str>) -> AppResult<(Vec<Value>, serde_json::Map<String, Value>)> {
    let defs = cmd.options.as_array().cloned().unwrap_or_default();
    let mut options = Vec::new();
    let mut resolved = serde_json::Map::new();
    for d in &defs {
        let name = d["name"].as_str().unwrap_or("");
        let Some(given) = given_all.iter().find(|o| o.name == name) else {
            if focused.is_none() && d["required"].as_bool() == Some(true) { return Err(AppError::BadRequest(format!("/{} needs {name}", cmd.name))) }
            continue;
        };
        let kind = d["type"].as_i64().unwrap_or(3);
        let v = &given.value;
        // Autocomplete: the option being typed is passed through as typed.
        if focused == Some(name) { options.push(json!({ "name": name, "type": kind, "value": v, "focused": true })); continue }
        if focused.is_some() && v.as_str().map(|s| s.trim().is_empty()).unwrap_or(false) { continue }
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
        if let Some(choices) = d["choices"].as_array().filter(|c| !c.is_empty() && focused.is_none()) {
            if !choices.iter().any(|ch| ch["value"] == value) { return Err(AppError::BadRequest(format!("{name}: pick one of the choices"))) }
        }
        options.push(json!({ "name": name, "type": kind, "value": value }));
    }
    Ok((options, resolved))
}

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
    // Apps you installed to your account work anywhere (global commands).
    let installed = cmd.guild_id.is_none() && sqlx::query_as::<_, (bool,)>("SELECT true FROM user_app_installs WHERE user_id = $1 AND app_id = $2").bind(uid).bind(cmd.application_id).fetch_optional(&state.db).await?.is_some();
    if !here && !installed { return Err(AppError::BadRequest("That command isn't available here".into())) }
    let data_external = !here;
    let (options, mut resolved) = read_options(&state, &c, &cmd, &req.options, None).await?;
    if cmd.kind != 1 && req.target_id.is_none() { return Err(AppError::BadRequest("User and message commands need a target".into())) }
    if cmd.kind == 3 {
        if let Some(t) = req.target_id { let m = fetch_message(&state.db, t, uid).await?; if m.channel_id != c.id { return Err(AppError::BadRequest("That message isn't in this channel".into())) } resolved.insert("messages".into(), json!({ t.to_string(): m })); }
    }
    // `external`: a user-installed app in a place its bot isn't; in servers its answers are only shown to the user.
    let data = json!({ "id": cmd.id, "name": cmd.name, "type": cmd.kind, "options": options, "target_id": req.target_id, "resolved": resolved, "external": data_external });
    let id = deliver(&state, uid, p, &c, cmd.application_id, bot, 2, data, None, Some(format!("/{}", cmd.name)), &app_name).await?;
    Ok((StatusCode::ACCEPTED, Json(json!({ "id": id }))))
}

/// Record an interaction and send it to the app's bot. `fail_label` (what the user did, e.g. "/echo"): if the bot
/// hasn't answered in 3 seconds, the user hears it didn't respond.
#[allow(clippy::too_many_arguments)]
async fn deliver(state: &AppState, uid: Uuid, p: u64, c: &Channel, app: Uuid, bot: Uuid, kind: i16, data: Value, source: Option<Uuid>, fail_label: Option<String>, app_name: &str) -> AppResult<Uuid> {
    let id = Uuid::now_v7();
    let token = crate::mail::new_token();
    sqlx::query("INSERT INTO interactions (id, token_hash, application_id, user_id, channel_id, guild_id, kind, data, source_message_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
        .bind(id).bind(crate::routes::applications::hash(&token)).bind(app).bind(uid).bind(c.id).bind(c.guild_id).bind(kind).bind(&data).bind(source).execute(&state.db).await?;
    let user = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1")).bind(uid).fetch_one(&state.db).await?;
    let member = match c.guild_id { Some(gid) => crate::routes::guilds::fetch_member(&state.db, gid, uid).await.ok().map(|m| json!({ "nickname": m.nickname, "roles": m.roles, "permissions": p.to_string() })), None => None };
    let message = match source { Some(m) => fetch_message(&state.db, m, bot).await.ok().map(|m| json!(m)), None => None };
    state.hub.emit_users(vec![bot], "INTERACTION_CREATE", json!({ "id": id, "token": token, "application_id": app, "type": kind, "data": data, "guild_id": c.guild_id, "channel_id": c.id, "user": user, "member": member, "message": message }));
    if let Some(label) = fail_label {
        let st = state.clone();
        let app_name = app_name.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            let done: Option<(bool,)> = sqlx::query_as("SELECT responded_at IS NOT NULL FROM interactions WHERE id = $1").bind(id).fetch_optional(&st.db).await.unwrap_or(None);
            if done.map(|d| !d.0).unwrap_or(false) { st.hub.emit_users(vec![uid], "INTERACTION_FAILED", json!({ "id": id, "name": label.trim_start_matches('/'), "label": label, "application": app_name })); }
        });
    }
    Ok(id)
}

/// The app behind a bot user, if any: (app id, name).
async fn app_of_bot(state: &AppState, bot: Uuid) -> AppResult<(Uuid, String)> {
    sqlx::query_as("SELECT id, name FROM applications WHERE bot_user_id = $1").bind(bot).fetch_optional(&state.db).await?.ok_or_else(|| AppError::BadRequest("That message isn't from an app".into()))
}

#[derive(Deserialize)]
struct ComponentIn { channel_id: Uuid, message_id: Uuid, custom_id: String, #[serde(default)] values: Vec<String> }

/// `POST /interactions/component`: a button press or a menu pick on an app's message (stored, or ephemeral to you).
async fn component(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<ComponentIn>) -> AppResult<(StatusCode, Json<Value>)> {
    let (c, p) = require_channel_perms(&state.db, req.channel_id, uid).await?;
    // The message: a stored one in this channel, or an ephemeral answer someone sent you.
    let (author, components, stored): (Uuid, Value, bool) = match fetch_message(&state.db, req.message_id, uid).await {
        Ok(m) if m.channel_id == c.id => (m.author.id, m.components.clone().unwrap_or(Value::Null), true),
        _ => {
            let row: Option<(Value,)> = sqlx::query_as("SELECT ephemeral FROM interactions WHERE user_id = $1 AND channel_id = $2 AND ephemeral->>'id' = $3").bind(uid).bind(c.id).bind(req.message_id.to_string()).fetch_optional(&state.db).await?;
            let (msg,) = row.ok_or_else(|| AppError::NotFound("Message not found".into()))?;
            (msg["author"]["id"].as_str().and_then(|s| s.parse().ok()).unwrap_or_default(), msg["components"].clone(), false)
        }
    };
    let comp = components.as_array().into_iter().flatten().flat_map(|row| row["components"].as_array().cloned().unwrap_or_default()).find(|x| x["custom_id"].as_str() == Some(req.custom_id.as_str()))
        .ok_or_else(|| AppError::BadRequest("That button or menu isn't on the message".into()))?;
    if comp["disabled"].as_bool() == Some(true) { return Err(AppError::BadRequest("That's disabled".into())) }
    let kind = comp["type"].as_i64().unwrap_or(2);
    if kind == 3 {
        let allowed: Vec<&str> = comp["options"].as_array().into_iter().flatten().filter_map(|o| o["value"].as_str()).collect();
        let (min, max) = (comp["min_values"].as_u64().unwrap_or(1) as usize, comp["max_values"].as_u64().unwrap_or(1) as usize);
        if req.values.len() < min || req.values.len() > max || req.values.iter().any(|v| !allowed.contains(&v.as_str())) { return Err(AppError::BadRequest("Pick from the menu's options".into())) }
    }
    let (app, app_name) = app_of_bot(&state, author).await?;
    let data = json!({ "custom_id": req.custom_id, "component_type": kind, "values": req.values });
    let id = deliver(&state, uid, p, &c, app, author, 3, data, stored.then_some(req.message_id), Some(comp["label"].as_str().map(|l| format!("“{l}”")).unwrap_or_else(|| "that".into())), &app_name).await?;
    Ok((StatusCode::ACCEPTED, Json(json!({ "id": id }))))
}

#[derive(Deserialize)]
struct FieldIn { custom_id: String, #[serde(default)] value: String }
#[derive(Deserialize)]
struct ModalIn { interaction_id: Uuid, custom_id: String, #[serde(default)] fields: Vec<FieldIn> }

/// `POST /interactions/modal`: the form an app opened for you (answering one of your interactions), filled in.
async fn modal_submit(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<ModalIn>) -> AppResult<(StatusCode, Json<Value>)> {
    let row: Option<(Uuid, Uuid, Option<Value>)> = sqlx::query_as("SELECT application_id, channel_id, choices FROM interactions WHERE id = $1 AND user_id = $2").bind(req.interaction_id).bind(uid).fetch_optional(&state.db).await?;
    let (app, cid, modal) = row.ok_or_else(|| AppError::NotFound("No form to answer".into()))?;
    let modal = modal.filter(|m| m["custom_id"].as_str() == Some(req.custom_id.as_str())).ok_or_else(|| AppError::BadRequest("That form isn't open".into()))?;
    // Every required field filled, within its length limits.
    let mut out = Vec::new();
    for input in modal["components"].as_array().into_iter().flatten().flat_map(|r| r["components"].as_array().cloned().unwrap_or_default()) {
        let id = input["custom_id"].as_str().unwrap_or("");
        let v = req.fields.iter().find(|f| f.custom_id == id).map(|f| f.value.trim().to_string()).unwrap_or_default();
        let label = input["label"].as_str().unwrap_or(id);
        if input["required"].as_bool().unwrap_or(true) && v.is_empty() { return Err(AppError::BadRequest(format!("Fill in “{label}”"))) }
        let (min, max) = (input["min_length"].as_u64().unwrap_or(0) as usize, input["max_length"].as_u64().unwrap_or(4000) as usize);
        let n = v.chars().count();
        if !v.is_empty() && (n < min || n > max) { return Err(AppError::BadRequest(format!("“{label}” must be {min}-{max} characters"))) }
        out.push(json!({ "custom_id": id, "value": v }));
    }
    let (c, p) = require_channel_perms(&state.db, cid, uid).await?;
    let bot = bot_of(&state, app).await?;
    let (_, app_name) = app_of_bot(&state, bot).await?;
    let data = json!({ "custom_id": req.custom_id, "components": out });
    let id = deliver(&state, uid, p, &c, app, bot, 5, data, None, Some(modal["title"].as_str().unwrap_or("the form").to_string()), &app_name).await?;
    Ok((StatusCode::ACCEPTED, Json(json!({ "id": id }))))
}

#[derive(Deserialize)]
struct AutoIn { command_id: Uuid, channel_id: Uuid, #[serde(default)] options: Vec<OptionValue>, focused: String }

/// `POST /interactions/autocomplete`: suggestions for the option being typed, from the app (waits up to 2.5 s).
async fn autocomplete(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<AutoIn>) -> AppResult<Json<Value>> {
    let (c, p) = require_channel_perms(&state.db, req.channel_id, uid).await?;
    let cmd = sqlx::query_as::<_, Command>(&format!("SELECT {CMD_COLS} FROM application_commands WHERE id = $1")).bind(req.command_id).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Unknown command".into()))?;
    let def = cmd.options.as_array().into_iter().flatten().find(|o| o["name"].as_str() == Some(req.focused.as_str())).cloned().ok_or_else(|| AppError::BadRequest("Unknown option".into()))?;
    if def["autocomplete"].as_bool() != Some(true) { return Err(AppError::BadRequest("That option has no suggestions".into())) }
    let bot = bot_of(&state, cmd.application_id).await?;
    let (options, _) = read_options(&state, &c, &cmd, &req.options, Some(&req.focused)).await?;
    let data = json!({ "id": cmd.id, "name": cmd.name, "type": cmd.kind, "options": options });
    let id = deliver(&state, uid, p, &c, cmd.application_id, bot, 4, data, None, None, "").await?;
    // The answer may arrive on any instance: poll the row.
    for _ in 0..25 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let (choices,): (Option<Value>,) = sqlx::query_as("SELECT choices FROM interactions WHERE id = $1").bind(id).fetch_one(&state.db).await?;
        if let Some(ch) = choices { return Ok(Json(json!({ "choices": ch }))) }
    }
    Ok(Json(json!({ "choices": [] })))
}

struct Live { app: Uuid, user: Uuid, channel: Channel, name: String, message_id: Option<Uuid>, ephemeral: Option<Value>, responded: bool, created: chrono::DateTime<Utc>, kind: i16, source: Option<Uuid>, external: bool }

/// The interaction a token names; 15 minutes to use it.
async fn live(state: &AppState, id: Uuid, token: &str) -> AppResult<Live> {
    let row: Option<(String, Uuid, Uuid, Uuid, Value, Option<Uuid>, Option<Value>, Option<chrono::DateTime<Utc>>, chrono::DateTime<Utc>, i16, Option<Uuid>)> = sqlx::query_as(
        "SELECT token_hash, application_id, user_id, channel_id, data, message_id, ephemeral, responded_at, created_at, kind, source_message_id FROM interactions WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let Some((hash, app, user, cid, data, message_id, ephemeral, responded, created, kind, source)) = row else { return Err(AppError::NotFound("Unknown interaction".into())) };
    if hash != crate::routes::applications::hash(token) || created < Utc::now() - chrono::Duration::minutes(15) { return Err(AppError::NotFound("Unknown or expired interaction".into())) }
    let channel = sqlx::query_as::<_, Channel>(&format!("SELECT {CHANNEL_COLS} FROM channels WHERE id = $1")).bind(cid).fetch_one(&state.db).await?;
    // A command's name, or for a button / form the command that made the message is unknown: show its custom id.
    let name = data["name"].as_str().or(data["custom_id"].as_str()).unwrap_or("").to_string();
    Ok(Live { app, user, channel, name, message_id, ephemeral, responded: responded.is_some(), created, kind, source, external: data["external"].as_bool().unwrap_or(false) })
}

#[derive(Deserialize, Default)]
struct ResponseData { #[serde(default)] content: String, embeds: Option<Value>, components: Option<Value>, #[serde(default)] flags: u64 }
#[derive(Deserialize)]
struct CallbackIn { #[serde(rename = "type")] kind: u8, #[serde(default)] data: Option<Value> }

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
    let components = match &d.components { Some(v) if v.as_array().map(|a| !a.is_empty()).unwrap_or(false) => Some(clean_components(v)?), _ => None };
    if !deferred && content.trim().is_empty() && embeds.is_none() { return Err(AppError::BadRequest("A response needs content or an embed".into())) }
    let bot = bot_of(state, l.app).await?;
    let user = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1")).bind(l.user).fetch_one(&state.db).await?;
    let m = meta(l, &user, deferred, interaction);
    if d.flags & EPHEMERAL != 0 || (l.external && l.channel.guild_id.is_some()) {
        let author = sqlx::query_as::<_, User>(&format!("SELECT {USER_COLS} FROM users WHERE id = $1")).bind(bot).fetch_one(&state.db).await?;
        let msg = json!({ "id": Uuid::now_v7(), "channel_id": l.channel.id, "author": author, "content": content, "created_at": Utc::now(), "edited_at": null, "pinned_at": null,
            "reactions": [], "attachments": [], "mentions": [], "mention_roles": [], "mention_everyone": false, "kind": "default", "embeds": embeds, "components": components, "interaction": m, "ephemeral": true });
        state.hub.emit_users(vec![l.user], "MESSAGE_CREATE", json!({ "message": msg, "guild_id": l.channel.guild_id }));
        return Ok((None, Some(msg)));
    }
    let mid = Uuid::now_v7();
    let (users, _, _) = crate::routes::channels::parse_mentions(&content);
    sqlx::query("INSERT INTO messages (id, channel_id, author_id, content, mentions, embeds, interaction, components) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)")
        .bind(mid).bind(l.channel.id).bind(bot).bind(&content).bind(&users).bind(&embeds).bind(&m).bind(&components).execute(&state.db).await?;
    let msg: Message = fetch_message(&state.db, mid, bot).await?;
    state.hub.emit(target_for(&state.db, &l.channel).await?, "MESSAGE_CREATE", json!({ "message": msg, "guild_id": l.channel.guild_id }));
    if !deferred { crate::push::after_message(state.clone(), msg, l.channel.clone()); }
    Ok((Some(mid), None))
}

/// `POST /interactions/:id/:token/callback`: the first answer, within 3 seconds. Types: 4 = a message, 5 = "thinking"
/// (fill it in with PATCH .../messages/@original), 6 = got it (buttons/menus: change nothing yet), 7 = update the
/// message the button or menu is on, 8 = autocomplete suggestions, 9 = open a form. `flags: 64` makes it ephemeral.
async fn callback(State(state): State<AppState>, Path((id, token)): Path<(Uuid, String)>, Json(req): Json<CallbackIn>) -> AppResult<StatusCode> {
    let l = live(&state, id, &token).await?;
    if l.responded { return Err(AppError::BadRequest("This interaction has already been answered".into())) }
    // 3 seconds, like Discord (plus a little for replies already on their way): after that the user was told it failed.
    if l.created < Utc::now() - chrono::Duration::milliseconds(3500) { return Err(AppError::BadRequest("Too late: answer within 3 seconds, or defer".into())) }
    let raw = req.data.unwrap_or(Value::Null);
    let d: ResponseData = serde_json::from_value(raw.clone()).unwrap_or_default();
    let (mut mid, mut eph, mut choices) = (None, None, None);
    match (req.kind, l.kind) {
        (4, 2 | 3 | 5) => (mid, eph) = respond(&state, &l, id, &d, false).await?,
        (5, 2 | 3 | 5) => (mid, eph) = respond(&state, &l, id, &ResponseData { flags: d.flags, ..Default::default() }, true).await?,
        (6, 3) => {}
        (7, 3) => update_source(&state, &l, &d).await?,
        (8, 4) => {
            let list: Vec<Value> = raw["choices"].as_array().cloned().unwrap_or_default().into_iter().take(25).filter_map(|c| {
                let n: String = c["name"].as_str()?.trim().chars().take(100).collect();
                (!n.is_empty()).then(|| json!({ "name": n, "value": c["value"] }))
            }).collect();
            choices = Some(json!(list));
        }
        (9, 2 | 3) => {
            let modal = clean_modal(&raw)?;
            choices = Some(modal.clone());
            state.hub.emit_users(vec![l.user], "INTERACTION_MODAL", json!({ "interaction_id": id, "application_id": l.app, "channel_id": l.channel.id, "modal": modal }));
        }
        (1, _) => {}
        _ => return Err(AppError::BadRequest("That response type doesn't fit this interaction".into())),
    }
    let done = sqlx::query("UPDATE interactions SET responded_at = now(), message_id = $2, ephemeral = $3, choices = COALESCE($4, choices) WHERE id = $1 AND responded_at IS NULL").bind(id).bind(mid).bind(&eph).bind(&choices).execute(&state.db).await?;
    if done.rows_affected() == 0 { return Err(AppError::BadRequest("This interaction has already been answered".into())) }
    Ok(StatusCode::NO_CONTENT)
}

/// Type 7: change the message whose button or menu was used (content, embeds and components given replace them).
async fn update_source(state: &AppState, l: &Live, d: &ResponseData) -> AppResult<()> {
    let content: String = d.content.trim_end().chars().take(2000).collect();
    let embeds = match &d.embeds { Some(e) if e.as_array().map(|a| !a.is_empty()).unwrap_or(false) => Some(crate::routes::webhooks::clean_embeds(e)?), _ => None };
    let components = match &d.components { Some(v) if v.as_array().map(|a| !a.is_empty()).unwrap_or(false) => Some(clean_components(v)?), _ => None };
    let bot = bot_of(state, l.app).await?;
    match l.source {
        Some(mid) => {
            sqlx::query("UPDATE messages SET content = $2, embeds = $3, components = $4, edited_at = now() WHERE id = $1 AND author_id = $5")
                .bind(mid).bind(&content).bind(&embeds).bind(&components).bind(bot).execute(&state.db).await?;
            let msg = fetch_message(&state.db, mid, bot).await?;
            state.hub.emit(target_for(&state.db, &l.channel).await?, "MESSAGE_UPDATE", json!({ "message": msg, "guild_id": l.channel.guild_id }));
        }
        None => return Err(AppError::BadRequest("Ephemeral messages can't be updated this way; send a new one".into())),
    }
    Ok(())
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

fn str_field(v: &Value, k: &str, max: usize) -> Option<String> { v[k].as_str().map(|s| s.trim().chars().take(max).collect::<String>()).filter(|s| !s.is_empty()) }

/// Buttons and select menus, rebuilt from the known fields: up to 5 action rows; a row holds up to 5 buttons or one
/// menu. Buttons: style 1 primary, 2 secondary, 3 success, 4 danger (need a custom_id), 5 link (need an https url).
/// Menus (type 3): custom_id, up to 25 options, min/max values.
pub fn clean_components(v: &Value) -> AppResult<Value> {
    let rows = v.as_array().ok_or_else(|| AppError::BadRequest("components must be a list of action rows".into()))?;
    if rows.len() > 5 { return Err(AppError::BadRequest("Up to 5 rows of components".into())) }
    let mut ids = std::collections::HashSet::new();
    let mut out = Vec::new();
    for row in rows {
        let items = row["components"].as_array().ok_or_else(|| AppError::BadRequest("each row needs components".into()))?;
        if items.is_empty() || items.len() > 5 { return Err(AppError::BadRequest("a row holds 1 to 5 components".into())) }
        let mut cleaned = Vec::new();
        for c in items {
            let kind = c["type"].as_i64().unwrap_or(0);
            let custom = str_field(c, "custom_id", 100);
            if let Some(id) = &custom { if !ids.insert(id.clone()) { return Err(AppError::BadRequest(format!("custom_id {id} is used twice"))) } }
            match kind {
                2 => {
                    let style = c["style"].as_i64().unwrap_or(2);
                    if !(1..=5).contains(&style) { return Err(AppError::BadRequest("button style is 1-5".into())) }
                    let label = str_field(c, "label", 80);
                    let emoji = str_field(c, "emoji", 64);
                    if label.is_none() && emoji.is_none() { return Err(AppError::BadRequest("a button needs a label or an emoji".into())) }
                    let url = if style == 5 { Some(c["url"].as_str().filter(|u| u.starts_with("https://") || u.starts_with("http://")).ok_or_else(|| AppError::BadRequest("link buttons need an http(s) url".into()))?.to_string()) } else { None };
                    if style != 5 && custom.is_none() { return Err(AppError::BadRequest("buttons need a custom_id".into())) }
                    cleaned.push(json!({ "type": 2, "style": style, "label": label, "emoji": emoji, "custom_id": if style == 5 { None } else { custom }, "url": url, "disabled": c["disabled"].as_bool().unwrap_or(false) }));
                }
                3 => {
                    if items.len() != 1 { return Err(AppError::BadRequest("a select menu takes a whole row".into())) }
                    let custom = custom.ok_or_else(|| AppError::BadRequest("select menus need a custom_id".into()))?;
                    let opts: Vec<Value> = c["options"].as_array().cloned().unwrap_or_default().iter().take(25).filter_map(|o| {
                        let label = str_field(o, "label", 100)?; let value = str_field(o, "value", 100)?;
                        Some(json!({ "label": label, "value": value, "description": str_field(o, "description", 100), "emoji": str_field(o, "emoji", 64), "default": o["default"].as_bool().unwrap_or(false) }))
                    }).collect();
                    if opts.is_empty() { return Err(AppError::BadRequest("a select menu needs options".into())) }
                    let min = c["min_values"].as_u64().unwrap_or(1).min(25);
                    let max = c["max_values"].as_u64().unwrap_or(1).clamp(min.max(1), opts.len() as u64);
                    cleaned.push(json!({ "type": 3, "custom_id": custom, "placeholder": str_field(c, "placeholder", 150), "options": opts, "min_values": min, "max_values": max, "disabled": c["disabled"].as_bool().unwrap_or(false) }));
                }
                _ => return Err(AppError::BadRequest("components are buttons (2) or select menus (3)".into())),
            }
        }
        out.push(json!({ "type": 1, "components": cleaned }));
    }
    Ok(Value::Array(out))
}

/// A form (type 9 response): a title, a custom_id, and up to 5 text inputs (style 1 short, 2 paragraph).
fn clean_modal(v: &Value) -> AppResult<Value> {
    let title = str_field(v, "title", 45).ok_or_else(|| AppError::BadRequest("a form needs a title".into()))?;
    let custom = str_field(v, "custom_id", 100).ok_or_else(|| AppError::BadRequest("a form needs a custom_id".into()))?;
    let inputs: Vec<Value> = v["components"].as_array().into_iter().flatten().flat_map(|r| r["components"].as_array().cloned().unwrap_or_default()).collect();
    if inputs.is_empty() || inputs.len() > 5 { return Err(AppError::BadRequest("a form has 1 to 5 text inputs".into())) }
    let mut rows = Vec::new();
    for i in inputs {
        let id = str_field(&i, "custom_id", 100).ok_or_else(|| AppError::BadRequest("text inputs need a custom_id".into()))?;
        let label = str_field(&i, "label", 45).ok_or_else(|| AppError::BadRequest("text inputs need a label".into()))?;
        let max = i["max_length"].as_u64().unwrap_or(4000).clamp(1, 4000);
        rows.push(json!({ "type": 1, "components": [{ "type": 4, "custom_id": id, "label": label, "style": if i["style"].as_i64() == Some(2) { 2 } else { 1 },
            "required": i["required"].as_bool().unwrap_or(true), "min_length": i["min_length"].as_u64().unwrap_or(0).min(max), "max_length": max,
            "placeholder": str_field(&i, "placeholder", 100), "value": str_field(&i, "value", max as usize) }] }));
    }
    Ok(json!({ "title": title, "custom_id": custom, "components": rows }))
}

#[cfg(test)]
mod tests {
    use super::clean_components;
    use serde_json::json;
    #[test]
    fn components() {
        assert!(clean_components(&json!([{ "type": 1, "components": [{ "type": 2, "style": 1, "label": "Yes", "custom_id": "yes" }, { "type": 2, "style": 5, "label": "Docs", "url": "https://x.example" }] }])).is_ok());
        assert!(clean_components(&json!([{ "type": 1, "components": [{ "type": 2, "style": 1, "label": "No id" }] }])).is_err());
        assert!(clean_components(&json!([{ "type": 1, "components": [{ "type": 2, "style": 5, "label": "x", "url": "javascript:1" }] }])).is_err());
        assert!(clean_components(&json!([{ "type": 1, "components": [{ "type": 2, "style": 1, "label": "a", "custom_id": "d" }, { "type": 2, "style": 1, "label": "b", "custom_id": "d" }] }])).is_err());
    }
}
