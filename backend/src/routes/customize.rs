//! Channels & Roles: Browse Channels (each member hides channels they don't want in their list), self-assignable
//! roles, and onboarding questions whose answers grant roles and show channels.

use crate::{auth::AuthUser, error::{AppError, AppResult}, perms, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::{get, post, put}, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/me/customize", get(mine))
        .route("/guilds/:id/me/hidden-channels", put(set_hidden))
        .route("/guilds/:id/me/roles/:rid", put(add_role).delete(remove_role))
        .route("/guilds/:id/onboarding", put(set_onboarding))
        .route("/guilds/:id/onboarding/answers", post(answer))
}

/// `GET /guilds/:id/me/customize`: your hidden channels, whether you've done onboarding, and the questions.
async fn mine(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Value>> {
    let row: Option<(Vec<Uuid>, Option<chrono::DateTime<chrono::Utc>>, Value)> = sqlx::query_as(
        "SELECT m.hidden_channels, m.onboarded_at, g.onboarding FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.guild_id = $1 AND m.user_id = $2")
        .bind(gid).bind(uid).fetch_optional(&state.db).await?;
    let Some((hidden, onboarded, onboarding)) = row else { return Err(AppError::NotFound("Server not found".into())) };
    Ok(Json(json!({ "hidden_channels": hidden, "onboarded": onboarded.is_some(), "onboarding": onboarding })))
}

#[derive(Deserialize)]
struct HiddenReq { channel_ids: Vec<Uuid> }

async fn set_hidden(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<HiddenReq>) -> AppResult<StatusCode> {
    perms::guild_perms(&state.db, gid, uid).await?;
    let mut ids = req.channel_ids;
    ids.sort(); ids.dedup(); ids.truncate(500);
    sqlx::query("UPDATE guild_members SET hidden_channels = $3 WHERE guild_id = $1 AND user_id = $2").bind(gid).bind(uid).bind(&ids).execute(&state.db).await?;
    state.hub.emit_users(vec![uid], "GUILD_CUSTOMIZE_UPDATE", json!({ "guild_id": gid, "hidden_channels": ids }));
    Ok(StatusCode::NO_CONTENT)
}

/// Give yourself roles (and refresh what you can see).
async fn grant(state: &AppState, gid: Uuid, uid: Uuid, roles: &[Uuid], add: bool) -> AppResult<()> {
    let before = perms::visibility(&state.db, gid).await?;
    for r in roles {
        if add { sqlx::query("INSERT INTO member_roles (guild_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING").bind(gid).bind(uid).bind(r).execute(&state.db).await?; }
        else { sqlx::query("DELETE FROM member_roles WHERE guild_id = $1 AND user_id = $2 AND role_id = $3").bind(gid).bind(uid).bind(r).execute(&state.db).await?; }
    }
    perms::resync_visibility(state, gid, &before).await?;
    let m = crate::routes::guilds::fetch_member(&state.db, gid, uid).await?;
    state.hub.emit_guild(gid, "GUILD_MEMBER_UPDATE", json!(m));
    Ok(())
}

async fn self_role(state: &AppState, gid: Uuid, uid: Uuid, rid: Uuid) -> AppResult<()> {
    let (ctx, _) = perms::guild_perms(&state.db, gid, uid).await?;
    let role = ctx.roles.get(&rid).ok_or(AppError::NotFound("Role not found".into()))?;
    if !role.self_assignable || (role.permissions as u64) & perms::SELF_GRANT_FORBIDDEN != 0 { return Err(AppError::Forbidden) }
    Ok(())
}

async fn add_role(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, rid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    self_role(&state, gid, uid, rid).await?;
    grant(&state, gid, uid, &[rid], true).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_role(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((gid, rid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    self_role(&state, gid, uid, rid).await?;
    grant(&state, gid, uid, &[rid], false).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, serde::Serialize, Clone)]
struct OptionIn { #[serde(default)] id: Option<Uuid>, label: String, #[serde(default)] emoji: String, #[serde(default)] role_ids: Vec<Uuid>, #[serde(default)] channel_ids: Vec<Uuid> }
#[derive(Deserialize, serde::Serialize, Clone)]
struct QuestionIn { #[serde(default)] id: Option<Uuid>, title: String, #[serde(default)] multi: bool, #[serde(default)] required: bool, options: Vec<OptionIn> }
#[derive(Deserialize)]
struct OnboardingIn { enabled: bool, questions: Vec<QuestionIn> }

/// `PUT /guilds/:id/onboarding` (Manage Server): up to 5 questions with up to 10 answers each. Answers may only grant
/// roles without moderation powers.
async fn set_onboarding(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<OnboardingIn>) -> AppResult<Json<Value>> {
    let (ctx, p) = perms::guild_perms(&state.db, gid, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    if req.questions.len() > 5 { return Err(AppError::BadRequest("Up to 5 questions".into())) }
    let chans: HashSet<Uuid> = sqlx::query_as::<_, (Uuid,)>("SELECT id FROM channels WHERE guild_id = $1").bind(gid).fetch_all(&state.db).await?.into_iter().map(|r| r.0).collect();
    let mut qs = Vec::new();
    for q in req.questions {
        let title: String = q.title.trim().chars().take(100).collect();
        if title.is_empty() || q.options.is_empty() || q.options.len() > 10 { return Err(AppError::BadRequest("Each question needs a title and 1 to 10 answers".into())) }
        let mut opts = Vec::new();
        for o in q.options {
            for r in &o.role_ids {
                let role = ctx.roles.get(r).ok_or(AppError::BadRequest("Unknown role in an answer".into()))?;
                if *r == gid || (role.permissions as u64) & perms::SELF_GRANT_FORBIDDEN != 0 || !ctx.outranks_role(uid, role) { return Err(AppError::BadRequest(format!("Answers can't grant {}", role.name))) }
            }
            if o.channel_ids.iter().any(|c| !chans.contains(c)) { return Err(AppError::BadRequest("Unknown channel in an answer".into())) }
            opts.push(OptionIn { id: Some(o.id.unwrap_or_else(Uuid::now_v7)), label: o.label.trim().chars().take(50).collect(), emoji: o.emoji.trim().chars().take(32).collect(), role_ids: o.role_ids, channel_ids: o.channel_ids });
        }
        qs.push(QuestionIn { id: Some(q.id.unwrap_or_else(Uuid::now_v7)), title, multi: q.multi, required: q.required, options: opts });
    }
    let v = json!({ "enabled": req.enabled, "questions": qs });
    sqlx::query("UPDATE guilds SET onboarding = $2 WHERE id = $1").bind(gid).bind(&v).execute(&state.db).await?;
    if let Ok(g) = sqlx::query_as::<_, crate::models::Guild>(&format!("SELECT {} FROM guilds WHERE id = $1", crate::routes::guilds::GUILD_COLS)).bind(gid).fetch_one(&state.db).await {
        state.hub.emit_guild(gid, "GUILD_UPDATE", json!(g));
    }
    let name = crate::audit::guild_name(&state, gid).await;
    crate::audit::guild(&state, gid, uid, "guild.onboarding", "guild", Some(gid), &name, json!({ "enabled": req.enabled, "questions": v["questions"].as_array().map(|a| a.len()) })).await;
    Ok(Json(v))
}

#[derive(Deserialize)]
struct AnswersIn { option_ids: Vec<Uuid> }

/// `POST /guilds/:id/onboarding/answers`: your picks; their roles are granted and their channels shown.
async fn answer(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<AnswersIn>) -> AppResult<StatusCode> {
    perms::guild_perms(&state.db, gid, uid).await?;
    let (ob,): (Value,) = sqlx::query_as("SELECT onboarding FROM guilds WHERE id = $1").bind(gid).fetch_one(&state.db).await?;
    let qs: Vec<QuestionIn> = serde_json::from_value(ob["questions"].clone()).unwrap_or_default();
    let picked: HashSet<Uuid> = req.option_ids.into_iter().collect();
    let mut roles = Vec::new();
    let mut show = Vec::new();
    for q in &qs {
        let chosen: Vec<&OptionIn> = q.options.iter().filter(|o| o.id.map(|i| picked.contains(&i)).unwrap_or(false)).collect();
        if q.required && chosen.is_empty() { return Err(AppError::BadRequest(format!("Please answer “{}”", q.title))) }
        if !q.multi && chosen.len() > 1 { return Err(AppError::BadRequest(format!("Pick one answer for “{}”", q.title))) }
        for o in chosen { roles.extend(o.role_ids.iter().copied()); show.extend(o.channel_ids.iter().copied()); }
    }
    // Re-check every role at answer time (a role may have gained powers since the question was saved).
    let (ctx, _) = perms::guild_perms(&state.db, gid, uid).await?;
    roles.retain(|r| ctx.roles.get(r).map(|x| (x.permissions as u64) & perms::SELF_GRANT_FORBIDDEN == 0 && *r != gid).unwrap_or(false));
    roles.sort(); roles.dedup();
    if !roles.is_empty() { grant(&state, gid, uid, &roles, true).await?; }
    sqlx::query("UPDATE guild_members SET onboarded_at = now(), hidden_channels = ARRAY(SELECT unnest(hidden_channels) EXCEPT SELECT unnest($3::uuid[])) WHERE guild_id = $1 AND user_id = $2")
        .bind(gid).bind(uid).bind(&show).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
