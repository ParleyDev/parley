//! AutoMod: server rules checked on every message (keywords and regexes with an allow list, mention spam, link spam)
//! and on server nickname changes (name filter). Actions: block with a message, alert a channel, time the member out.
//! People who can manage the server are never filtered, nor roles/channels a rule exempts.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::Channel,
    perms::{self, has},
    state::AppState,
};
use axum::{extract::{Path, State}, http::StatusCode, routing::{get, patch}, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/automod", get(list).post(create))
        .route("/guilds/:id/automod/:rid", patch(update).delete(remove))
}

const COLS: &str = "id, guild_id, name, enabled, trigger, keywords, regexes, allow, mention_limit, block, block_message, alert_channel_id, timeout_secs, exempt_roles, exempt_channels, created_at";
const TRIGGERS: [&str; 4] = ["keyword", "mention_spam", "link_spam", "name"];

#[derive(Debug, Serialize, FromRow, Clone)]
pub struct Rule {
    pub id: Uuid,
    pub guild_id: Uuid,
    pub name: String,
    pub enabled: bool,
    pub trigger: String,
    pub keywords: Vec<String>,
    pub regexes: Vec<String>,
    pub allow: Vec<String>,
    pub mention_limit: i32,
    pub block: bool,
    pub block_message: String,
    pub alert_channel_id: Option<Uuid>,
    pub timeout_secs: i32,
    pub exempt_roles: Vec<Uuid>,
    pub exempt_channels: Vec<Uuid>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RuleInput {
    name: Option<String>,
    enabled: Option<bool>,
    trigger: Option<String>,
    keywords: Option<Vec<String>>,
    regexes: Option<Vec<String>>,
    allow: Option<Vec<String>>,
    mention_limit: Option<i32>,
    block: Option<bool>,
    block_message: Option<String>,
    #[serde(deserialize_with = "crate::routes::roles::deserialize_nullable_uuid")]
    alert_channel_id: Option<Option<Uuid>>,
    timeout_secs: Option<i32>,
    exempt_roles: Option<Vec<Uuid>>,
    exempt_channels: Option<Vec<Uuid>>,
}

async fn require_manage(state: &AppState, gid: Uuid, uid: Uuid) -> AppResult<()> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)
}

fn clean_list(v: &[String], max: usize, each: usize) -> Vec<String> {
    let mut out: Vec<String> = v.iter().map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()).map(|s| s.chars().take(each).collect()).collect();
    out.dedup();
    out.truncate(max);
    out
}

fn validate(i: &RuleInput) -> AppResult<()> {
    if let Some(t) = &i.trigger { if !TRIGGERS.contains(&t.as_str()) { return Err(AppError::BadRequest("Unknown trigger".into())) } }
    if let Some(rs) = &i.regexes {
        if rs.len() > 10 { return Err(AppError::BadRequest("Up to 10 regexes".into())) }
        for r in rs { if r.len() > 260 || regex::RegexBuilder::new(r).case_insensitive(true).size_limit(1 << 20).build().is_err() { return Err(AppError::BadRequest(format!("That regex doesn't work: {r}"))) } }
    }
    if i.mention_limit.map(|m| !(1..=50).contains(&m)).unwrap_or(false) { return Err(AppError::BadRequest("Mention limit is 1 to 50".into())) }
    if i.timeout_secs.map(|s| !(0..=7 * 86400).contains(&s)).unwrap_or(false) { return Err(AppError::BadRequest("Timeout is up to 7 days".into())) }
    Ok(())
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Vec<Rule>>> {
    require_manage(&state, gid, uid).await?;
    Ok(Json(sqlx::query_as::<_, Rule>(&format!("SELECT {COLS} FROM automod_rules WHERE guild_id = $1 ORDER BY created_at")).bind(gid).fetch_all(&state.db).await?))
}

async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(i): Json<RuleInput>) -> AppResult<(StatusCode, Json<Rule>)> {
    require_manage(&state, gid, uid).await?;
    validate(&i)?;
    let trigger = i.trigger.clone().ok_or(AppError::BadRequest("trigger is required".into()))?;
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM automod_rules WHERE guild_id = $1").bind(gid).fetch_one(&state.db).await?;
    if count >= 10 { return Err(AppError::BadRequest("A server can have up to 10 AutoMod rules".into())) }
    let id = Uuid::now_v7();
    let name = i.name.as_deref().map(str::trim).filter(|n| !n.is_empty()).unwrap_or(match trigger.as_str() { "mention_spam" => "Block mention spam", "link_spam" => "Block links", "name" => "Block bad nicknames", _ => "Block words" }).chars().take(100).collect::<String>();
    sqlx::query("INSERT INTO automod_rules (id, guild_id, name, trigger) VALUES ($1, $2, $3, $4)").bind(id).bind(gid).bind(&name).bind(&trigger).execute(&state.db).await?;
    let r = apply(&state, gid, id, &i).await?;
    crate::audit::guild(&state, gid, uid, "automod.create", "automod", Some(id), &r.name, json!({ "trigger": r.trigger })).await;
    Ok((StatusCode::CREATED, Json(r)))
}

async fn apply(state: &AppState, gid: Uuid, id: Uuid, i: &RuleInput) -> AppResult<Rule> {
    if let Some(Some(ch)) = i.alert_channel_id {
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM channels WHERE id = $1 AND guild_id = $2 AND kind = 'text'").bind(ch).bind(gid).fetch_optional(&state.db).await?;
        if ok.is_none() { return Err(AppError::BadRequest("Alerts go to a text channel in this server".into())) }
    }
    let r = sqlx::query_as::<_, Rule>(&format!(
        "UPDATE automod_rules SET name = COALESCE($3, name), enabled = COALESCE($4, enabled), keywords = COALESCE($5, keywords), regexes = COALESCE($6, regexes),
           allow = COALESCE($7, allow), mention_limit = COALESCE($8, mention_limit), block = COALESCE($9, block), block_message = COALESCE($10, block_message),
           alert_channel_id = CASE WHEN $11 THEN $12 ELSE alert_channel_id END, timeout_secs = COALESCE($13, timeout_secs),
           exempt_roles = COALESCE($14, exempt_roles), exempt_channels = COALESCE($15, exempt_channels)
         WHERE id = $1 AND guild_id = $2 RETURNING {COLS}"))
        .bind(id).bind(gid)
        .bind(i.name.as_ref().map(|n| n.trim().chars().take(100).collect::<String>()).filter(|n| !n.is_empty()))
        .bind(i.enabled)
        .bind(i.keywords.as_ref().map(|k| clean_list(k, 1000, 60)))
        .bind(i.regexes.as_ref().map(|k| k.iter().map(|r| r.trim().to_string()).filter(|r| !r.is_empty()).collect::<Vec<_>>()))
        .bind(i.allow.as_ref().map(|k| clean_list(k, 100, 60)))
        .bind(i.mention_limit)
        .bind(i.block)
        .bind(i.block_message.as_ref().map(|m| m.trim().chars().take(150).collect::<String>()))
        .bind(i.alert_channel_id.is_some()).bind(i.alert_channel_id.flatten())
        .bind(i.timeout_secs)
        .bind(&i.exempt_roles).bind(&i.exempt_channels)
        .fetch_optional(&state.db).await?
        .ok_or(AppError::NotFound("Rule not found".into()))?;
    Ok(r)
}

async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, rid)): Path<(Uuid, Uuid)>, Json(i): Json<RuleInput>) -> AppResult<Json<Rule>> {
    require_manage(&state, gid, uid).await?;
    validate(&i)?;
    if i.trigger.is_some() { return Err(AppError::BadRequest("A rule's trigger can't change; make a new rule".into())) }
    let r = apply(&state, gid, rid, &i).await?;
    crate::audit::guild(&state, gid, uid, "automod.update", "automod", Some(rid), &r.name, json!({ "enabled": r.enabled })).await;
    Ok(Json(r))
}

async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, rid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    require_manage(&state, gid, uid).await?;
    let gone: Option<(String,)> = sqlx::query_as("DELETE FROM automod_rules WHERE id = $1 AND guild_id = $2 RETURNING name").bind(rid).bind(gid).fetch_optional(&state.db).await?;
    let Some((name,)) = gone else { return Err(AppError::NotFound("Rule not found".into())) };
    crate::audit::guild(&state, gid, uid, "automod.delete", "automod", Some(rid), &name, json!({})).await;
    Ok(StatusCode::NO_CONTENT)
}

/// `*word*` substring, `word*` prefix, `*word` suffix, `word` whole word (all case-insensitive).
fn keyword_hits(text: &str, kw: &str) -> bool {
    let t = text.to_lowercase();
    let (pre, suf) = (kw.starts_with('*'), kw.ends_with('*') && kw.len() > 1);
    let core = kw.trim_matches('*');
    if core.is_empty() { return false }
    let words: Vec<&str> = t.split(|c: char| !c.is_alphanumeric() && c != '\'').filter(|w| !w.is_empty()).collect();
    match (pre, suf) {
        (true, true) => t.contains(core),
        (false, true) => words.iter().any(|w| w.starts_with(core)),
        (true, false) => words.iter().any(|w| w.ends_with(core)),
        (false, false) => if core.contains(' ') { t.contains(core) } else { words.iter().any(|w| *w == core) },
    }
}

/// The first thing in `text` a keyword rule objects to (None = fine). Allow-list words and phrases are cut out first.
pub fn keyword_match(r: &Rule, text: &str) -> Option<String> {
    let mut t = text.to_lowercase();
    for a in &r.allow { t = t.replace(a.as_str(), " "); }
    if let Some(k) = r.keywords.iter().find(|k| keyword_hits(&t, k)) { return Some(k.clone()) }
    for re in &r.regexes {
        if let Ok(rx) = regex::RegexBuilder::new(re).case_insensitive(true).size_limit(1 << 20).build() {
            if let Some(m) = rx.find(&t) { return Some(m.as_str().to_string()) }
        }
    }
    None
}

fn link_match(r: &Rule, text: &str) -> Option<String> {
    for word in text.split_whitespace() {
        let w = word.trim_matches(|c: char| "<>()[]\"'".contains(c));
        let Ok(u) = url::Url::parse(w) else { continue };
        if !matches!(u.scheme(), "http" | "https") { continue }
        let host = u.host_str().unwrap_or("").trim_start_matches("www.").to_lowercase();
        if !r.allow.iter().any(|d| host == *d || host.ends_with(&format!(".{d}"))) { return Some(host) }
    }
    None
}

async fn exempt(state: &AppState, r: &Rule, c: Option<&Channel>, uid: Uuid) -> bool {
    if let Some(c) = c { if r.exempt_channels.contains(&c.id) || c.parent_id.map(|p| r.exempt_channels.contains(&p)).unwrap_or(false) { return true } }
    if r.exempt_roles.is_empty() { return false }
    let roles: Vec<(Uuid,)> = sqlx::query_as("SELECT role_id FROM member_roles WHERE guild_id = $1 AND user_id = $2").bind(r.guild_id).bind(uid).fetch_all(&state.db).await.unwrap_or_default();
    roles.iter().any(|(rid,)| r.exempt_roles.contains(rid))
}

/// What a rule does once it matched: alert, time out, audit; Err(Blocked) when it blocks.
async fn act(state: &AppState, r: &Rule, c: Option<&Channel>, uid: Uuid, what: &str, matched: &str) -> AppResult<()> {
    let name: String = sqlx::query_as::<_, (String,)>("SELECT username FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await.map(|x| x.0).unwrap_or_default();
    if let Some(alert) = r.alert_channel_id {
        if let Ok(ch) = sqlx::query_as::<_, Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS)).bind(alert).fetch_one(&state.db).await {
            let place = c.map(|c| format!(" in <#{}>", c.id)).unwrap_or_default();
            let snippet: String = what.chars().take(300).collect();
            let text = format!("**AutoMod** · {} {}<@{}>{}: “{}” (matched “{}”)", r.name, if r.block { "blocked " } else { "flagged " }, uid, place, snippet, matched);
            let _ = crate::routes::channels::system_message(state, &ch, uid, "automod_alert", &text, vec![], None, None).await;
        }
    }
    if r.timeout_secs > 0 {
        let _ = sqlx::query("UPDATE guild_members SET timeout_until = now() + make_interval(secs => $3) WHERE guild_id = $1 AND user_id = $2")
            .bind(r.guild_id).bind(uid).bind(r.timeout_secs as f64).execute(&state.db).await;
        if let Ok(m) = crate::routes::guilds::fetch_member(&state.db, r.guild_id, uid).await { state.hub.emit_guild(r.guild_id, "GUILD_MEMBER_UPDATE", json!(m)); }
    }
    crate::audit::guild(state, r.guild_id, uid, if r.block { "automod.block" } else { "automod.flag" }, "user", Some(uid), &name, json!({ "rule": r.name, "matched": matched })).await;
    if r.block {
        let msg = if r.block_message.is_empty() { "This message was blocked by the server's AutoMod.".to_string() } else { r.block_message.clone() };
        return Err(AppError::Blocked(msg));
    }
    Ok(())
}

async fn rules_for(state: &AppState, gid: Uuid, triggers: &[&str]) -> Vec<Rule> {
    sqlx::query_as::<_, Rule>(&format!("SELECT {COLS} FROM automod_rules WHERE guild_id = $1 AND enabled AND trigger = ANY($2)"))
        .bind(gid).bind(triggers.iter().map(|s| s.to_string()).collect::<Vec<_>>()).fetch_all(&state.db).await.unwrap_or_default()
}

/// Check a message about to be posted in `c` (a server channel) by `uid` with channel permissions `p`.
pub async fn check_message(state: &AppState, c: &Channel, uid: Uuid, p: u64, content: &str, mentions: usize) -> AppResult<()> {
    let Some(gid) = c.guild_id else { return Ok(()) };
    if has(p, perms::MANAGE_GUILD) || content.is_empty() && mentions == 0 { return Ok(()) }
    for r in rules_for(state, gid, &["keyword", "mention_spam", "link_spam"]).await {
        let hit = match r.trigger.as_str() {
            "keyword" => keyword_match(&r, content),
            "mention_spam" => (mentions as i32 >= r.mention_limit).then(|| format!("{mentions} mentions")),
            "link_spam" => link_match(&r, content),
            _ => None,
        };
        if let Some(m) = hit { if !exempt(state, &r, Some(c), uid).await { act(state, &r, Some(c), uid, content, &m).await?; } }
    }
    Ok(())
}

/// Check a server nickname (or display name) someone is about to take.
pub async fn check_name(state: &AppState, gid: Uuid, uid: Uuid, p: u64, name: &str) -> AppResult<()> {
    if has(p, perms::MANAGE_GUILD) { return Ok(()) }
    for r in rules_for(state, gid, &["name"]).await {
        if let Some(m) = keyword_match(&r, name) { if !exempt(state, &r, None, uid).await { act(state, &r, None, uid, name, &m).await?; } }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rule(keywords: &[&str], allow: &[&str], regexes: &[&str]) -> Rule {
        Rule { id: Uuid::nil(), guild_id: Uuid::nil(), name: "r".into(), enabled: true, trigger: "keyword".into(), keywords: keywords.iter().map(|s| s.to_string()).collect(),
            regexes: regexes.iter().map(|s| s.to_string()).collect(), allow: allow.iter().map(|s| s.to_string()).collect(), mention_limit: 5, block: true, block_message: String::new(),
            alert_channel_id: None, timeout_secs: 0, exempt_roles: vec![], exempt_channels: vec![], created_at: chrono::Utc::now() }
    }
    #[test]
    fn keywords() {
        let r = rule(&["darn", "heck*", "*bad", "*oops*", "free money"], &["darnell"], &[]);
        assert!(keyword_match(&r, "well DARN it").is_some());
        assert!(keyword_match(&r, "hi darnell").is_none(), "allow list wins, whole words only");
        assert!(keyword_match(&r, "what the heckin").is_some());
        assert!(keyword_match(&r, "so notbad").is_some());
        assert!(keyword_match(&r, "whoopsie").is_some());
        assert!(keyword_match(&r, "get FREE MONEY now").is_some());
        assert!(keyword_match(&r, "a fine day").is_none());
        let rx = rule(&[], &[], &[r"c[a@]sh\s*app"]);
        assert!(keyword_match(&rx, "send via C@sh App").is_some());
    }
    #[test]
    fn links() {
        let mut r = rule(&[], &["github.com"], &[]);
        r.trigger = "link_spam".into();
        assert!(link_match(&r, "see https://github.com/x and https://gist.github.com/y").is_none());
        assert_eq!(link_match(&r, "click http://evil.example/win").as_deref(), Some("evil.example"));
    }
}
