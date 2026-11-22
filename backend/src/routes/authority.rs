//! Reporting to the authorities: the checklist and the export.
//!
//! Parley does not file anything for an operator. What it does is make sure the step is not skipped and is not
//! slowed down by hunting for details: a report about child sexual content or an adult pursuing a child cannot be
//! closed until someone records either the report that was filed (where, the reference given, when) with the
//! evidence put on hold, or the decision that none was needed and why. And it produces, for a report or for an
//! upload that matched known material, one document with what a hotline form asks for.
//!
//! Open to trust-and-safety leads and legal (`SafetyMatchReview`). Every read, record and export is logged. The
//! export never contains a file: it names the files, their sizes and hashes, and where the held copies are.

use crate::{
    audit,
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{require_perm, Perm},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

/// Report categories that cannot be closed without a record here.
pub const MANDATORY: [&str; 2] = ["child_sexual_content", "child_grooming"];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/reports/:id/authority", get(get_record).put(put_record))
        .route("/admin/reports/:id/authority/export", get(export_report))
        .route("/admin/safety/matches/:id/export", get(export_match))
}

/// Whether a report in this category may be closed yet. Called from `reports::update`.
pub async fn may_close(db: &PgPool, report_id: Uuid) -> AppResult<()> {
    let row: Option<(String, bool)> = sqlx::query_as(
        "SELECT r.category, EXISTS (SELECT 1 FROM authority_reports a WHERE a.subject_kind = 'report' AND a.subject_id = r.id) FROM reports r WHERE r.id = $1",
    ).bind(report_id).fetch_optional(db).await?;
    match row {
        Some((cat, false)) if MANDATORY.contains(&cat.as_str()) => Err(AppError::BadRequest(
            "Before this report can be closed, a trust-and-safety lead or legal must record the report made to the authorities, or that none was needed and why.".into(),
        )),
        _ => Ok(()),
    }
}

async fn record_json(db: &PgPool, id: Uuid) -> AppResult<Value> {
    let Some((category,)): Option<(String,)> = sqlx::query_as("SELECT category FROM reports WHERE id = $1").bind(id).fetch_optional(db).await? else { return Err(AppError::NotFound("Report not found".into())) };
    let rec: Option<(String, String, String, Option<chrono::DateTime<chrono::Utc>>, bool, String, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT a.decision, a.authority, a.reference, a.filed_at, a.evidence_preserved, a.note, (SELECT username FROM users WHERE id = a.recorded_by), a.recorded_at
           FROM authority_reports a WHERE a.subject_kind = 'report' AND a.subject_id = $1",
    ).bind(id).fetch_optional(db).await?;
    Ok(json!({
        "required": MANDATORY.contains(&category.as_str()),
        "record": rec.map(|r| json!({ "decision": r.0, "authority": r.1, "reference": r.2, "filed_at": r.3, "evidence_preserved": r.4, "note": r.5, "recorded_by": r.6, "recorded_at": r.7 })),
    }))
}

async fn get_record(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::ReportContextRead).await?;
    Ok(Json(record_json(&state.db, id).await?))
}

#[derive(Deserialize)]
struct PutRecord {
    /// 'filed' or 'not_required'.
    decision: String,
    #[serde(default)] authority: String,
    #[serde(default)] reference: String,
    filed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The checklist line: the evidence must be kept. Recording it puts the report on legal hold.
    #[serde(default)] evidence_preserved: bool,
    #[serde(default)] note: String,
}

/// `PUT /admin/reports/:id/authority`: record what was done. For a filed report all of where, reference, date and
/// "the evidence is preserved" are needed; for "none was needed", the reason.
async fn put_record(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<PutRecord>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::SafetyMatchReview).await?;
    let exists: Option<(bool,)> = sqlx::query_as("SELECT true FROM reports WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    if exists.is_none() { return Err(AppError::NotFound("Report not found".into())) }
    let (authority, reference, note) = (req.authority.trim().chars().take(200).collect::<String>(), req.reference.trim().chars().take(200).collect::<String>(), req.note.trim().chars().take(2000).collect::<String>());
    match req.decision.as_str() {
        "filed" => {
            if authority.is_empty() || reference.is_empty() { return Err(AppError::BadRequest("Say where the report was filed and the reference you were given.".into())) }
            let Some(when) = req.filed_at else { return Err(AppError::BadRequest("Say when the report was filed.".into())) };
            if when > chrono::Utc::now() + chrono::Duration::minutes(5) { return Err(AppError::BadRequest("The filing date is in the future.".into())) }
            if !req.evidence_preserved { return Err(AppError::BadRequest("Confirm that the evidence is preserved. Recording this puts the report on legal hold so it is not cleared.".into())) }
        }
        "not_required" => {
            if note.chars().count() < 10 { return Err(AppError::BadRequest("Say why no report to the authorities was needed (it is kept with the report and in the audit log).".into())) }
        }
        _ => return Err(AppError::BadRequest("decision is filed or not_required".into())),
    }
    let filed = req.decision == "filed";
    sqlx::query(
        "INSERT INTO authority_reports (id, subject_kind, subject_id, decision, authority, reference, filed_at, evidence_preserved, note, recorded_by)
         VALUES ($1, 'report', $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (subject_kind, subject_id) DO UPDATE SET decision = EXCLUDED.decision, authority = EXCLUDED.authority, reference = EXCLUDED.reference, filed_at = EXCLUDED.filed_at,
            evidence_preserved = EXCLUDED.evidence_preserved, note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by, recorded_at = now()",
    ).bind(Uuid::now_v7()).bind(id).bind(&req.decision).bind(if filed { authority.as_str() } else { "" }).bind(if filed { reference.as_str() } else { "" })
     .bind(if filed { req.filed_at } else { None }).bind(filed && req.evidence_preserved).bind(&note).bind(uid).execute(&state.db).await?;
    // "Preserved" has to be true in fact: the hold keeps the snapshot and the copied files past the retention period.
    if filed { sqlx::query("UPDATE reports SET legal_hold = true WHERE id = $1").bind(id).execute(&state.db).await?; }
    audit::record(&state, uid, "report.authority", "report", Some(id), "", json!({ "decision": req.decision, "authority": authority, "reference": reference, "filed_at": req.filed_at, "note": note })).await;
    Ok(Json(record_json(&state.db, id).await?))
}

/// The account a report or a match is about, as a hotline form asks for it: who they said they were, how to reach
/// them, when they joined, and the network addresses they connected from with dates.
async fn person(db: &PgPool, user: Option<Uuid>) -> Value {
    let Some(uid) = user else { return Value::Null };
    let u: Option<(String, String, Option<String>, Option<chrono::DateTime<chrono::Utc>>, chrono::DateTime<chrono::Utc>, bool, String)> = sqlx::query_as(
        "SELECT username, display_name, email, email_verified_at, created_at, suspended_at IS NOT NULL, account_state FROM users WHERE id = $1",
    ).bind(uid).fetch_optional(db).await.ok().flatten();
    let Some(u) = u else { return json!({ "user_id": uid, "note": "This account no longer exists." }) };
    let nets: Vec<(String, String, chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)> =
        sqlx::query_as("SELECT ip, user_agent, first_seen, last_seen FROM user_network_log WHERE user_id = $1 ORDER BY last_seen DESC LIMIT 100").bind(uid).fetch_all(db).await.unwrap_or_default();
    json!({
        "user_id": uid, "username": u.0, "display_name": u.1, "email": u.2, "email_verified_at": u.3, "registered_at": u.4, "suspended": u.5, "account_state": u.6,
        "network_addresses": nets.into_iter().map(|n| json!({ "ip": n.0, "user_agent": n.1, "first_seen": n.2, "last_seen": n.3 })).collect::<Vec<_>>(),
    })
}

fn about(state: &AppState, by: &str) -> Value {
    json!({
        "what_this_is": "Details for a report to the authorities, produced by Parley for the operator of this instance. It contains no files.",
        "generated_at": chrono::Utc::now(), "generated_by": by, "instance_address": state.config.app_url,
    })
}

/// `GET /admin/reports/:id/authority/export`: everything about one report that a hotline form asks for.
async fn export_report(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::SafetyMatchReview).await?;
    let row: Option<(String, String, String, Option<Uuid>, Option<Uuid>, Option<Uuid>, String, Option<Uuid>, String, String, chrono::DateTime<chrono::Utc>, Option<Value>, bool)> = sqlx::query_as(
        "SELECT kind, category, reason, reporter_id, target_user_id, channel_id, channel_name, guild_id, guild_name, content, created_at, evidence, legal_hold FROM reports WHERE id = $1",
    ).bind(id).fetch_optional(&state.db).await?;
    let Some((kind, category, reason, reporter, target, channel, channel_name, guild, guild_name, content, created_at, evidence, hold)) = row else { return Err(AppError::NotFound("Report not found".into())) };
    let files: Vec<(Uuid, String, String, i64, String, bool)> = sqlx::query_as("SELECT attachment_id, filename, content_type, size, sha256, kept FROM report_evidence_files WHERE report_id = $1 ORDER BY attachment_id").bind(id).fetch_all(&state.db).await?;
    let reporter_name: Option<String> = match reporter { Some(r) => sqlx::query_as::<_, (String,)>("SELECT username FROM users WHERE id = $1").bind(r).fetch_optional(&state.db).await?.map(|x| x.0), None => None };
    let ev = evidence.unwrap_or(Value::Null);
    let by = audit::username(&state, uid).await;
    audit::record(&state, uid, "report.authority_export", "report", Some(id), "", json!({ "category": category })).await;
    Ok(Json(json!({
        "about": about(&state, &by),
        "incident": {
            "report_id": id, "kind": kind, "category": category, "reported_to_instance_at": created_at, "what_the_reporter_said": reason,
            "where": { "server_id": guild, "server_name": guild_name, "channel_id": channel, "channel_name": channel_name, "private_conversation": guild.is_none() && channel.is_some() },
        },
        "reported_person": person(&state.db, target).await,
        "reported_by": { "user_id": reporter, "username": reporter_name },
        "content": {
            "text_as_reported": content,
            "message": ev.get("message").cloned().unwrap_or(Value::Null),
            "messages_before": ev.get("before").cloned().unwrap_or(json!([])),
            "messages_after": ev.get("after").cloned().unwrap_or(json!([])),
            "profile_when_reported": ev.get("profile").cloned().unwrap_or(Value::Null),
            "captured_at": ev.get("captured_at").cloned().unwrap_or(Value::Null),
            "files": files.into_iter().map(|(aid, filename, content_type, size, sha256, kept)| json!({
                "attachment_id": aid, "filename": filename, "content_type": content_type, "size": size, "sha256": sha256, "copy_held": kept,
                "held_at": if kept { json!(format!("UPLOAD_DIR/evidence/{id}/{aid}")) } else { Value::Null },
            })).collect::<Vec<_>>(),
        },
        "preservation": { "legal_hold": hold, "note": "Held files are on the server under UPLOAD_DIR/evidence. Do not open, copy or send them except as the authority you report to directs." },
        "record": record_json(&state.db, id).await?["record"].clone(),
    })))
}

/// `GET /admin/safety/matches/:id/export`: the same for an upload that matched known material.
async fn export_match(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Value>> {
    require_perm(&state, uid, Perm::SafetyMatchReview).await?;
    let row: Option<(Value,)> = sqlx::query_as("SELECT to_jsonb(m) FROM media_matches m WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let Some((m,)) = row else { return Err(AppError::NotFound("Match not found".into())) };
    let user = m["user_id"].as_str().and_then(|u| Uuid::parse_str(u).ok());
    let held = m["quarantined"].as_bool().unwrap_or(false);
    let by = audit::username(&state, uid).await;
    audit::record(&state, uid, "safety.match.export", "instance", Some(id), m["username"].as_str().unwrap_or(""), json!({})).await;
    Ok(Json(json!({
        "about": about(&state, &by),
        "incident": {
            "match_id": id, "kind": "upload matched known material", "uploaded_at": m["created_at"], "headed_for": m["surface"],
            "where": { "server_id": m["guild_id"], "channel_id": m["channel_id"] },
            "upload_came_from": { "ip": m["ip"], "user_agent": m["user_agent"] },
            "matched_by": { "source": m["source"], "reference": m["reference"], "category": m["category"] },
        },
        "reported_person": person(&state.db, user).await,
        "username_at_upload": m["username"],
        "content": { "files": [{
            "filename": m["filename"], "content_type": m["content_type"], "size": m["size"], "sha256": m["sha256"], "copy_held": held,
            "held_at": if held { json!(format!("UPLOAD_DIR/quarantine/{id}")) } else { Value::Null },
        }] },
        "preservation": { "legal_hold": m["legal_hold"], "note": "The quarantined file is on the server under UPLOAD_DIR/quarantine. No route serves it. Do not open, copy or send it except as the authority you report to directs." },
        "record": { "status": m["status"], "reference": m["report_ref"], "reported_at": m["reported_at"] },
    })))
}
