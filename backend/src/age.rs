//! Age assurance: the one place that decides whether an account may see something with a minimum age.
//!
//! Two questions, both answered by SQL functions (migration 0173) so that queries can ask them inline:
//! `channel_min_age(channel)` is the age a channel asks for after inheritance (its own, its category's or parent
//! channel's, its server's); `age_meets(user, age)` is whether the account holds a current record at a level this
//! instance accepts. Nothing in the permission system grants this: it is checked after permissions, for owners and
//! administrators too.
//!
//! Content access goes through `routes::channels::require_channel`, live events through `perms::channel_audience`,
//! lists of channels to read from through `perms::readable_channels`, and files through `routes::attachments`.
//! All of them end up here. A restricted channel is still *listed* (name and a lock) for people who do not meet it,
//! through the `_listed` variants, which never return content.

use crate::{error::{AppError, AppResult}, models::Channel};
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::Uuid;

/// The age this channel asks for, if any.
pub async fn min_age(db: &PgPool, channel_id: Uuid) -> AppResult<Option<i32>> {
    Ok(sqlx::query_as::<_, (Option<i32>,)>("SELECT channel_min_age($1)").bind(channel_id).fetch_optional(db).await?.and_then(|r| r.0))
}

/// Whether the account meets an age under this instance's rules.
pub async fn meets(db: &PgPool, uid: Uuid, need: i32) -> AppResult<bool> {
    Ok(sqlx::query_as::<_, (bool,)>("SELECT age_meets($1, $2)").bind(uid).bind(need).fetch_one(db).await?.0)
}

/// Refuse content of a channel to someone who does not meet its age. `AgeGate(true)`: they said they are under 18.
pub async fn check(db: &PgPool, c: &Channel, uid: Uuid) -> AppResult<()> {
    if c.guild_id.is_none() { return Ok(()) }
    check_id(db, c.id, uid).await
}

/// The same by channel id.
pub async fn check_id(db: &PgPool, channel_id: Uuid, uid: Uuid) -> AppResult<()> {
    let Some(need) = min_age(db, channel_id).await? else { return Ok(()) };
    if meets(db, uid, need).await? { return Ok(()) }
    let minor: bool = sqlx::query_as::<_, (bool,)>("SELECT declared_minor FROM users WHERE id = $1").bind(uid).fetch_optional(db).await?.map(|r| r.0).unwrap_or(false);
    Err(AppError::AgeGate(minor))
}

/// Of these people, the ones who may receive this channel's content.
pub async fn filter(db: &PgPool, channel_id: Uuid, users: Vec<Uuid>) -> AppResult<Vec<Uuid>> {
    let Some(need) = min_age(db, channel_id).await? else { return Ok(users) };
    Ok(sqlx::query_as::<_, (Uuid,)>("SELECT u FROM unnest($1::uuid[]) AS u WHERE age_meets(u, $2)").bind(&users).bind(need).fetch_all(db).await?.into_iter().map(|r| r.0).collect())
}

/// Channels of a server whose content this person may not have.
pub async fn blocked_channels(db: &PgPool, guild_id: Uuid, uid: Uuid) -> AppResult<HashSet<Uuid>> {
    Ok(sqlx::query_as::<_, (Uuid,)>("SELECT id FROM channels WHERE guild_id = $1 AND channel_min_age(id) IS NOT NULL AND NOT age_meets($2, channel_min_age(id))")
        .bind(guild_id).bind(uid).fetch_all(db).await?.into_iter().map(|r| r.0).collect())
}

/// Of these channels, the ones whose content this person may not have.
pub async fn blocked_among(db: &PgPool, channels: &[Uuid], uid: Uuid) -> AppResult<HashSet<Uuid>> {
    Ok(sqlx::query_as::<_, (Uuid,)>("SELECT id FROM channels WHERE id = ANY($1) AND channel_min_age(id) IS NOT NULL AND NOT age_meets($2, channel_min_age(id))")
        .bind(channels).bind(uid).fetch_all(db).await?.into_iter().map(|r| r.0).collect())
}

/// Whether the server itself asks for an age this person does not meet (Discover, previews).
pub async fn guild_blocked(db: &PgPool, guild_id: Uuid, uid: Uuid) -> AppResult<bool> {
    Ok(sqlx::query_as::<_, (bool,)>("SELECT min_age IS NOT NULL AND NOT age_meets($2, min_age) FROM guilds WHERE id = $1").bind(guild_id).bind(uid).fetch_optional(db).await?.map(|r| r.0).unwrap_or(false))
}

/// Refuse someone who does not meet the age a whole server asks for (joining it).
pub async fn check_guild(db: &PgPool, guild_id: Uuid, uid: Uuid) -> AppResult<()> {
    if !guild_blocked(db, guild_id, uid).await? { return Ok(()) }
    let minor: bool = sqlx::query_as::<_, (bool,)>("SELECT declared_minor FROM users WHERE id = $1").bind(uid).fetch_optional(db).await?.map(|r| r.0).unwrap_or(false);
    Err(AppError::AgeGate(minor))
}

/// A minimum age as sent by a client: 0 clears it, 13-21 sets it.
pub fn setting(age: i16) -> AppResult<Option<i16>> {
    match age {
        0 => Ok(None),
        13..=21 => Ok(Some(age)),
        _ => Err(AppError::BadRequest("The minimum age is 0 (none) or between 13 and 21".into())),
    }
}

/// Raising a minimum age needs only the permission to manage the place. Lowering or removing it also needs the
/// person to meet the age it has now, so that someone who cannot see the content cannot open it to everyone.
pub async fn may_change(db: &PgPool, uid: Uuid, old: Option<i16>, new: Option<i16>) -> AppResult<()> {
    let Some(old) = old else { return Ok(()) };
    if new.map(|n| n >= old).unwrap_or(false) { return Ok(()) }
    if meets(db, uid, old as i32).await? { return Ok(()) }
    Err(AppError::ForbiddenWith("Only someone who meets the current minimum age can lower or remove it.".into()))
}
