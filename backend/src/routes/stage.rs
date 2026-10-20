//! Stage channels: audience / speakers. Moderators (Manage Channels) join as speakers and can invite others to speak or
//! move them back; everyone else joins suppressed and can raise a hand. All of it is voice state, so clients learn
//! about changes through the usual VOICE_STATE_UPDATE.

use crate::{auth::AuthUser, error::{AppError, AppResult}, perms, routes::channels::require_channel_perms, state::AppState};
use axum::{extract::{Path, State}, http::StatusCode, routing::{delete, post, put}, Router};
use serde_json::json;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/channels/:id/stage/hand", post(raise_hand).delete(lower_hand))
        .route("/channels/:id/stage/speakers/:uid", put(invite_to_speak).delete(move_to_audience))
}

async fn broadcast(state: &AppState, channel: &crate::models::Channel, user: Uuid) -> AppResult<()> {
    if let Some(vs) = state.hub.voice_state(user) {
        let target = perms::channel_audience(&state.db, channel).await?;
        state.hub.emit(target, "VOICE_STATE_UPDATE", json!(vs));
    }
    Ok(())
}

async fn set_hand(state: AppState, id: Uuid, uid: Uuid, up: bool) -> AppResult<StatusCode> {
    let (c, _) = require_channel_perms(&state.db, id, uid).await?;
    if c.kind != "stage" && c.kind != "studio" { return Err(AppError::BadRequest("Not a stage channel".into())); }
    let in_here = state.hub.voice_state(uid).map(|v| v.channel_id == id).unwrap_or(false);
    if !in_here { return Err(AppError::BadRequest("Join the stage first".into())); }
    state.hub.voice_update(uid, |v| v.request_to_speak = up && v.suppress);
    broadcast(&state, &c, uid).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn raise_hand(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> { set_hand(state, id, uid, true).await }
async fn lower_hand(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<StatusCode> { set_hand(state, id, uid, false).await }

async fn set_speaker(state: AppState, id: Uuid, uid: Uuid, target: Uuid, speaker: bool) -> AppResult<StatusCode> {
    let (c, p) = require_channel_perms(&state.db, id, uid).await?;
    if c.kind != "stage" && c.kind != "studio" { return Err(AppError::BadRequest("Not a stage channel".into())); }
    let engineer = c.kind == "studio" && perms::is_engineer(&state.db, id, uid).await?;
    if (uid != target || speaker) && !engineer { perms::check(p, perms::MANAGE_CHANNELS)?; }   // anyone may step down themselves
    let in_here = state.hub.voice_state(target).map(|v| v.channel_id == id).unwrap_or(false);
    if !in_here { return Err(AppError::NotFound("That member is not on this stage".into())); }
    if speaker {
        // Needs Speak in the channel as well; the stage only lifts the audience suppression.
        let (_, tp) = require_channel_perms(&state.db, id, target).await?;
        if !perms::has(tp, perms::SPEAK) { return Err(AppError::BadRequest("That member cannot speak in this channel".into())); }
    }
    state.hub.voice_update(target, |v| { v.suppress = !speaker; v.request_to_speak = false; });
    broadcast(&state, &c, target).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn invite_to_speak(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> { set_speaker(state, id, uid, target, true).await }
async fn move_to_audience(State(state): State<AppState>, AuthUser(uid): AuthUser, Path((id, target)): Path<(Uuid, Uuid)>) -> AppResult<StatusCode> { set_speaker(state, id, uid, target, false).await }
