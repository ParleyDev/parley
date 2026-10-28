mod audit;
mod av;
mod auth;
mod config;
mod error;
mod models;
mod perms;
mod push;
mod webpush;
mod mail;
mod metrics;
mod mfa;
mod ratelimit;
mod routes;
mod state;
mod mcp;
mod voice_audio;
mod ws;

use axum::{http::{header, HeaderValue, Method}, routing::get, Router};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower_http::{cors::{AllowOrigin, CorsLayer}, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Build version: PARLEY_VERSION baked at build (see scripts/version.mjs), else the crate version.
pub const VERSION: &str = match option_env!("PARLEY_VERSION") { Some(v) => v, None => env!("CARGO_PKG_VERSION") };

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
    .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::HeaderName::from_static("x-audit-log-reason")])
    .allow_credentials(true);

    // MCP tools call the API in-process as the connected user (same checks, events and limits as the app).
    mcp::set_internal(routes::api_router().with_state(state.clone()));
    // MCP and its OAuth endpoints are called cross-origin by AI clients (some in a browser) with bearer tokens, never
    // cookies, so any origin may call them.
    let mcp_cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::HeaderName::from_static("mcp-protocol-version"), header::HeaderName::from_static("mcp-session-id")])
        .expose_headers([header::WWW_AUTHENTICATE, header::HeaderName::from_static("mcp-session-id")]);

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/version", get(|| async { axum::Json(serde_json::json!({ "version": VERSION })) }))
        .route("/.well-known/apple-app-site-association", get(apple_app_site_association))
        .route("/.well-known/assetlinks.json", get(asset_links))
        .route("/metrics", get(metrics::endpoint))
        .route("/ws", get(ws::handler::ws_upgrade))
        // The versioned prefix (what the API reference documents) and the original one; both are the same API.
        .nest("/api/v1", routes::api_router().layer(axum::middleware::from_fn(audit::reason_scope)))
        .nest("/api", routes::api_router().layer(axum::middleware::from_fn(audit::reason_scope)))
        .layer(axum::extract::DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(cors)
        .merge(mcp::public_router().layer(axum::extract::DefaultBodyLimit::max(1024 * 1024)).layer(mcp_cors))
        .layer(TraceLayer::new_for_http())
        .layer(axum::middleware::from_fn(metrics::track))
        .with_state(state);

    let state_for_expiry = state_for_sweep.clone();
    let state_for_reminders = state_for_sweep.clone();
    tokio::spawn(routes::attachments::sweep_orphans(state_for_sweep.clone()));
    tokio::spawn(voice_audio::convert_backlog(state_for_sweep.clone()));
    tokio::spawn(routes::storage::fix_orientation_backlog(state_for_sweep.clone()));
    tokio::spawn(routes::images::sweep_orphans(state_for_sweep));
    tokio::spawn(ratelimit::prune_loop());
    tokio::spawn(routes::users::expire_statuses(state_for_expiry));
    tokio::spawn(routes::threads::auto_archive(state_for_reminders.clone()));
    tokio::spawn(routes::deletion::finalize_loop(state_for_reminders.clone()));
    tokio::spawn(audit::prune_loop(state_for_reminders.clone()));
    tokio::spawn(routes::integrations::sync_loop(state_for_reminders.clone()));
    tokio::spawn(routes::spotify::poll_loop(state_for_reminders.clone()));
    tokio::spawn(routes::channels::bookmark_reminders(state_for_reminders));
    let listener = tokio::net::TcpListener::bind(&config.bind_addr).await?;
    tracing::info!("listening on {}", config.bind_addr);
    axum::serve(listener, app).await?;
    Ok(())
}

/// Apple's app–site association: lets the listed iOS apps use this server's passkeys and security keys inside their
/// web view (WebAuthn in WKWebView needs the app to be associated with the relying party's domain).
async fn apple_app_site_association(axum::extract::State(state): axum::extract::State<state::AppState>) -> axum::response::Response {
    use axum::response::IntoResponse;
    if state.config.ios_app_ids.is_empty() { return axum::http::StatusCode::NOT_FOUND.into_response() }
    axum::Json(serde_json::json!({ "webcredentials": { "apps": state.config.ios_app_ids } })).into_response()
}

/// Digital Asset Links: tells Android the Parley app may use this server's passkeys and security keys (and open its
/// links). The app's web view only allows WebAuthn for sites that list it here.
async fn asset_links(axum::extract::State(state): axum::extract::State<state::AppState>) -> axum::response::Response {
    use axum::response::IntoResponse;
    let c = &state.config;
    if c.android_app_certs.is_empty() { return axum::http::StatusCode::NOT_FOUND.into_response() }
    axum::Json(serde_json::json!([{
        "relation": ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
        "target": { "namespace": "android_app", "package_name": c.android_app_id, "sha256_cert_fingerprints": c.android_app_certs },
    }])).into_response()
}
