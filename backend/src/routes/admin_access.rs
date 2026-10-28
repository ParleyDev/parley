//! Admin access control (docs/admin-access-and-server-deletion.md).
//!
//! Phase 1, roles and permissions: an admin holds roles (`admin_roles`; `ADMIN_EMAILS` admins implicitly hold
//! SUPER_ADMIN and TS_LEAD). Each role grants a fixed set of permissions, mapped in one place (`perms_for`). Every admin
//! endpoint asks for a permission (`require_perm`); hiding things in the console is only a convenience. SUPER_ADMIN
//! manages roles and the instance but has no content permissions.
//!
//! Content is never searched globally: admins reach it through cases (`routes/cases.rs`) and the public-server search
//! (`routes/admin_search.rs`). The append-only `admin_access_log` records every content access, PII reveal and role
//! change. User-facing search (`routes/search.rs`) is a separate path.
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    ratelimit::client_ip,
    routes::users::require_admin,
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap},
    routing::{get, post, put},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use uuid::Uuid;

/// Roles that can be granted, in display order.
pub const ROLES: &[&str] = &["SUPPORT", "MODERATOR", "TS_LEAD", "LEGAL", "SUPER_ADMIN", "AUDITOR"];
/// Shortest justification accepted: enough to say why, not just "x".
pub const MIN_JUSTIFICATION: usize = 10;

/// What an admin may do. Some are further bound to a case (enforced where cases apply).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Perm {
    /// Who someone is: username, join date, state, roles, counts. Never email or IP unmasked.
    AccountMetadataRead,
    /// Unmask email, IP and devices, read the outgoing mail log. Every use is logged.
    AccountPiiReveal,
    /// Servers, DMs and group chats: names, members, counts (no message content).
    ConversationMetadataRead,
    /// Reports and the reported message with its context window.
    ReportContextRead,
    /// Ask for (or, with CaseApprove, grant) more context than the window.
    ReportContextExpand,
    /// Search public / discoverable server content (case-bound for moderators and legal).
    ContentSearchPublic,
    /// DM and group content: only with an approved, unexpired grant on a case.
    ContentSearchPrivate,
    /// Delete messages, suspend, ban, purge, log out, take servers down.
    ContentAction,
    /// Export content: only with an approved case.
    ContentExport,
    /// Approve another admin's grant request (never your own).
    CaseApprove,
    /// Grant and revoke admin roles.
    AdminRolesManage,
    /// Read the audit log: your own actions, your team's (moderators and leads), or all of it.
    AuditReadOwn,
    AuditReadTeam,
    AuditReadAll,
    /// Instance settings, mail settings, Discover review, app verification, maintenance, blocked domains, stats.
    InstanceManage,
}

use Perm::*;

/// The role → permission mapping. Change access here and nowhere else.
pub fn perms_for(role: &str) -> &'static [Perm] {
    match role {
        "SUPPORT" => &[AccountMetadataRead, AccountPiiReveal],
        "MODERATOR" => &[AccountMetadataRead, ConversationMetadataRead, ReportContextRead, ReportContextExpand, ContentSearchPublic, ContentAction, AuditReadOwn],
        "TS_LEAD" => &[AccountMetadataRead, AccountPiiReveal, ConversationMetadataRead, ReportContextRead, ReportContextExpand, ContentSearchPublic, ContentSearchPrivate, ContentAction, CaseApprove, AuditReadTeam],
        "LEGAL" => &[AccountMetadataRead, AccountPiiReveal, ConversationMetadataRead, ReportContextRead, ReportContextExpand, ContentSearchPublic, ContentSearchPrivate, ContentExport, AuditReadAll],
        "SUPER_ADMIN" => &[AccountMetadataRead, AdminRolesManage, AuditReadAll, InstanceManage],
        "AUDITOR" => &[AuditReadAll],
        _ => &[],
    }
}

/// An admin's roles and what they add up to.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Access { pub roles: Vec<String>, pub perms: BTreeSet<Perm> }
impl Access {
    pub fn has(&self, p: Perm) -> bool { self.perms.contains(&p) }
    pub fn has_role(&self, r: &str) -> bool { self.roles.iter().any(|x| x == r) }
    /// T&S leads and legal see emails, IPs and devices in full; others see them masked (support can reveal, logged).
    pub fn pii_unmasked(&self) -> bool { self.has_role("TS_LEAD") || self.has_role("LEGAL") }
    /// T&S leads search public servers without a case; moderators and legal only under one.
    pub fn public_search_unbound(&self) -> bool { self.has_role("TS_LEAD") }
}

fn env_listed(state: &AppState, email: Option<&str>) -> bool {
    email.is_some_and(|e| state.config.admin_emails.iter().any(|a| a.eq_ignore_ascii_case(e)))
}

/// Roles held: rows in `admin_roles`, plus SUPER_ADMIN and TS_LEAD for `ADMIN_EMAILS` admins.
pub async fn access(state: &AppState, uid: Uuid) -> AppResult<Access> {
    let mut roles: Vec<String> = sqlx::query_as::<_, (String,)>("SELECT role FROM admin_roles WHERE user_id = $1").bind(uid).fetch_all(&state.db).await?.into_iter().map(|r| r.0).collect();
    let email: Option<(Option<String>,)> = sqlx::query_as("SELECT email FROM users WHERE id = $1").bind(uid).fetch_optional(&state.db).await?;
    if env_listed(state, email.and_then(|e| e.0).as_deref()) {
        for r in ["SUPER_ADMIN", "TS_LEAD"] { if !roles.iter().any(|x| x == r) { roles.push(r.into()) } }
    }
    roles.sort_by_key(|r| ROLES.iter().position(|x| x == r).unwrap_or(99));
    let perms = roles.iter().flat_map(|r| perms_for(r).iter().copied()).collect();
    Ok(Access { roles, perms })
}

/// Console access with a permission. 403 otherwise.
pub async fn require_perm(state: &AppState, uid: Uuid, p: Perm) -> AppResult<Access> {
    require_admin(state, uid).await?;
    let a = access(state, uid).await?;
    if a.has(p) { Ok(a) } else { Err(AppError::Forbidden) }
}

/// Console access with any one of these permissions. 403 otherwise.
pub async fn require_any(state: &AppState, uid: Uuid, ps: &[Perm]) -> AppResult<Access> {
    require_admin(state, uid).await?;
    let a = access(state, uid).await?;
    if ps.iter().any(|p| a.has(*p)) { Ok(a) } else { Err(AppError::Forbidden) }
}

/// A justification for a content or PII access: required, trimmed, at least `MIN_JUSTIFICATION` characters, at most 1000.
pub fn justification(raw: Option<&str>) -> AppResult<String> {
    let j: String = raw.unwrap_or_default().trim().chars().take(1000).collect();
    if j.chars().count() < MIN_JUSTIFICATION {
        return Err(AppError::BadRequest(format!("Say why you need this (at least {MIN_JUSTIFICATION} characters). Every access is logged.")));
    }
    Ok(j)
}

/// `a***@example.com`: enough to tell accounts apart, not enough to contact anyone.
pub fn mask_email(e: &str) -> String {
    match e.split_once('@') {
        Some((local, domain)) => format!("{}***@{}", local.chars().next().unwrap_or('*'), domain),
        None => "***".into(),
    }
}

/// One entry in the append-only access log. Failing to log fails the request: no log, no access.
pub struct Entry<'a> { pub action: &'a str, pub query: &'a str, pub filters: Value, pub justification: &'a str, pub targets: &'a [Uuid] }

pub async fn log(state: &AppState, uid: Uuid, roles: &[String], headers: &HeaderMap, e: Entry<'_>) -> AppResult<()> {
    log_case(state, uid, roles, headers, None, e).await
}

pub async fn log_case(state: &AppState, uid: Uuid, roles: &[String], headers: &HeaderMap, case_id: Option<Uuid>, e: Entry<'_>) -> AppResult<()> {
    let ua: String = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or_default().chars().take(400).collect();
    sqlx::query("INSERT INTO admin_access_log (id, actor_id, actor_roles, action, query, filters, justification, target_ids, case_id, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)")
        .bind(Uuid::now_v7()).bind(uid).bind(roles).bind(e.action).bind(e.query).bind(&e.filters).bind(e.justification).bind(e.targets).bind(case_id)
        .bind(client_ip(headers)).bind(ua).execute(&state.db).await?;
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/access", get(my_access))
        .route("/admin/access-log", get(read_log))
        .route("/admin/roles", get(list_roles))
        .route("/admin/users/:id/roles", put(set_roles))
        .route("/admin/users/:id/reveal", post(reveal))
}

/// `GET /admin/access`: this admin's roles and permissions (the console shows what they may use).
async fn my_access(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_admin(&state, uid).await?;
    let a = access(&state, uid).await?;
    Ok(Json(json!({ "roles": a.roles, "perms": a.perms, "all_roles": ROLES })))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct LogRow { pub id: Uuid, pub at: DateTime<Utc>, pub actor_id: Uuid, pub actor_roles: Vec<String>, pub action: String, pub query: String, pub filters: Value, pub justification: String, pub target_ids: Vec<Uuid>, pub case_id: Option<Uuid>, pub ip: String, pub user_agent: String }

#[derive(Deserialize)]
struct LogQuery { actor_id: Option<Uuid>, before: Option<DateTime<Utc>>, limit: Option<i64> }

/// `GET /admin/access-log`: the access log, newest first (anyone who may read the whole audit log).
async fn read_log(State(state): State<AppState>, AuthUser(uid): AuthUser, Query(q): Query<LogQuery>) -> AppResult<Json<Vec<LogRow>>> {
    require_perm(&state, uid, AuditReadAll).await?;
    Ok(Json(sqlx::query_as::<_, LogRow>("SELECT id, at, actor_id, actor_roles, action, query, filters, justification, target_ids, case_id, ip, user_agent FROM admin_access_log
        WHERE ($1::uuid IS NULL OR actor_id = $1) AND ($2::timestamptz IS NULL OR at < $2) ORDER BY at DESC LIMIT $3")
        .bind(q.actor_id).bind(q.before).bind(q.limit.unwrap_or(100).clamp(1, 500)).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
pub struct Justified { pub justification: Option<String> }

/// `GET /admin/roles`: everyone holding a role (granted rows; `ADMIN_EMAILS` admins are listed as such).
async fn list_roles(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    require_perm(&state, uid, AdminRolesManage).await?;
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as("SELECT u.id, u.username, u.display_name FROM users u WHERE u.is_admin OR EXISTS (SELECT 1 FROM admin_roles r WHERE r.user_id = u.id) ORDER BY u.username").fetch_all(&state.db).await?;
    let mut out = Vec::new();
    for (id, username, display_name) in rows { out.push(json!({ "id": id, "username": username, "display_name": display_name, "roles": access(&state, id).await?.roles })) }
    Ok(Json(json!(out)))
}

#[derive(Deserialize)]
struct RolesIn { roles: Vec<String> }

/// `PUT /admin/users/:id/roles`: replace someone's roles (SUPER_ADMIN only). Console access follows: any role grants
/// it, none takes it away. At least one SUPER_ADMIN must remain. Logged with the before and after.
async fn set_roles(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path(id): Path<Uuid>, Json(req): Json<RolesIn>) -> AppResult<Json<Value>> {
    let me = require_perm(&state, uid, AdminRolesManage).await?;
    let mut want: Vec<String> = req.roles.into_iter().map(|r| r.trim().to_uppercase()).collect();
    want.sort(); want.dedup();
    if let Some(bad) = want.iter().find(|r| !ROLES.contains(&r.as_str())) { return Err(AppError::BadRequest(format!("Unknown role {bad}"))) }
    let (exists, state_): (bool, String) = sqlx::query_as("SELECT true, account_state FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("User not found".into()))?;
    if !exists || state_ != "active" { return Err(AppError::BadRequest("Roles can only be given to active accounts".into())) }
    let before = access(&state, id).await?.roles;
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM admin_roles WHERE user_id = $1").bind(id).execute(&mut *tx).await?;
    for r in &want { sqlx::query("INSERT INTO admin_roles (user_id, role, granted_by) VALUES ($1, $2, $3)").bind(id).bind(r).bind(uid).execute(&mut *tx).await?; }
    sqlx::query("UPDATE users SET is_admin = $2, admin_via_env = false WHERE id = $1").bind(id).bind(!want.is_empty()).execute(&mut *tx).await?;
    // Somebody must still be able to manage roles: a granted SUPER_ADMIN, or an ADMIN_EMAILS admin.
    let (granted,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM admin_roles WHERE role = 'SUPER_ADMIN'").fetch_one(&mut *tx).await?;
    let env_admins: Vec<(Option<String>,)> = sqlx::query_as("SELECT email FROM users WHERE account_state = 'active'").fetch_all(&mut *tx).await?;
    let env = env_admins.iter().any(|(e,)| env_listed(&state, e.as_deref()));
    if granted == 0 && !env { return Err(AppError::BadRequest("At least one SUPER_ADMIN must remain".into())) }
    tx.commit().await?;
    let after = access(&state, id).await?.roles;
    log(&state, uid, &me.roles, &headers, Entry { action: "roles.set", query: "", filters: json!({ "before": before, "after": after }), justification: "", targets: &[id] }).await?;
    state.hub.session_forget(id);
    Ok(Json(json!({ "id": id, "roles": after })))
}

/// `POST /admin/users/:id/reveal` (justification): the unmasked email and recent IPs and devices. Logged.
async fn reveal(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path(id): Path<Uuid>, Json(j): Json<Justified>) -> AppResult<Json<Value>> {
    let a = require_perm(&state, uid, AccountPiiReveal).await?;
    let why = justification(j.justification.as_deref())?;
    let (email,): (Option<String>,) = sqlx::query_as("SELECT email FROM users WHERE id = $1").bind(id).fetch_optional(&state.db).await?.ok_or_else(|| AppError::NotFound("User not found".into()))?;
    let sessions: Vec<(String, String, DateTime<Utc>)> = sqlx::query_as("SELECT ip, user_agent, last_seen_at FROM sessions WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 20").bind(id).fetch_all(&state.db).await?;
    log(&state, uid, &a.roles, &headers, Entry { action: "pii.reveal", query: "", filters: json!({}), justification: &why, targets: &[id] }).await?;
    Ok(Json(json!({ "email": email, "sessions": sessions.iter().map(|(ip, ua, at)| json!({ "ip": ip, "user_agent": ua, "last_seen_at": at })).collect::<Vec<_>>() })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn justification_is_required_and_trimmed() {
        assert!(justification(None).is_err());
        assert!(justification(Some("   short  ")).is_err());
        assert_eq!(justification(Some("  report #42 follow-up ")).unwrap(), "report #42 follow-up");
        assert_eq!(justification(Some(&"x".repeat(2000))).unwrap().len(), 1000);
    }

    #[test]
    fn super_admin_manages_but_reads_no_content() {
        let p = perms_for("SUPER_ADMIN");
        assert!(p.contains(&AdminRolesManage) && p.contains(&InstanceManage));
        for c in [ContentSearchPublic, ContentSearchPrivate, ReportContextRead, ContentAction, ContentExport, AccountPiiReveal] { assert!(!p.contains(&c), "{c:?}") }
    }

    #[test]
    fn the_table_holds() {
        assert!(!perms_for("SUPPORT").contains(&ReportContextRead));
        assert!(!perms_for("MODERATOR").contains(&AccountPiiReveal) && perms_for("MODERATOR").contains(&ContentAction));
        assert!(perms_for("TS_LEAD").contains(&CaseApprove) && !perms_for("MODERATOR").contains(&CaseApprove));
        assert!(perms_for("LEGAL").contains(&ContentExport) && !perms_for("LEGAL").contains(&ContentAction));
        assert_eq!(perms_for("AUDITOR"), &[AuditReadAll]);
        assert!(ROLES.iter().all(|r| !perms_for(r).is_empty()));
        assert!(!ROLES.iter().any(|r| perms_for(r).contains(&ContentExport) && *r != "LEGAL"), "only legal exports");
    }

    #[test]
    fn emails_are_masked() {
        assert_eq!(mask_email("alice@example.com"), "a***@example.com");
        assert_eq!(mask_email("nope"), "***");
    }
}
