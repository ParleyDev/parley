mod auth;
mod config;
mod error;
mod models;
mod perms;
mod routes;
mod state;
mod ws;

use axum::{http::{header, HeaderValue, Method}, routing::get, Router};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower_http::{cors::{AllowOrigin, CorsLayer}, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=info,sqlx=warn".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = config::Config::from_env();

    let db = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&db).await?;
    tracing::info!("migrations applied");

    let state = state::AppState { db, config: Arc::new(config.clone()), hub: Arc::new(ws::hub::Hub::new()) };

    let cors = if config.cors_origins.is_empty() {
        CorsLayer::new().allow_origin(AllowOrigin::mirror_request())
    } else {
        CorsLayer::new().allow_origin(AllowOrigin::list(
            config.cors_origins.iter().filter_map(|o| HeaderValue::from_str(o).ok()),
        ))
    }
    .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE, Method::OPTIONS])
    .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
    .allow_credentials(true);

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(ws::handler::ws_upgrade))
        .nest("/api", routes::api_router())
        .layer(axum::extract::DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&config.bind_addr).await?;
    tracing::info!("listening on {}", config.bind_addr);
    axum::serve(listener, app).await?;
    Ok(())
}
