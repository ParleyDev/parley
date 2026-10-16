//! SFU voice: when an admin configures a LiveKit server, clients join rooms there (one room per voice
//! channel / call) instead of meshing peer connections. The backend only mints access tokens; the
//! channel's CONNECT / SPEAK / STREAM permissions decide what the token allows.

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    perms::{self, has},
    routes::{admin::load_settings, channels::require_channel_perms},
    state::AppState,
};
use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/voice/token", post(token))
}

#[derive(Deserialize)]
struct TokenReq {
    channel_id: Uuid,
}

#[derive(Serialize)]
struct VideoGrant {
    room: String,
    #[serde(rename = "roomJoin")]
    room_join: bool,
    #[serde(rename = "canPublish")]
    can_publish: bool,
    #[serde(rename = "canSubscribe")]
    can_subscribe: bool,
    #[serde(rename = "canPublishData")]
    can_publish_data: bool,
    #[serde(rename = "canPublishSources", skip_serializing_if = "Vec::is_empty")]
    can_publish_sources: Vec<&'static str>,
}

#[derive(Serialize)]
struct Claims {
    iss: String,
    sub: String,
    name: String,
    nbf: i64,
    exp: i64,
    jti: String,
    video: VideoGrant,
}

/// LiveKit access token (HS256 JWT) for the caller to join the channel's room.
pub fn livekit_token(api_key: &str, api_secret: &str, identity: &str, name: &str, room: &str, can_publish: bool, can_video: bool) -> anyhow::Result<String> {
    let now = chrono::Utc::now().timestamp();
    let mut sources = vec![];
    if can_publish { sources.push("microphone"); }
    if can_video { sources.extend(["camera", "screen_share", "screen_share_audio"]); }
    let claims = Claims {
        iss: api_key.to_string(),
        sub: identity.to_string(),
        name: name.to_string(),
        nbf: now - 10,
        exp: now + 6 * 3600,
        jti: Uuid::now_v7().to_string(),
        video: VideoGrant { room: room.to_string(), room_join: true, can_publish: can_publish || can_video, can_subscribe: true, can_publish_data: true, can_publish_sources: sources },
    };
    Ok(jsonwebtoken::encode(&jsonwebtoken::Header::default(), &claims, &jsonwebtoken::EncodingKey::from_secret(api_secret.as_bytes()))?)
}

async fn token(State(state): State<AppState>, AuthUser(uid): AuthUser, Json(req): Json<TokenReq>) -> AppResult<Json<Value>> {
    let settings = load_settings(&state.db).await?;
    if !settings.sfu_configured() {
        return Err(AppError::BadRequest("This instance uses peer-to-peer voice (no SFU configured)".into()));
    }
    let (c, p) = require_channel_perms(&state.db, req.channel_id, uid).await?;
    let (can_publish, can_video) = if c.guild_id.is_none() {
        (true, true)
    } else {
        if c.kind != "voice" || !has(p, perms::CONNECT) {
            return Err(AppError::Forbidden);
        }
        (has(p, perms::SPEAK), has(p, perms::STREAM))
    };
    let (name,): (String,) = sqlx::query_as("SELECT display_name FROM users WHERE id = $1").bind(uid).fetch_one(&state.db).await?;
    let token = livekit_token(&settings.livekit_api_key, &settings.livekit_api_secret, &uid.to_string(), &name, &c.id.to_string(), can_publish, can_video)?;
    Ok(Json(json!({ "url": settings.livekit_url.trim(), "token": token, "room": c.id, "can_publish": can_publish, "can_video": can_video })))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn token_has_livekit_shape() {
        let t = livekit_token("devkey", "secret", "user-1", "Alice", "room-1", true, false).unwrap();
        let key = jsonwebtoken::DecodingKey::from_secret(b"secret");
        let mut v = jsonwebtoken::Validation::default();
        v.set_issuer(&["devkey"]);
        let data = jsonwebtoken::decode::<serde_json::Value>(&t, &key, &v).unwrap();
        assert_eq!(data.claims["sub"], "user-1");
        assert_eq!(data.claims["video"]["room"], "room-1");
        assert_eq!(data.claims["video"]["roomJoin"], true);
        assert_eq!(data.claims["video"]["canPublishSources"], json!(["microphone"]));
    }
}
