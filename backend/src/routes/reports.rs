//! Report a message or a user; admins triage in the console (resolve / dismiss, delete the message, suspend).

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::channels::require_channel,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::FromRow;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/reports", post(create))
        .route("/admin/reports", get(list))
        .route("/guilds/:id/reports", get(guild_reports))
        .route("/guilds/:id/reports/:rid", axum::routing::patch(guild_report_update))
        .route("/admin/reports/:id", axum::routing::patch(update))
        .route("/admin/reports/:id/evidence", get(evidence))
        .route("/admin/reports/:id/hold", post(hold))
        .route("/admin/messages/:id", axum::routing::delete(admin_delete_message))
}

#[derive(Deserialize)]
struct CreateReport {
    kind: String,
    message_id: Option<Uuid>,
    user_id: Option<Uuid>,
    /// Report a server, or (with a user report) the server the user was reported from.
    guild_id: Option<Uuid>,
    #[serde(default)]
    reason: String,
    /// What kind of problem: one of [`CATEGORIES`]. Absent or unknown = "other".
    #[serde(default)]
    category: String,
    /// Also send it to the server's moderators (message reports in a server, or user reports with a server).
    #[serde(default)]
    to_mods: bool,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Report {
    pub id: Uuid,
    pub reporter_id: Option<Uuid>,
    #[sqlx(default)]
    pub reporter_username: Option<String>,
    pub kind: String,
    pub target_user_id: Option<Uuid>,
    pub target_username: String,
    pub message_id: Option<Uuid>,
    pub channel_id: Option<Uuid>,
    pub channel_name: String,
    pub guild_id: Option<Uuid>,
    pub guild_name: String,
    pub content: String,
    pub reason: String,
    pub status: String,
    pub resolved_by: Option<Uuid>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub note: String,
    pub created_at: DateTime<Utc>,
    /// Whether the reported message still exists (admins can delete it from the console).
    #[sqlx(default)]
    pub message_exists: bool,
    #[sqlx(default)]
    pub target_suspended: bool,
    #[sqlx(default)]
    pub to_mods: bool,
    #[sqlx(default)]
    pub mod_status: String,
    #[sqlx(default)]
    pub mod_note: String,
    /// The admin case this report opened.
    #[sqlx(default)]
    pub case_id: Option<Uuid>,
    #[sqlx(default)]
    pub category: String,
    /// Handled first: child safety, threats, intimate images, self-harm.
    #[sqlx(default)]
    pub urgent: bool,
    #[sqlx(default)]
    pub legal_hold: bool,
    /// An evidence snapshot is held for this report.
    #[sqlx(default)]
    pub has_evidence: bool,
}

/// The kinds of problem a report can name. The first five are the general ones; the rest are separated so that
/// they can be handled first and by the right people.
pub const CATEGORIES: [&str; 12] = [
    "spam", "harassment", "explicit", "illegal", "other",
    "child_sexual_content", "child_grooming", "minor_in_adult_space", "underage_user",
    "intimate_image", "threat", "self_harm",
];
/// Sorted first and exempt from the reporter's limit.
pub fn is_urgent(category: &str) -> bool { matches!(category, "child_sexual_content" | "child_grooming" | "minor_in_adult_space" | "intimate_image" | "threat" | "self_harm") }
/// Goes to the instance's own team only, never to a server's moderators (one of them may be who it is about).
pub fn instance_only(category: &str) -> bool { matches!(category, "child_sexual_content" | "child_grooming" | "minor_in_adult_space" | "intimate_image") }
/// Reports an hour per person. Urgent ones have their own, roomier allowance, so a real emergency is never held up
/// by earlier ordinary reports and the urgent queue still cannot be flooded by one account.
const REPORT_LIMIT: crate::ratelimit::Limit = crate::ratelimit::Limit { count: 10.0, secs: 3600.0 };
const URGENT_LIMIT: crate::ratelimit::Limit = crate::ratelimit::Limit { count: 30.0, secs: 3600.0 };

const REPORT_SELECT: &str = "SELECT r.id, r.reporter_id, u.username AS reporter_username, r.kind, r.target_user_id, r.target_username, r.message_id, r.channel_id, r.channel_name,
    r.guild_id, r.guild_name, r.content, r.reason, r.status, r.resolved_by, r.resolved_at, r.note, r.created_at, r.to_mods, r.mod_status, r.mod_note,
    r.category, r.urgent, r.legal_hold, (r.evidence IS NOT NULL) AS has_evidence,
    EXISTS (SELECT 1 FROM messages m WHERE m.id = r.message_id) AS message_exists,
    EXISTS (SELECT 1 FROM users t WHERE t.id = r.target_user_id AND t.suspended_at IS NOT NULL) AS target_suspended,
    (SELECT c.id FROM cases c WHERE c.report_id = r.id) AS case_id
    FROM reports r LEFT JOIN users u ON u.id = r.reporter_id";

async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<CreateReport>) -> AppResult<(StatusCode, Json<Value>)> {
    let reason: String = req.reason.trim().chars().take(1000).collect();
    if reason.is_empty() {
        return Err(AppError::BadRequest("Please say why you are reporting this".into()));
    }
    let category = if CATEGORIES.contains(&req.category.as_str()) { req.category.as_str() } else { "other" };
    let urgent = is_urgent(category);
    // A person's reports are limited so the queue cannot be flooded.
    let (bucket, limit) = if urgent { ("reports_urgent", URGENT_LIMIT) } else { ("reports", REPORT_LIMIT) };
    if let Err(wait) = crate::ratelimit::LIMITER.take(bucket, &uid.to_string(), limit) {
        return Err(AppError::TooMany(format!("You have sent a lot of reports. Try again in {} minutes.", wait.div_ceil(60).max(1))));
    }
    let to_mods = req.to_mods && !instance_only(category);
    let id = Uuid::now_v7();
    match req.kind.as_str() {
        "message" => {
            let mid = req.message_id.ok_or(AppError::BadRequest("message_id is required".into()))?;
            let row: Option<(Uuid, Uuid, String)> = sqlx::query_as("SELECT channel_id, author_id, content FROM messages WHERE id = $1").bind(mid).fetch_optional(&state.db).await?;
            let Some((cid, author, content)) = row else { return Err(AppError::NotFound("Message not found".into())) };
            if author == uid {
                return Err(AppError::BadRequest("You cannot report your own message".into()));
            }
            let c = require_channel(&state.db, cid, uid).await?;
            let guild_name = match c.guild_id { Some(g) => audit::guild_name(&state, g).await, None => String::new() };
            sqlx::query(
                "INSERT INTO reports (id, reporter_id, kind, target_user_id, target_username, message_id, channel_id, channel_name, guild_id, guild_name, content, reason, to_mods)
                 VALUES ($1, $2, 'message', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
            )
            .bind(id).bind(uid).bind(author).bind(audit::username(&state, author).await).bind(mid).bind(cid).bind(&c.name).bind(c.guild_id).bind(guild_name).bind(content).bind(&reason).bind(to_mods && c.guild_id.is_some())
            .execute(&state.db)
            .await?;
        }
        "user" => {
            let target = req.user_id.ok_or(AppError::BadRequest("user_id is required".into()))?;
            if target == uid {
                return Err(AppError::BadRequest("You cannot report yourself".into()));
            }
            let name = audit::username(&state, target).await;
            if name.is_empty() {
                return Err(AppError::NotFound("User not found".into()));
            }
            // Reported from a server you're both in: that server's moderators can get it too.
            let gid = match req.guild_id { Some(g) => sqlx::query_as::<_, (bool,)>("SELECT COUNT(*) = 2 FROM guild_members WHERE guild_id = $1 AND user_id IN ($2, $3)").bind(g).bind(uid).bind(target).fetch_one(&state.db).await?.0.then_some(g), None => None };
            let guild_name = match gid { Some(g) => audit::guild_name(&state, g).await, None => String::new() };
            sqlx::query("INSERT INTO reports (id, reporter_id, kind, target_user_id, target_username, reason, guild_id, guild_name, to_mods) VALUES ($1, $2, 'user', $3, $4, $5, $6, $7, $8)")
                .bind(id).bind(uid).bind(target).bind(name).bind(&reason).bind(gid).bind(guild_name).bind(to_mods && gid.is_some())
                .execute(&state.db)
                .await?;
        }
        "guild" => {
            let gid = req.guild_id.ok_or(AppError::BadRequest("guild_id is required".into()))?;
            let row: Option<(String, Uuid)> = sqlx::query_as("SELECT name, owner_id FROM guilds WHERE id = $1").bind(gid).fetch_optional(&state.db).await?;
            let Some((gname, owner)) = row else { return Err(AppError::NotFound("Server not found".into())) };
            sqlx::query("INSERT INTO reports (id, reporter_id, kind, target_user_id, target_username, guild_id, guild_name, reason) VALUES ($1, $2, 'guild', $3, $4, $5, $6, $7)")
                .bind(id).bind(uid).bind(owner).bind(audit::username(&state, owner).await).bind(gid).bind(gname).bind(&reason)
                .execute(&state.db)
                .await?;
        }
        _ => return Err(AppError::BadRequest("kind must be message, user or guild".into())),
    }
    // Every report opens a case: admin access to its context goes through it.
    let (subject, cid, mid): (Option<Uuid>, Option<Uuid>, Option<Uuid>) = sqlx::query_as("SELECT CASE kind WHEN 'guild' THEN guild_id WHEN 'message' THEN channel_id ELSE target_user_id END, channel_id, message_id FROM reports WHERE id = $1").bind(id).fetch_one(&state.db).await?;
    sqlx::query("UPDATE reports SET category = $2, urgent = $3 WHERE id = $1").bind(id).bind(category).bind(urgent).execute(&state.db).await?;
    crate::routes::cases::open_for_report(&state, id, &req.kind, subject.unwrap_or(id), cid, mid, &reason).await?;
    // Evidence is taken now, while the message, its files and the profile are as the reporter saw them.
    if let Err(e) = capture_evidence(&state, id).await { tracing::error!(report = %id, error = ?e, "could not capture a report's evidence"); }
    if let Ok(Some((Some(target),))) = sqlx::query_as::<_, (Option<Uuid>,)>("SELECT target_user_id FROM reports WHERE id = $1 AND kind <> 'guild'").bind(id).fetch_optional(&state.db).await {
        crate::abuse::after_report(state.clone(), target);
    }
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

#[derive(Deserialize)]
struct ListQuery {
    #[serde(default = "open")]
    status: String,
}
fn open() -> String { "open".into() }

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<ListQuery>) -> AppResult<Json<Vec<Report>>> {
    crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::ReportContextRead).await?;
    let status = if q.status == "all" { None } else { Some(q.status) };
    Ok(Json(
        sqlx::query_as::<_, Report>(&format!("{REPORT_SELECT} WHERE ($1::text IS NULL OR r.status = $1) ORDER BY (r.urgent AND r.status = 'open') DESC, r.id DESC LIMIT 200"))
            .bind(status)
            .fetch_all(&state.db)
            .await?,
    ))
}

#[derive(Deserialize)]
struct UpdateReport {
    status: String,
    #[serde(default)]
    note: String,
    /// Official notices sent from the system account ("Parley") with the decision: to whoever reported it, and to the
    /// reported user. Empty or absent: nothing is sent.
    #[serde(default)]
    message_reporter: Option<String>,
    #[serde(default)]
    message_target: Option<String>,
}

async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<UpdateReport>) -> AppResult<Json<Report>> {
    crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::ContentAction).await?;
    if !["open", "resolved", "dismissed"].contains(&req.status.as_str()) {
        return Err(AppError::BadRequest("status must be open, resolved or dismissed".into()));
    }
    let note: String = req.note.trim().chars().take(500).collect();
    // Child sexual content and grooming: not closed until the report to the authorities is dealt with on record.
    if req.status != "open" { crate::routes::authority::may_close(&state.db, id).await?; }
    let res = sqlx::query("UPDATE reports SET status = $2, note = $3, resolved_by = CASE WHEN $2 = 'open' THEN NULL ELSE $4 END, resolved_at = CASE WHEN $2 = 'open' THEN NULL ELSE now() END WHERE id = $1")
        .bind(id).bind(&req.status).bind(&note).bind(uid)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound("Report not found".into()));
    }
    crate::routes::cases::follow_report(&state, id, req.status == "open", uid).await?;
    let r = sqlx::query_as::<_, Report>(&format!("{REPORT_SELECT} WHERE r.id = $1")).bind(id).fetch_one(&state.db).await?;
    let clean = |m: &Option<String>| m.as_deref().map(str::trim).filter(|m| !m.is_empty()).map(|m| m.chars().take(crate::routes::notices::MAX_NOTICE).collect::<String>());
    let (to_reporter, to_target) = (clean(&req.message_reporter), clean(&req.message_target));
    let mut notified = Vec::new();
    if let (Some(text), Some(who)) = (&to_reporter, r.reporter_id) { crate::routes::notices::send(&state, who, text).await?; notified.push("reporter") }
    if let (Some(text), Some(who)) = (&to_target, r.target_user_id) { crate::routes::notices::send(&state, who, text).await?; notified.push("target") }
    audit::record(&state, uid, &format!("report.{}", req.status), "report", Some(id), &r.target_username,
        json!({ "kind": r.kind, "note": note, "notified": notified, "message_reporter": to_reporter, "message_target": to_target })).await;
    Ok(Json(r))
}

/// Admins may delete any message anywhere (reported content, spam); members of the channel see it vanish.
async fn admin_delete_message(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> {
    crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::ContentAction).await?;
    let row: Option<(Uuid, Uuid)> = sqlx::query_as("SELECT channel_id, author_id FROM messages WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let Some((cid, author)) = row else { return Err(AppError::NotFound("Message not found".into())) };
    let c = sqlx::query_as::<_, crate::models::Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS)).bind(cid).fetch_one(&state.db).await?;
    let files: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM attachments WHERE message_id = $1").bind(id).fetch_all(&state.db).await?;
    sqlx::query("DELETE FROM messages WHERE id = $1").bind(id).execute(&state.db).await?;
    for (fid,) in files {
        let _ = tokio::fs::remove_file(state.config.upload_dir.join(fid.to_string())).await; let _ = tokio::fs::remove_file(state.config.upload_dir.join(format!("{fid}.thumb"))).await; let _ = tokio::fs::remove_file(state.config.upload_dir.join(format!("{fid}.viz"))).await;
    }
    let target = crate::routes::channels::target_for(&state.db, &c).await?;
    state.hub.emit(target, "MESSAGE_DELETE", json!({ "id": id, "channel_id": cid, "guild_id": c.guild_id }));
    audit::record(&state, uid, "message.delete", "user", Some(author), &audit::username(&state, author).await, json!({ "message_id": id, "channel": c.name })).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Moderators of a server: anyone who can manage messages, kick, ban, time out or manage the server.
async fn require_mod(state: &AppState, gid: Uuid, uid: Uuid) -> AppResult<()> {
    let (_, p) = crate::perms::guild_perms(&state.db, gid, uid).await?;
    crate::perms::check_any(p, crate::perms::MANAGE_MESSAGES | crate::perms::KICK_MEMBERS | crate::perms::BAN_MEMBERS | crate::perms::MODERATE_MEMBERS | crate::perms::MANAGE_GUILD)
}

#[derive(Deserialize)]
struct GuildReportsQuery {
    #[serde(default = "open")]
    status: String,
}

/// `GET /guilds/:id/reports`: reports members sent to this server's moderators (the reporter isn't shown).
async fn guild_reports(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Query(q): Query<GuildReportsQuery>) -> AppResult<Json<Vec<Value>>> {
    require_mod(&state, gid, uid).await?;
    let status = if q.status == "all" { None } else { Some(q.status) };
    let rows = sqlx::query_as::<_, Report>(&format!("{REPORT_SELECT} WHERE r.guild_id = $1 AND r.to_mods AND ($2::text IS NULL OR r.mod_status = $2) ORDER BY r.id DESC LIMIT 200"))
        .bind(gid).bind(status).fetch_all(&state.db).await?;
    // Moderators don't learn who reported (only instance admins do).
    Ok(Json(rows.into_iter().map(|r| json!({ "id": r.id, "kind": r.kind, "target_user_id": r.target_user_id, "target_username": r.target_username, "message_id": r.message_id,
        "channel_id": r.channel_id, "channel_name": r.channel_name, "content": r.content, "reason": r.reason, "mod_status": r.mod_status, "mod_note": r.mod_note,
        "created_at": r.created_at, "message_exists": r.message_exists })).collect()))
}

#[derive(Deserialize)]
struct GuildReportUpdate { mod_status: String, #[serde(default)] mod_note: String }

/// `PATCH /guilds/:id/reports/:rid`: a moderator resolves or dismisses a report (instance admins keep their own status).
async fn guild_report_update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, rid)): Path<(Uuid, Uuid)>, Json(req): Json<GuildReportUpdate>) -> AppResult<StatusCode> {
    require_mod(&state, gid, uid).await?;
    if !["open", "resolved", "dismissed"].contains(&req.mod_status.as_str()) { return Err(AppError::BadRequest("mod_status must be open, resolved or dismissed".into())) }
    let note: String = req.mod_note.trim().chars().take(500).collect();
    let n = sqlx::query("UPDATE reports SET mod_status = $3, mod_note = $4, mod_by = $5 WHERE id = $1 AND guild_id = $2 AND to_mods").bind(rid).bind(gid).bind(&req.mod_status).bind(&note).bind(uid).execute(&state.db).await?.rows_affected();
    if n == 0 { return Err(AppError::NotFound("Report not found".into())) }
    let name = audit::guild_name(&state, gid).await;
    crate::audit::guild(&state, gid, uid, "report.update", "report", Some(rid), &name, json!({ "status": req.mod_status })).await;
    Ok(StatusCode::NO_CONTENT)
}

// ---- evidence ----

/// The largest attachment copied as evidence; larger ones are recorded (name, size) without a copy.
const EVIDENCE_FILE_MAX: i64 = 200 * 1024 * 1024;

/// Take the snapshot described in migration 0171 for a report just filed. Each part is best effort.
async fn capture_evidence(state: &AppState, id: Uuid) -> AppResult<()> {
    let (kind, target, mid, cid): (String, Option<Uuid>, Option<Uuid>, Option<Uuid>) = sqlx::query_as("SELECT kind, target_user_id, message_id, channel_id FROM reports WHERE id = $1").bind(id).fetch_one(&state.db).await?;
    let profile: Option<Value> = match target {
        Some(u) => sqlx::query_as::<_, (Value,)>("SELECT jsonb_build_object('id', id, 'username', username, 'display_name', display_name, 'bio', bio, 'avatar_url', avatar_url, 'created_at', created_at) FROM users WHERE id = $1").bind(u).fetch_optional(&state.db).await?.map(|r| r.0),
        None => None,
    };
    let mut ev = json!({ "captured_at": chrono::Utc::now(), "profile": profile });
    if let (true, Some(mid), Some(cid)) = (kind == "message", mid, cid) {
        let ch: Option<(Option<Uuid>, bool)> = sqlx::query_as("SELECT guild_id, channel_min_age(id) IS NOT NULL FROM channels WHERE id = $1").bind(cid).fetch_optional(&state.db).await?;
        let (guild, nsfw) = ch.unwrap_or((None, false));
        ev["channel"] = json!({ "id": cid, "private": guild.is_none(), "age_restricted": nsfw });
        const ROW: &str = "jsonb_build_object('id', m.id, 'author_id', m.author_id, 'author', u.username, 'content', m.content, 'created_at', m.created_at, 'edited_at', m.edited_at,
            'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'filename', a.filename, 'content_type', a.content_type, 'size', a.size)) FROM attachments a WHERE a.message_id = m.id), '[]'::jsonb))";
        let one: Option<(Value,)> = sqlx::query_as(&format!("SELECT {ROW} FROM messages m JOIN users u ON u.id = m.author_id WHERE m.id = $1")).bind(mid).fetch_optional(&state.db).await?;
        ev["message"] = one.map(|r| r.0).unwrap_or(Value::Null);
        // Around it: only in a server channel, and only as far as a report handler may read (a direct message's
        // surroundings need a grant on the case, so they are not copied here).
        if guild.is_some() {
            let n = state.config.report_context_window;
            let before: Vec<(Value,)> = sqlx::query_as(&format!("SELECT {ROW} FROM messages m JOIN users u ON u.id = m.author_id WHERE m.channel_id = $1 AND m.id < $2 ORDER BY m.id DESC LIMIT $3")).bind(cid).bind(mid).bind(n).fetch_all(&state.db).await?;
            let after: Vec<(Value,)> = sqlx::query_as(&format!("SELECT {ROW} FROM messages m JOIN users u ON u.id = m.author_id WHERE m.channel_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT $3")).bind(cid).bind(mid).bind(n).fetch_all(&state.db).await?;
            ev["before"] = Value::Array(before.into_iter().rev().map(|r| r.0).collect());
            ev["after"] = Value::Array(after.into_iter().map(|r| r.0).collect());
        }
        // Copies of the reported message's files: they go when the message is deleted, the copies stay.
        let files: Vec<(Uuid, String, String, i64)> = sqlx::query_as("SELECT id, filename, content_type, size FROM attachments WHERE message_id = $1").bind(mid).fetch_all(&state.db).await?;
        let dir = state.config.upload_dir.join("evidence").join(id.to_string());
        for (aid, filename, content_type, size) in files {
            let mut sha = String::new();
            let mut kept = false;
            if size <= EVIDENCE_FILE_MAX {
                if let Ok(bytes) = tokio::fs::read(state.config.upload_dir.join(aid.to_string())).await {
                    sha = crate::routes::matching::sha256_hex(&bytes);
                    // A hard link where the disk allows it: it costs no space while the original exists (so reporting
                    // one large file many times cannot fill the disk) and survives the original's deletion.
                    let (from, to) = (state.config.upload_dir.join(aid.to_string()), dir.join(aid.to_string()));
                    kept = tokio::fs::create_dir_all(&dir).await.is_ok() && (tokio::fs::hard_link(&from, &to).await.is_ok() || tokio::fs::write(&to, &bytes).await.is_ok());
                }
            }
            sqlx::query("INSERT INTO report_evidence_files (report_id, attachment_id, filename, content_type, size, sha256, kept) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING")
                .bind(id).bind(aid).bind(filename).bind(content_type).bind(size).bind(sha).bind(kept).execute(&state.db).await?;
        }
    }
    sqlx::query("UPDATE reports SET evidence = $2 WHERE id = $1").bind(id).bind(ev).execute(&state.db).await?;
    Ok(())
}

/// `GET /admin/reports/:id/evidence`: the snapshot taken when the report was filed, and which of the reported
/// message's files are held (their details and hashes, never the files). Logged.
async fn evidence(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::ReportContextRead).await?;
    let row: Option<(Option<Value>, bool)> = sqlx::query_as("SELECT evidence, legal_hold FROM reports WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let Some((ev, hold)) = row else { return Err(AppError::NotFound("Report not found".into())) };
    let files: Vec<(Uuid, String, String, i64, String, bool)> = sqlx::query_as("SELECT attachment_id, filename, content_type, size, sha256, kept FROM report_evidence_files WHERE report_id = $1 ORDER BY attachment_id").bind(id).fetch_all(&state.db).await?;
    audit::record(&state, uid, "report.evidence", "report", Some(id), "", json!({})).await;
    Ok(Json(json!({
        "evidence": ev, "legal_hold": hold, "retention_days": state.config.report_retention_days,
        "files": files.into_iter().map(|(aid, filename, content_type, size, sha256, kept)| json!({ "attachment_id": aid, "filename": filename, "content_type": content_type, "size": size, "sha256": sha256, "kept": kept })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
struct Hold { on: bool }

/// `POST /admin/reports/:id/hold {on}`: a legal hold keeps the report's evidence past the retention period.
/// Trust-and-safety leads and legal only.
async fn hold(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<Hold>) -> AppResult<Json<Report>> {
    let a = crate::routes::admin_access::require_perm(&state, uid, crate::routes::admin_access::Perm::ReportContextRead).await?;
    if !a.pii_unmasked() { return Err(AppError::Forbidden); }
    let res = sqlx::query("UPDATE reports SET legal_hold = $2 WHERE id = $1").bind(id).bind(req.on).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::NotFound("Report not found".into())); }
    audit::record(&state, uid, if req.on { "report.hold" } else { "report.unhold" }, "report", Some(id), "", json!({})).await;
    Ok(Json(sqlx::query_as::<_, Report>(&format!("{REPORT_SELECT} WHERE r.id = $1")).bind(id).fetch_one(&state.db).await?))
}

/// Clear the evidence of reports closed longer ago than the retention period, unless they are on legal hold. Returns how many.
pub async fn purge_evidence(state: &AppState) -> AppResult<u64> {
    let days = state.config.report_retention_days;
    if days == 0 { return Ok(0); }
    let old: Vec<(Uuid,)> = sqlx::query_as("UPDATE reports SET evidence = NULL WHERE evidence IS NOT NULL AND NOT legal_hold AND status <> 'open' AND resolved_at < now() - make_interval(days => $1::int) RETURNING id").bind(days as i32).fetch_all(&state.db).await?;
    for (id,) in &old {
        let _ = tokio::fs::remove_dir_all(state.config.upload_dir.join("evidence").join(id.to_string())).await;
        sqlx::query("UPDATE report_evidence_files SET kept = false WHERE report_id = $1").bind(id).execute(&state.db).await?;
    }
    Ok(old.len() as u64)
}

/// Once a day.
pub async fn retention_loop(state: AppState) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(24 * 3600)).await;
        match purge_evidence(&state).await {
            Ok(0) => {}
            Ok(n) => tracing::info!(reports = n, "report evidence past its retention period cleared"),
            Err(e) => tracing::warn!(error = ?e, "report evidence cleanup failed"),
        }
    }
}

#[cfg(test)]
mod category_tests {
    use super::*;
    #[test]
    fn child_safety_reports_are_urgent_and_stay_with_the_instance() {
        for c in ["child_sexual_content", "child_grooming", "minor_in_adult_space"] { assert!(is_urgent(c) && instance_only(c), "{c}"); }
        assert!(is_urgent("threat") && !instance_only("threat"));
        assert!(is_urgent("self_harm") && !instance_only("self_harm"));
        assert!(!is_urgent("spam") && !is_urgent("underage_user") && !is_urgent("other"));
        assert!(CATEGORIES.iter().all(|c| !c.is_empty()));
    }
}
