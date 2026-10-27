pub mod account;
pub mod admin;
pub mod applications;
pub mod assets;
pub mod asset_layers;
pub mod attachments;
pub mod automod;
pub mod auth;
pub mod badge;
pub mod calls;
pub mod channels;
pub mod customize;
pub mod templates;
pub mod announcements;
pub mod group_invites;
pub mod membership;
pub mod insights;
pub mod appeals;
pub mod webhooks;
pub mod interactions;
pub mod linked_roles;
pub mod apidoc;
pub mod qr_login;
pub mod server_tags;
pub mod recap;
pub mod directory;
pub mod integrations;
pub mod web_push;
pub mod captions;
pub mod ai;
pub mod spotify;
pub mod activities;
pub mod family;
pub mod connections;
pub mod discovery;
pub mod dms;
pub mod embeds;
pub mod expressions;
pub mod gifs;
pub mod images;
pub mod guilds;
pub mod highlights;
pub mod invites;
pub mod mfa;
pub mod moderation;
pub mod modtools;
pub mod passkeys;
pub mod polls;
pub mod relationships;
pub mod reports;
pub mod roles;
pub mod safety;
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
pub mod widget;

use crate::state::AppState;
use axum::Router;

pub fn api_router() -> Router<AppState> {
    Router::new()
        .merge(auth::router())
        .merge(users::router())
        .merge(web_push::router())
        .merge(captions::router())
        .merge(ai::router())
        .merge(spotify::router())
        .merge(activities::router())
        .merge(family::router())
        .merge(account::router())
        .merge(connections::router())
        .merge(integrations::router())
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
        .merge(modtools::router())
        .merge(calls::router())
        .merge(widget::router())
        .merge(automod::router())
        .merge(safety::router())
        .merge(highlights::router())
        .merge(customize::router())
        .merge(templates::router())
        .merge(announcements::router())
        .merge(group_invites::router())
        .merge(membership::router())
        .merge(insights::router())
        .merge(appeals::router())
        .merge(webhooks::router())
        .merge(interactions::router())
        .merge(linked_roles::router())
        .merge(apidoc::router())
        .merge(qr_login::router())
        .merge(server_tags::router())
        .merge(recap::router())
        .merge(directory::router())
        .merge(invites::router())
        .merge(roles::router())
        .merge(relationships::router())
        .merge(channels::router())
        .merge(dms::router())
        .merge(attachments::router())
        .merge(images::router())
        .merge(assets::router())
        .merge(asset_layers::router())
        .merge(expressions::router())
        .merge(gifs::router())
        .merge(discovery::router())
        .merge(admin::router())
        .merge(crate::mcp::api_router())
}
