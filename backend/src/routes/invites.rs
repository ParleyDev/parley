use crate::{
    auth::{AuthUser, MaybeUser},
    error::{AppError, AppResult},
    models::Guild,
    perms,
    routes::badge,
    routes::guilds::{fetch_member, is_banned, GUILD_COLS},
    state::AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::header,
    response::IntoResponse,
    routing::{get, put},
    Json, Router,
};
use serde_json::{json, Value};
use uuid::Uuid;

/// Finds the invite a code names: an exact (case-sensitive) random code, or a vanity code in any case, which only
/// resolves while its server is approved for Discovery. A random code wins if both match.
const MATCH: &str = "((NOT i.vanity AND i.code = $1) OR (i.vanity AND i.code = lower($1)
    AND EXISTS (SELECT 1 FROM guild_discovery d WHERE d.guild_id = i.guild_id AND d.status = 'approved')))";
/// Whether the invite can still be used (not expired, not used up).
const LIVE: &str = "((i.expires_at IS NULL OR i.expires_at > now()) AND (i.max_uses IS NULL OR i.uses < i.max_uses))";

/// guild id, name, icon, member count, live, rules, rules required, invite code.
type PreviewRow = (Uuid, String, Option<String>, i64, bool, String, bool, String, Option<String>, String);
/// guild id, uses, max uses, expiry, invite code.
type AcceptRow = (Uuid, i32, Option<i32>, Option<chrono::DateTime<chrono::Utc>>, String, Uuid, bool);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/invites/:code", get(preview).route_layer(axum::middleware::from_fn(crate::ratelimit::rl_invite_preview)).post(accept))
        .route("/invites/:code/preview-messages", get(preview_messages).route_layer(axum::middleware::from_fn(crate::ratelimit::rl_invite_preview)))
        .route("/invites/:code/badge.svg", get(badge))
        .route("/guilds/:id/badge", put(save_badge_settings).get(badge_settings))
        .route("/guilds/:id/badge/preview.svg", get(badge_preview))
}

/// A server's README badge settings (Server Settings › Badge). Missing fields take the defaults, so a server that
/// never opened the tab gets the original badge.
#[derive(serde::Serialize, serde::Deserialize, Clone, PartialEq)]
#[serde(default)]
pub struct BadgeSettings {
    /// Off: every badge for the server is a grey "badge disabled" and shows no counts.
    enabled: bool,
    /// Left side text; empty means "Parley".
    label: String,
    /// `#rrggbb` for the right side; empty means Parley purple.
    color: String,
    /// What the right side counts: `both`, `members` or `online`.
    show: String,
    /// Style when the URL doesn't pick one: `flat`, `flat-square` or `for-the-badge`.
    style: String,
}

impl Default for BadgeSettings {
    fn default() -> Self {
        Self { enabled: true, label: String::new(), color: String::new(), show: "both".into(), style: "flat".into() }
    }
}

impl BadgeSettings {
    /// Clamp whatever was stored or sent to something safe to render.
    fn clean(mut self) -> Self {
        self.label = self.label.trim().chars().take(32).collect();
        let hex = self.color.len() == 7 && self.color.starts_with('#') && self.color[1..].chars().all(|c| c.is_ascii_hexdigit());
        self.color = if hex { self.color.to_ascii_lowercase() } else { String::new() };
        if !["both", "members", "online"].contains(&self.show.as_str()) { self.show = "both".into(); }
        if !["flat", "flat-square", "for-the-badge"].contains(&self.style.as_str()) { self.style = "flat".into(); }
        self
    }
    fn from_value(v: Value) -> Self {
        serde_json::from_value::<Self>(v).unwrap_or_default().clean()
    }
}

async fn badge_settings(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> AppResult<Json<BadgeSettings>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    let (v,): (Value,) = sqlx::query_as("SELECT badge FROM guilds WHERE id = $1").bind(id).fetch_one(&state.db).await?;
    Ok(Json(BadgeSettings::from_value(v)))
}

async fn save_badge_settings(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(req): Json<BadgeSettings>) -> AppResult<Json<BadgeSettings>> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    let next = req.clean();
    let (prev, name): (Value, String) = sqlx::query_as("SELECT badge, name FROM guilds WHERE id = $1").bind(id).fetch_one(&state.db).await?;
    let prev = serde_json::to_value(BadgeSettings::from_value(prev)).unwrap_or_default();
    let now = serde_json::to_value(&next).unwrap_or_default();
    if prev != now {
        sqlx::query("UPDATE guilds SET badge = $2 WHERE id = $1").bind(id).bind(&now).execute(&state.db).await?;
        // Only what changed, like guild.update.
        let changed: serde_json::Map<String, Value> = now.as_object().into_iter().flatten().filter(|(k, v)| prev.get(k.as_str()) != Some(v)).map(|(k, v)| (k.clone(), v.clone())).collect();
        crate::audit::guild(&state, id, uid, "guild.badge_update", "guild", Some(id), &name, Value::Object(changed)).await;
    }
    Ok(Json(next))
}

#[derive(serde::Deserialize)]
struct BadgeQuery {
    /// Overrides the server's default style.
    style: Option<String>,
    /// Overrides the server's label.
    label: Option<String>,
}

/// A README badge for an invite, public like the link it sits on: "Parley | 12 online · 340 members" while the invite
/// works, a grey "invite expired" once it doesn't. Invisible members aren't counted as online. The server's badge
/// settings pick the label, colour, counts and default style, or turn it off.
async fn badge(State(state): State<AppState>, Path(code): Path<String>, Query(q): Query<BadgeQuery>) -> AppResult<impl IntoResponse> {
    let row: Option<(bool, i64, i64, Value)> = sqlx::query_as(&format!(
        "SELECT {LIVE}, {COUNTS}, g.badge
         FROM invites i JOIN guilds g ON g.id = i.guild_id WHERE {MATCH} ORDER BY i.vanity LIMIT 1"
    ))
    .bind(&code)
    .bind(crate::ws::bus::STALE_SECS as f64)
    .fetch_optional(&state.db)
    .await?;
    let settings = row.as_ref().map(|r| BadgeSettings::from_value(r.3.clone())).unwrap_or_default();
    let svg = render_badge(&settings, row.map(|(live, members, online, _)| (live, members, online)), q.label, q.style.as_deref());
    Ok((
        [
            (header::CONTENT_TYPE, "image/svg+xml; charset=utf-8"),
            // Viewers (and GitHub's image proxy) revalidate every time; a CDN in front may keep it for five minutes,
            // which spares the database when a README is popular. A plain max-age would be stretched by CDNs that
            // impose a longer browser TTL on images (Cloudflare's default is four hours).
            (header::CACHE_CONTROL, "no-cache"),
            (header::HeaderName::from_static("cdn-cache-control"), "public, max-age=300"),
            (header::CONTENT_SECURITY_POLICY, "default-src 'none'; img-src data:; style-src 'unsafe-inline'"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        svg,
    ))
}

/// Members, then online members (not invisible), of the guild `i.guild_id`; `$2` is the presence staleness cutoff.
const COUNTS: &str = "(SELECT COUNT(*) FROM guild_members WHERE guild_id = i.guild_id),
    (SELECT COUNT(*) FROM guild_members m JOIN users u ON u.id = m.user_id
      WHERE m.guild_id = i.guild_id AND u.status <> 'invisible'
        AND EXISTS (SELECT 1 FROM presence p WHERE p.user_id = m.user_id AND p.sockets > 0
          AND p.updated_at > now() - make_interval(secs => $2)))";

/// The badge SVG for `settings` and an invite's (live, members, online), or None for an unknown invite. A label or
/// style in the URL wins over the server's.
fn render_badge(settings: &BadgeSettings, invite: Option<(bool, i64, i64)>, label: Option<String>, style: Option<&str>) -> String {
    let label = label.map(|l| l.trim().chars().take(32).collect::<String>()).filter(|l| !l.is_empty())
        .or_else(|| Some(settings.label.clone()).filter(|l| !l.is_empty()))
        .unwrap_or_else(|| "Parley".into());
    let color = if settings.color.is_empty() { badge::COLOR } else { settings.color.as_str() };
    let (message, color) = match invite {
        Some(_) if !settings.enabled => ("badge disabled".into(), badge::GREY),
        Some((true, members, online)) => {
            let members = format!("{} {}", badge::compact(members), if members == 1 { "member" } else { "members" });
            let online = format!("{} online", badge::compact(online));
            (match settings.show.as_str() { "members" => members, "online" => online, _ => format!("{online} · {members}") }, color)
        }
        Some((false, ..)) => ("invite expired".into(), badge::GREY),
        None => ("invalid invite".into(), badge::GREY),
    };
    badge::render(&label, &message, color, badge::Style::parse(style.or(Some(settings.style.as_str()))))
}

/// Server Settings › Badge preview: unsaved settings drawn with the server's real counts (Manage Server only, since
/// the online count may be hidden from the public badge).
async fn badge_preview(State(state): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Query(q): Query<BadgeSettings>) -> AppResult<impl IntoResponse> {
    let (_, p) = perms::guild_perms(&state.db, id, uid).await?;
    perms::check(p, perms::MANAGE_GUILD)?;
    let (members, online): (i64, i64) = sqlx::query_as(&format!("SELECT {COUNTS} FROM (SELECT $1::uuid AS guild_id) i"))
        .bind(id).bind(crate::ws::bus::STALE_SECS as f64).fetch_one(&state.db).await?;
    let svg = render_badge(&q.clean(), Some((true, members, online)), None, None);
    Ok(([(header::CONTENT_TYPE, "image/svg+xml; charset=utf-8"), (header::CACHE_CONTROL, "no-store")], svg))
}

/// The server has paused invites (Safety settings) and `uid` isn't already in it.
pub async fn invites_paused(db: &sqlx::PgPool, gid: Uuid, uid: Uuid) -> AppResult<bool> {
    let (paused,): (bool,) = sqlx::query_as(
        "SELECT g.invites_paused AND NOT EXISTS (SELECT 1 FROM guild_members m WHERE m.guild_id = g.id AND m.user_id = $2) FROM guilds g WHERE g.id = $1")
        .bind(gid).bind(uid).fetch_one(db).await?;
    Ok(paused)
}

/// Whether `@everyone` alone may view and read the history of this channel (a text channel of a server, with the
/// category's and its own overwrites applied): what a logged-out visitor may be shown.
pub async fn everyone_can_read(db: &sqlx::PgPool, channel: &crate::models::Channel) -> AppResult<bool> {
    // Age-restricted channels are never shown logged out, and an encrypted one would only serve ciphertext.
    let Some(gid) = channel.guild_id.filter(|_| channel.kind == "text" && !channel.e2ee) else { return Ok(false) };
    if crate::age::min_age(db, channel.id).await?.is_some() { return Ok(false) }
    let ctx = perms::GuildCtx::load(db, gid).await?;
    let mut c = [channel.clone()];
    perms::attach_overwrites(db, &mut c).await?;
    let p = crate::routes::discovery::everyone_perms(&ctx, &c[0]);
    Ok(perms::has(p, perms::VIEW_CHANNEL) && perms::has(p, perms::READ_MESSAGE_HISTORY))
}

/// The server's invite preview channel, if one is set and still readable by everyone.
async fn preview_channel(db: &sqlx::PgPool, gid: Uuid) -> AppResult<Option<crate::models::Channel>> {
    let Some(cid) = sqlx::query_scalar::<_, Option<Uuid>>("SELECT invite_preview_channel_id FROM guilds WHERE id = $1").bind(gid).fetch_one(db).await? else { return Ok(None) };
    let Some(c) = perms::guild_channels(db, gid).await?.into_iter().find(|c| c.id == cid) else { return Ok(None) };
    Ok(if everyone_can_read(db, &c).await? { Some(c) } else { None })
}

async fn preview_channel_json(db: &sqlx::PgPool, gid: Uuid) -> AppResult<Value> {
    Ok(preview_channel(db, gid).await?.map(|c| json!({ "id": c.id, "name": c.name })).unwrap_or(Value::Null))
}

/// Up to five recent text messages of the invite's preview channel, oldest first, for the logged-out invite page.
/// Display fields only: no attachments, embeds, reactions or user ids (mentions are turned into names).
async fn preview_messages(State(state): State<AppState>, Path(code): Path<String>) -> AppResult<impl IntoResponse> {
    let gid: Option<(Uuid,)> = sqlx::query_as(&format!("SELECT i.guild_id FROM invites i WHERE {MATCH} AND {LIVE} ORDER BY i.vanity LIMIT 1")).bind(&code).fetch_optional(&state.db).await?;
    let (gid,) = gid.ok_or_else(|| AppError::NotFound("Invite not found or expired".into()))?;
    let chan = preview_channel(&state.db, gid).await?.ok_or_else(|| AppError::NotFound("No preview for this invite".into()))?;
    let rows: Vec<(Uuid, String, chrono::DateTime<chrono::Utc>, String, Option<String>)> = sqlx::query_as(
        "SELECT m.id, m.content, m.created_at, COALESCE(NULLIF(gm.nickname, ''), u.display_name), u.avatar_url
         FROM messages m JOIN users u ON u.id = m.author_id LEFT JOIN guild_members gm ON gm.guild_id = $2 AND gm.user_id = m.author_id
         WHERE m.channel_id = $1 AND m.kind = 'default' AND btrim(m.content) <> '' ORDER BY m.id DESC LIMIT 5")
        .bind(chan.id).bind(gid).fetch_all(&state.db).await?;
    let mut body = Vec::new();
    for (id, content, at, name, avatar) in rows.into_iter().rev() {
        // Mention tokens carry member, role and channel ids; show their names instead.
        let content = crate::push::readable(&state, &content, Some(gid)).await;
        body.push(json!({ "id": id, "content": content, "created_at": at, "author": { "display_name": name, "avatar_url": avatar } }));
    }
    Ok(([(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"), (header::CACHE_CONTROL, "public, max-age=30")], Json(body)))
}

async fn preview(
    State(state): State<AppState>,
    MaybeUser(uid): MaybeUser,
    Path(code): Path<String>,
) -> AppResult<impl IntoResponse> {
    let row: Option<PreviewRow> = sqlx::query_as(&format!(
        "SELECT g.id, g.name, g.icon_url, (SELECT COUNT(*) FROM guild_members WHERE guild_id = g.id), {LIVE}, g.rules, g.rules_required, i.code, g.invite_splash_url, g.description
         FROM invites i JOIN guilds g ON g.id = i.guild_id WHERE {MATCH} ORDER BY i.vanity LIMIT 1"
    ))
    .bind(&code)
    .fetch_optional(&state.db)
    .await?;
    let (gid, name, icon, count, live, rules, rules_required, code, splash, description) = row.ok_or_else(|| AppError::NotFound("Invite not found or expired".into()))?;
    let online = crate::ws::bus::visible_online_users(&state.db).await;
    let (online_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM guild_members WHERE guild_id = $1 AND user_id = ANY($2)").bind(gid).bind(&online).fetch_one(&state.db).await?;
    let Some(uid) = uid else {
        // Logged out: only what the server already shows publicly, readable cross-origin and cacheable for a moment.
        let (paused,): (bool,) = sqlx::query_as("SELECT invites_paused FROM guilds WHERE id = $1").bind(gid).fetch_one(&state.db).await?;
        let body = json!({
            "code": code,
            "guild": { "id": gid, "name": name, "icon_url": icon, "member_count": count, "online_count": online_count, "rules_required": rules_required, "splash_url": splash, "description": description },
            "expired": !live,
            "paused": paused,
            "preview_channel": preview_channel_json(&state.db, gid).await?,
        });
        return Ok(([(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"), (header::CACHE_CONTROL, "public, max-age=30"), (header::VARY, "Authorization")], Json(body)).into_response());
    };
    let already: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2")
        .bind(gid)
        .bind(uid)
        .fetch_optional(&state.db)
        .await?;
    Ok(([(header::VARY, "Authorization")], Json(json!({
        "code": code,
        "guild": { "id": gid, "name": name, "icon_url": icon, "member_count": count, "online_count": online_count, "rules": rules, "rules_required": rules_required, "splash_url": splash, "description": description },
        "expired": !live,
        "already_member": already.is_some(),
        "banned": is_banned(&state.db, gid, uid).await?,
        "paused": invites_paused(&state.db, gid, uid).await?,
        "preview_channel": preview_channel_json(&state.db, gid).await?,
    }))).into_response())
}

async fn accept(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    crate::routes::guests::deny(&state, uid, "Guests stay in the demo server. Claim your account to join or create others.").await?;
    let mut tx = state.db.begin().await?;
    let row: Option<AcceptRow> = sqlx::query_as(&format!(
        "SELECT i.guild_id, i.uses, i.max_uses, i.expires_at, i.code, i.creator_id, i.temporary FROM invites i WHERE {MATCH} ORDER BY i.vanity LIMIT 1 FOR UPDATE"
    ))
    .bind(&code)
    .fetch_optional(&mut *tx)
    .await?;
    let (gid, uses, max, expires, code, inviter, temporary) = row.ok_or_else(|| AppError::NotFound("Invite not found or expired".into()))?;
    if expires.is_some_and(|t| t <= chrono::Utc::now()) {
        return Err(AppError::BadRequest("This invite has expired".into()));
    }
    crate::abuse::rate_invite_accept(uid)?;
    crate::abuse::deny_new(&state.db, uid).await?;
    // An adults-only server takes new members only once they are confirmed. (People already in it stay, locked out.)
    crate::age::check_guild(&state.db, gid, uid).await?;
    if max.map(|m| uses >= m).unwrap_or(false) {
        return Err(AppError::BadRequest("Invite has reached its maximum uses".into()));
    }
    if is_banned(&state.db, gid, uid).await? {
        return Err(AppError::BadRequest("You are banned from this server".into()));
    }
    if invites_paused(&state.db, gid, uid).await? {
        return Err(AppError::BadRequest("Invites to this server are paused right now".into()));
    }
    // Remember how they joined (for moderators), and whether the invite only grants temporary membership.
    let inserted = sqlx::query("INSERT INTO guild_members (guild_id, user_id, joined_via, inviter_id, temporary) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING")
        .bind(gid)
        .bind(uid)
        .bind(&code)
        .bind(inviter)
        .bind(temporary)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if inserted > 0 {
        sqlx::query("UPDATE invites SET uses = uses + 1 WHERE code = $1").bind(&code).execute(&mut *tx).await?;
        crate::routes::users::apply_join_defaults(&state.db, uid, gid).await;
    }
    let guild = sqlx::query_as::<_, Guild>(&format!("SELECT {GUILD_COLS} FROM guilds WHERE id = $1"))
        .bind(gid)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    let channels = crate::perms::visible_channels(&state.db, gid, uid).await?;

    let roles = crate::perms::list_roles(&state.db, gid).await?;
    let emojis = crate::routes::expressions::emojis_for_guilds(&state.db, &[gid]).await?;
    let stickers = crate::routes::expressions::stickers_for_guilds(&state.db, &[gid]).await?;
    let extra = crate::routes::communities::with_communities(&state.db, uid, gid, &channels, json!({ "channels": channels, "roles": roles, "emojis": emojis, "stickers": stickers })).await;
    let payload = crate::routes::guilds::guild_payload(&guild, extra);
    if inserted > 0 {
        state.hub.emit_users(vec![uid], "GUILD_CREATE", payload.clone());
        if let Ok(member) = fetch_member(&state.db, gid, uid).await {
            state.hub.emit_guild(gid, "GUILD_MEMBER_ADD", json!(member));
        }
        if let Err(e) = crate::routes::channels::guild_system_message(&state, gid, uid, "member_join", "joined the server.").await {
            tracing::warn!(error = ?e, "join notice failed");
        }
        crate::routes::safety::after_join(&state, gid, uid).await;
    }
    Ok(Json(payload))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badge_settings_are_cleaned() {
        let s = BadgeSettings::from_value(json!({ "label": "  My server  ", "color": "#ABCDEF", "show": "members" }));
        assert!(s.enabled && s.label == "My server" && s.color == "#abcdef" && s.show == "members" && s.style == "flat");
        let bad = BadgeSettings::from_value(json!({ "color": "red\" onload=\"x", "show": "all", "style": "huge", "label": "x".repeat(50) }));
        assert!(bad.color.is_empty() && bad.show == "both" && bad.style == "flat" && bad.label.len() == 32);
        assert!(BadgeSettings::from_value(json!("not an object")) == BadgeSettings::default());
    }
}
