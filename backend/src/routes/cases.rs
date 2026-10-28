//! Admin cases (docs/admin-access-and-server-deletion.md, Phase 2). All admin access to message content goes through a
//! case: no case, no content.
//!
//! - A report opens a case by itself. Whoever handles reports sees the reported message with `REPORT_CONTEXT_WINDOW`
//!   messages either side, from that conversation only.
//! - Moderators, T&S leads and legal open investigation cases, and legal opens legal cases, each with a justification
//!   and an explicit scope: channels and, optionally, a time range.
//! - Reading past the context window, anything inside a DM or group chat, and exports need a grant. A T&S lead who is
//!   not the requester approves it (the database refuses self-approval). Grants are limited to the case scope, serve
//!   only the requester, and expire after `CASE_GRANT_HOURS`. Cases expire after `CASE_EXPIRY_DAYS`.
//!
//! Every read is written to the append-only `admin_access_log` with the case id.
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Channel, Message, MessageRow},
    routes::{
        admin_access::{self, justification, log_case, require_any, Entry, Perm::*},
        channels::{hydrate, MESSAGE_SELECT},
    },
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::FromRow;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/cases", get(list).post(open))
        .route("/admin/cases/:id", get(show))
        .route("/admin/cases/:id/close", post(close))
        .route("/admin/cases/:id/context", get(context))
        .route("/admin/cases/:id/messages", get(messages))
        .route("/admin/cases/:id/export", get(export))
        .route("/admin/cases/:id/grants", post(request_grant))
        .route("/admin/cases/:id/grants/:gid", post(decide))
        .route("/admin/case-grants", get(pending_grants))
}

#[derive(Debug, Serialize, FromRow)]
pub struct Case {
    pub id: Uuid,
    pub kind: String,
    pub subject_kind: String,
    pub subject_id: Uuid,
    pub report_id: Option<Uuid>,
    pub anchor_message_id: Option<Uuid>,
    pub opened_by: Option<Uuid>,
    pub justification: String,
    pub status: String,
    pub scope_channel_ids: Vec<Uuid>,
    pub scope_from: Option<DateTime<Utc>>,
    pub scope_to: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
    pub closed_by: Option<Uuid>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct Grant {
    pub id: Uuid,
    pub case_id: Uuid,
    pub kind: String,
    pub requested_by: Uuid,
    pub justification: String,
    pub channel_ids: Vec<Uuid>,
    pub status: String,
    pub decided_by: Option<Uuid>,
    pub decided_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

const CASE_COLS: &str = "id, kind, subject_kind, subject_id, report_id, anchor_message_id, opened_by, justification, status, scope_channel_ids, scope_from, scope_to, expires_at, created_at, closed_at, closed_by";
const GRANT_COLS: &str = "id, case_id, kind, requested_by, justification, channel_ids, status, decided_by, decided_at, expires_at, created_at";

/// Open the case for a new report (called when the report is filed). Message reports are scoped to their channel.
pub async fn open_for_report(state: &AppState, report_id: Uuid, kind: &str, subject: Uuid, channel_id: Option<Uuid>, message_id: Option<Uuid>, reason: &str) -> AppResult<()> {
    let subject_kind = match kind { "guild" => "server", "message" => "conversation", _ => "user" };
    let why: String = format!("Report: {}", reason.chars().take(400).collect::<String>());
    sqlx::query(&format!("INSERT INTO cases (id, kind, subject_kind, subject_id, report_id, anchor_message_id, justification, scope_channel_ids, expires_at)
        VALUES ($1, 'report', $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8::int))"))
        .bind(Uuid::now_v7()).bind(subject_kind).bind(subject).bind(report_id).bind(message_id).bind(why)
        .bind(channel_id.map(|c| vec![c]).unwrap_or_default()).bind(state.config.case_expiry_days as i32)
        .execute(&state.db).await?;
    Ok(())
}

/// A report was resolved, dismissed or reopened: its case follows.
pub async fn follow_report(state: &AppState, report_id: Uuid, open: bool, by: Uuid) -> AppResult<()> {
    if open {
        sqlx::query("UPDATE cases SET status = 'open', closed_at = NULL, closed_by = NULL WHERE report_id = $1").bind(report_id).execute(&state.db).await?;
    } else {
        sqlx::query("UPDATE cases SET status = 'closed', closed_at = now(), closed_by = $2 WHERE report_id = $1 AND status = 'open'").bind(report_id).bind(by).execute(&state.db).await?;
    }
    Ok(())
}

async fn load(state: &AppState, id: Uuid) -> AppResult<Case> {
    sqlx::query_as::<_, Case>(&format!("SELECT {CASE_COLS} FROM cases WHERE id = $1")).bind(id).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("Case not found".into()))
}

/// Content is only read through an open, unexpired case.
fn usable(c: &Case) -> AppResult<()> {
    if c.status != "open" { return Err(AppError::BadRequest("This case is closed".into())) }
    if c.expires_at <= Utc::now() { return Err(AppError::BadRequest("This case has expired".into())) }
    Ok(())
}

/// An approved, unexpired grant of this kind on the case, requested by this admin and covering the channel (if any).
async fn grant_for(state: &AppState, case_id: Uuid, uid: Uuid, kind: &str, channel: Option<Uuid>) -> AppResult<Option<Grant>> {
    Ok(sqlx::query_as::<_, Grant>(&format!("SELECT {GRANT_COLS} FROM case_grants WHERE case_id = $1 AND requested_by = $2 AND kind = $3 AND status = 'approved'
        AND expires_at > now() AND ($4::uuid IS NULL OR cardinality(channel_ids) = 0 OR $4 = ANY(channel_ids)) ORDER BY expires_at DESC LIMIT 1"))
        .bind(case_id).bind(uid).bind(kind).bind(channel).fetch_optional(&state.db).await?)
}

async fn channel(state: &AppState, id: Uuid) -> AppResult<Channel> {
    sqlx::query_as::<_, Channel>(&format!("SELECT {} FROM channels WHERE id = $1", crate::routes::guilds::CHANNEL_COLS)).bind(id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("That conversation no longer exists".into()))
}

#[derive(Deserialize)]
struct ListQuery { status: Option<String>, subject_id: Option<Uuid> }

/// `GET /admin/cases?status=open|closed|all`: newest first.
async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<ListQuery>) -> AppResult<Json<Vec<Case>>> {
    require_any(&state, uid, &[ReportContextRead, CaseApprove]).await?;
    let status = match q.status.as_deref() { Some("all") => None, Some(s) => Some(s.to_string()), None => Some("open".into()) };
    Ok(Json(sqlx::query_as::<_, Case>(&format!("SELECT {CASE_COLS} FROM cases WHERE ($1::text IS NULL OR status = $1) AND ($2::uuid IS NULL OR subject_id = $2) ORDER BY created_at DESC LIMIT 200"))
        .bind(status).bind(q.subject_id).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
struct OpenCase {
    kind: String,
    subject_kind: String,
    subject_id: Uuid,
    justification: Option<String>,
    #[serde(default)]
    channel_ids: Vec<Uuid>,
    from: Option<DateTime<Utc>>,
    to: Option<DateTime<Utc>>,
}

/// `POST /admin/cases`: open an investigation (moderators, leads, legal) or a legal case (legal), scoped to channels.
async fn open(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Json(req): Json<OpenCase>) -> AppResult<Json<Case>> {
    let a = match req.kind.as_str() {
        "investigation" => admin_access::require_perm(&state, uid, ContentSearchPublic).await?,
        "legal" => admin_access::require_perm(&state, uid, ContentExport).await?,
        _ => return Err(AppError::BadRequest("kind must be investigation or legal (reports open their own cases)".into())),
    };
    if !["user", "conversation", "server"].contains(&req.subject_kind.as_str()) { return Err(AppError::BadRequest("subject_kind must be user, conversation or server".into())) }
    let why = justification(req.justification.as_deref())?;
    let mut chans = req.channel_ids.clone(); chans.sort(); chans.dedup();
    if chans.is_empty() || chans.len() > 50 { return Err(AppError::BadRequest("Scope the case to between 1 and 50 conversations".into())) }
    let (found,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM channels WHERE id = ANY($1)").bind(&chans).fetch_one(&state.db).await?;
    if found as usize != chans.len() { return Err(AppError::BadRequest("Some of those conversations don't exist".into())) }
    if let (Some(f), Some(t)) = (req.from, req.to) { if f >= t { return Err(AppError::BadRequest("The time range is backwards".into())) } }
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO cases (id, kind, subject_kind, subject_id, opened_by, justification, scope_channel_ids, scope_from, scope_to, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(days => $10::int))")
        .bind(id).bind(&req.kind).bind(&req.subject_kind).bind(req.subject_id).bind(uid).bind(&why).bind(&chans).bind(req.from).bind(req.to).bind(state.config.case_expiry_days as i32)
        .execute(&state.db).await?;
    log_case(&state, uid, &a.roles, &headers, Some(id), Entry { action: "case.open", query: "", filters: json!({ "kind": req.kind, "subject_kind": req.subject_kind, "from": req.from, "to": req.to }), justification: &why, targets: &chans }).await?;
    Ok(Json(load(&state, id).await?))
}

/// `GET /admin/cases/:id`: the case, its report (if any) and its grants.
async fn show(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    require_any(&state, uid, &[ReportContextRead, CaseApprove]).await?;
    let c = load(&state, id).await?;
    let grants = sqlx::query_as::<_, Grant>(&format!("SELECT {GRANT_COLS} FROM case_grants WHERE case_id = $1 ORDER BY created_at DESC")).bind(id).fetch_all(&state.db).await?;
    let names: Vec<(Uuid, String, Option<Uuid>)> = sqlx::query_as("SELECT id, name, guild_id FROM channels WHERE id = ANY($1)").bind(&c.scope_channel_ids).fetch_all(&state.db).await?;
    let scope: Vec<Value> = c.scope_channel_ids.iter().map(|cid| match names.iter().find(|n| n.0 == *cid) {
        Some((_, name, g)) => json!({ "id": cid, "name": name, "private": g.is_none() }),
        None => json!({ "id": cid, "name": null, "private": null }),
    }).collect();
    Ok(Json(json!({ "case": c, "grants": grants, "scope": scope, "context_window": state.config.report_context_window })))
}

/// `POST /admin/cases/:id/close`.
async fn close(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path(id): Path<Uuid>) -> AppResult<Json<Case>> {
    let a = require_any(&state, uid, &[ReportContextRead, CaseApprove]).await?;
    load(&state, id).await?;
    sqlx::query("UPDATE cases SET status = 'closed', closed_at = now(), closed_by = $2 WHERE id = $1 AND status = 'open'").bind(id).bind(uid).execute(&state.db).await?;
    sqlx::query("UPDATE case_grants SET status = 'revoked' WHERE case_id = $1 AND status IN ('pending', 'approved')").bind(id).execute(&state.db).await?;
    log_case(&state, uid, &a.roles, &headers, Some(id), Entry { action: "case.close", query: "", filters: json!({}), justification: "", targets: &[] }).await?;
    Ok(Json(load(&state, id).await?))
}

#[derive(Deserialize)]
struct WhyQuery { justification: Option<String> }

/// `GET /admin/cases/:id/context`: the reported message and `REPORT_CONTEXT_WINDOW` messages either side, from its
/// conversation only. Inside a DM or group chat this too needs an approved private-access grant.
async fn context(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path(id): Path<Uuid>, Query(q): Query<WhyQuery>) -> AppResult<Json<Value>> {
    let a = admin_access::require_perm(&state, uid, ReportContextRead).await?;
    let c = load(&state, id).await?;
    usable(&c)?;
    let (Some(anchor), Some(cid)) = (c.anchor_message_id, c.scope_channel_ids.first().copied()) else {
        return Err(AppError::BadRequest("Only message reports have a context window".into()));
    };
    let ch = channel(&state, cid).await?;
    let private = ch.guild_id.is_none();
    if private && !(a.has(ContentSearchPrivate) && grant_for(&state, id, uid, "private_access", Some(cid)).await?.is_some()) {
        return Err(AppError::Forbidden);
    }
    let n = state.config.report_context_window;
    let before = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.id < $2 ORDER BY m.id DESC LIMIT $3")).bind(cid).bind(anchor).bind(n).fetch_all(&state.db).await?;
    let at = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.id = $1 AND m.channel_id = $2")).bind(anchor).bind(cid).fetch_all(&state.db).await?;
    let after = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT $3")).bind(cid).bind(anchor).bind(n).fetch_all(&state.db).await?;
    let mut rows: Vec<MessageRow> = before.into_iter().rev().collect();
    rows.extend(at); rows.extend(after);
    let msgs = hydrate(&state.db, rows, uid, false).await?;
    let ids: Vec<Uuid> = msgs.iter().map(|m| m.id).collect();
    let why = q.justification.unwrap_or_default();
    log_case(&state, uid, &a.roles, &headers, Some(id), Entry { action: "case.context", query: "", filters: json!({ "channel_id": cid, "window": n }), justification: &why, targets: &ids }).await?;
    Ok(Json(json!({ "channel": { "id": ch.id, "name": ch.name, "private": private }, "anchor_id": anchor, "messages": msgs })))
}

#[derive(Deserialize)]
struct BrowseQuery { channel_id: Uuid, before: Option<Uuid>, after: Option<Uuid>, limit: Option<i64> }

/// May this admin read this channel's messages inside this case?
async fn may_read(state: &AppState, a: &admin_access::Access, c: &Case, uid: Uuid, cid: Uuid) -> AppResult<Channel> {
    usable(c)?;
    if !c.scope_channel_ids.contains(&cid) { return Err(AppError::Forbidden) }
    let ch = channel(state, cid).await?;
    let ok = if ch.guild_id.is_none() {
        // DMs and group chats: two-person approved, time-boxed.
        a.has(ContentSearchPrivate) && grant_for(state, c.id, uid, "private_access", Some(cid)).await?.is_some()
    } else if c.kind == "report" {
        // Past the context window: an approved expansion.
        a.has(ReportContextExpand) && grant_for(state, c.id, uid, "expand", Some(cid)).await?.is_some()
    } else {
        a.has(ContentSearchPublic)
    };
    if ok { Ok(ch) } else { Err(AppError::Forbidden) }
}

/// `GET /admin/cases/:id/messages?channel_id=&before=|after=&limit=`: page through a conversation in the case scope.
async fn messages(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path(id): Path<Uuid>, Query(q): Query<BrowseQuery>) -> AppResult<Json<Vec<Message>>> {
    let a = require_any(&state, uid, &[ReportContextRead, ContentSearchPublic]).await?;
    let c = load(&state, id).await?;
    may_read(&state, &a, &c, uid, q.channel_id).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 100);
    let rows = if let Some(after) = q.after {
        sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.channel_id = $1 AND m.id > $2 AND ($3::timestamptz IS NULL OR m.created_at >= $3) AND ($4::timestamptz IS NULL OR m.created_at <= $4) ORDER BY m.id ASC LIMIT $5"))
            .bind(q.channel_id).bind(after).bind(c.scope_from).bind(c.scope_to).bind(limit).fetch_all(&state.db).await?
    } else {
        let mut r = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.channel_id = $1 AND ($2::uuid IS NULL OR m.id < $2) AND ($3::timestamptz IS NULL OR m.created_at >= $3) AND ($4::timestamptz IS NULL OR m.created_at <= $4) ORDER BY m.id DESC LIMIT $5"))
            .bind(q.channel_id).bind(q.before).bind(c.scope_from).bind(c.scope_to).bind(limit).fetch_all(&state.db).await?;
        r.reverse(); r
    };
    let msgs = hydrate(&state.db, rows, uid, false).await?;
    let ids: Vec<Uuid> = msgs.iter().map(|m| m.id).collect();
    log_case(&state, uid, &a.roles, &headers, Some(id), Entry { action: "case.messages", query: "", filters: json!({ "channel_id": q.channel_id, "before": q.before, "after": q.after }), justification: "", targets: &ids }).await?;
    Ok(Json(msgs))
}

/// `GET /admin/cases/:id/export`: everything in scope, for legal, with an approved export grant. Logged.
async fn export(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    let a = admin_access::require_perm(&state, uid, ContentExport).await?;
    let c = load(&state, id).await?;
    usable(&c)?;
    let g = grant_for(&state, id, uid, "export", None).await?.ok_or(AppError::Forbidden)?;
    let chans: Vec<Uuid> = if g.channel_ids.is_empty() { c.scope_channel_ids.clone() } else { g.channel_ids.clone() };
    let rows = sqlx::query_as::<_, MessageRow>(&format!("{MESSAGE_SELECT} WHERE m.channel_id = ANY($1) AND ($2::timestamptz IS NULL OR m.created_at >= $2) AND ($3::timestamptz IS NULL OR m.created_at <= $3) ORDER BY m.id ASC LIMIT 10000"))
        .bind(&chans).bind(c.scope_from).bind(c.scope_to).fetch_all(&state.db).await?;
    let msgs = hydrate(&state.db, rows, uid, false).await?;
    let ids: Vec<Uuid> = msgs.iter().map(|m| m.id).collect();
    log_case(&state, uid, &a.roles, &headers, Some(id), Entry { action: "case.export", query: "", filters: json!({ "grant_id": g.id, "channels": chans }), justification: &g.justification, targets: &ids }).await?;
    Ok(Json(json!({ "case": c, "exported_at": Utc::now(), "exported_by": uid, "messages": msgs })))
}

#[derive(Deserialize)]
struct GrantReq { kind: String, justification: Option<String>, #[serde(default)] channel_ids: Vec<Uuid> }

/// `POST /admin/cases/:id/grants`: ask for more than the case gives by itself. A T&S lead other than you decides.
async fn request_grant(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path(id): Path<Uuid>, Json(req): Json<GrantReq>) -> AppResult<Json<Grant>> {
    let need = match req.kind.as_str() { "expand" => ReportContextExpand, "private_access" => ContentSearchPrivate, "export" => ContentExport, _ => return Err(AppError::BadRequest("kind must be expand, private_access or export".into())) };
    let a = admin_access::require_perm(&state, uid, need).await?;
    let c = load(&state, id).await?;
    usable(&c)?;
    let why = justification(req.justification.as_deref())?;
    let mut chans = req.channel_ids.clone(); chans.sort(); chans.dedup();
    if chans.iter().any(|x| !c.scope_channel_ids.contains(x)) { return Err(AppError::BadRequest("A grant can't reach outside the case scope".into())) }
    let gid = Uuid::now_v7();
    sqlx::query("INSERT INTO case_grants (id, case_id, kind, requested_by, justification, channel_ids) VALUES ($1, $2, $3, $4, $5, $6)")
        .bind(gid).bind(id).bind(&req.kind).bind(uid).bind(&why).bind(&chans).execute(&state.db).await?;
    log_case(&state, uid, &a.roles, &headers, Some(id), Entry { action: "case.grant_request", query: "", filters: json!({ "grant_id": gid, "kind": req.kind }), justification: &why, targets: &chans }).await?;
    Ok(Json(sqlx::query_as::<_, Grant>(&format!("SELECT {GRANT_COLS} FROM case_grants WHERE id = $1")).bind(gid).fetch_one(&state.db).await?))
}

#[derive(Deserialize)]
struct Decision { decision: String }

/// `POST /admin/cases/:id/grants/:gid` `{decision: approve|deny|revoke}`: T&S leads, never on their own request.
async fn decide(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path((id, gid)): Path<(Uuid, Uuid)>, Json(req): Json<Decision>) -> AppResult<Json<Grant>> {
    let a = admin_access::require_perm(&state, uid, CaseApprove).await?;
    let c = load(&state, id).await?;
    let g = sqlx::query_as::<_, Grant>(&format!("SELECT {GRANT_COLS} FROM case_grants WHERE id = $1 AND case_id = $2")).bind(gid).bind(id).fetch_optional(&state.db).await?
        .ok_or_else(|| AppError::NotFound("Request not found".into()))?;
    if g.requested_by == uid { return Err(AppError::BadRequest("Someone else has to decide your own request".into())) }
    let (from, to) = match req.decision.as_str() { "approve" => ("pending", "approved"), "deny" => ("pending", "denied"), "revoke" => ("approved", "revoked"), _ => return Err(AppError::BadRequest("decision must be approve, deny or revoke".into())) };
    if g.status != from { return Err(AppError::BadRequest(format!("This request is already {}", g.status))) }
    if to == "approved" { usable(&c)?; }
    // A grant never outlives its case.
    let expires = (to == "approved").then(|| (Utc::now() + Duration::hours(state.config.case_grant_hours)).min(c.expires_at));
    sqlx::query("UPDATE case_grants SET status = $2, decided_by = $3, decided_at = now(), expires_at = COALESCE($4, expires_at) WHERE id = $1").bind(gid).bind(to).bind(uid).bind(expires).execute(&state.db).await?;
    log_case(&state, uid, &a.roles, &headers, Some(id), Entry { action: &format!("case.grant_{}", req.decision), query: "", filters: json!({ "grant_id": gid, "kind": g.kind, "requested_by": g.requested_by }), justification: "", targets: &[g.requested_by] }).await?;
    Ok(Json(sqlx::query_as::<_, Grant>(&format!("SELECT {GRANT_COLS} FROM case_grants WHERE id = $1")).bind(gid).fetch_one(&state.db).await?))
}

/// `GET /admin/case-grants`: requests waiting for a decision (T&S leads), oldest first.
async fn pending_grants(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Vec<Grant>>> {
    admin_access::require_perm(&state, uid, CaseApprove).await?;
    Ok(Json(sqlx::query_as::<_, Grant>(&format!("SELECT {GRANT_COLS} FROM case_grants WHERE status = 'pending' ORDER BY created_at LIMIT 200")).fetch_all(&state.db).await?))
}
