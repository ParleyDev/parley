//! Server widget: a public JSON summary (online members, a Join link) that the embeddable page and other sites read.

use crate::{error::{AppError, AppResult}, state::AppState};
use axum::{extract::{Path, State}, http::header, response::IntoResponse, routing::get, Json, Router};
use serde_json::json;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new().route("/guilds/:id/widget.json", get(widget))
}

/// `GET /guilds/:id/widget.json` (no login): name, online count, up to 100 online members and the Join invite, when
/// the server has its widget turned on.
async fn widget(State(state): State<AppState>, Path(id): Path<Uuid>) -> AppResult<impl IntoResponse> {
    let g: Option<(String, Option<String>, bool, String)> = sqlx::query_as("SELECT name, icon_url, widget_enabled, widget_invite FROM guilds WHERE id = $1").bind(id).fetch_optional(&state.db).await?;
    let Some((name, icon, enabled, invite)) = g else { return Err(AppError::NotFound("Server not found".into())) };
    if !enabled { return Err(AppError::Forbidden) }
    let online = crate::ws::bus::visible_online_users(&state.db).await;
    let idle = crate::ws::bus::idle_users(&state.db).await;
    let rows: Vec<(Uuid, String, Option<String>, String)> = sqlx::query_as(
        "SELECT u.id, COALESCE(m.nickname, u.display_name), u.avatar_url, u.status FROM guild_members m JOIN users u ON u.id = m.user_id
         WHERE m.guild_id = $1 AND m.user_id = ANY($2) AND u.status <> 'invisible' AND NOT u.bot ORDER BY lower(COALESCE(m.nickname, u.display_name)) LIMIT 100")
        .bind(id).bind(&online).fetch_all(&state.db).await?;
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = $1 AND m.user_id = ANY($2) AND u.status <> 'invisible'")
        .bind(id).bind(&online).fetch_one(&state.db).await?;
    let members: Vec<_> = rows.into_iter().map(|(uid, name, avatar, status)| {
        let status = if status == "online" && idle.contains(&uid) { "idle".to_string() } else { status };
        json!({ "id": uid, "username": name, "avatar_url": avatar, "status": status })
    }).collect();
    Ok(([(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"), (header::CACHE_CONTROL, "public, max-age=60")],
        Json(json!({ "id": id, "name": name, "icon_url": icon, "presence_count": count, "members": members, "instant_invite": if invite.is_empty() { None } else { Some(format!("/invite/{invite}")) } }))))
}
