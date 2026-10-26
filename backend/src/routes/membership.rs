//! Membership applications: the server asks new members questions; moderators approve (unlocking chat) or reject
//! (removing them). Pending members are held by the rules gate (`guilds::check_rules`).

use crate::{auth::AuthUser, error::{AppError, AppResult}, perms, state::AppState};
use axum::{extract::{Path, Query, State}, http::StatusCode, routing::{get, post, put}, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use super::guilds::{fetch_member, remove_member, GUILD_COLS};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/application-form", put(set_form))
        .route("/guilds/:id/application", get(mine).post(apply))
        .route("/guilds/:id/applications", get(list))
        .route("/guilds/:id/applications/:uid/approve", post(approve))
        .route("/guilds/:id/applications/:uid/reject", post(reject))
}

/// Who reviews applications.
const REVIEW: u64 = perms::KICK_MEMBERS | perms::MANAGE_GUILD;

#[derive(Deserialize, Serialize, Clone)]
struct Question { #[serde(default)] id: Option<Uuid>, title: String, #[serde(default)] paragraph: bool, #[serde(default)] required: bool }
#[derive(Deserialize)]
struct FormIn { enabled: bool, questions: Vec<Question> }

/// `PUT /guilds/:id/application-form` (Manage Server). Turning it on lets current members keep chatting: only people
/// who join afterwards need to apply.
async fn set_form(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<FormIn>) -> AppResult<Json<Value>> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    if req.questions.len() > 5 { return Err(AppError::BadRequest("Up to 5 questions".into())) }
    let mut qs = Vec::new();
    for q in req.questions {
        let title: String = q.title.trim().chars().take(150).collect();
        if title.is_empty() { return Err(AppError::BadRequest("Each question needs some text".into())) }
        qs.push(Question { id: Some(q.id.unwrap_or_else(Uuid::now_v7)), title, paragraph: q.paragraph, required: q.required });
    }
    if req.enabled && qs.is_empty() { return Err(AppError::BadRequest("Add at least one question".into())) }
    let v = json!({ "enabled": req.enabled, "questions": qs });
    let mut tx = state.db.begin().await?;
    let (was,): (bool,) = sqlx::query_as("SELECT COALESCE((applications->>'enabled')::boolean, false) FROM guilds WHERE id = $1").bind(gid).fetch_one(&mut *tx).await?;
    if req.enabled && !was {
        sqlx::query("UPDATE guild_members SET rules_accepted_at = now() WHERE guild_id = $1 AND rules_accepted_at IS NULL").bind(gid).execute(&mut *tx).await?;
    }
    sqlx::query("UPDATE guilds SET applications = $2 WHERE id = $1").bind(gid).bind(&v).execute(&mut *tx).await?;
    tx.commit().await?;
    if let Ok(g) = sqlx::query_as::<_, crate::models::Guild>(&format!("SELECT {GUILD_COLS} FROM guilds WHERE id = $1")).bind(gid).fetch_one(&state.db).await {
        state.hub.emit_guild(gid, "GUILD_UPDATE", json!(g));
    }
    let name = crate::audit::guild_name(&state, gid).await;
    crate::audit::guild(&state, gid, uid, "guild.applications", "guild", Some(gid), &name, json!({ "enabled": req.enabled })).await;
    Ok(Json(v))
}

#[derive(Serialize, sqlx::FromRow)]
struct Application { user_id: Uuid, answers: Value, status: String, reason: String, created_at: chrono::DateTime<chrono::Utc>, decided_at: Option<chrono::DateTime<chrono::Utc>> }

/// `GET /guilds/:id/application`: your application here, if any.
async fn mine(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Option<Application>>> {
    perms::guild_perms(&state.db, gid, uid).await?;
    Ok(Json(sqlx::query_as::<_, Application>("SELECT user_id, answers, status, reason, created_at, decided_at FROM guild_applications WHERE guild_id = $1 AND user_id = $2").bind(gid).bind(uid).fetch_optional(&state.db).await?))
}

#[derive(Deserialize)]
struct Answer { question_id: Uuid, answer: String }
#[derive(Deserialize)]
struct ApplyIn { answers: Vec<Answer> }

/// `POST /guilds/:id/application`: submit (or resubmit while pending) your answers.
async fn apply(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<ApplyIn>) -> AppResult<Json<Application>> {
    perms::guild_perms(&state.db, gid, uid).await?;
    let (form, accepted): (Value, bool) = sqlx::query_as("SELECT g.applications, m.rules_accepted_at IS NOT NULL FROM guilds g JOIN guild_members m ON m.guild_id = g.id AND m.user_id = $2 WHERE g.id = $1")
        .bind(gid).bind(uid).fetch_one(&state.db).await?;
    if !form["enabled"].as_bool().unwrap_or(false) { return Err(AppError::BadRequest("This server doesn't take applications".into())) }
    if accepted { return Err(AppError::BadRequest("You're already in".into())) }
    let qs: Vec<Question> = serde_json::from_value(form["questions"].clone()).unwrap_or_default();
    let mut out = Vec::new();
    for q in &qs {
        let a = req.answers.iter().find(|a| Some(a.question_id) == q.id).map(|a| a.answer.trim().chars().take(if q.paragraph { 1000 } else { 150 }).collect::<String>()).unwrap_or_default();
        if q.required && a.is_empty() { return Err(AppError::BadRequest(format!("Please answer “{}”", q.title))) }
        out.push(json!({ "question": q.title, "answer": a }));
    }
    let app = sqlx::query_as::<_, Application>(
        "INSERT INTO guild_applications (guild_id, user_id, answers) VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET answers = EXCLUDED.answers, status = 'pending', reason = '', created_at = now(), decided_by = NULL, decided_at = NULL
         WHERE guild_applications.status <> 'approved'
         RETURNING user_id, answers, status, reason, created_at, decided_at")
        .bind(gid).bind(uid).bind(json!(out)).fetch_optional(&state.db).await?.ok_or(AppError::Conflict("Already approved".into()))?;
    Ok(Json(app))
}

#[derive(Deserialize)]
struct ListQ { #[serde(default)] status: Option<String> }

/// `GET /guilds/:id/applications?status=pending` (Kick Members or Manage Server).
async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Query(q): Query<ListQ>) -> AppResult<Json<Vec<Value>>> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check_any(p, REVIEW)?;
    let status = q.status.unwrap_or_else(|| "pending".into());
    let rows: Vec<(Uuid, Value, String, String, chrono::DateTime<chrono::Utc>, String, String, Option<String>, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT a.user_id, a.answers, a.status, a.reason, a.created_at, u.username, u.display_name, u.avatar_url, u.created_at FROM guild_applications a JOIN users u ON u.id = a.user_id
         WHERE a.guild_id = $1 AND a.status = $2 ORDER BY a.created_at LIMIT 200")
        .bind(gid).bind(&status).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(|(id, answers, status, reason, at, username, name, avatar, joined)| json!({
        "user_id": id, "answers": answers, "status": status, "reason": reason, "created_at": at,
        "user": { "id": id, "username": username, "display_name": name, "avatar_url": avatar, "created_at": joined } })).collect()))
}

async fn decide(state: &AppState, gid: Uuid, uid: Uuid, target: Uuid, status: &str, reason: &str) -> AppResult<()> {
    let (_, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check_any(p, REVIEW)?;
    let res = sqlx::query("UPDATE guild_applications SET status = $3, reason = $4, decided_by = $5, decided_at = now() WHERE guild_id = $1 AND user_id = $2 AND status = 'pending'")
        .bind(gid).bind(target).bind(status).bind(reason).bind(uid).execute(&state.db).await?;
    if res.rows_affected() == 0 { return Err(AppError::NotFound("No pending application".into())) }
    state.hub.emit_users(vec![target], "APPLICATION_UPDATE", json!({ "guild_id": gid, "status": status, "reason": reason }));
    let name = crate::audit::username(state, target).await;
    crate::audit::guild(state, gid, uid, &format!("member.application_{status}"), "user", Some(target), &name, json!({ "reason": reason })).await;
    Ok(())
}

/// Approve: they're in (the rules gate opens).
async fn approve(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, target)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    decide(&state, gid, uid, target, "approved", "").await?;
    sqlx::query("UPDATE guild_members SET rules_accepted_at = COALESCE(rules_accepted_at, now()) WHERE guild_id = $1 AND user_id = $2").bind(gid).bind(target).execute(&state.db).await?;
    if let Ok(m) = fetch_member(&state.db, gid, target).await { state.hub.emit_guild(gid, "GUILD_MEMBER_UPDATE", json!(m)); }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct RejectIn { #[serde(default)] reason: String }

/// Reject: they're removed from the server, with the reason.
async fn reject(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, target)): Path<(Uuid, Uuid)>, body: Option<Json<RejectIn>>) -> AppResult<StatusCode> {
    let reason: String = body.map(|Json(b)| b.reason).unwrap_or_default().trim().chars().take(300).collect();
    decide(&state, gid, uid, target, "rejected", &reason).await?;
    remove_member(&state, gid, target).await?;
    Ok(StatusCode::NO_CONTENT)
}
