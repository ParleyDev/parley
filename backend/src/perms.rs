//! Discord-style permissions: a bitfield per role, OR'd across a member's roles,
//! then adjusted per channel by allow/deny overwrites (@everyone, then roles, then member).
//! The guild owner and anyone with ADMINISTRATOR bypass everything.

use crate::{
    error::{AppError, AppResult},
    models::{Channel, Guild, Overwrite, Role},
    routes::guilds::{CHANNEL_COLS, GUILD_COLS},
    state::AppState,
    ws::hub::Target,
};
use serde_json::json;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub const CREATE_INVITE: u64 = 1 << 0;
pub const KICK_MEMBERS: u64 = 1 << 1;
pub const BAN_MEMBERS: u64 = 1 << 2;
pub const ADMINISTRATOR: u64 = 1 << 3;
pub const MANAGE_CHANNELS: u64 = 1 << 4;
pub const MANAGE_GUILD: u64 = 1 << 5;
pub const ADD_REACTIONS: u64 = 1 << 6;
/// Read the server's audit log (Manage Server also can).
pub const VIEW_AUDIT_LOG: u64 = 1 << 7;
/// While they speak, everyone else in the voice channel is turned down.
pub const PRIORITY_SPEAKER: u64 = 1 << 8;
pub const STREAM: u64 = 1 << 9;
pub const VIEW_CHANNEL: u64 = 1 << 10;
pub const SEND_MESSAGES: u64 = 1 << 11;
/// Send /tts messages, read aloud to everyone viewing the channel.
pub const SEND_TTS_MESSAGES: u64 = 1 << 12;
pub const MANAGE_MESSAGES: u64 = 1 << 13;
/// Links in their messages unfurl into previews.
pub const EMBED_LINKS: u64 = 1 << 14;
pub const ATTACH_FILES: u64 = 1 << 15;
/// See messages sent before they opened the channel (without it, only new ones).
pub const READ_MESSAGE_HISTORY: u64 = 1 << 16;
pub const MENTION_EVERYONE: u64 = 1 << 17;
/// Use custom emoji from other servers.
pub const USE_EXTERNAL_EMOJIS: u64 = 1 << 18;
/// Moderate threads: lock, archive, rename, see private threads (Manage Messages also can).
pub const MANAGE_THREADS: u64 = 1 << 19;
pub const CONNECT: u64 = 1 << 20;
pub const SPEAK: u64 = 1 << 21;
/// Voice moderation (Discord's bits): server mute, server deafen, move members between voice channels or disconnect them.
pub const MUTE_MEMBERS: u64 = 1 << 22;
pub const DEAFEN_MEMBERS: u64 = 1 << 23;
pub const MOVE_MEMBERS: u64 = 1 << 24;
/// Create, edit and cancel scheduled events (Manage Server also can).
pub const MANAGE_EVENTS: u64 = 1 << 25;
pub const CHANGE_NICKNAME: u64 = 1 << 26;
pub const MANAGE_NICKNAMES: u64 = 1 << 27;
pub const MANAGE_ROLES: u64 = 1 << 28;
/// Time members out (Discord's MODERATE_MEMBERS). Kept below bit 31 so the web client can use plain JS bit ops.
pub const MODERATE_MEMBERS: u64 = 1 << 29;
/// Manage emoji, stickers and soundboard sounds (Manage Server also can).
pub const MANAGE_EXPRESSIONS: u64 = 1 << 30;

/// What a timed-out member loses in every channel: they can still read.
pub const TIMEOUT_STRIP: u64 = SEND_MESSAGES | ADD_REACTIONS | ATTACH_FILES | CONNECT | SPEAK | STREAM | CREATE_INVITE | CHANGE_NICKNAME | MENTION_EVERYONE;

pub const ALL: u64 = CREATE_INVITE
    | KICK_MEMBERS
    | BAN_MEMBERS
    | ADMINISTRATOR
    | MANAGE_CHANNELS
    | MANAGE_GUILD
    | ADD_REACTIONS
    | PRIORITY_SPEAKER
    | STREAM
    | VIEW_CHANNEL
    | SEND_MESSAGES
    | SEND_TTS_MESSAGES
    | MANAGE_MESSAGES
    | ATTACH_FILES
    | MENTION_EVERYONE
    | CONNECT
    | SPEAK
    | MUTE_MEMBERS
    | DEAFEN_MEMBERS
    | MOVE_MEMBERS
    | CHANGE_NICKNAME
    | MANAGE_NICKNAMES
    | MANAGE_ROLES
    | MODERATE_MEMBERS
    | VIEW_AUDIT_LOG
    | EMBED_LINKS
    | READ_MESSAGE_HISTORY
    | USE_EXTERNAL_EMOJIS
    | MANAGE_THREADS
    | MANAGE_EVENTS
    | MANAGE_EXPRESSIONS;

/// What a fresh @everyone role gets (must match migration 0002).
pub const DEFAULT_EVERYONE: u64 =
    CREATE_INVITE | ADD_REACTIONS | STREAM | VIEW_CHANNEL | SEND_MESSAGES | SEND_TTS_MESSAGES | EMBED_LINKS | READ_MESSAGE_HISTORY | USE_EXTERNAL_EMOJIS | ATTACH_FILES | MENTION_EVERYONE | CONNECT | SPEAK | CHANGE_NICKNAME;

/// Allowed when holding any one of `bits` (e.g. Manage Server or the narrower permission).
pub fn check_any(perms: u64, bits: u64) -> AppResult<()> {
    if perms & bits != 0 { Ok(()) } else { Err(AppError::Forbidden) }
}

/// Thread moderation: Manage Messages or Manage Threads.
pub fn moderates_threads(p: u64) -> bool { has(p, MANAGE_MESSAGES) || has(p, MANAGE_THREADS) }

/// Powers a member must never be able to give themselves (self-assignable roles, onboarding answers).
pub const SELF_GRANT_FORBIDDEN: u64 = ADMINISTRATOR | MANAGE_GUILD | MANAGE_ROLES | MANAGE_CHANNELS | KICK_MEMBERS | BAN_MEMBERS | MODERATE_MEMBERS | MANAGE_MESSAGES | MANAGE_NICKNAMES | MANAGE_THREADS | MANAGE_EVENTS | MANAGE_EXPRESSIONS | VIEW_AUDIT_LOG | MENTION_EVERYONE | MUTE_MEMBERS | DEAFEN_MEMBERS | MOVE_MEMBERS;

/// Stage moderator in a channel: Manage Channels, or both Mute Members and Move Members there (Discord's Stage
/// Moderator, granted per stage with a permission overwrite).
pub fn stage_mod(perms: u64) -> bool {
    has(perms, MANAGE_CHANNELS) || (has(perms, MUTE_MEMBERS) && has(perms, MOVE_MEMBERS))
}

pub fn has(perms: u64, bit: u64) -> bool {
    perms & bit == bit
}

pub fn check(perms: u64, bit: u64) -> AppResult<()> {
    if has(perms, bit) { Ok(()) } else { Err(AppError::Forbidden) }
}

/// Everything needed to answer "what can user X do in guild G" in memory.
pub struct GuildCtx {
    pub guild: Guild,
    pub roles: HashMap<Uuid, Role>,
    /// user_id -> role ids (excluding @everyone, which everyone implicitly has)
    pub member_roles: HashMap<Uuid, Vec<Uuid>>,
    pub members: HashSet<Uuid>,
    /// Members whose timeout is still running (loaded with the context).
    pub timed_out: HashSet<Uuid>,
    /// When the server requires 2FA for moderation: members without it, who lose moderator powers.
    pub mfa_missing: HashSet<Uuid>,
}

/// Powers that need two-factor authentication when a server requires it (Discord's list, as far as Parley has them).
pub const MFA_GATED: u64 = ADMINISTRATOR | KICK_MEMBERS | BAN_MEMBERS | MANAGE_CHANNELS | MANAGE_GUILD | MANAGE_MESSAGES | MANAGE_ROLES | MODERATE_MEMBERS;

impl GuildCtx {
    pub async fn load(db: &PgPool, guild_id: Uuid) -> AppResult<Self> {
        let guild = sqlx::query_as::<_, Guild>(&format!("SELECT {GUILD_COLS} FROM guilds WHERE id = $1"))
            .bind(guild_id)
            .fetch_optional(db)
            .await?
            .ok_or_else(|| AppError::NotFound("Server not found".into()))?;
        let roles = list_roles(db, guild_id).await?.into_iter().map(|r| (r.id, r)).collect();
        let members: HashSet<Uuid> = sqlx::query_as::<_, (Uuid,)>("SELECT user_id FROM guild_members WHERE guild_id = $1")
            .bind(guild_id)
            .fetch_all(db)
            .await?
            .into_iter()
            .map(|r| r.0)
            .collect();
        let mut member_roles: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
        let rows: Vec<(Uuid, Uuid)> = sqlx::query_as("SELECT user_id, role_id FROM member_roles WHERE guild_id = $1")
            .bind(guild_id)
            .fetch_all(db)
            .await?;
        for (u, r) in rows {
            member_roles.entry(u).or_default().push(r);
        }
        let timed_out: HashSet<Uuid> = sqlx::query_as::<_, (Uuid,)>("SELECT user_id FROM guild_members WHERE guild_id = $1 AND (timeout_until > now() OR quarantined)")
            .bind(guild_id)
            .fetch_all(db)
            .await?
            .into_iter()
            .map(|r| r.0)
            .collect();
        let mfa_missing: HashSet<Uuid> = if guild.mfa_level >= 1 {
            sqlx::query_as::<_, (Uuid,)>("SELECT m.user_id FROM guild_members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = $1 AND u.totp_secret IS NULL")
                .bind(guild_id).fetch_all(db).await?.into_iter().map(|r| r.0).collect()
        } else { HashSet::new() };
        Ok(Self { guild, roles, member_roles, members, timed_out, mfa_missing })
    }

    pub fn is_member(&self, user: Uuid) -> bool {
        self.members.contains(&user)
    }

    pub fn is_owner(&self, user: Uuid) -> bool {
        self.guild.owner_id == user
    }

    /// Timed out and not exempt (owner and administrators cannot be silenced).
    pub fn is_timed_out(&self, user: Uuid) -> bool {
        self.timed_out.contains(&user) && self.base(user).map(|p| !has(p, ADMINISTRATOR)).unwrap_or(false)
    }

    /// Guild-level permissions, or None if not a member.
    pub fn base(&self, user: Uuid) -> Option<u64> {
        if !self.is_member(user) {
            return None;
        }
        if self.is_owner(user) {
            return Some(ALL);
        }
        let mut p = self.roles.get(&self.guild.id).map(|r| r.permissions as u64).unwrap_or(0);
        for rid in self.member_roles.get(&user).into_iter().flatten() {
            if let Some(r) = self.roles.get(rid) {
                p |= r.permissions as u64;
            }
        }
        if self.mfa_missing.contains(&user) { p &= !MFA_GATED }
        if has(p, ADMINISTRATOR) { Some(ALL) } else { Some(p) }
    }

    /// Position of the member's highest role (0 = only @everyone). Owner outranks everyone.
    pub fn highest(&self, user: Uuid) -> i32 {
        if self.is_owner(user) {
            return i32::MAX;
        }
        self.member_roles
            .get(&user)
            .into_iter()
            .flatten()
            .filter_map(|r| self.roles.get(r))
            .map(|r| r.position)
            .max()
            .unwrap_or(0)
    }

    /// Can `actor` manage (edit/delete/assign) this role? Owner always; otherwise the role must sit below the actor's highest.
    /// @everyone is manageable by anyone allowed to manage roles at all.
    pub fn outranks_role(&self, actor: Uuid, role: &Role) -> bool {
        self.is_owner(actor) || role.id == self.guild.id || role.position < self.highest(actor)
    }

    /// Can `actor` act on (kick, re-role) `target`? Owner is untouchable; otherwise strictly higher.
    pub fn outranks_member(&self, actor: Uuid, target: Uuid) -> bool {
        if self.is_owner(target) {
            return false;
        }
        self.is_owner(actor) || self.highest(actor) > self.highest(target)
    }

    /// Apply channel overwrites to a base permission set.
    pub fn in_channel(&self, user: Uuid, base: u64, overwrites: &[Overwrite]) -> u64 {
        if has(base, ADMINISTRATOR) {
            return ALL;
        }
        let mut p = base;
        // @everyone overwrite
        if let Some(o) = overwrites.iter().find(|o| o.target_id == self.guild.id) {
            p = (p & !(o.deny as u64)) | o.allow as u64;
        }
        // role overwrites, aggregated
        let my_roles = self.member_roles.get(&user);
        let (mut allow, mut deny) = (0u64, 0u64);
        for o in overwrites.iter().filter(|o| o.target_kind == "role" && o.target_id != self.guild.id) {
            if my_roles.map(|rs| rs.contains(&o.target_id)).unwrap_or(false) {
                allow |= o.allow as u64;
                deny |= o.deny as u64;
            }
        }
        p = (p & !deny) | allow;
        // member overwrite
        if let Some(o) = overwrites.iter().find(|o| o.target_kind == "member" && o.target_id == user) {
            p = (p & !(o.deny as u64)) | o.allow as u64;
        }
        if !has(p, VIEW_CHANNEL) {
            return 0;
        }
        if self.timed_out.contains(&user) { p & !TIMEOUT_STRIP } else { p }
    }
}

pub async fn list_roles(db: &PgPool, guild_id: Uuid) -> AppResult<Vec<Role>> {
    Ok(sqlx::query_as::<_, Role>(&format!("SELECT {ROLE_COLS} FROM roles WHERE guild_id = $1 ORDER BY position DESC, created_at"))
        .bind(guild_id)
        .fetch_all(db)
        .await?)
}

pub const ROLE_COLS: &str = "id, guild_id, name, color, color_accent, position, permissions, hoist, created_at, name_style, icon, mentionable, self_assignable, managed_app_id, requirements";

/// Fill `overwrites` on each channel in one query.
pub async fn attach_overwrites(db: &PgPool, channels: &mut [Channel]) -> AppResult<()> {
    let mut ids: Vec<Uuid> = channels.iter().map(|c| c.id).collect();
    if ids.is_empty() {
        return Ok(());
    }
    // Studio engineers ride along with the channel payload.
    let studios: Vec<Uuid> = channels.iter().filter(|c| c.kind == "studio").map(|c| c.id).collect();
    if !studios.is_empty() {
        let rows: Vec<(Uuid, Uuid)> = sqlx::query_as("SELECT channel_id, user_id FROM studio_engineers WHERE channel_id = ANY($1) ORDER BY added_at").bind(&studios).fetch_all(db).await?;
        for c in channels.iter_mut() { c.engineer_ids = rows.iter().filter(|(ch, _)| *ch == c.id).map(|(_, u)| *u).collect(); }
    }
    // Channels without their own overwrites inherit their category's, so load parents too.
    for pid in channels.iter().filter_map(|c| c.parent_id) {
        if !ids.contains(&pid) {
            ids.push(pid);
        }
    }
    let rows = sqlx::query_as::<_, Overwrite>(
        "SELECT channel_id, target_id, target_kind, allow, deny FROM channel_overwrites WHERE channel_id = ANY($1)",
    )
    .bind(&ids)
    .fetch_all(db)
    .await?;
    let mut by_channel: HashMap<Uuid, Vec<Overwrite>> = HashMap::new();
    for o in rows {
        by_channel.entry(o.channel_id).or_default().push(o);
    }
    for c in channels.iter_mut() {
        let own = by_channel.get(&c.id).cloned().unwrap_or_default();
        c.permissions_synced = c.parent_id.map(|_| own.is_empty());
        c.overwrites = if own.is_empty() {
            match c.parent_id.and_then(|p| by_channel.get(&p)) {
                // Re-key so the client treats them as this channel's effective overwrites.
                Some(inherited) => inherited.iter().map(|o| Overwrite { channel_id: c.id, ..o.clone() }).collect(),
                None => own,
            }
        } else {
            own
        };
    }
    Ok(())
}

/// Guild-level permissions for a user; NotFound if not a member (don't reveal the guild exists).
pub async fn guild_perms(db: &PgPool, guild_id: Uuid, user: Uuid) -> AppResult<(GuildCtx, u64)> {
    let ctx = GuildCtx::load(db, guild_id).await?;
    let p = ctx.base(user).ok_or_else(|| AppError::NotFound("Server not found".into()))?;
    Ok((ctx, p))
}

/// Permissions in a specific guild channel (channel must have overwrites attached).
pub async fn channel_perms(db: &PgPool, channel: &Channel, user: Uuid) -> AppResult<(GuildCtx, u64)> {
    let gid = channel.guild_id.ok_or(AppError::Forbidden)?;
    let (ctx, base) = guild_perms(db, gid, user).await?;
    let p = ctx.in_channel(user, base, &channel.overwrites);
    Ok((ctx, p))
}

/// Every member who can see this guild channel.
pub fn audience(ctx: &GuildCtx, channel: &Channel) -> Vec<Uuid> {
    ctx.members
        .iter()
        .copied()
        .filter(|u| ctx.base(*u).map(|b| has(ctx.in_channel(*u, b, &channel.overwrites), VIEW_CHANNEL)).unwrap_or(false))
        .collect()
}

pub async fn channel_audience(db: &PgPool, channel: &Channel) -> AppResult<Target> {
    let gid = channel.guild_id.ok_or(AppError::Forbidden)?;
    let ctx = GuildCtx::load(db, gid).await?;
    Ok(Target::Users(audience(&ctx, channel)))
}

/// All channels of a guild with overwrites attached, ordered for display.
pub async fn guild_channels(db: &PgPool, guild_id: Uuid) -> AppResult<Vec<Channel>> {
    let mut cs = sqlx::query_as::<_, Channel>(&format!(
        "SELECT {CHANNEL_COLS} FROM channels WHERE guild_id = $1 ORDER BY position, created_at"
    ))
    .bind(guild_id)
    .fetch_all(db)
    .await?;
    attach_overwrites(db, &mut cs).await?;
    Ok(cs)
}

/// Channels of a guild the user may view.
pub async fn visible_channels(db: &PgPool, guild_id: Uuid, user: Uuid) -> AppResult<Vec<Channel>> {
    let ctx = GuildCtx::load(db, guild_id).await?;
    let Some(base) = ctx.base(user) else { return Ok(vec![]) };
    let cs = guild_channels(db, guild_id).await?;
    Ok(cs.into_iter().filter(|c| has(ctx.in_channel(user, base, &c.overwrites), VIEW_CHANNEL)).collect())
}

/// channel -> set of users who can see it, for every channel in the guild.
pub type Visibility = HashMap<Uuid, (Channel, HashSet<Uuid>)>;

pub async fn visibility(db: &PgPool, guild_id: Uuid) -> AppResult<Visibility> {
    let ctx = GuildCtx::load(db, guild_id).await?;
    let cs = guild_channels(db, guild_id).await?;
    Ok(cs.into_iter().map(|c| { let a = audience(&ctx, &c).into_iter().collect(); (c.id, (c, a)) }).collect())
}

/// After a permission change: tell users who gained a channel about it (CHANNEL_CREATE),
/// and users who lost one to drop it (CHANNEL_DELETE). Everyone who keeps seeing it gets CHANNEL_UPDATE
/// so overwrites stay in sync client-side.
pub async fn resync_visibility(state: &AppState, guild_id: Uuid, before: &Visibility) -> AppResult<()> {
    let after = visibility(&state.db, guild_id).await?;
    refresh_voice(state, guild_id, &after).await?;
    for (cid, (channel, now)) in &after {
        let was: HashSet<Uuid> = before.get(cid).map(|(_, s)| s.clone()).unwrap_or_default();
        let gained: Vec<Uuid> = now.difference(&was).copied().collect();
        let lost: Vec<Uuid> = was.difference(now).copied().collect();
        let kept: Vec<Uuid> = now.intersection(&was).copied().collect();
        if !gained.is_empty() {
            state.hub.emit_users(gained, "CHANNEL_CREATE", json!(channel));
        }
        if !lost.is_empty() {
            state.hub.voice_evict(|v| v.channel_id == *cid && lost.contains(&v.user_id));
            state.hub.emit_users(lost, "CHANNEL_DELETE", json!({ "id": cid, "guild_id": guild_id }));
        }
        if !kept.is_empty() {
            state.hub.emit_users(kept, "CHANNEL_UPDATE", json!(channel));
        }
    }
    Ok(())
}

/// Re-evaluate CONNECT / SPEAK / STREAM for everyone currently in this guild's voice channels.
/// Lost CONNECT evicts; lost SPEAK sets `suppress`; lost STREAM drops camera/screen flags.
async fn refresh_voice(state: &AppState, guild_id: Uuid, vis: &Visibility) -> AppResult<()> {
    let states = state.hub.voice_states_for_guilds(&[guild_id]);
    if states.is_empty() {
        return Ok(());
    }
    let ctx = GuildCtx::load(&state.db, guild_id).await?;
    for vs in states {
        let Some((channel, _)) = vis.get(&vs.channel_id) else { continue };
        let p = ctx.base(vs.user_id).map(|b| ctx.in_channel(vs.user_id, b, &channel.overwrites)).unwrap_or(0);
        if !has(p, CONNECT) {
            state.hub.voice_evict(|v| v.user_id == vs.user_id);
            state.hub.emit_users(vec![vs.user_id], "VOICE_ERROR", json!({ "message": "You no longer have permission to be in this voice channel" }));
            continue;
        }
        // Stage and studio audiences, and the AFK channel, stay suppressed until a moderator (or leaving) lifts it.
        let sticky = matches!(channel.kind.as_str(), "stage" | "studio") || ctx.guild.afk_channel_id == Some(channel.id);
        let suppress = !has(p, SPEAK) || (sticky && vs.suppress);
        let can_stream = has(p, STREAM);
        let changed = vs.suppress != suppress || (!can_stream && (vs.self_video || vs.self_stream));
        if changed {
            if let Some(updated) = state.hub.voice_update(vs.user_id, |v| {
                v.suppress = suppress;
                if !can_stream { v.self_video = false; v.self_stream = false; }
            }) {
                state.hub.emit_users(audience(&ctx, channel), "VOICE_STATE_UPDATE", json!(updated));
            }
        }
    }
    Ok(())
}

/// Human-readable catalogue, handy for clients and tests.
pub fn catalogue() -> Vec<(&'static str, u64)> {
    vec![
        ("CREATE_INVITE", CREATE_INVITE),
        ("KICK_MEMBERS", KICK_MEMBERS),
        ("BAN_MEMBERS", BAN_MEMBERS),
        ("ADMINISTRATOR", ADMINISTRATOR),
        ("MANAGE_CHANNELS", MANAGE_CHANNELS),
        ("MANAGE_GUILD", MANAGE_GUILD),
        ("ADD_REACTIONS", ADD_REACTIONS),
        ("STREAM", STREAM),
        ("VIEW_CHANNEL", VIEW_CHANNEL),
        ("SEND_MESSAGES", SEND_MESSAGES),
        ("SEND_TTS_MESSAGES", SEND_TTS_MESSAGES),
        ("PRIORITY_SPEAKER", PRIORITY_SPEAKER),
        ("VIEW_AUDIT_LOG", VIEW_AUDIT_LOG),
        ("EMBED_LINKS", EMBED_LINKS),
        ("READ_MESSAGE_HISTORY", READ_MESSAGE_HISTORY),
        ("USE_EXTERNAL_EMOJIS", USE_EXTERNAL_EMOJIS),
        ("MANAGE_THREADS", MANAGE_THREADS),
        ("MANAGE_EVENTS", MANAGE_EVENTS),
        ("MANAGE_EXPRESSIONS", MANAGE_EXPRESSIONS),
        ("MANAGE_MESSAGES", MANAGE_MESSAGES),
        ("ATTACH_FILES", ATTACH_FILES),
        ("MENTION_EVERYONE", MENTION_EVERYONE),
        ("CONNECT", CONNECT),
        ("SPEAK", SPEAK),
        ("MUTE_MEMBERS", MUTE_MEMBERS),
        ("DEAFEN_MEMBERS", DEAFEN_MEMBERS),
        ("MOVE_MEMBERS", MOVE_MEMBERS),
        ("CHANGE_NICKNAME", CHANGE_NICKNAME),
        ("MANAGE_NICKNAMES", MANAGE_NICKNAMES),
        ("MANAGE_ROLES", MANAGE_ROLES),
        ("MODERATE_MEMBERS", MODERATE_MEMBERS),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn default_matches_migration() {
        // 70258241 from migration 0002, plus ATTACH_FILES (32768) from 0003 and MENTION_EVERYONE (131072) from 0018.
        assert_eq!(DEFAULT_EVERYONE, 70258241 + 32768 + 131072 + 4096 + 16384 + 65536 + 262144);
    }

    #[test]
    fn has_requires_every_bit() {
        assert!(has(VIEW_CHANNEL | SEND_MESSAGES, VIEW_CHANNEL));
        assert!(has(VIEW_CHANNEL | SEND_MESSAGES, VIEW_CHANNEL | SEND_MESSAGES));
        assert!(!has(VIEW_CHANNEL, VIEW_CHANNEL | SEND_MESSAGES));
        assert!(has(0, 0));
        assert!(check(ALL, MANAGE_ROLES).is_ok());
        assert!(matches!(check(DEFAULT_EVERYONE, MANAGE_ROLES), Err(AppError::Forbidden)));
    }

    #[test]
    fn catalogue_covers_all() {
        let mut bits = 0u64;
        for (_, b) in catalogue() {
            assert_eq!(b.count_ones(), 1, "each catalogue entry is a single bit");
            assert_eq!(bits & b, 0, "no duplicate bits");
            bits |= b;
        }
        assert_eq!(bits, ALL);
    }

    // ---- fixtures ----------------------------------------------------------

    struct Fx {
        ctx: GuildCtx,
        owner: Uuid,
        mod_role: Uuid,
        vip_role: Uuid,
        admin_role: Uuid,
    }

    fn role(gid: Uuid, position: i32, permissions: u64) -> Role {
        Role {
            id: Uuid::now_v7(),
            guild_id: gid,
            name: format!("r{position}"),
            color: None,
            color_accent: None,
            position,
            permissions: permissions as i64,
            hoist: false,
            created_at: Utc::now(),
            name_style: serde_json::Value::Null,
            icon: None,
            mentionable: false,
            self_assignable: false,
            managed_app_id: None,
            requirements: None,
        }
    }

    fn fixture() -> Fx {
        let gid = Uuid::now_v7();
        let owner = Uuid::now_v7();
        let guild = Guild {
            id: gid,
            name: "g".into(),
            icon_url: None,
            owner_id: owner,
            created_at: Utc::now(),
            banner_url: None,
            rules: String::new(),
            rules_required: false,
            description: String::new(),
            system_channel_id: None,
            join_notices: true,
            join_wave: true,
            default_notifications: "all".into(),
            verification_level: 0,
            mfa_level: 0,
            invites_paused: false,
            dms_paused_until: None,
            afk_channel_id: None,
            afk_timeout: 300,
            rules_channel_id: None,
            welcome_screen: serde_json::json!({}),
            raid_protection: true,
            raid_threshold: 10,
            safety_alerts_channel_id: None,
            onboarding: serde_json::json!({}), applications: serde_json::json!({}), tag: None, tag_badge: None, partnered: false, explicit_filter: String::new(), summaries_enabled: true,
            widget_enabled: false,
            widget_invite: String::new(),
            invite_splash_url: None,
        };
        let mut everyone = role(gid, 0, DEFAULT_EVERYONE);
        everyone.id = gid; // @everyone shares the guild id
        let mod_role = role(gid, 2, KICK_MEMBERS | MANAGE_MESSAGES);
        let vip_role = role(gid, 1, STREAM);
        let admin_role = role(gid, 3, ADMINISTRATOR);
        let (m, v, a) = (mod_role.id, vip_role.id, admin_role.id);
        let roles = [everyone, mod_role, vip_role, admin_role].into_iter().map(|r| (r.id, r)).collect();
        let ctx = GuildCtx { guild, roles, member_roles: HashMap::new(), members: HashSet::from([owner]), timed_out: HashSet::new(), mfa_missing: HashSet::new() };
        Fx { ctx, owner, mod_role: m, vip_role: v, admin_role: a }
    }

    impl Fx {
        fn member(&mut self, roles: &[Uuid]) -> Uuid {
            let u = Uuid::now_v7();
            self.ctx.members.insert(u);
            if !roles.is_empty() {
                self.ctx.member_roles.insert(u, roles.to_vec());
            }
            u
        }
    }

    fn ow(channel: Uuid, kind: &str, target: Uuid, allow: u64, deny: u64) -> Overwrite {
        Overwrite { channel_id: channel, target_id: target, target_kind: kind.into(), allow: allow as i64, deny: deny as i64 }
    }

    // ---- base permissions --------------------------------------------------

    #[test]
    fn non_member_has_no_base() {
        let fx = fixture();
        assert_eq!(fx.ctx.base(Uuid::now_v7()), None);
        assert!(!fx.ctx.is_member(Uuid::now_v7()));
    }

    #[test]
    fn owner_gets_everything() {
        let fx = fixture();
        assert_eq!(fx.ctx.base(fx.owner), Some(ALL));
        assert_eq!(fx.ctx.highest(fx.owner), i32::MAX);
    }

    #[test]
    fn plain_member_gets_everyone_role() {
        let mut fx = fixture();
        let u = fx.member(&[]);
        assert_eq!(fx.ctx.base(u), Some(DEFAULT_EVERYONE));
        assert_eq!(fx.ctx.highest(u), 0);
    }

    #[test]
    fn roles_are_ored_onto_everyone() {
        let mut fx = fixture();
        let (m, v) = (fx.mod_role, fx.vip_role);
        let u = fx.member(&[m, v]);
        let p = fx.ctx.base(u).unwrap();
        assert_eq!(p, DEFAULT_EVERYONE | KICK_MEMBERS | MANAGE_MESSAGES | STREAM);
        assert!(!has(p, ADMINISTRATOR));
        assert_eq!(fx.ctx.highest(u), 2, "highest position wins");
    }

    #[test]
    fn unknown_role_ids_are_ignored() {
        let mut fx = fixture();
        let u = fx.member(&[Uuid::now_v7()]);
        assert_eq!(fx.ctx.base(u), Some(DEFAULT_EVERYONE));
        assert_eq!(fx.ctx.highest(u), 0);
    }

    #[test]
    fn administrator_expands_to_all() {
        let mut fx = fixture();
        let a = fx.admin_role;
        let u = fx.member(&[a]);
        assert_eq!(fx.ctx.base(u), Some(ALL));
    }

    #[test]
    fn stripped_everyone_role_leaves_nothing() {
        let mut fx = fixture();
        let gid = fx.ctx.guild.id;
        fx.ctx.roles.get_mut(&gid).unwrap().permissions = 0;
        let u = fx.member(&[]);
        assert_eq!(fx.ctx.base(u), Some(0));
    }

    // ---- hierarchy ---------------------------------------------------------

    #[test]
    fn owner_outranks_everyone_and_is_untouchable() {
        let mut fx = fixture();
        let a = fx.admin_role;
        let admin = fx.member(&[a]);
        assert!(fx.ctx.outranks_member(fx.owner, admin));
        assert!(!fx.ctx.outranks_member(admin, fx.owner));
        assert!(!fx.ctx.outranks_member(fx.owner, fx.owner), "owner cannot act on themself");
        let top = fx.ctx.roles[&a].clone();
        assert!(fx.ctx.outranks_role(fx.owner, &top));
    }

    #[test]
    fn member_outranks_only_strictly_lower() {
        let mut fx = fixture();
        let (m, v) = (fx.mod_role, fx.vip_role);
        let moderator = fx.member(&[m]);
        let vip = fx.member(&[v]);
        let other_mod = fx.member(&[m]);
        let plain = fx.member(&[]);
        assert!(fx.ctx.outranks_member(moderator, vip));
        assert!(fx.ctx.outranks_member(moderator, plain));
        assert!(!fx.ctx.outranks_member(vip, moderator));
        assert!(!fx.ctx.outranks_member(moderator, other_mod), "equal rank never outranks");
        assert!(!fx.ctx.outranks_member(plain, plain));
    }

    #[test]
    fn role_management_respects_position() {
        let mut fx = fixture();
        let (m, v, a) = (fx.mod_role, fx.vip_role, fx.admin_role);
        let moderator = fx.member(&[m]);
        let vip_role = fx.ctx.roles[&v].clone();
        let mod_role = fx.ctx.roles[&m].clone();
        let admin_role = fx.ctx.roles[&a].clone();
        let everyone = fx.ctx.roles[&fx.ctx.guild.id].clone();
        assert!(fx.ctx.outranks_role(moderator, &vip_role));
        assert!(!fx.ctx.outranks_role(moderator, &mod_role), "cannot manage own highest role");
        assert!(!fx.ctx.outranks_role(moderator, &admin_role));
        assert!(fx.ctx.outranks_role(moderator, &everyone), "@everyone is always manageable");
        let plain = fx.member(&[]);
        assert!(fx.ctx.outranks_role(plain, &everyone));
        assert!(!fx.ctx.outranks_role(plain, &vip_role));
    }

    // ---- channel overwrites ------------------------------------------------

    #[test]
    fn no_overwrites_keeps_base() {
        let mut fx = fixture();
        let u = fx.member(&[]);
        assert_eq!(fx.ctx.in_channel(u, DEFAULT_EVERYONE, &[]), DEFAULT_EVERYONE);
    }

    #[test]
    fn admin_bypasses_overwrites() {
        let mut fx = fixture();
        let a = fx.admin_role;
        let u = fx.member(&[a]);
        let ch = Uuid::now_v7();
        let ows = [ow(ch, "role", fx.ctx.guild.id, 0, VIEW_CHANNEL), ow(ch, "member", u, 0, ALL)];
        assert_eq!(fx.ctx.in_channel(u, ALL, &ows), ALL);
        // owner goes through the same path with base == ALL
        assert_eq!(fx.ctx.in_channel(fx.owner, ALL, &ows), ALL);
    }

    #[test]
    fn losing_view_channel_zeroes_everything() {
        let mut fx = fixture();
        let u = fx.member(&[]);
        let ch = Uuid::now_v7();
        let ows = [ow(ch, "role", fx.ctx.guild.id, 0, VIEW_CHANNEL)];
        assert_eq!(fx.ctx.in_channel(u, DEFAULT_EVERYONE, &ows), 0);
    }

    #[test]
    fn everyone_overwrite_applies_to_all_members() {
        let mut fx = fixture();
        let u = fx.member(&[]);
        let ch = Uuid::now_v7();
        let ows = [ow(ch, "role", fx.ctx.guild.id, MANAGE_MESSAGES, SEND_MESSAGES)];
        let p = fx.ctx.in_channel(u, DEFAULT_EVERYONE, &ows);
        assert!(has(p, MANAGE_MESSAGES));
        assert!(!has(p, SEND_MESSAGES));
        assert!(has(p, VIEW_CHANNEL));
    }

    #[test]
    fn role_overwrite_only_for_holders_and_beats_everyone() {
        let mut fx = fixture();
        let v = fx.vip_role;
        let vip = fx.member(&[v]);
        let plain = fx.member(&[]);
        let ch = Uuid::now_v7();
        // read-only channel: everyone loses SEND, vips get it back
        let ows = [ow(ch, "role", fx.ctx.guild.id, 0, SEND_MESSAGES), ow(ch, "role", v, SEND_MESSAGES, 0)];
        assert!(has(fx.ctx.in_channel(vip, fx.ctx.base(vip).unwrap(), &ows), SEND_MESSAGES));
        assert!(!has(fx.ctx.in_channel(plain, fx.ctx.base(plain).unwrap(), &ows), SEND_MESSAGES));
    }

    #[test]
    fn role_overwrites_aggregate_allow_over_deny() {
        let mut fx = fixture();
        let (m, v) = (fx.mod_role, fx.vip_role);
        let u = fx.member(&[m, v]);
        let ch = Uuid::now_v7();
        // one role denies ATTACH_FILES, another allows it: allow wins (Discord semantics)
        let ows = [ow(ch, "role", m, 0, ATTACH_FILES), ow(ch, "role", v, ATTACH_FILES, 0)];
        let p = fx.ctx.in_channel(u, fx.ctx.base(u).unwrap(), &ows);
        assert!(has(p, ATTACH_FILES));
        // roles only deny -> gone
        let ows = [ow(ch, "role", m, 0, ATTACH_FILES)];
        assert!(!has(fx.ctx.in_channel(u, fx.ctx.base(u).unwrap(), &ows), ATTACH_FILES));
    }

    #[test]
    fn member_overwrite_beats_roles() {
        let mut fx = fixture();
        let v = fx.vip_role;
        let u = fx.member(&[v]);
        let other = fx.member(&[v]);
        let ch = Uuid::now_v7();
        let ows = [ow(ch, "role", v, SEND_MESSAGES, 0), ow(ch, "member", u, 0, SEND_MESSAGES)];
        assert!(!has(fx.ctx.in_channel(u, fx.ctx.base(u).unwrap(), &ows), SEND_MESSAGES));
        assert!(has(fx.ctx.in_channel(other, fx.ctx.base(other).unwrap(), &ows), SEND_MESSAGES));
        // member allow restores what the everyone overwrite removed
        let ows = [ow(ch, "role", fx.ctx.guild.id, 0, VIEW_CHANNEL), ow(ch, "member", u, VIEW_CHANNEL, 0)];
        assert!(has(fx.ctx.in_channel(u, fx.ctx.base(u).unwrap(), &ows), VIEW_CHANNEL));
        assert_eq!(fx.ctx.in_channel(other, fx.ctx.base(other).unwrap(), &ows), 0);
    }

    #[test]
    fn member_overwrite_for_someone_else_is_ignored() {
        let mut fx = fixture();
        let u = fx.member(&[]);
        let ch = Uuid::now_v7();
        let ows = [ow(ch, "member", Uuid::now_v7(), 0, VIEW_CHANNEL)];
        assert_eq!(fx.ctx.in_channel(u, DEFAULT_EVERYONE, &ows), DEFAULT_EVERYONE);
    }

    #[test]
    fn timed_out_members_can_only_read() {
        let mut fx = fixture();
        let (m, a) = (fx.mod_role, fx.admin_role);
        let u = fx.member(&[m]);
        let admin = fx.member(&[a]);
        fx.ctx.timed_out.insert(u);
        fx.ctx.timed_out.insert(admin);
        fx.ctx.timed_out.insert(fx.owner);
        assert!(fx.ctx.is_timed_out(u));
        assert!(!fx.ctx.is_timed_out(admin), "administrators are exempt");
        assert!(!fx.ctx.is_timed_out(fx.owner), "the owner is exempt");
        let p = fx.ctx.in_channel(u, fx.ctx.base(u).unwrap(), &[]);
        assert!(has(p, VIEW_CHANNEL) && has(p, MANAGE_MESSAGES), "reading and moderation bits survive");
        assert!(!has(p, SEND_MESSAGES) && !has(p, ADD_REACTIONS) && !has(p, CONNECT) && !has(p, ATTACH_FILES));
        assert_eq!(fx.ctx.in_channel(admin, ALL, &[]), ALL);
        // a member overwrite cannot undo a timeout
        let ows = [ow(Uuid::now_v7(), "member", u, SEND_MESSAGES, 0)];
        assert!(!has(fx.ctx.in_channel(u, fx.ctx.base(u).unwrap(), &ows), SEND_MESSAGES));
    }

    #[test]
    fn overwrites_cannot_grant_administrator_bypass() {
        let mut fx = fixture();
        let u = fx.member(&[]);
        let ch = Uuid::now_v7();
        // granting ADMINISTRATOR via overwrite sets the bit but does not expand to ALL
        let ows = [ow(ch, "member", u, ADMINISTRATOR, 0)];
        let p = fx.ctx.in_channel(u, DEFAULT_EVERYONE, &ows);
        assert_eq!(p, DEFAULT_EVERYONE | ADMINISTRATOR);
        assert!(!has(p, MANAGE_ROLES));
    }
}

/// Is this user an engineer of the studio channel?
pub async fn is_engineer(db: &PgPool, channel_id: Uuid, user: Uuid) -> AppResult<bool> {
    let row: Option<(bool,)> = sqlx::query_as("SELECT true FROM studio_engineers WHERE channel_id = $1 AND user_id = $2").bind(channel_id).bind(user).fetch_optional(db).await?;
    Ok(row.is_some())
}
