//! Scheduled events: a named time slot in a voice/stage channel or at an external location, with RSVPs.
//! Manage Server creates and edits; any member RSVPs. Changes are pushed to the server as EVENT_UPDATE.

use crate::{auth::AuthUser, error::{AppError, AppResult}, perms, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::{get, put}, Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/events", get(list).post(create))
        .route("/guilds/:id/events/:eid", axum::routing::patch(update).delete(remove))
        .route("/guilds/:id/events/:eid/rsvp", put(rsvp).delete(unrsvp))
}

#[derive(Debug, Serialize, FromRow)]
pub struct Event {
    pub id: Uuid,
    pub guild_id: Uuid,
    pub name: String,
    pub description: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    pub channel_id: Option<Uuid>,
    pub location: String,
    pub creator_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub rsvp_count: i64,
    pub me_rsvp: bool,
}

const EVENT_SELECT: &str = "SELECT e.id, e.guild_id, e.name, e.description, e.starts_at, e.ends_at, e.channel_id, e.location, e.creator_id, e.created_at,
    (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id) AS rsvp_count,
    EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = $2) AS me_rsvp
    FROM guild_events e";

async fn require_member(db: &PgPool, guild_id: Uuid, uid: Uuid) -> AppResult<()> {
    let row: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2").bind(guild_id).bind(uid).fetch_optional(db).await?;
    if row.is_some() { Ok(()) } else { Err(AppError::NotFound("Server not found".into())) }
}

/// Upcoming and ongoing events (ended ones drop off an hour after they end), soonest first.
pub async fn events_for(db: &PgPool, guild_id: Uuid, me: Uuid) -> AppResult<Vec<Event>> {
    Ok(sqlx::query_as::<_, Event>(&format!("{EVENT_SELECT} WHERE e.guild_id = $1 AND COALESCE(e.ends_at, e.starts_at + interval '2 hours') > now() - interval '1 hour' ORDER BY e.starts_at LIMIT 100"))
        .bind(guild_id).bind(me).fetch_all(db).await?)
}

async fn one(db: &PgPool, eid: Uuid, me: Uuid) -> AppResult<Event> {
    sqlx::query_as::<_, Event>(&format!("{EVENT_SELECT} WHERE e.id = $1")).bind(eid).bind(me).fetch_optional(db).await?.ok_or_else(|| AppError::NotFound("Event not found".into()))
}

async fn list(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<Vec<Event>>> {
    require_member(&state.db, id, uid).await?;
    Ok(Json(events_for(&state.db, id, uid).await?))
}

#[derive(Deserialize)]
struct EventInput {
    name: Option<String>,
    description: Option<String>,
    starts_at: Option<DateTime<Utc>>,
    #[serde(default, deserialize_with = "nullable_time")]
    ends_at: Option<Option<DateTime<Utc>>>,
    #[serde(default, deserialize_with = "nullable_uuid")]
    channel_id: Option<Option<Uuid>>,
    location: Option<String>,
}
fn nullable_time<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<DateTime<Utc>>>, D::Error> { Ok(Some(Option::<DateTime<Utc>>::deserialize(d)?)) }
fn nullable_uuid<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<Uuid>>, D::Error> { Ok(Some(Option::<Uuid>::deserialize(d)?)) }

fn clean_name(n: &str) -> AppResult<String> {
    let n: String = n.trim().chars().take(100).collect();
    if n.chars().count() < 2 { return Err(AppError::BadRequest("Event name must be 2-100 characters".into())); }
    Ok(n)
}

async fn check_place(db: &PgPool, guild_id: Uuid, channel_id: Option<Uuid>, location: &str) -> AppResult<()> {
    if let Some(cid) = channel_id {
        let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM channels WHERE id = $1 AND guild_id = $2 AND kind IN ('voice', 'stage')").bind(cid).bind(guild_id).fetch_optional(db).await?;
        if ok.is_none() { return Err(AppError::BadRequest("Events can only be held in a voice or stage channel of this server".into())); }
    } else if location.trim().is_empty() {
        return Err(AppError::BadRequest("Pick a voice channel or enter a location".into()));
    }
    Ok(())
}

async fn push(state: &AppState, guild_id: Uuid) {
    state.hub.emit_guild(guild_id, "EVENT_UPDATE", json!({ "guild_id": guild_id }));
}

async fn create(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<EventInput>) -> AppResult<(StatusCode, Json<Event>)> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check_any(p, perms::MANAGE_GUILD | perms::MANAGE_EVENTS)?;
    let name = clean_name(req.name.as_deref().unwrap_or(""))?;
    let starts = req.starts_at.ok_or_else(|| AppError::BadRequest("starts_at is required".into()))?;
    if starts < Utc::now() - chrono::Duration::minutes(5) { return Err(AppError::BadRequest("Events start in the future".into())); }
    let ends = req.ends_at.flatten();
    if ends.map(|e| e <= starts).unwrap_or(false) { return Err(AppError::BadRequest("The end must be after the start".into())); }
    let channel_id = req.channel_id.flatten();
    let location: String = req.location.unwrap_or_default().trim().chars().take(200).collect();
    check_place(&state.db, id, channel_id, &location).await?;
    let description: String = req.description.unwrap_or_default().trim_end().chars().take(1000).collect();
    let eid = Uuid::now_v7();
    sqlx::query("INSERT INTO guild_events (id, guild_id, name, description, starts_at, ends_at, channel_id, location, creator_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
        .bind(eid).bind(id).bind(&name).bind(&description).bind(starts).bind(ends).bind(channel_id).bind(&location).bind(uid)
        .execute(&state.db).await?;
    // The creator is going.
    sqlx::query("INSERT INTO event_rsvps (event_id, user_id) VALUES ($1, $2)").bind(eid).bind(uid).execute(&state.db).await?;
    crate::audit::guild(&state, id, uid, "event.create", "event", Some(eid), &name, json!({ "starts_at": starts })).await;
    push(&state, id).await;
    Ok((StatusCode::CREATED, Json(one(&state.db, eid, uid).await?)))
}

async fn update(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, eid)): Path<(Uuid, Uuid)>, Json(req): Json<EventInput>) -> AppResult<Json<Event>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check_any(p, perms::MANAGE_GUILD | perms::MANAGE_EVENTS)?;
    let cur = one(&state.db, eid, uid).await?;
    if cur.guild_id != id { return Err(AppError::NotFound("Event not found".into())); }
    let name = match &req.name { Some(n) => clean_name(n)?, None => cur.name.clone() };
    let starts = req.starts_at.unwrap_or(cur.starts_at);
    let ends = match req.ends_at { Some(e) => e, None => cur.ends_at };
    if ends.map(|e| e <= starts).unwrap_or(false) { return Err(AppError::BadRequest("The end must be after the start".into())); }
    let channel_id = match req.channel_id { Some(c) => c, None => cur.channel_id };
    let location: String = req.location.map(|l| l.trim().chars().take(200).collect()).unwrap_or(cur.location.clone());
    check_place(&state.db, id, channel_id, &location).await?;
    let description: String = req.description.map(|d| d.trim_end().chars().take(1000).collect()).unwrap_or(cur.description.clone());
    sqlx::query("UPDATE guild_events SET name = $2, description = $3, starts_at = $4, ends_at = $5, channel_id = $6, location = $7 WHERE id = $1")
        .bind(eid).bind(&name).bind(&description).bind(starts).bind(ends).bind(channel_id).bind(&location)
        .execute(&state.db).await?;
    crate::audit::guild(&state, id, uid, "event.update", "event", Some(eid), &name, json!({})).await;
    push(&state, id).await;
    Ok(Json(one(&state.db, eid, uid).await?))
}

async fn remove(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, eid)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check_any(p, perms::MANAGE_GUILD | perms::MANAGE_EVENTS)?;
    let name: Option<(String,)> = sqlx::query_as("DELETE FROM guild_events WHERE id = $1 AND guild_id = $2 RETURNING name").bind(eid).bind(id).fetch_optional(&state.db).await?;
    let Some((name,)) = name else { return Err(AppError::NotFound("Event not found".into())) };
    crate::audit::guild(&state, id, uid, "event.delete", "event", Some(eid), &name, json!({})).await;
    push(&state, id).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn rsvp(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, eid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Event>> {
    require_member(&state.db, id, uid).await?;
    let exists: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_events WHERE id = $1 AND guild_id = $2").bind(eid).bind(id).fetch_optional(&state.db).await?;
    if exists.is_none() { return Err(AppError::NotFound("Event not found".into())); }
    sqlx::query("INSERT INTO event_rsvps (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING").bind(eid).bind(uid).execute(&state.db).await?;
    push(&state, id).await;
    Ok(Json(one(&state.db, eid, uid).await?))
}

async fn unrsvp(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, eid)): Path<(Uuid, Uuid)>) -> AppResult<Json<Event>> {
    require_member(&state.db, id, uid).await?;
    sqlx::query("DELETE FROM event_rsvps WHERE event_id = $1 AND user_id = $2").bind(eid).bind(uid).execute(&state.db).await?;
    push(&state, id).await;
    Ok(Json(one(&state.db, eid, uid).await?))
}
