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
pub const STREAM: u64 = 1 << 9;
pub const VIEW_CHANNEL: u64 = 1 << 10;
pub const SEND_MESSAGES: u64 = 1 << 11;
pub const MANAGE_MESSAGES: u64 = 1 << 13;
pub const ATTACH_FILES: u64 = 1 << 15;
pub const CONNECT: u64 = 1 << 20;
pub const SPEAK: u64 = 1 << 21;
pub const CHANGE_NICKNAME: u64 = 1 << 26;
pub const MANAGE_NICKNAMES: u64 = 1 << 27;
pub const MANAGE_ROLES: u64 = 1 << 28;

pub const ALL: u64 = CREATE_INVITE
    | KICK_MEMBERS
    | BAN_MEMBERS
    | ADMINISTRATOR
    | MANAGE_CHANNELS
    | MANAGE_GUILD
    | ADD_REACTIONS
    | STREAM
    | VIEW_CHANNEL
    | SEND_MESSAGES
    | MANAGE_MESSAGES
    | ATTACH_FILES
    | CONNECT
    | SPEAK
    | CHANGE_NICKNAME
    | MANAGE_NICKNAMES
    | MANAGE_ROLES;

/// What a fresh @everyone role gets (must match migration 0002).
pub const DEFAULT_EVERYONE: u64 =
    CREATE_INVITE | ADD_REACTIONS | STREAM | VIEW_CHANNEL | SEND_MESSAGES | ATTACH_FILES | CONNECT | SPEAK | CHANGE_NICKNAME;

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
}

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
        Ok(Self { guild, roles, member_roles, members })
    }

    pub fn is_member(&self, user: Uuid) -> bool {
        self.members.contains(&user)
    }

    pub fn is_owner(&self, user: Uuid) -> bool {
        self.guild.owner_id == user
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
        if !has(p, VIEW_CHANNEL) { 0 } else { p }
    }
}

pub async fn list_roles(db: &PgPool, guild_id: Uuid) -> AppResult<Vec<Role>> {
    Ok(sqlx::query_as::<_, Role>(&format!("SELECT {ROLE_COLS} FROM roles WHERE guild_id = $1 ORDER BY position DESC, created_at"))
        .bind(guild_id)
        .fetch_all(db)
        .await?)
}

pub const ROLE_COLS: &str = "id, guild_id, name, color, color_accent, position, permissions, hoist, created_at";

/// Fill `overwrites` on each channel in one query.
pub async fn attach_overwrites(db: &PgPool, channels: &mut [Channel]) -> AppResult<()> {
    let ids: Vec<Uuid> = channels.iter().map(|c| c.id).collect();
    if ids.is_empty() {
        return Ok(());
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
        c.overwrites = by_channel.remove(&c.id).unwrap_or_default();
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
        let suppress = !has(p, SPEAK);
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
        ("MANAGE_MESSAGES", MANAGE_MESSAGES),
        ("ATTACH_FILES", ATTACH_FILES),
        ("CONNECT", CONNECT),
        ("SPEAK", SPEAK),
        ("CHANGE_NICKNAME", CHANGE_NICKNAME),
        ("MANAGE_NICKNAMES", MANAGE_NICKNAMES),
        ("MANAGE_ROLES", MANAGE_ROLES),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_matches_migration() {
        // 70258241 from migration 0002 plus ATTACH_FILES (32768) from 0003.
        assert_eq!(DEFAULT_EVERYONE, 70258241 + 32768);
    }
}
