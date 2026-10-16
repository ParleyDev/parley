pub mod admin;
pub mod attachments;
pub mod auth;
pub mod channels;
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
pub mod polls;
pub mod relationships;
pub mod reports;
pub mod roles;
pub mod search;
pub mod sessions;
pub mod storage;
pub mod threads;
pub mod users;

use crate::state::AppState;
use axum::Router;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .merge(auth::router())
        .merge(users::router())
        .merge(mfa::router())
        .merge(sessions::router())
        .merge(search::router())
        .merge(reports::router())
        .merge(moderation::router())
        .merge(polls::router())
        .merge(embeds::router())
        .merge(storage::router())
        .merge(threads::router())
        .merge(guilds::router())
        .merge(invites::router())
        .merge(roles::router())
        .merge(relationships::router())
        .merge(channels::router())
        .merge(dms::router())
        .merge(attachments::router())
        .merge(images::router())
        .merge(expressions::router())
        .merge(gifs::router())
        .merge(discovery::router())
        .merge(admin::router())
}
