pub mod auth;
pub mod channels;
pub mod dms;
pub mod guilds;
pub mod invites;
pub mod users;

use crate::state::AppState;
use axum::Router;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .merge(auth::router())
        .merge(users::router())
        .merge(guilds::router())
        .merge(invites::router())
        .merge(channels::router())
        .merge(dms::router())
}
