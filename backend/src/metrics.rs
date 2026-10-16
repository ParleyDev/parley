//! Prometheus-style metrics at `GET /metrics` (text exposition format, no extra crates) and the request
//! middleware that feeds them. Optional `METRICS_TOKEN` guards the endpoint (bearer header or `?token=`).

use crate::state::AppState;
use axum::{
    body::Body,
    extract::{Query, Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::Instant;

/// Latency histogram buckets in milliseconds (cumulative, Prometheus style).
const BUCKETS_MS: [u64; 10] = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

#[derive(Default)]
pub struct Counters {
    // http_requests_total{method,class}: methods x status classes (1xx..5xx)
    pub requests: [[AtomicU64; 5]; 6],
    pub latency_buckets: [AtomicU64; 11],
    pub latency_sum_ms: AtomicU64,
    pub latency_count: AtomicU64,
    pub messages_created: AtomicU64,
    pub ws_connects: AtomicU64,
    pub ws_resumes: AtomicU64,
    pub uploads: AtomicU64,
    pub upload_bytes: AtomicU64,
    pub errors_5xx: AtomicU64,
    pub rate_limited: AtomicU64,
}

pub static METRICS: Counters = Counters {
    requests: [[AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0)], [AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0)], [AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0)], [AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0)], [AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0)], [AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0)]],
    latency_buckets: [AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0)],
    latency_sum_ms: AtomicU64::new(0),
    latency_count: AtomicU64::new(0),
    messages_created: AtomicU64::new(0),
    ws_connects: AtomicU64::new(0),
    ws_resumes: AtomicU64::new(0),
    uploads: AtomicU64::new(0),
    upload_bytes: AtomicU64::new(0),
    errors_5xx: AtomicU64::new(0),
    rate_limited: AtomicU64::new(0),
};

const METHODS: [&str; 6] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OTHER"];

fn method_idx(m: &axum::http::Method) -> usize {
    match *m {
        axum::http::Method::GET => 0,
        axum::http::Method::POST => 1,
        axum::http::Method::PUT => 2,
        axum::http::Method::PATCH => 3,
        axum::http::Method::DELETE => 4,
        _ => 5,
    }
}

/// Count every request by method and status class, and its latency.
pub async fn track(req: Request<Body>, next: Next) -> Response {
    let method = method_idx(req.method());
    let start = Instant::now();
    let resp = next.run(req).await;
    let ms = start.elapsed().as_millis() as u64;
    let status = resp.status().as_u16();
    let class = ((status / 100).clamp(1, 5) - 1) as usize;
    METRICS.requests[method][class].fetch_add(1, Relaxed);
    if status >= 500 { METRICS.errors_5xx.fetch_add(1, Relaxed); }
    if status == 429 { METRICS.rate_limited.fetch_add(1, Relaxed); }
    METRICS.latency_sum_ms.fetch_add(ms, Relaxed);
    METRICS.latency_count.fetch_add(1, Relaxed);
    for (i, b) in BUCKETS_MS.iter().enumerate() {
        if ms <= *b { METRICS.latency_buckets[i].fetch_add(1, Relaxed); }
    }
    METRICS.latency_buckets[BUCKETS_MS.len()].fetch_add(1, Relaxed); // +Inf
    resp
}

#[derive(Deserialize)]
pub struct MetricsQuery {
    token: Option<String>,
}

pub fn render(state: &AppState, online_users: u64) -> String {
    let mut out = String::with_capacity(4096);
    let line = |out: &mut String, s: &str| { out.push_str(s); out.push('\n'); };
    line(&mut out, "# HELP parley_http_requests_total HTTP requests by method and status class.");
    line(&mut out, "# TYPE parley_http_requests_total counter");
    for (mi, m) in METHODS.iter().enumerate() {
        for (ci, c) in ["1xx", "2xx", "3xx", "4xx", "5xx"].iter().enumerate() {
            let v = METRICS.requests[mi][ci].load(Relaxed);
            if v > 0 { line(&mut out, &format!("parley_http_requests_total{{method=\"{m}\",class=\"{c}\"}} {v}")); }
        }
    }
    line(&mut out, "# HELP parley_http_request_duration_ms HTTP request latency.");
    line(&mut out, "# TYPE parley_http_request_duration_ms histogram");
    for (i, b) in BUCKETS_MS.iter().enumerate() {
        line(&mut out, &format!("parley_http_request_duration_ms_bucket{{le=\"{b}\"}} {}", METRICS.latency_buckets[i].load(Relaxed)));
    }
    line(&mut out, &format!("parley_http_request_duration_ms_bucket{{le=\"+Inf\"}} {}", METRICS.latency_buckets[BUCKETS_MS.len()].load(Relaxed)));
    line(&mut out, &format!("parley_http_request_duration_ms_sum {}", METRICS.latency_sum_ms.load(Relaxed)));
    line(&mut out, &format!("parley_http_request_duration_ms_count {}", METRICS.latency_count.load(Relaxed)));
    let simple = [
        ("parley_http_errors_5xx_total", "counter", "Responses with a 5xx status.", METRICS.errors_5xx.load(Relaxed)),
        ("parley_http_rate_limited_total", "counter", "Responses with 429.", METRICS.rate_limited.load(Relaxed)),
        ("parley_messages_created_total", "counter", "Messages created (including system notices).", METRICS.messages_created.load(Relaxed)),
        ("parley_ws_connects_total", "counter", "WebSocket sessions started (READY).", METRICS.ws_connects.load(Relaxed)),
        ("parley_ws_resumes_total", "counter", "WebSocket sessions resumed with replay.", METRICS.ws_resumes.load(Relaxed)),
        ("parley_uploads_total", "counter", "Attachment uploads accepted.", METRICS.uploads.load(Relaxed)),
        ("parley_upload_bytes_total", "counter", "Bytes of attachments accepted.", METRICS.upload_bytes.load(Relaxed)),
        ("parley_ws_connections", "gauge", "Open WebSocket connections.", state.hub.socket_count() as u64),
        ("parley_online_users", "gauge", "Users with at least one open socket (any instance).", online_users),
        ("parley_voice_sessions", "gauge", "Users currently in a voice channel or call.", state.hub.voice_count() as u64),
        ("parley_ws_events_total", "counter", "Events broadcast through the hub.", state.hub.current_seq()),
        ("parley_db_pool_size", "gauge", "Open database connections.", state.db.size() as u64),
        ("parley_db_pool_idle", "gauge", "Idle database connections.", state.db.num_idle() as u64),
    ];
    for (name, kind, help, v) in simple {
        line(&mut out, &format!("# HELP {name} {help}"));
        line(&mut out, &format!("# TYPE {name} {kind}"));
        line(&mut out, &format!("{name} {v}"));
    }
    out
}

pub async fn endpoint(State(state): State<AppState>, headers: axum::http::HeaderMap, Query(q): Query<MetricsQuery>) -> Response {
    if let Some(expected) = state.config.metrics_token.as_deref().filter(|t| !t.is_empty()) {
        let bearer = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer "));
        if bearer != Some(expected) && q.token.as_deref() != Some(expected) {
            return (StatusCode::UNAUTHORIZED, "metrics token required").into_response();
        }
    }
    let online = crate::ws::bus::online_users(&state.db).await.len() as u64;
    ([(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")], render(&state, online)).into_response()
}
