use crate::{
    auth::AuthUser,
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
type PreviewRow = (Uuid, String, Option<String>, i64, bool, String, bool, String);
/// guild id, uses, max uses, expiry, invite code.
type AcceptRow = (Uuid, i32, Option<i32>, Option<chrono::DateTime<chrono::Utc>>, String);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/invites/:code", get(preview).post(accept))
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

async fn preview(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    let row: Option<PreviewRow> = sqlx::query_as(&format!(
        "SELECT g.id, g.name, g.icon_url, (SELECT COUNT(*) FROM guild_members WHERE guild_id = g.id), {LIVE}, g.rules, g.rules_required, i.code
         FROM invites i JOIN guilds g ON g.id = i.guild_id WHERE {MATCH} ORDER BY i.vanity LIMIT 1"
    ))
    .bind(&code)
    .fetch_optional(&state.db)
    .await?;
    let (gid, name, icon, count, live, rules, rules_required, code) = row.ok_or_else(|| AppError::NotFound("Invite not found or expired".into()))?;
    let already: Option<(bool,)> = sqlx::query_as("SELECT true FROM guild_members WHERE guild_id = $1 AND user_id = $2")
        .bind(gid)
        .bind(uid)
        .fetch_optional(&state.db)
        .await?;
    let online = crate::ws::bus::online_users(&state.db).await;
    let (online_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM guild_members WHERE guild_id = $1 AND user_id = ANY($2)").bind(gid).bind(&online).fetch_one(&state.db).await?;
    Ok(Json(json!({
        "code": code,
        "guild": { "id": gid, "name": name, "icon_url": icon, "member_count": count, "online_count": online_count, "rules": rules, "rules_required": rules_required },
        "expired": !live,
        "already_member": already.is_some(),
        "banned": is_banned(&state.db, gid, uid).await?,
    })))
}

async fn accept(
    State(state): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(code): Path<String>,
) -> AppResult<Json<Value>> {
    let mut tx = state.db.begin().await?;
    let row: Option<AcceptRow> = sqlx::query_as(&format!(
        "SELECT i.guild_id, i.uses, i.max_uses, i.expires_at, i.code FROM invites i WHERE {MATCH} ORDER BY i.vanity LIMIT 1 FOR UPDATE"
    ))
    .bind(&code)
    .fetch_optional(&mut *tx)
    .await?;
    let (gid, uses, max, expires, code) = row.ok_or_else(|| AppError::NotFound("Invite not found or expired".into()))?;
    if expires.is_some_and(|t| t <= chrono::Utc::now()) {
        return Err(AppError::BadRequest("This invite has expired".into()));
    }
    if max.map(|m| uses >= m).unwrap_or(false) {
        return Err(AppError::BadRequest("Invite has reached its maximum uses".into()));
    }
    if is_banned(&state.db, gid, uid).await? {
        return Err(AppError::BadRequest("You are banned from this server".into()));
    }
    let inserted = sqlx::query("INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(gid)
        .bind(uid)
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
    let payload = json!({ "id": guild.id, "name": guild.name, "icon_url": guild.icon_url, "banner_url": guild.banner_url, "owner_id": guild.owner_id, "rules": guild.rules, "rules_required": guild.rules_required,
        "created_at": guild.created_at, "channels": channels, "roles": roles, "emojis": emojis, "stickers": stickers });
    if inserted > 0 {
        state.hub.emit_users(vec![uid], "GUILD_CREATE", payload.clone());
        if let Ok(member) = fetch_member(&state.db, gid, uid).await {
            state.hub.emit_guild(gid, "GUILD_MEMBER_ADD", json!(member));
        }
        if let Err(e) = crate::routes::channels::guild_system_message(&state, gid, uid, "member_join", "joined the server.").await {
            tracing::warn!(error = ?e, "join notice failed");
        }
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
