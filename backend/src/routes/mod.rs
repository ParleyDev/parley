pub mod account;
pub mod admin;
pub mod applications;
pub mod assets;
pub mod attachments;
pub mod auth;
pub mod channels;
pub mod connections;
pub mod discovery;
pub mod dms;
pub mod embeds;
pub mod expressions;
pub mod gifs;
pub mod images;
pub mod guilds;
pub mod invites;
pub mod mfa;
pub mod moderation;
pub mod passkeys;
pub mod polls;
pub mod relationships;
pub mod reports;
pub mod roles;
pub mod search;
pub mod sessions;
pub mod sounds;
pub mod stage;
pub mod studio;
pub mod events;
pub mod storage;
pub mod threads;
pub mod users;
pub mod voice;

use crate::state::AppState;
use axum::Router;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .merge(auth::router())
        .merge(users::router())
        .merge(account::router())
        .merge(connections::router())
        .merge(applications::router())
        .merge(mfa::router())
        .merge(passkeys::router())
        .merge(sessions::router())
        .merge(search::router())
        .merge(reports::router())
        .merge(moderation::router())
        .merge(polls::router())
        .merge(embeds::router())
        .merge(storage::router())
        .merge(threads::router())
        .merge(voice::router())
        .merge(sounds::router())
        .merge(stage::router())
        .merge(studio::router())
        .merge(events::router())
        .merge(guilds::router())
        .merge(invites::router())
        .merge(roles::router())
        .merge(relationships::router())
        .merge(channels::router())
        .merge(dms::router())
        .merge(attachments::router())
        .merge(images::router())
        .merge(assets::router())
        .merge(expressions::router())
        .merge(gifs::router())
        .merge(discovery::router())
        .merge(admin::router())
        .merge(crate::mcp::api_router())
}
