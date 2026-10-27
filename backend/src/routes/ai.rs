//! Message translation and AI channel summaries, both through services the instance admin configures (Instance
//! Settings): a LibreTranslate-compatible server for translation, an OpenAI-compatible chat endpoint for summaries.
//! Nothing is sent anywhere unless one is set up; servers can turn summaries off.

use crate::{auth::AuthUser, error::{AppError, AppResult}, state::AppState};
use axum::{extract::{Path, State}, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/messages/:mid/translate", post(translate).route_layer(axum::middleware::from_fn(crate::ratelimit::rl_messages)))
        .route("/channels/:id/summaries", get(summaries))
}

#[derive(Deserialize)]
struct TranslateReq { target: String }

fn lang_ok(l: &str) -> bool {
    let (base, region) = match l.split_once('-') { Some((b, r)) => (b, Some(r)), None => (l, None) };
    (2..=3).contains(&base.len()) && base.chars().all(|c| c.is_ascii_lowercase())
        && region.map(|r| (2..=4).contains(&r.len()) && r.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or(true)
}

/// `POST /channels/:id/messages/:mid/translate {target}`: the message in `target` (a language code), cached.
async fn translate(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((cid, mid)): Path<(Uuid, Uuid)>, Json(req): Json<TranslateReq>) -> AppResult<Json<Value>> {
    crate::routes::channels::require_channel(&state.db, cid, uid).await?;
    let target = req.target.trim().to_lowercase();
    if !lang_ok(&target) { return Err(AppError::BadRequest("target must be a language code like en or pt-br".into())); }
    let row: Option<(String,)> = sqlx::query_as("SELECT content FROM messages WHERE id = $1 AND channel_id = $2").bind(mid).bind(cid).fetch_optional(&state.db).await?;
    let (content,) = row.ok_or_else(|| AppError::NotFound("Message not found".into()))?;
    if content.trim().is_empty() { return Err(AppError::BadRequest("Nothing to translate".into())); }
    let hash = format!("{:x}", Sha256::digest(content.as_bytes()));
    let cached: Option<(String, String)> = sqlx::query_as("SELECT text, source_lang FROM message_translations WHERE message_id = $1 AND lang = $2 AND content_hash = $3")
        .bind(mid).bind(&target).bind(&hash).fetch_optional(&state.db).await?;
    if let Some((text, source)) = cached { return Ok(Json(json!({ "text": text, "source_lang": source, "target": target, "cached": true }))); }
    let s = crate::routes::admin::load_settings(&state.db).await?;
    if s.translate_url.trim().is_empty() { return Err(AppError::BadRequest("Translation is not set up on this server".into())); }
    // LibreTranslate wants the base language ("pt", not "pt-br").
    let to = target.split('-').next().unwrap_or(&target).to_string();
    let mut body = json!({ "q": content, "source": "auto", "target": to, "format": "text" });
    if !s.translate_api_key.is_empty() { body["api_key"] = json!(s.translate_api_key); }
    let resp = reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e| AppError::Other(e.into()))?
        .post(format!("{}/translate", s.translate_url.trim_end_matches('/'))).json(&body).send().await
        .map_err(|e| AppError::BadRequest(format!("The translation service didn't answer: {e}")))?;
    if !resp.status().is_success() { return Err(AppError::BadRequest(format!("The translation service refused ({})", resp.status()))); }
    let v: Value = resp.json().await.map_err(|e| AppError::BadRequest(format!("Unreadable translation: {e}")))?;
    let text = v["translatedText"].as_str().unwrap_or("").chars().take(8000).collect::<String>();
    let source = v["detectedLanguage"]["language"].as_str().unwrap_or("").to_string();
    sqlx::query("INSERT INTO message_translations (message_id, lang, content_hash, source_lang, text) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (message_id, lang) DO UPDATE SET content_hash = EXCLUDED.content_hash, source_lang = EXCLUDED.source_lang, text = EXCLUDED.text, created_at = now()")
        .bind(mid).bind(&target).bind(&hash).bind(&source).bind(&text).execute(&state.db).await?;
    Ok(Json(json!({ "text": text, "source_lang": source, "target": target, "cached": false })))
}

#[derive(Serialize, Clone)]
struct Topic { title: String, summary: String, message_ids: Vec<Uuid>, people: Vec<Uuid> }

/// Summaries per channel, kept until a new message arrives or ten minutes pass.
static CACHE: Mutex<Option<HashMap<Uuid, (Uuid, Vec<Topic>, Instant)>>> = Mutex::new(None);

/// `GET /channels/:id/summaries`: the last two days of a server text channel as a few topics, newest first.
async fn summaries(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(cid): Path<Uuid>) -> AppResult<Json<Vec<Topic>>> {
    let c = crate::routes::channels::require_channel(&state.db, cid, uid).await?;
    let Some(gid) = c.guild_id else { return Err(AppError::BadRequest("Summaries are for server channels".into())) };
    if c.kind != "text" { return Err(AppError::BadRequest("Summaries are for text channels".into())); }
    let (on,): (bool,) = sqlx::query_as("SELECT summaries_enabled FROM guilds WHERE id = $1").bind(gid).fetch_one(&state.db).await?;
    if !on { return Err(AppError::BadRequest("This server has summaries turned off".into())); }
    let s = crate::routes::admin::load_settings(&state.db).await?;
    if !s.summaries { return Err(AppError::BadRequest("Summaries are not set up on this server".into())); }
    let rows: Vec<(Uuid, Uuid, String, String)> = sqlx::query_as(
        "SELECT m.id, m.author_id, COALESCE(NULLIF(gm.nickname, ''), u.display_name), m.content FROM messages m JOIN users u ON u.id = m.author_id
         LEFT JOIN guild_members gm ON gm.guild_id = $2 AND gm.user_id = m.author_id
         WHERE m.channel_id = $1 AND m.created_at > now() - interval '48 hours' AND m.content <> '' AND NOT u.bot ORDER BY m.id DESC LIMIT 150",
    ).bind(cid).bind(gid).fetch_all(&state.db).await?;
    if rows.len() < 5 { return Ok(Json(Vec::new())); }
    let last = rows[0].0;
    if let Ok(g) = CACHE.lock() {
        if let Some((l, t, at)) = g.as_ref().and_then(|m| m.get(&cid)) { if *l == last && at.elapsed() < Duration::from_secs(600) { return Ok(Json(t.clone())); } }
    }
    let transcript: String = rows.iter().rev().map(|(id, _, name, text)| format!("[{id}] {name}: {}", text.chars().take(500).collect::<String>().replace('\n', " "))).collect::<Vec<_>>().join("\n");
    let system = "You summarize a chat channel into conversation topics. Reply with only a JSON array (no prose, no code fence) of at most 5 objects: {\"title\": short topic title (max 8 words), \"summary\": one or two plain sentences, \"message_ids\": the ids (the bracketed values) of the messages that belong to it, oldest first}. Newest topic first. Skip small talk with nothing to summarize. Never invent facts.";
    let mut req = reqwest::Client::builder().timeout(Duration::from_secs(60)).build().map_err(|e| AppError::Other(e.into()))?
        .post(format!("{}/v1/chat/completions", s.llm_url.trim_end_matches('/')))
        .json(&json!({ "model": s.llm_model, "temperature": 0.2, "messages": [{ "role": "system", "content": system }, { "role": "user", "content": transcript }] }));
    if !s.llm_api_key.is_empty() { req = req.bearer_auth(&s.llm_api_key); }
    let resp = req.send().await.map_err(|e| AppError::BadRequest(format!("The summary service didn't answer: {e}")))?;
    if !resp.status().is_success() { return Err(AppError::BadRequest(format!("The summary service refused ({})", resp.status()))); }
    let v: Value = resp.json().await.map_err(|e| AppError::BadRequest(format!("Unreadable summary: {e}")))?;
    let raw = v["choices"][0]["message"]["content"].as_str().unwrap_or("[]");
    // Models sometimes wrap JSON in a code fence anyway.
    let raw = raw.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    // Read leniently: a model may invent ids or leave fields out; keep what makes sense.
    let parsed: Vec<Value> = serde_json::from_str(raw).map_err(|_| AppError::BadRequest("The summary service returned something unreadable".into()))?;
    let mut topics: Vec<Topic> = parsed.iter().map(|t| Topic {
        title: t["title"].as_str().unwrap_or("").trim().to_string(),
        summary: t["summary"].as_str().unwrap_or("").trim().to_string(),
        message_ids: t["message_ids"].as_array().into_iter().flatten().filter_map(|v| v.as_str()?.parse().ok()).collect(),
        people: Vec::new(),
    }).collect();
    let known: HashMap<Uuid, Uuid> = rows.iter().map(|(id, author, _, _)| (*id, *author)).collect();
    for t in &mut topics {
        t.title = t.title.chars().take(120).collect();
        t.summary = t.summary.chars().take(600).collect();
        t.message_ids.retain(|id| known.contains_key(id));
        let mut seen = HashSet::new();
        t.people = t.message_ids.iter().filter_map(|id| known.get(id).copied()).filter(|a| seen.insert(*a)).take(10).collect();
    }
    topics.retain(|t| !t.message_ids.is_empty() && !t.title.is_empty());
    topics.truncate(5);
    if let Ok(mut g) = CACHE.lock() { g.get_or_insert_with(HashMap::new).insert(cid, (last, topics.clone(), Instant::now())); }
    Ok(Json(topics))
}

#[cfg(test)]
mod tests {
    #[test]
    fn langs() {
        for ok in ["en", "pt-br", "zh-hans", "fil"] { assert!(super::lang_ok(ok), "{ok}"); }
        for bad in ["", "e", "english", "EN", "en-", "en-toolong", "../x"] { assert!(!super::lang_ok(bad), "{bad}"); }
    }
}
