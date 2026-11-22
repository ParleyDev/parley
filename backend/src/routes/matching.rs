//! Matching uploads against known abuse material, and what happens when one matches.
//!
//! Two ways to match, both off until an administrator turns them on (Admin Console → Safety → Known-material matching):
//! - a list of SHA-256 values (`blocked_file_hashes`), loaded by the administrator from a list they are entitled to.
//!   It catches byte-identical copies only;
//! - a matching service: an HTTP endpoint the operator runs or subscribes to (an adapter in front of whichever
//!   perceptual-hash service they are vetted for). Parley sends it the file and acts on its answer. The contract is in
//!   docs/self-hosting/media-matching.md; nothing about any one vendor is built in.
//!
//! Every path that stores media calls [`check`] before the file can be served (next to the antivirus). On a match the
//! upload is refused with a plain message, the file goes to quarantine (`UPLOAD_DIR/quarantine/<id>`, which no route
//! serves) as evidence, the account is suspended, and a row in `media_matches` records who, where and what it matched.
//! Review is by people holding `SafetyMatchReview` (trust-and-safety leads and legal), who see the record and never
//! the file: they note the report filed with the authority, or release a false match (which restores the account and
//! destroys the file). Nothing here logs or returns the content.

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{require_perm, Perm},
    state::AppState,
};
use axum::{extract::{Path, Query, State}, routing::{get, patch, post}, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/safety/matching", get(get_config).put(put_config))
        .route("/admin/safety/matching/hashes", post(add_hashes).delete(remove_hashes))
        .route("/admin/safety/matching/test", post(test_service))
        .route("/admin/safety/matches", get(list_matches))
        .route("/admin/safety/matches/:id", patch(decide_match))
}

/// What the administrator has set (stored as `match_*` keys in `instance_settings`).
#[derive(Debug, Clone, Default)]
pub struct Config {
    /// The matching service's address; empty = not used.
    pub service_url: String,
    /// Sent as a bearer token to the service.
    pub service_token: String,
    /// An unreachable or failing service refuses the upload (instead of letting it through unchecked).
    pub fail_closed: bool,
}

pub async fn load_config(db: &PgPool) -> Config {
    let rows: Vec<(String, Value)> = sqlx::query_as("SELECT key, value FROM instance_settings WHERE key LIKE 'match\\_%'").fetch_all(db).await.unwrap_or_default();
    let mut c = Config::default();
    for (k, v) in rows {
        match k.as_str() {
            "match_service_url" => c.service_url = v.as_str().unwrap_or("").to_string(),
            "match_service_token" => c.service_token = v.as_str().unwrap_or("").to_string(),
            "match_fail_closed" => c.fail_closed = v.as_bool().unwrap_or(false),
            _ => {}
        }
    }
    c
}

/// Where an upload was headed, for the record of a match.
#[derive(Debug, Clone, Default)]
pub struct Ctx<'a> {
    pub user_id: Uuid,
    /// "attachment", "image" (profile pictures, banners, icons, emoji, stickers), "sound".
    pub surface: &'a str,
    pub channel_id: Option<Uuid>,
    pub filename: &'a str,
    pub content_type: &'a str,
}

struct Hit { source: String, reference: String, category: String }

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// What the matching service answered.
#[derive(Deserialize)]
struct ServiceReply {
    #[serde(rename = "match")]
    matched: bool,
    #[serde(default)]
    source: String,
    #[serde(default)]
    reference: String,
    #[serde(default)]
    category: String,
}

/// Ask the matching service about a file. Err = it could not be asked or answered something else.
async fn ask_service(cfg: &Config, bytes: &[u8], sha: &str, surface: &str, content_type: &str) -> Result<Option<Hit>, String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
    let mut req = client.post(cfg.service_url.trim())
        .header("Content-Type", if content_type.is_empty() { "application/octet-stream" } else { content_type })
        .header("X-Parley-Sha256", sha)
        .header("X-Parley-Surface", surface)
        .body(bytes.to_vec());
    if !cfg.service_token.is_empty() { req = req.bearer_auth(&cfg.service_token); }
    let res = req.send().await.map_err(|e| format!("request failed: {e}"))?;
    if !res.status().is_success() { return Err(format!("status {}", res.status())); }
    let reply: ServiceReply = res.json().await.map_err(|e| format!("unreadable answer: {e}"))?;
    Ok(reply.matched.then(|| Hit {
        source: if reply.source.trim().is_empty() { "service".into() } else { format!("service:{}", clip(&reply.source, 60)) },
        reference: clip(&reply.reference, 200),
        category: clip(&reply.category, 60),
    }))
}

fn clip(s: &str, n: usize) -> String { s.trim().chars().take(n).collect() }

/// Only pictures and video go to the matching service; the hash list is checked for every file.
fn service_applies(content_type: &str) -> bool { content_type.starts_with("image/") || content_type.starts_with("video/") }

/// Gate an upload: Ok(()) when it matches nothing (or matching is off); the upload's refusal otherwise, after the
/// match has been recorded, the file quarantined and the account suspended.
pub async fn check(state: &AppState, bytes: &[u8], ctx: Ctx<'_>) -> AppResult<()> {
    let sha = sha256_hex(bytes);
    let listed: Option<(String,)> = sqlx::query_as("SELECT source FROM blocked_file_hashes WHERE sha256 = $1").bind(&sha).fetch_optional(&state.db).await?;
    let mut hit = listed.map(|(source,)| Hit { source: if source.is_empty() { "hash-list".into() } else { format!("hash-list:{source}") }, reference: String::new(), category: String::new() });
    if hit.is_none() {
        let cfg = load_config(&state.db).await;
        if !cfg.service_url.trim().is_empty() && service_applies(ctx.content_type) {
            match ask_service(&cfg, bytes, &sha, ctx.surface, ctx.content_type).await {
                Ok(h) => hit = h,
                Err(e) => {
                    tracing::error!(surface = ctx.surface, error = %e, "matching service failed");
                    if cfg.fail_closed { return Err(AppError::BadRequest("Upload refused: a required safety check is unavailable. Try again later.".into())); }
                }
            }
        }
    }
    let Some(hit) = hit else { return Ok(()) };
    record_match(state, bytes, &sha, &ctx, &hit).await;
    // The same words whatever matched: nothing here tells the sender what was recognised or how.
    Err(AppError::BadRequest("This file can't be uploaded.".into()))
}

/// Quarantine the file, write the record, suspend the account. Best effort at each step: a failure to keep the file
/// must not stop the account being suspended or the record being written.
async fn record_match(state: &AppState, bytes: &[u8], sha: &str, ctx: &Ctx<'_>, hit: &Hit) {
    let id = Uuid::now_v7();
    let dir = state.config.upload_dir.join("quarantine");
    let quarantined = async {
        tokio::fs::create_dir_all(&dir).await?;
        let path = dir.join(id.to_string());
        tokio::fs::write(&path, bytes).await?;
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; let _ = tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).await; }
        Ok::<(), std::io::Error>(())
    }.await.map_err(|e| tracing::error!(error = %e, "could not quarantine a matched upload")).is_ok();
    let guild_id: Option<Uuid> = match ctx.channel_id {
        Some(c) => sqlx::query_as::<_, (Option<Uuid>,)>("SELECT guild_id FROM channels WHERE id = $1").bind(c).fetch_optional(&state.db).await.ok().flatten().and_then(|r| r.0),
        None => None,
    };
    let username: String = sqlx::query_as::<_, (String,)>("SELECT username FROM users WHERE id = $1").bind(ctx.user_id).fetch_optional(&state.db).await.ok().flatten().map(|r| r.0).unwrap_or_default();
    // Administrators are not suspended by a machine: the match is recorded and a person decides.
    let is_admin: bool = sqlx::query_as::<_, (bool,)>("SELECT is_admin FROM users WHERE id = $1").bind(ctx.user_id).fetch_optional(&state.db).await.ok().flatten().map(|r| r.0).unwrap_or(false);
    let suspended = !is_admin && sqlx::query("UPDATE users SET suspended_at = now() WHERE id = $1 AND suspended_at IS NULL").bind(ctx.user_id).execute(&state.db).await.map(|r| r.rows_affected() == 1).unwrap_or(false);
    let (ip, ua) = audit::client();
    if let Err(e) = sqlx::query(
        "INSERT INTO media_matches (id, user_id, username, surface, channel_id, guild_id, filename, content_type, size, sha256, source, reference, category, ip, user_agent, quarantined, suspended)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)",
    )
    .bind(id).bind(ctx.user_id).bind(&username).bind(ctx.surface).bind(ctx.channel_id).bind(guild_id).bind(clip(ctx.filename, 255)).bind(ctx.content_type)
    .bind(bytes.len() as i64).bind(sha).bind(&hit.source).bind(&hit.reference).bind(&hit.category).bind(ip).bind(clip(&ua, 400)).bind(quarantined).bind(suspended)
    .execute(&state.db).await
    {
        tracing::error!(error = %e, "could not record a matched upload");
    }
    if !is_admin {
        state.hub.session_forget(ctx.user_id);
        state.hub.emit_users(vec![ctx.user_id], "SESSION_REVOKED", json!({ "reason": "Your account has been suspended." }));
        state.hub.voice_evict(|v| v.user_id == ctx.user_id);
    }
    crate::metrics::METRICS.media_matched.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let text = format!("🚨 An upload by **{}** matched known abuse material ({}). It was quarantined{}.", crate::notify::name(&username), ctx.surface,
        if suspended { " and the account suspended" } else if is_admin { "; the account is an admin's and was not suspended" } else { "" });
    crate::notify::send(state, crate::notify::Event::new("safety", "safety.match", text).link("Matched uploads", "/admin/matches").user(ctx.user_id));
    tracing::warn!(match_id = %id, surface = ctx.surface, source = %hit.source, "upload matched known abuse material: quarantined");
}

// ---- administration: the matching setup (InstanceManage) ----

async fn hash_counts(db: &PgPool) -> AppResult<Vec<Value>> {
    let rows: Vec<(String, i64)> = sqlx::query_as("SELECT source, COUNT(*) FROM blocked_file_hashes GROUP BY source ORDER BY source").fetch_all(db).await?;
    Ok(rows.into_iter().map(|(source, count)| json!({ "source": source, "count": count })).collect())
}

async fn config_json(state: &AppState) -> AppResult<Value> {
    let c = load_config(&state.db).await;
    let lists = hash_counts(&state.db).await?;
    let total: i64 = lists.iter().filter_map(|l| l["count"].as_i64()).sum();
    let (open,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM media_matches WHERE status = 'open'").fetch_one(&state.db).await?;
    // The token is never sent back: only whether one is set.
    Ok(json!({ "service_url": c.service_url, "service_token_set": !c.service_token.is_empty(), "fail_closed": c.fail_closed, "hash_lists": lists, "hash_total": total, "open_matches": open, "active": total > 0 || !c.service_url.trim().is_empty() }))
}

async fn get_config(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    Ok(Json(config_json(&state).await?))
}

#[derive(Deserialize)]
struct PutConfig {
    service_url: String,
    /// Absent = keep the stored token; "" = remove it.
    service_token: Option<String>,
    fail_closed: bool,
}

async fn put_config(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<PutConfig>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let url = req.service_url.trim().to_string();
    if !url.is_empty() && !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::BadRequest("The matching service address must start with https:// (or http:// for one on your own network)".into()));
    }
    let before = load_config(&state.db).await;
    let mut set: Vec<(&str, Value)> = vec![("match_service_url", json!(url)), ("match_fail_closed", json!(req.fail_closed))];
    if let Some(t) = &req.service_token { set.push(("match_service_token", json!(t.trim()))); }
    for (k, v) in set {
        sqlx::query("INSERT INTO instance_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").bind(k).bind(v).execute(&state.db).await?;
    }
    let mut changed = serde_json::Map::new();
    if before.service_url != url { changed.insert("service_url".into(), json!(url)); }
    if before.fail_closed != req.fail_closed { changed.insert("fail_closed".into(), json!(req.fail_closed)); }
    if let Some(t) = &req.service_token { if before.service_token != t.trim() { changed.insert("service_token".into(), json!(if t.trim().is_empty() { "cleared" } else { "set" })); } }
    if !changed.is_empty() { audit::record(&state, uid, "safety.matching.update", "instance", None, "", Value::Object(changed)).await; }
    Ok(Json(config_json(&state).await?))
}

#[derive(Deserialize)]
struct AddHashes {
    /// The list these came from, in the administrator's words (shown with a match; e.g. the name of the feed).
    #[serde(default)]
    source: String,
    /// SHA-256 values in hex, separated by anything that is not a hex digit (one per line, commas, a CSV column).
    hashes: String,
}

async fn add_hashes(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<AddHashes>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let source = clip(&req.source, 60);
    let mut good: Vec<String> = Vec::new();
    let mut invalid = 0usize;
    for tok in req.hashes.split(|c: char| !c.is_ascii_hexdigit()).filter(|t| !t.is_empty()) {
        if tok.len() == 64 { good.push(tok.to_ascii_lowercase()); } else { invalid += 1; }
    }
    good.sort(); good.dedup();
    if good.len() > 200_000 { return Err(AppError::BadRequest("At most 200,000 hashes at a time".into())); }
    let mut added = 0u64;
    for chunk in good.chunks(5000) {
        added += sqlx::query("INSERT INTO blocked_file_hashes (sha256, source, added_by) SELECT h, $2, $3 FROM unnest($1::text[]) h ON CONFLICT (sha256) DO NOTHING")
            .bind(chunk).bind(&source).bind(uid).execute(&state.db).await?.rows_affected();
    }
    // The hashes themselves are not written to the audit log: only how many, and from which list.
    audit::record(&state, uid, "safety.matching.hashes_add", "instance", None, "", json!({ "source": source, "given": good.len(), "added": added, "invalid": invalid })).await;
    let mut out = config_json(&state).await?;
    out["added"] = json!(added); out["already_listed"] = json!(good.len() as u64 - added); out["invalid"] = json!(invalid);
    Ok(Json(out))
}

#[derive(Deserialize)]
struct RemoveHashes { source: String }

async fn remove_hashes(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<RemoveHashes>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let removed = sqlx::query("DELETE FROM blocked_file_hashes WHERE source = $1").bind(&q.source).execute(&state.db).await?.rows_affected();
    audit::record(&state, uid, "safety.matching.hashes_remove", "instance", None, "", json!({ "source": q.source, "removed": removed })).await;
    let mut out = config_json(&state).await?;
    out["removed"] = json!(removed);
    Ok(Json(out))
}

/// A one-pixel PNG: something harmless to send when checking the matching service answers as the contract says.
pub const PROBE_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
];

/// `POST /admin/safety/matching/test`: send a harmless picture to the configured service and say what came back.
async fn test_service(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::InstanceManage).await?;
    let cfg = load_config(&state.db).await;
    if cfg.service_url.trim().is_empty() { return Err(AppError::BadRequest("No matching service address is set".into())); }
    Ok(Json(match ask_service(&cfg, PROBE_PNG, &sha256_hex(PROBE_PNG), "test", "image/png").await {
        Ok(None) => json!({ "ok": true, "message": "The service answered: no match for the test picture." }),
        Ok(Some(_)) => json!({ "ok": false, "message": "The service answered that the test picture (a single blank pixel) matches. Check that it follows the contract." }),
        Err(e) => json!({ "ok": false, "message": format!("The service could not be used: {e}") }),
    }))
}

// ---- administration: the review queue (SafetyMatchReview) ----

#[derive(Serialize, sqlx::FromRow)]
struct MatchRow {
    id: Uuid,
    user_id: Option<Uuid>,
    username: String,
    surface: String,
    channel_id: Option<Uuid>,
    guild_id: Option<Uuid>,
    filename: String,
    content_type: String,
    size: i64,
    sha256: String,
    source: String,
    reference: String,
    category: String,
    ip: String,
    user_agent: String,
    quarantined: bool,
    suspended: bool,
    status: String,
    report_ref: String,
    reported_at: Option<chrono::DateTime<chrono::Utc>>,
    note: String,
    legal_hold: bool,
    created_at: chrono::DateTime<chrono::Utc>,
    decided_by: Option<Uuid>,
    decided_at: Option<chrono::DateTime<chrono::Utc>>,
}

const MATCH_COLS: &str = "id, user_id, username, surface, channel_id, guild_id, filename, content_type, size, sha256, source, reference, category, ip, user_agent, quarantined, suspended, status, report_ref, reported_at, note, legal_hold, created_at, decided_by, decided_at";

#[derive(Deserialize)]
struct ListQ { status: Option<String> }

async fn list_matches(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<ListQ>) -> AppResult<Json<Vec<MatchRow>>> {
    require_perm(&state, uid, Perm::SafetyMatchReview).await?;
    let status = q.status.unwrap_or_default();
    let rows: Vec<MatchRow> = sqlx::query_as(&format!("SELECT {MATCH_COLS} FROM media_matches WHERE ($1 = '' OR status = $1) ORDER BY (status = 'open') DESC, created_at DESC LIMIT 200")).bind(&status).fetch_all(&state.db).await?;
    audit::record(&state, uid, "safety.matches.view", "instance", None, "", json!({ "status": status, "rows": rows.len() })).await;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct Decide {
    /// "reported" (a report was filed: `report_ref` is its reference), "release" (a false match), "close",
    /// "hold" / "unhold" (legal hold), "destroy" (the quarantined file, once the match is closed and not on hold).
    action: String,
    #[serde(default)]
    report_ref: String,
    #[serde(default)]
    note: String,
}

async fn decide_match(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<Decide>) -> AppResult<Json<MatchRow>> {
    require_perm(&state, uid, Perm::SafetyMatchReview).await?;
    let row: MatchRow = sqlx::query_as(&format!("SELECT {MATCH_COLS} FROM media_matches WHERE id = $1")).bind(id).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("No such match".into()))?;
    let note = clip(&req.note, 1000);
    let file = state.config.upload_dir.join("quarantine").join(id.to_string());
    match req.action.as_str() {
        "reported" => {
            let r = clip(&req.report_ref, 200);
            if r.is_empty() { return Err(AppError::BadRequest("Enter the reference the authority gave for the report".into())); }
            if row.status == "released" { return Err(AppError::BadRequest("This match was released as a false match".into())); }
            sqlx::query("UPDATE media_matches SET status = 'reported', report_ref = $2, reported_at = now(), note = CASE WHEN $3 = '' THEN note ELSE $3 END, decided_by = $4, decided_at = now() WHERE id = $1").bind(id).bind(&r).bind(&note).bind(uid).execute(&state.db).await?;
        }
        "release" => {
            // A false match: the account comes back (if this match suspended it) and the file is destroyed.
            if note.is_empty() { return Err(AppError::BadRequest("Say why this is a false match".into())); }
            if row.status == "reported" { return Err(AppError::BadRequest("A report was filed for this match; it cannot be released".into())); }
            if row.legal_hold { return Err(AppError::BadRequest("Lift the legal hold first".into())); }
            if row.suspended { if let Some(u) = row.user_id { sqlx::query("UPDATE users SET suspended_at = NULL WHERE id = $1").bind(u).execute(&state.db).await?; state.hub.session_forget(u); } }
            let _ = tokio::fs::remove_file(&file).await;
            sqlx::query("UPDATE media_matches SET status = 'released', quarantined = false, note = $2, decided_by = $3, decided_at = now() WHERE id = $1").bind(id).bind(&note).bind(uid).execute(&state.db).await?;
        }
        "close" => {
            if row.status == "open" { return Err(AppError::BadRequest("Record the report that was filed, or release the match, before closing it".into())); }
            sqlx::query("UPDATE media_matches SET status = 'closed', note = CASE WHEN $2 = '' THEN note ELSE $2 END, decided_by = $3, decided_at = now() WHERE id = $1 AND status = 'reported'").bind(id).bind(&note).bind(uid).execute(&state.db).await?;
        }
        "hold" | "unhold" => {
            sqlx::query("UPDATE media_matches SET legal_hold = $2 WHERE id = $1").bind(id).bind(req.action == "hold").execute(&state.db).await?;
        }
        "destroy" => {
            if row.legal_hold { return Err(AppError::BadRequest("This match is under legal hold".into())); }
            if row.status != "closed" { return Err(AppError::BadRequest("Only a closed match's file can be destroyed".into())); }
            let _ = tokio::fs::remove_file(&file).await;
            sqlx::query("UPDATE media_matches SET quarantined = false WHERE id = $1").bind(id).execute(&state.db).await?;
        }
        _ => return Err(AppError::BadRequest("Unknown action".into())),
    }
    audit::record(&state, uid, &format!("safety.match.{}", req.action), "user", row.user_id, "", json!({ "match_id": id, "note": note })).await;
    let row: MatchRow = sqlx::query_as(&format!("SELECT {MATCH_COLS} FROM media_matches WHERE id = $1")).bind(id).fetch_one(&state.db).await?;
    Ok(Json(row))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_is_lowercase_hex() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
    #[test]
    fn only_pictures_and_video_go_to_the_service() {
        assert!(service_applies("image/png") && service_applies("video/mp4"));
        assert!(!service_applies("audio/mpeg") && !service_applies("application/pdf") && !service_applies(""));
    }
    #[test]
    fn the_probe_is_a_png() {
        assert_eq!(&PROBE_PNG[..8], b"\x89PNG\r\n\x1a\n");
    }
}
