//! Server deletion and takedowns (docs/admin-access-and-server-deletion.md, Phase 6).
//!
//! - **Owner deletion** needs the password, a 2FA code when 2FA is on, and the server's name typed out. The server goes
//!   dark at once (`pending_deletion`): members lose it, invites are gone, webhooks and bots stop, voice ends. Only the
//!   owner can restore it, until `SERVER_DELETION_GRACE_DAYS` (7) have passed.
//! - **Takedown** (Trust & Safety, `content.action` and an open case): the server goes dark the same way
//!   (`taken_down`), members are told it was removed for violating the guidelines, and the owner cannot restore it.
//!   Its content stays for `TAKEDOWN_RETENTION_DAYS` (90), reachable only through the case.
//! - **Finalize** (scheduled, idempotent, one transaction per server): in-scope content of open cases is copied to
//!   `case_snapshots` first; forwards elsewhere lose their pointer; then the server and everything in it are hard
//!   deleted (files after the commit), leaving a `guild_tombstones` row with only the id, when and how.
//!
//! Anything that still points at such a server (links, invites, replies, notifications) gets 410
//! `server_unavailable`, which clients show as "This server is no longer available".
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    routes::admin_access::{self, log_case, Entry, Perm::*},
    state::AppState,
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/guilds/:id/deletion", post(request))
        .route("/guilds/:id/restore", post(restore))
        .route("/users/@me/guilds/pending-deletion", get(pending))
        .route("/admin/guilds/:id/takedown", post(takedown))
}

/// Why a server can't be used: being deleted, taken down, gone (tombstone), or simply not found.
pub async fn unavailable(db: &PgPool, gid: Uuid) -> AppError {
    let state: Option<(String,)> = sqlx::query_as("SELECT state FROM guilds WHERE id = $1").bind(gid).fetch_optional(db).await.ok().flatten();
    match state.as_ref().map(|s| s.0.as_str()) {
        Some("pending_deletion") => AppError::ServerUnavailable("pending_deletion"),
        Some("taken_down") => AppError::ServerUnavailable("taken_down"),
        Some(_) => AppError::NotFound("Server not found".into()),
        None => {
            let gone: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_tombstones WHERE id = $1").bind(gid).fetch_optional(db).await.ok().flatten();
            if gone.is_some() { AppError::ServerUnavailable("deleted") } else { AppError::NotFound("Server not found".into()) }
        }
    }
}

/// Ok for an active server; the matching 404 or 410 otherwise.
pub async fn ensure_active(db: &PgPool, gid: Uuid) -> AppResult<()> {
    let ok: Option<(bool,)> = sqlx::query_as("SELECT true FROM guilds WHERE id = $1 AND state = 'active'").bind(gid).fetch_optional(db).await?;
    if ok.is_some() { Ok(()) } else { Err(unavailable(db, gid).await) }
}

/// The server goes dark for everyone: members lose it, invites are gone, voice ends.
async fn go_dark(state: &AppState, gid: Uuid, reason: &str, name: &str) -> AppResult<()> {
    sqlx::query("DELETE FROM invites WHERE guild_id = $1").bind(gid).execute(&state.db).await?;
    state.hub.voice_evict(|v| v.guild_id == Some(gid));
    state.hub.emit_guild(gid, "GUILD_DELETE", json!({ "id": gid, "unavailable": true, "reason": reason, "name": name }));
    Ok(())
}

#[derive(Deserialize)]
pub struct DeleteReq {
    #[serde(default)]
    password: String,
    code: Option<String>,
    /// The server's name, typed out.
    #[serde(default)]
    name: String,
}

/// `POST /guilds/:id/deletion` (and `DELETE /guilds/:id`): the owner deletes the server, restorable for a grace period.
pub async fn request(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>, Json(req): Json<DeleteReq>) -> AppResult<Json<Value>> {
    let row: Option<(Uuid, String, String)> = sqlx::query_as("SELECT owner_id, name, state FROM guilds WHERE id = $1").bind(gid).fetch_optional(&state.db).await?;
    let Some((owner, name, st)) = row else { return Err(unavailable(&state.db, gid).await) };
    if owner != uid { return Err(AppError::Forbidden) }
    if st != "active" { return Err(unavailable(&state.db, gid).await) }
    crate::routes::mfa::check_password_and_factor(&state, uid, &req.password, req.code.as_deref()).await?;
    if req.name.trim() != name.trim() { return Err(AppError::BadRequest("Type the server's name exactly to confirm".into())) }
    let at = Utc::now() + Duration::days(state.config.server_deletion_grace_days);
    sqlx::query("UPDATE guilds SET state = 'pending_deletion', deletion_type = 'owner', deletion_requested_at = now(), deletion_scheduled_for = $2 WHERE id = $1 AND state = 'active'")
        .bind(gid).bind(at).execute(&state.db).await?;
    go_dark(&state, gid, "deleted", &name).await?;
    crate::audit::guild(&state, gid, uid, "guild.deletion_requested", "guild", Some(gid), &name, json!({ "scheduled_for": at })).await;
    Ok(Json(json!({ "id": gid, "state": "pending_deletion", "scheduled_for": at })))
}

/// `POST /guilds/:id/restore`: the owner brings the server back during the grace period. Takedowns can't be undone here.
async fn restore(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(gid): Path<Uuid>) -> AppResult<Json<Value>> {
    let row: Option<(Uuid, String)> = sqlx::query_as("SELECT owner_id, state FROM guilds WHERE id = $1").bind(gid).fetch_optional(&state.db).await?;
    let Some((owner, st)) = row else { return Err(unavailable(&state.db, gid).await) };
    if owner != uid { return Err(AppError::Forbidden) }
    if st == "taken_down" { return Err(AppError::BadRequest("This server was removed for violating the community guidelines and can't be restored".into())) }
    if st != "pending_deletion" { return Err(AppError::BadRequest("This server isn't being deleted".into())) }
    sqlx::query("UPDATE guilds SET state = 'active', deletion_type = NULL, deletion_requested_at = NULL, deletion_scheduled_for = NULL WHERE id = $1 AND state = 'pending_deletion'").bind(gid).execute(&state.db).await?;
    // Members get the server back as if they had just joined (which also resubscribes their sessions to it).
    let guild = sqlx::query_as::<_, crate::models::Guild>(&format!("SELECT {} FROM guilds WHERE id = $1", crate::routes::guilds::GUILD_COLS)).bind(gid).fetch_one(&state.db).await?;
    let roles = crate::perms::list_roles(&state.db, gid).await?;
    let emojis = crate::routes::expressions::emojis_for_guilds(&state.db, &[gid]).await?;
    let stickers = crate::routes::expressions::stickers_for_guilds(&state.db, &[gid]).await?;
    let members: Vec<(Uuid,)> = sqlx::query_as("SELECT user_id FROM guild_members WHERE guild_id = $1").bind(gid).fetch_all(&state.db).await?;
    for (m,) in members {
        let channels = crate::perms::visible_channels(&state.db, gid, m).await?;
        state.hub.emit_users(vec![m], "GUILD_CREATE", crate::routes::guilds::guild_payload(&guild, json!({ "channels": channels, "roles": roles, "emojis": emojis, "stickers": stickers })));
    }
    crate::audit::guild(&state, gid, uid, "guild.restored", "guild", Some(gid), "", json!({})).await;
    Ok(Json(json!({ "id": gid, "state": "active" })))
}

/// `GET /users/@me/guilds/pending-deletion`: servers you own that are being deleted (to restore).
async fn pending(State(state): State<AppState>, AuthUser(uid): AuthUser) -> AppResult<Json<Value>> {
    let rows: Vec<(Uuid, String, Option<String>, Option<DateTime<Utc>>)> = sqlx::query_as("SELECT id, name, icon_url, deletion_scheduled_for FROM guilds WHERE owner_id = $1 AND state = 'pending_deletion' ORDER BY deletion_scheduled_for")
        .bind(uid).fetch_all(&state.db).await?;
    Ok(Json(json!(rows.into_iter().map(|(id, name, icon, at)| json!({ "id": id, "name": name, "icon_url": icon, "scheduled_for": at })).collect::<Vec<_>>())))
}

#[derive(Deserialize)]
struct TakedownReq { case_id: Uuid, justification: Option<String> }

/// `POST /admin/guilds/:id/takedown` `{case_id, justification}`: Trust & Safety removes a server under an open case.
async fn takedown(State(state): State<AppState>, AuthUser(uid): AuthUser, headers: HeaderMap, Path(gid): Path<Uuid>, Json(req): Json<TakedownReq>) -> AppResult<Json<Value>> {
    let a = admin_access::require_perm(&state, uid, ContentAction).await?;
    let why = admin_access::justification(req.justification.as_deref())?;
    crate::routes::cases::usable(&crate::routes::cases::load(&state, req.case_id).await?)?;
    let row: Option<(String, String)> = sqlx::query_as("SELECT name, state FROM guilds WHERE id = $1").bind(gid).fetch_optional(&state.db).await?;
    let Some((name, st)) = row else { return Err(unavailable(&state.db, gid).await) };
    if st == "taken_down" { return Err(AppError::BadRequest("This server is already taken down".into())) }
    let at = Utc::now() + Duration::days(state.config.takedown_retention_days);
    // A takedown overrides an owner's pending deletion: the owner can no longer restore, and content is kept longer.
    sqlx::query("UPDATE guilds SET state = 'taken_down', deletion_type = 'takedown', deletion_requested_at = now(), deletion_scheduled_for = $2, takedown_case_id = $3 WHERE id = $1")
        .bind(gid).bind(at).bind(req.case_id).execute(&state.db).await?;
    go_dark(&state, gid, "takedown", &name).await?;
    log_case(&state, uid, &a.roles, &headers, Some(req.case_id), Entry { action: "guild.takedown", query: "", filters: json!({ "retain_until": at }), justification: &why, targets: &[gid] }).await?;
    Ok(Json(json!({ "id": gid, "state": "taken_down", "retain_until": at })))
}

/// Hard-delete a server now, keeping a tombstone. Safe to run again: a server that is already gone is a no-op.
/// Open cases that reach into it get a snapshot of their in-scope content first.
pub async fn finalize(state: &AppState, gid: Uuid, kind: &str) -> AppResult<bool> {
    let mut tx = state.db.begin().await?;
    let row: Option<(Option<String>,)> = sqlx::query_as("SELECT deletion_type FROM guilds WHERE id = $1 FOR UPDATE SKIP LOCKED").bind(gid).fetch_optional(&mut *tx).await?;
    let Some((dtype,)) = row else { return Ok(false) };
    let kind = dtype.as_deref().unwrap_or(kind).to_string();
    let channels: Vec<Uuid> = sqlx::query_as::<_, (Uuid,)>("SELECT id FROM channels WHERE guild_id = $1").bind(gid).fetch_all(&mut *tx).await?.into_iter().map(|r| r.0).collect();

    // Preservation: only what each open case covers (its channels in this server, its time range).
    let cases: Vec<(Uuid, Vec<Uuid>, Option<DateTime<Utc>>, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT id, scope_channel_ids, scope_from, scope_to FROM cases WHERE status = 'open' AND expires_at > now()
           AND ((subject_kind = 'server' AND subject_id = $1) OR scope_channel_ids && $2)").bind(gid).bind(&channels).fetch_all(&mut *tx).await?;
    let mut copies: Vec<(Uuid, Uuid)> = Vec::new();
    for (cid, scope, from, to) in cases {
        let inscope: Vec<Uuid> = scope.iter().copied().filter(|c| channels.contains(c)).collect();
        if inscope.is_empty() { continue }
        let (messages,): (Value,) = sqlx::query_as(
            "SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'channel_id', m.channel_id, 'author_id', m.author_id, 'content', m.content, 'created_at', m.created_at, 'edited_at', m.edited_at) ORDER BY m.id), '[]')
             FROM messages m WHERE m.channel_id = ANY($1) AND ($2::timestamptz IS NULL OR m.created_at >= $2) AND ($3::timestamptz IS NULL OR m.created_at <= $3)")
            .bind(&inscope).bind(from).bind(to).fetch_one(&mut *tx).await?;
        let files: Vec<(Uuid, Option<Uuid>, String, String, i64)> = sqlx::query_as(
            "SELECT a.id, a.message_id, a.filename, a.content_type, a.size FROM attachments a JOIN messages m ON m.id = a.message_id
             WHERE m.channel_id = ANY($1) AND ($2::timestamptz IS NULL OR m.created_at >= $2) AND ($3::timestamptz IS NULL OR m.created_at <= $3)")
            .bind(&inscope).bind(from).bind(to).fetch_all(&mut *tx).await?;
        let atts: Value = json!(files.iter().map(|(id, mid, f, ct, sz)| json!({ "id": id, "message_id": mid, "filename": f, "content_type": ct, "size": sz })).collect::<Vec<_>>());
        sqlx::query("INSERT INTO case_snapshots (id, case_id, guild_id, messages, attachments) VALUES ($1, $2, $3, $4, $5)")
            .bind(Uuid::now_v7()).bind(cid).bind(gid).bind(&messages).bind(&atts).execute(&mut *tx).await?;
        copies.extend(files.iter().map(|f| (cid, f.0)));
    }
    // Case copies of the files, before the originals go.
    for (cid, fid) in &copies {
        let dir = state.config.upload_dir.join("cases").join(cid.to_string());
        let _ = tokio::fs::create_dir_all(&dir).await;
        let _ = tokio::fs::copy(state.config.upload_dir.join(fid.to_string()), dir.join(fid.to_string())).await;
    }

    // Forwards elsewhere survive, without a pointer into the deleted server.
    sqlx::query("UPDATE messages SET forwarded_from = NULL, forwarded_unavailable = true
                 WHERE forwarded_from IN (SELECT id FROM messages WHERE channel_id = ANY($1)) AND NOT (channel_id = ANY($1))")
        .bind(&channels).execute(&mut *tx).await?;
    let files: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM attachments WHERE channel_id = ANY($1)").bind(&channels).fetch_all(&mut *tx).await?;
    // Server tags people wore lose their text along with the server.
    sqlx::query("UPDATE users SET clan_tag = '', clan_tag_guild = NULL WHERE clan_tag_guild = $1").bind(gid).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO guild_tombstones (id, deletion_type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING").bind(gid).bind(&kind).execute(&mut *tx).await?;
    // Everything in the server goes with it (foreign keys cascade: channels, messages, roles, overwrites, emoji,
    // stickers, sounds, invites, webhooks, memberships, bans, events, ...).
    sqlx::query("DELETE FROM guilds WHERE id = $1").bind(gid).execute(&mut *tx).await?;
    tx.commit().await?;
    for (fid,) in files {
        let _ = tokio::fs::remove_file(state.config.upload_dir.join(fid.to_string())).await;
        let _ = tokio::fs::remove_file(state.config.upload_dir.join(format!("{fid}.thumb"))).await;
    }
    Ok(true)
}

/// Finalize every server whose grace period or retention window has passed. Returns how many were removed.
pub async fn finalize_due(state: &AppState) -> AppResult<usize> {
    let due: Vec<(Uuid,)> = sqlx::query_as("SELECT id FROM guilds WHERE state <> 'active' AND deletion_scheduled_for <= now() ORDER BY deletion_scheduled_for LIMIT 50").fetch_all(&state.db).await?;
    let mut n = 0;
    for (gid,) in due {
        match finalize(state, gid, "owner").await {
            Ok(true) => n += 1,
            Ok(false) => {}
            Err(e) => tracing::error!(error = %e, guild = %gid, "server finalize failed"),
        }
    }
    Ok(n)
}

/// `DELETE /guilds/:id` keeps working for owners, with the same confirmation in its body.
pub async fn delete_alias(state: State<AppState>, user: AuthUser, path: Path<Uuid>, body: Json<DeleteReq>) -> AppResult<StatusCode> {
    let _ = request(state, user, path, body).await?;
    Ok(StatusCode::NO_CONTENT)
}
