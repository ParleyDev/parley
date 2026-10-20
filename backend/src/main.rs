mod audit;
mod av;
mod auth;
mod config;
mod error;
mod models;
mod perms;
mod mail;
mod metrics;
mod mfa;
mod ratelimit;
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
    let config = config::Config::from_env();

    // Optional Sentry: error-level tracing events and panics become Sentry events when SENTRY_DSN is set.
    let _sentry = config.sentry_dsn.as_deref().filter(|d| !d.is_empty()).map(|dsn| {
        sentry::init((dsn, sentry::ClientOptions { release: sentry::release_name!(), environment: Some(config.sentry_environment.clone().into()), ..Default::default() }))
    });
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=info,sqlx=warn".into());
    let registry = tracing_subscriber::registry().with(filter).with(sentry::integrations::tracing::layer());
    if config.log_format == "json" {
        registry.with(tracing_subscriber::fmt::layer().json().flatten_event(true).with_current_span(false)).init();
    } else {
        registry.with(tracing_subscriber::fmt::layer()).init();
    }
    if _sentry.is_some() {
        tracing::info!("sentry error reporting enabled");
    }

    let db = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(&config.database_url)
        .await?;
    // Rolling back to an older build leaves newer rows in _sqlx_migrations; every migration here is additive, so
    // MIGRATIONS_IGNORE_MISSING=1 lets the older binary start against the newer schema (see README "Upgrades and rollback").
    let mut migrator = sqlx::migrate!("./migrations");
    if std::env::var("MIGRATIONS_IGNORE_MISSING").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false) {
        migrator.set_ignore_missing(true);
        tracing::warn!("MIGRATIONS_IGNORE_MISSING set: migrations unknown to this build are ignored");
    }
    migrator.run(&db).await?;
    tracing::info!("migrations applied");

    let state = state::AppState { db, config: Arc::new(config.clone()), hub: Arc::new(ws::hub::Hub::new()) };
    let state_for_sweep = state.clone();
    // Legacy data-URL avatars/banners become uploaded images (no-op once converted).
    routes::images::convert_data_urls(&state).await;
    // Rate limit overrides saved in Instance Settings apply from the start.
    if let Ok(s) = routes::admin::load_settings(&state.db).await { ratelimit::LIMITER.apply_overrides(&s.rate_limits); }
    // Cross-instance bus (Postgres LISTEN/NOTIFY) + shared presence: harmless on one instance, required for more.
    let (bus_tx, bus_rx) = tokio::sync::mpsc::unbounded_channel();
    state.hub.attach_bus(bus_tx);
    tokio::spawn(ws::bus::publisher(state.clone(), bus_rx));
    tokio::spawn(ws::bus::listener(state.clone()));
    tokio::spawn(ws::bus::heartbeat(state.clone()));
    tracing::info!(instance = %state.hub.instance_id, "instance id");

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
        .route("/metrics", get(metrics::endpoint))
        .route("/ws", get(ws::handler::ws_upgrade))
        .nest("/api", routes::api_router())
        .layer(axum::extract::DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(axum::middleware::from_fn(metrics::track))
        .with_state(state);

    tokio::spawn(routes::attachments::sweep_orphans(state_for_sweep.clone()));
    tokio::spawn(routes::images::sweep_orphans(state_for_sweep));
    tokio::spawn(ratelimit::prune_loop());
    let listener = tokio::net::TcpListener::bind(&config.bind_addr).await?;
    tracing::info!("listening on {}", config.bind_addr);
    axum::serve(listener, app).await?;
    Ok(())
}
